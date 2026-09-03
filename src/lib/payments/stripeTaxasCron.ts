import "server-only";
import Stripe from "stripe";
import { getDb } from "@/lib/db";
import { completarTaxasDoGateway } from "@/lib/transactions";
import { getStripeCredentials } from "@/lib/settings";
import { taxasDaCobranca } from "./stripeTaxas";

/**
 * REPESCAGEM das taxas da Stripe: venda paga que ficou sem taxa e sem
 * comissão da plataforma, buscada de novo no tique de 1 minuto.
 *
 * Serve também para RESGATAR o que já passou: venda internacional gravada
 * antes de o painel saber ler a liquidação continua sem o valor em real, e
 * sem ele fica fora do faturamento. A mesma consulta que preenche a taxa
 * preenche a conversão.
 *
 * Existe porque a tentativa do webhook é UM TIRO, disparado milissegundos
 * depois do pagamento aprovar — e nesse instante a `balance_transaction` da
 * cobrança, que é onde os números moram, muitas vezes ainda não existe. Foi
 * assim que uma venda de R$ 99,97 entrou com líquido igual ao valor cheio: a
 * mesma busca, feita à mão horas depois, respondeu na hora.
 *
 * Esperar alguns segundos dentro do webhook resolveria esse caso e só ele — e
 * atrasaria a resposta que a Stripe espera rápida (ela reenvia o evento
 * quando demora). Repescar cobre a demora da liquidação, o blip de rede, a
 * chave salva depois do primeiro webhook e qualquer motivo futuro, sem
 * segurar ninguém.
 *
 * A tentativa imediata do webhook continua: quando ela funciona, o número
 * aparece na hora e a repescagem não acha nada para fazer.
 */

/** Espera antes da primeira repescagem. Menos que isso e ela correria contra o
 *  próprio webhook, refazendo a consulta que ele acabou de fazer. */
const CARENCIA_MS = 60_000;

/** Até quando insistir. Depois disso a venda continua recuperável pelo botão
 *  "Buscar taxas na Stripe" na correção — mas para de consumir consulta a cada
 *  minuto por algo que já se mostrou insolúvel. */
const JANELA_MS = 2 * 24 * 60 * 60 * 1000;

/** Por tique. Segura o caso de várias vendas presas ao mesmo tempo sem virar
 *  uma rajada de consultas. */
const POR_TIQUE = 5;

export async function runStripeTaxasPendentes(): Promise<{ conferidas: number; preenchidas: number }> {
  const creds = getStripeCredentials();
  if (!creds) return { conferidas: 0, preenchidas: 0 };

  const agora = Date.now();
  const linhas = getDb()
    .prepare(
      `SELECT id, provider_ref
         FROM transactions
        WHERE provider = 'stripe'
          AND status = 'paid'
          -- Falta a taxa, OU falta a conversão numa venda que não é em real.
          -- A segunda condição é o que resgata a venda internacional antiga:
          -- ela entrou antes de o painel saber ler a liquidação e, sem o valor
          -- em real, fica fora do faturamento.
          AND (
            fee_cents IS NULL
            OR (COALESCE(currency, 'BRL') <> 'BRL' AND settled_amount_cents IS NULL)
            -- Cobrança e liquidação com o MESMO número numa venda que não é em
            -- real: o valor em real foi digitado no campo da cobrança, na época
            -- em que era o único jeito de o total fechar. A Stripe sabe quanto
            -- foi cobrado de verdade e devolve o par ao lugar.
            OR (COALESCE(currency, 'BRL') <> 'BRL' AND settled_amount_cents = amount_cents)
          )
          AND provider_ref IS NOT NULL AND provider_ref <> ''
          AND COALESCE(paid_at, created_at) BETWEEN ? AND ?
        ORDER BY COALESCE(paid_at, created_at) DESC
        LIMIT ?`,
    )
    .all(agora - JANELA_MS, agora - CARENCIA_MS, POR_TIQUE) as { id: string; provider_ref: string }[];
  if (linhas.length === 0) return { conferidas: 0, preenchidas: 0 };

  const stripe = new Stripe(creds.secretKey);
  let preenchidas = 0;
  for (const linha of linhas) {
    try {
      // A referência gravada é o id da SESSÃO quando a venda passou por um
      // checkout hospedado (o nosso ou o do sistema de fora) e o do
      // PaymentIntent quando a cobrança foi criada direto pela API. A busca é
      // sempre pelo PaymentIntent.
      let paymentIntentId = linha.provider_ref;
      if (paymentIntentId.startsWith("cs_")) {
        const sessao = await stripe.checkout.sessions.retrieve(paymentIntentId);
        const pi = sessao.payment_intent;
        const id = typeof pi === "string" ? pi : pi?.id;
        if (!id) continue;
        paymentIntentId = id;
      }
      const r = await taxasDaCobranca(stripe, paymentIntentId);
      if (!r.ok) continue;
      if (completarTaxasDoGateway(linha.id, r.taxas)) preenchidas++;
    } catch {
      // Uma venda que não resolve não pode impedir as outras da fila. O
      // próximo tique tenta de novo, até a janela fechar.
    }
  }
  return { conferidas: linhas.length, preenchidas };
}
