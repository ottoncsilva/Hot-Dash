import "server-only";
import Stripe from "stripe";
import { normalizeStatus, recordTransaction, updateStatusByRef } from "@/lib/transactions";
import { logWebhookEvent } from "@/lib/webhookLog";
import { deliverPaidTransaction } from "./deliverPayment";

export type ResultadoWebhookStripe = { ok: true; ignored?: boolean; reason?: string };

/**
 * Processa um evento da Stripe já com a assinatura verificada (ver
 * `/api/webhooks/stripe/route.ts`, que faz `stripe.webhooks.constructEvent`
 * sobre o corpo cru antes de chegar aqui).
 *
 * Só `checkout.session.completed` importa — é o evento de "pagamento único
 * aprovado" do modo `mode: "payment"` usado pelo adaptador
 * (`src/lib/payments/stripe.ts`). Assinaturas nativas da Stripe não existem
 * neste v1, então nenhum outro evento precisa de tratamento.
 */
export async function processarWebhookStripe(event: Stripe.Event): Promise<ResultadoWebhookStripe> {
  const registra = (decision: string) =>
    logWebhookEvent({
      provider: "stripe",
      providerRef: "id" in event.data.object ? String((event.data.object as { id?: string }).id || "") : undefined,
      decision: `${decision} · event: ${event.type}`,
      body: event,
    });

  if (event.type !== "checkout.session.completed") {
    registra("ignorado · evento não é checkout.session.completed");
    return { ok: true, ignored: true, reason: event.type };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const providerRef = session.id;
  // A Stripe só dispara este evento quando o pagamento foi concluído — não
  // existe "pending" chegando aqui, ao contrário do cashin da SyncPay.
  if (session.payment_status !== "paid") {
    registra(`ignorado · payment_status=${session.payment_status}`);
    return { ok: true, ignored: true, reason: "not_paid" };
  }

  const grossCents = typeof session.amount_total === "number" ? session.amount_total : undefined;

  const updated = updateStatusByRef("stripe", providerRef, "paid", { grossCents });
  registra(updated ? "cobrança atualizada · paid" : "venda nova · paid");

  if (!updated) {
    // Sessão paga sem transação `pending` pré-criada (não deveria acontecer
    // no fluxo do bot, que sempre grava a transação antes de mandar o link,
    // mas cobre qualquer checkout gerado fora desse caminho) — mesmo padrão
    // de fallback do webhook da SyncPay.
    recordTransaction({
      provider: "stripe",
      providerRef,
      description: "Venda Stripe",
      customer: session.customer_details?.name || session.customer_email || undefined,
      amountCents: grossCents ?? 0,
      currency: (session.currency || "usd").toUpperCase(),
      method: "card",
      status: normalizeStatus("paid"),
    });
    return { ok: true };
  }

  if (updated.becamePaid) {
    await deliverPaidTransaction(updated.transaction, registra);
  }

  return { ok: true };
}
