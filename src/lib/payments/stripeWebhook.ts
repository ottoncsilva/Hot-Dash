import "server-only";
import Stripe from "stripe";
import { findByProviderRef, normalizeStatus, recordTransaction, updateStatusByRef } from "@/lib/transactions";
import { logWebhookEvent } from "@/lib/webhookLog";
import { deliverPaidTransaction } from "./deliverPayment";
import {
  findSubscriptionByStripeSubscriptionId,
  findSubscriptionByTransaction,
  getBotConfig,
  getPlan,
  saveSubscription,
} from "@/lib/telegramDb";
import { getTelegramUser } from "@/lib/telegramUsers";
import { sendTelegramMessage } from "@/lib/telegramApi";

export type ResultadoWebhookStripe = { ok: true; ignored?: boolean; reason?: string };

/**
 * Textos FIXOS da ASSINATURA automática — mesmo espírito do
 * `CHECKOUT_INTL_TEXTS` do webhook do bot (mecânica de cobrança, não
 * conteúdo de persona), só que vivem aqui porque quem dispara é o webhook
 * da Stripe, não uma resposta a um clique do lead no bot.
 */
const TEXTOS_ASSINATURA = {
  en: {
    renewed: "🔁 Your subscription just renewed — access extended automatically.",
    failed:
      "⚠️ We couldn't charge your card for this cycle. We'll try again automatically — " +
      "update your payment method if it keeps failing.",
  },
  es: {
    renewed: "🔁 Tu suscripción se renovó — el acceso fue extendido automáticamente.",
    failed:
      "⚠️ No pudimos cobrar tu tarjeta en este ciclo. Vamos a intentarlo de nuevo automáticamente — " +
      "actualiza tu método de pago si sigue fallando.",
  },
} as const;

function idiomaDoLead(botId: string, telegramUserId: number): "en" | "es" {
  const lang = getTelegramUser(`${botId}_${telegramUserId}`)?.language;
  return lang === "es" ? "es" : "en"; // comprador internacional: nunca português, "en" é o piso seguro.
}

/**
 * Processa um evento da Stripe já com a assinatura verificada (ver
 * `/api/webhooks/stripe/route.ts`, que faz `stripe.webhooks.constructEvent`
 * sobre o corpo cru antes de chegar aqui).
 *
 * Cinco eventos importam agora — os quatro primeiros cobrem TODO o ciclo de
 * vida de uma assinatura automática (checkout internacional, `mode:
 * "subscription"` — ver `src/lib/payments/stripe.ts`); pagamento avulso
 * (PIX e Stripe `mode: "payment"`) só usa o primeiro:
 *
 *   • checkout.session.completed → primeira cobrança aprovada (avulsa OU
 *     assinatura — é o mesmo evento nos dois modos).
 *   • invoice.paid / invoice.payment_succeeded → a Stripe cobrou um ciclo
 *     NOVO sozinha (renovação automática).
 *   • invoice.payment_failed → tentativa de renovação que não passou.
 *   • customer.subscription.deleted → assinatura cancelada/encerrada.
 */
export async function processarWebhookStripe(event: Stripe.Event): Promise<ResultadoWebhookStripe> {
  const registra = (decision: string) =>
    logWebhookEvent({
      provider: "stripe",
      providerRef: "id" in event.data.object ? String((event.data.object as { id?: string }).id || "") : undefined,
      decision: `${decision} · event: ${event.type}`,
      body: event,
    });

  if (event.type === "checkout.session.completed") {
    return processarCheckoutCompleto(event.data.object as Stripe.Checkout.Session, registra);
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    return processarRenovacaoPaga(event.data.object as Stripe.Invoice, registra);
  }
  if (event.type === "invoice.payment_failed") {
    return processarRenovacaoFalhou(event.data.object as Stripe.Invoice, registra);
  }
  if (event.type === "customer.subscription.deleted") {
    registra("assinatura cancelada/encerrada · acesso segue até o vencimento já gravado");
    return { ok: true };
  }

  registra("ignorado · evento sem tratamento");
  return { ok: true, ignored: true, reason: event.type };
}

async function processarCheckoutCompleto(
  session: Stripe.Checkout.Session,
  registra: (s: string) => void,
): Promise<ResultadoWebhookStripe> {
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

  // ASSINATURA (mode: "subscription"): a Stripe só cria a Subscription/
  // Customer quando o checkout completa — não dava pra saber esses ids na
  // hora de gerar o link (ver stripe.ts). Grava agora, na inscrição local,
  // pra: (a) o webhook de renovação achar quem estender quando a Stripe
  // cobrar sozinha, (b) o Alerta de Renovação manual saber que esta
  // inscrição não precisa mais dele (ver runTelegramFunnels).
  if (session.subscription) {
    const sub = findSubscriptionByTransaction(updated.transaction.id);
    if (sub) {
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      saveSubscription({ ...sub, stripeSubscriptionId: subscriptionId, stripeCustomerId: customerId });
      registra("assinatura Stripe vinculada · renovação automática ligada");
    }
  }

  if (updated.becamePaid) {
    await deliverPaidTransaction(updated.transaction, registra);
  }

  return { ok: true };
}

