import "server-only";
import Stripe from "stripe";

/**
 * O que sobrou de uma cobrança na Stripe: quanto o gateway cobrou, quanto a
 * PLATAFORMA reteve e quanto de fato caiu na conta.
 *
 * Existe porque o webhook não traz nada disso. Um `checkout.session.completed`
 * (e um `payment_intent.succeeded`) carrega o valor cheio e mais nada — sem
 * taxa, sem split, sem líquido. Esses números moram na `balance_transaction`
 * da cobrança, um objeto a dois saltos de distância, e só chegam aqui por uma
 * consulta explícita à API.
 *
 * Sem isto, venda da Stripe entrava no Financeiro com líquido = valor cheio
 * (ver `updateStatusByRef`): o painel mostrava dinheiro que nunca chegou, e a
 * classificação por taxa retida — a que separa funil de LTV numa venda de bot
 * operado por fora — não tinha o que comparar.
 *
 * `application_fee` é a peça que importa: quando outro sistema opera o bot e
 * cobra pela conta da modelo via Stripe Connect, a comissão dele aparece aí,
 * e é o equivalente exato do `split` da SyncPay. No app da Stripe é a linha
 * "Tarifa da plataforma"; "Tarifa de processamento" é o resto da `fee`.
 */
export type TaxasDaCobranca = {
  /** O que a Stripe cobrou, já SEM a comissão da plataforma. `null` quando a
   *  cobrança ainda não entrou no saldo e só a comissão é conhecida.
   *  Na MOEDA DE LIQUIDAÇÃO, que é como a Stripe cobra. */
  feeCents: number | null;
  /** A comissão de quem opera o bot por fora (`application_fee`). */
  splitCents: number;
  /** O que sobrou: valor cheio − taxa − split. `null` junto com a taxa. */
  netCents: number | null;
  /** A moeda em que o dinheiro ENTROU na conta. Numa venda em real é a mesma
   *  da cobrança; num cartão internacional é o real do depósito. */
  moeda: string;
  /** O bruto NA MOEDA DE LIQUIDAÇÃO: US$ 19,90 cobrados viram R$ 101,28
   *  depositados, com a cotação que a própria Stripe usou. `null` quando a
   *  cobrança ainda não liquidou e só a comissão é conhecida. */
  grossCents: number | null;
  /** O bruto NA MOEDA DA COBRANÇA, como o cliente pagou (US$ 19,90). É a
   *  Stripe dizendo qual é o valor da venda — serve para conferir o que está
   *  gravado numa venda internacional, onde os dois números convivem e é
   *  fácil o de real acabar no lugar do de dólar. */
  chargedCents: number;
  /** A moeda em que o cliente foi COBRADO. */
  chargedMoeda: string;
};

/**
 * Por que não deu para responder. Vai para o diário de webhooks: uma busca que
 * falha em silêncio é uma venda entrando com líquido errado sem deixar rastro,
 * e foi exatamente assim que a primeira delas passou despercebida.
 */
export type ResultadoTaxas =
  | { ok: true; taxas: TaxasDaCobranca }
  | { ok: false; motivo: string };

/**
 * Busca os três números da cobrança de um PaymentIntent.
 *
 * Nunca lança: é chamada de dentro de webhook, e uma falha de rede na Stripe
 * não pode derrubar o registro de uma venda que já foi paga. Quando não dá
 * para responder, diz por quê em vez de devolver vazio.
 */
export async function taxasDaCobranca(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<ResultadoTaxas> {
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
  } catch (e) {
    return { ok: false, motivo: `consulta falhou (${e instanceof Error ? e.message : "erro"})` };
  }

  const charge = pi.latest_charge;
  if (!charge || typeof charge === "string") {
    return { ok: false, motivo: "PaymentIntent sem cobrança expandida" };
  }

  const bt = charge.balance_transaction;
  if (!bt || typeof bt === "string") {
    // A `balance_transaction` é criada quando a cobrança entra no saldo, o que
    // pode demorar um instante depois do pagamento aprovar. A comissão da
    // plataforma, porém, já está na própria cobrança — dá para salvar o número
    // que separa funil de LTV mesmo sem o resto.
    const comissao = charge.application_fee_amount;
    if (typeof comissao === "number" && comissao > 0) {
      // `application_fee_amount` vem na moeda da COBRANÇA — é o único número
      // conhecido nesse instante, e a conversão só existe na liquidação.
      return {
        ok: true,
        taxas: {
          feeCents: null,
          splitCents: comissao,
          netCents: null,
          moeda: charge.currency.toUpperCase(),
          grossCents: null,
          chargedCents: charge.amount,
          chargedMoeda: charge.currency.toUpperCase(),
        },
      };
    }
    return { ok: false, motivo: "cobrança ainda sem balance_transaction" };
  }

  // A `balance_transaction` é na moeda de LIQUIDAÇÃO da conta, que não é
  // obrigatoriamente a da cobrança: uma venda em dólar numa conta brasileira é
  // depositada em real. Nesse caso `bt.amount` É a conversão — feita pela
  // própria Stripe, com a cotação do momento — e vai junto, para o painel
  // poder somar a venda no faturamento em real sem inventar cotação nenhuma.
  //
  // Isto era uma TRAVA: quando as moedas diferiam a leitura inteira era
  // descartada, e a venda internacional entrava sem taxa e sem líquido.

  const comissaoPlataforma = (bt.fee_details || [])
    .filter((d) => d.type === "application_fee")
    .reduce((soma, d) => soma + d.amount, 0);

  return {
    ok: true,
    taxas: {
      // `bt.fee` é o desconto TOTAL, comissão da plataforma inclusa. Aqui os
      // dois viram colunas separadas — é assim que o Financeiro já mostra a
      // venda da SyncPay, e é o que a tela da Stripe também separa. Tudo que
      // não é comissão da plataforma entra na TAXA: processamento, conversão
      // de moeda e imposto, exatamente como o extrato dela soma.
      feeCents: Math.max(0, bt.fee - comissaoPlataforma),
      splitCents: comissaoPlataforma,
      netCents: bt.net,
      moeda: bt.currency.toUpperCase(),
      grossCents: bt.amount,
      chargedCents: charge.amount,
      chargedMoeda: charge.currency.toUpperCase(),
    },
  };
}
