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
  /** O que a Stripe cobrou, já SEM a comissão da plataforma. */
  feeCents: number;
  /** A comissão de quem opera o bot por fora (`application_fee`). */
  splitCents: number;
  /** O que sobrou: valor cheio − taxa − split. */
  netCents: number;
};

/**
 * Busca os três números da cobrança de um PaymentIntent. Devolve `null`
 * quando não dá para responder com honestidade — e aí quem chama grava o que
 * já gravava, em vez de inventar valor.
 *
 * Nunca lança: é chamada de dentro de webhook, e uma falha de rede na Stripe
 * não pode derrubar o registro de uma venda que já foi paga.
 */
export async function taxasDaCobranca(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<TaxasDaCobranca | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = pi.latest_charge;
    if (!charge || typeof charge === "string") return null;
    const bt = charge.balance_transaction;
    if (!bt || typeof bt === "string") return null;

    // A `balance_transaction` é na moeda de LIQUIDAÇÃO da conta, que não é
    // obrigatoriamente a da cobrança (venda em dólar numa conta que liquida em
    // real, por exemplo). Quando diferem, `fee` e `net` estão numa moeda e o
    // valor gravado na transação está noutra: subtrair um do outro produziria
    // um líquido inventado. Melhor não responder.
    if (bt.currency !== charge.currency || bt.amount !== charge.amount) return null;

    const comissaoPlataforma = (bt.fee_details || [])
      .filter((d) => d.type === "application_fee")
      .reduce((soma, d) => soma + d.amount, 0);

    return {
      // `bt.fee` é o desconto TOTAL, comissão da plataforma inclusa. Aqui os
      // dois viram colunas separadas — é assim que o Financeiro já mostra a
      // venda da SyncPay, e é o que a tela da Stripe também separa.
      feeCents: Math.max(0, bt.fee - comissaoPlataforma),
      splitCents: comissaoPlataforma,
      netCents: bt.net,
    };
  } catch {
    return null;
  }
}
