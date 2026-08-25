import "server-only";
import Stripe from "stripe";
import { publicOriginSemRequest } from "../publicOrigin";
import type { ChargeInput, ChargeResult, PaymentProvider } from "./types";

/**
 * Adaptador Stripe — cartão em moeda estrangeira (USD), para leads de fora do
 * Brasil. Usa Checkout Session em MODO PAGAMENTO ÚNICO (`mode: "payment"`),
 * não assinatura nativa: a cobrança é avulsa por ciclo, igual ao PIX hoje —
 * o motor de renovação/downsell que já existe cuida da virada.
 *
 * `providerRef = session.id` é o mesmo mecanismo do PIX: a transação
 * `pending` é pré-criada com esse `providerRef`, e o webhook
 * (`/api/webhooks/stripe`) só faz `updateStatusByRef("stripe", providerRef, ...)`.
 */
export function createStripe(creds: { secretKey: string; webhookSecret: string }): PaymentProvider {
  const stripe = new Stripe(creds.secretKey);

  return {
    key: "stripe",

    async createCharge(input: ChargeInput): Promise<ChargeResult> {
      const origin = publicOriginSemRequest();
      const moeda = (input.currency || "USD").toLowerCase();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: moeda,
              unit_amount: input.amountCents,
              product_data: { name: input.description || "Assinatura" },
            },
            quantity: 1,
          },
        ],
        customer_email: input.customer?.email || undefined,
        metadata: input.metadata || {},
        success_url: `${origin}/checkout/stripe/obrigado`,
        cancel_url: `${origin}/checkout/stripe/cancelado`,
      });

      return {
        providerRef: session.id,
        status: "pending",
        checkoutUrl: session.url || undefined,
        raw: session,
      };
    },

    async getBalance() {
      const bal = await stripe.balance.retrieve();
      // Soma tudo que está disponível, através das moedas — mistura USD com
      // outra moeda seria incorreto, mas hoje só existe cobrança em USD.
      const cents = bal.available.reduce((acc, b) => acc + b.amount, 0);
      return { availableCents: cents, raw: bal };
    },
  };
}

/** Testa credenciais sem afetar cache/estado de nenhum provider já instanciado. */
export async function testStripeCredentials(
  secretKey: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const stripe = new Stripe(secretKey);
    await stripe.balance.retrieve();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "falha ao conectar com a Stripe",
    };
  }
}