async function processarRenovacaoPaga(
  invoice: Stripe.Invoice,
  registra: (s: string) => void,
): Promise<ResultadoWebhookStripe> {
  // A primeira cobrança de uma assinatura também gera uma invoice paga, mas
  // ela já foi tratada via checkout.session.completed — processar de novo
  // aqui duplicaria a liberação de acesso (convite VIP, entregável etc.).
  if (invoice.billing_reason === "subscription_create") {
    registra("ignorado · primeira cobrança da assinatura, já tratada via checkout.session.completed");
    return { ok: true, ignored: true, reason: "subscription_create" };
  }

  const stripeSubscriptionId = invoice.parent?.subscription_details?.subscription;
  const subId = typeof stripeSubscriptionId === "string" ? stripeSubscriptionId : stripeSubscriptionId?.id;
  if (!subId) {
    registra("ignorado · invoice sem assinatura associada");
    return { ok: true, ignored: true, reason: "no_subscription" };
  }

  // Dedupe: a Stripe reentrega webhook (rede instável, timeout na nossa
  // resposta) — sem isso, um reenvio estenderia o acesso duas vezes pelo
  // mesmo ciclo pago uma vez só.
  if (findByProviderRef("stripe", invoice.id)) {
    registra("ignorado · invoice já processada");
    return { ok: true, ignored: true, reason: "already_processed" };
  }

  const sub = findSubscriptionByStripeSubscriptionId(subId);
  if (!sub) {
    registra("ignorado · assinatura Stripe sem inscrição local correspondente");
    return { ok: true, ignored: true, reason: "no_local_subscription" };
  }

  const bot = getBotConfig(sub.botId);
  if (!bot) {
    registra("ignorado · bot da inscrição não existe mais");
    return { ok: true, ignored: true, reason: "no_bot" };
  }

  const plan = sub.planId ? getPlan(sub.planId) : null;
  const durationDays = plan && plan.durationDays > 0 ? plan.durationDays : 30;

  recordTransaction({
    provider: "stripe",
    providerRef: invoice.id,
    profileId: bot.profileId,
    description: `Renovação Stripe - ${plan?.name || "assinatura"}`,
    amountCents: invoice.amount_paid,
    currency: (invoice.currency || "usd").toUpperCase(),
    method: "card",
    status: "paid",
    origin: "bot",
  });

  // Estende a partir do MAIOR entre o vencimento atual e agora: se a Stripe
  // cobrou um pouco antes do fim do ciclo, o lead não perde o restante que
  // já tinha pago.
  const base = Math.max(sub.expiresAt, Date.now());
  saveSubscription({ ...sub, expiresAt: base + durationDays * 24 * 60 * 60 * 1000 });
  registra("assinatura renovada automaticamente · acesso estendido");

  try {
    const idioma = idiomaDoLead(bot.id, sub.telegramUserId);
    await sendTelegramMessage(bot.botToken, String(sub.telegramUserId), TEXTOS_ASSINATURA[idioma].renewed);
  } catch {
    /* aviso ao lead é best-effort — não pode derrubar a renovação já gravada */
  }

  return { ok: true };
}

async function processarRenovacaoFalhou(
  invoice: Stripe.Invoice,
  registra: (s: string) => void,
): Promise<ResultadoWebhookStripe> {
  const stripeSubscriptionId = invoice.parent?.subscription_details?.subscription;
  const subId = typeof stripeSubscriptionId === "string" ? stripeSubscriptionId : stripeSubscriptionId?.id;
  if (!subId) {
    registra("ignorado · invoice sem assinatura associada");
    return { ok: true, ignored: true, reason: "no_subscription" };
  }

  const sub = findSubscriptionByStripeSubscriptionId(subId);
  if (!sub) {
    registra("ignorado · assinatura Stripe sem inscrição local correspondente");
    return { ok: true, ignored: true, reason: "no_local_subscription" };
  }

  const bot = getBotConfig(sub.botId);
  if (!bot) {
    registra("ignorado · bot da inscrição não existe mais");
    return { ok: true, ignored: true, reason: "no_bot" };
  }

  // Não mexe em `expiresAt`: a Stripe tenta cobrar de novo sozinha (Smart
  // Retries, configurado na própria conta) dentro do prazo que já vencia —
  // se não conseguir a tempo, a expiração natural (runTelegramEviction, já
  // existente) remove o acesso no prazo de sempre. Sem carência nova aqui.
  registra("renovação falhou · Stripe tenta de novo automaticamente");

  try {
    const idioma = idiomaDoLead(bot.id, sub.telegramUserId);
    await sendTelegramMessage(bot.botToken, String(sub.telegramUserId), TEXTOS_ASSINATURA[idioma].failed);
  } catch {
    /* aviso ao lead é best-effort */
  }

  try {
    const { sendPushEvent } = await import("@/lib/push");
    await sendPushEvent(
      "sale",
      "⚠️ Renovação automática falhou",
      `Assinatura Stripe de ${sub.telegramUsername || sub.telegramUserId} — a Stripe vai tentar cobrar de novo.`,
      "/dashboard/payments",
    );
  } catch {
    /* push é aviso, não pode derrubar o processamento */
  }

  return { ok: true };
}
