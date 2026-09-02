import "server-only";
import Stripe from "stripe";
import { findByProviderRef, nomeDoProduto, normalizeStatus, recordTransaction, updateStatusByRef } from "@/lib/transactions";
import { logWebhookEvent } from "@/lib/webhookLog";
import { avisarVendaAprovada, deliverPaidTransaction } from "./deliverPayment";
import {
  findSubscriptionByStripeSubscriptionId,
  findSubscriptionByTransaction,
  getBotConfig,
  getPlan,
  saveSubscription,
} from "@/lib/telegramDb";
import { getTelegramUser } from "@/lib/telegramUsers";
import { sendTelegramMessage } from "@/lib/telegramApi";
import { getStripeCredentials } from "@/lib/settings";
import { getDb } from "@/lib/db";
import { buscarRelatorioExterno } from "@/lib/externalSaleReport";
import { taxasDaCobranca } from "./stripeTaxas";

export type ResultadoWebhookStripe = { ok: true; ignored?: boolean; reason?: string };

/**
 * Textos FIXOS da ASSINATURA automática — mesmo espírito do
 * `CHECKOUT_INTL_TEXTS` do webhook do bot (mecânica de cobrança, não
 * conteúdo de persona), só que vivem aqui porque quem dispara é o webhook
 * da Stripe, não uma resposta a um clique do lead no bot.
 */
const TEXTOS_ASSINATURA = {
  pt: {
    renewed: "🔁 Sua assinatura renovou agora — acesso estendido automaticamente.",
    failed:
      "⚠️ Não conseguimos cobrar seu cartão neste ciclo. Vamos tentar de novo automaticamente — " +
      "atualize a forma de pagamento se continuar falhando.",
  },
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

/** "Cartão no Brasil" (`acceptCardBr`) também vira assinatura automática via
 *  Stripe (mesma decisão de sempre: "só o cartão vira automático") — esse
 *  comprador nunca passa pelo menu internacional, então `language` fica
 *  vazio, e o piso seguro pra quem NUNCA escolheu idioma é português, não
 *  inglês (mesmo critério de `deliverPayment.ts`). */
function idiomaDoLead(botId: string, telegramUserId: number): "pt" | "en" | "es" {
  const lang = getTelegramUser(`${botId}_${telegramUserId}`)?.language;
  return lang === "en" || lang === "es" ? lang : "pt";
}

/**
 * Processa um evento da Stripe já com a assinatura verificada (ver
 * `/api/webhooks/stripe/route.ts`, que faz `stripe.webhooks.constructEvent`
 * sobre o corpo cru antes de chegar aqui).
 *
 * Seis eventos importam agora — os quatro primeiros cobrem TODO o ciclo de
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
 *   • payment_intent.succeeded → REDE DE SEGURANÇA: cobrança paga nesta
 *     MESMA conta Stripe que não passou pelo checkout do Hot-Dash (ex.: um
 *     sistema externo, tipo o Bobz, usando a conta pra cobrar por fora do
 *     nosso fluxo). Sem isso, essa venda simplesmente não aparecia em lugar
 *     nenhum do Financeiro — ver `processarPaymentIntentSucedido`.
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
  if (event.type === "payment_intent.succeeded") {
    return processarPaymentIntentSucedido(event.data.object as Stripe.PaymentIntent, registra);
  }

  registra("ignorado · evento sem tratamento");
  return { ok: true, ignored: true, reason: event.type };
}

/**
 * Taxa, split e líquido da cobrança — ver `stripeTaxas.ts`. Fica aqui, entre
 * o webhook e a consulta, porque os dois caminhos de venda (checkout e
 * PaymentIntent solto) precisam do mesmo número e da mesma desistência
 * silenciosa quando a chave não está configurada.
 */
async function buscarTaxas(paymentIntent: string | Stripe.PaymentIntent | null | undefined) {
  const id = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
  if (!id) return null;
  const creds = getStripeCredentials();
  if (!creds) return null;
  return taxasDaCobranca(new Stripe(creds.secretKey), id);
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

  // O evento não traz taxa nem split — os dois moram na `balance_transaction`
  // da cobrança e só vêm por consulta. Sem isto a venda entrava com líquido
  // igual ao cheio, e a comissão de quem opera o bot por fora ficava invisível.
  const taxas = await buscarTaxas(session.payment_intent);
  if (taxas) {
    registra(
      `taxas da Stripe · processamento ${taxas.feeCents} · plataforma ${taxas.splitCents} · líquido ${taxas.netCents}`,
    );
  }

  const updated = updateStatusByRef("stripe", providerRef, "paid", {
    grossCents,
    netCents: taxas?.netCents,
    feeCents: taxas?.feeCents,
    splitCents: taxas?.splitCents,
  });
  if (updated) registra("cobrança atualizada · paid");

  if (!updated) {
    // Sessão paga sem transação `pending` pré-criada (não deveria acontecer
    // no fluxo do bot, que sempre grava a transação antes de mandar o link,
    // mas cobre qualquer checkout gerado fora desse caminho) — mesmo padrão
    // de fallback do webhook da SyncPay. Se o Canal de Vendas já mandou o
    // relatório dessa venda (ex.: Bobz), ele já diz de qual modelo/bot é.
    const vinculo = buscarRelatorioExterno("stripe", providerRef);
    recordTransaction({
      provider: "stripe",
      providerRef,
      profileId: vinculo?.profileId,
      botId: vinculo?.botId,
      // Só o nome do produto; sem relatório ainda, vazio (a tela mostra "—").
      // `mode: "subscription"` é a própria Stripe dizendo que esta compra
      // criou uma assinatura — não precisa deduzir de mais nada.
      description: nomeDoProduto(vinculo?.planName, session.mode === "subscription"),
      customer:
        session.customer_details?.name ||
        session.customer_email ||
        vinculo?.customerName ||
        vinculo?.telegramUsername ||
        undefined,
      amountCents: grossCents ?? 0,
      netAmountCents: taxas?.netCents,
      feeCents: taxas?.feeCents,
      splitCents: taxas?.splitCents,
      currency: (session.currency || "usd").toUpperCase(),
      method: "card",
      status: normalizeStatus("paid"),
      // O relatório do Canal de Vendas também traz o deep-link que trouxe o
      // lead e diz que a venda veio de um bot — sem isso ela entra no
      // Financeiro sem origem e some do Funil de Vendas.
      sourceCode: vinculo?.sourceCode,
      origin: vinculo?.botId ? "bot" : undefined,
    });
    registra(
      vinculo?.profileId
        ? `venda nova · paid · vinculada pelo Canal de Vendas (bot ${vinculo.botId})`
        : "venda nova · paid · sem relatório do Canal de Vendas ainda (Sem modelo)",
    );
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
    // Fatura de renovação: por definição é cobrança que se repetiu sozinha.
    description: nomeDoProduto(plan?.name, true),
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

/**
 * REDE DE SEGURANÇA para cobrança que a Stripe aprovou nesta conta SEM
 * passar pelo checkout do Hot-Dash — o caso concreto é um sistema externo
 * (o Bobz, hoje) que opera alguns bots por fora e usa a MESMA conta Stripe
 * pra cobrar. Sem isso, essa venda não aparecia em canto nenhum do
 * Financeiro: `checkout.session.completed` só dispara pra quem passa pelo
 * checkout hospedado da Stripe, e um `PaymentIntent` criado direto pela API
 * (sem Checkout Session) nunca gera esse evento.
 *
 * Só é tratada como venda NOVA quando as 3 checagens abaixo passam — cada
 * uma existe pra NÃO duplicar uma venda que já é nossa e já está sendo
 * contada por outro caminho:
 *
 *  1. Ainda não tem transação gravada pra este PaymentIntent (reenvio do
 *     mesmo evento, ou já foi gravada pelo `checkout.session.completed`
 *     usando o MESMO id — ver 3).
 *  2. Não pertence a um cliente que já tem assinatura Stripe local — nesse
 *     caso é uma renovação automática, e quem contabiliza é
 *     `processarRenovacaoPaga` (via `invoice.paid`), não aqui. (O SDK desta
 *     versão da Stripe nem expõe mais `payment_intent.invoice` — perguntar
 *     pro cliente local é o jeito confiável de saber.)
 *  3. Não existe um Checkout Session associado a este PaymentIntent — se
 *     existir, é uma venda que passou pelo NOSSO checkout (ou o do Bobz, se
 *     ele também usar Checkout Sessions) e `checkout.session.completed` já
 *     cuida dela (gravada sob o id da SESSÃO, não do PaymentIntent — os dois
 *     eventos disparam pra mesma cobrança, cada um com sua própria
 *     referência).
 */
async function processarPaymentIntentSucedido(
  pi: Stripe.PaymentIntent,
  registra: (s: string) => void,
): Promise<ResultadoWebhookStripe> {
  if (findByProviderRef("stripe", pi.id)) {
    registra("ignorado · já registrada");
    return { ok: true, ignored: true, reason: "already_recorded" };
  }

  const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  if (customerId) {
    const jaAssinante = getDb()
      .prepare("SELECT 1 FROM telegram_subscriptions WHERE stripe_customer_id = ? LIMIT 1")
      .get(customerId);
    if (jaAssinante) {
      registra("ignorado · cliente já é assinante Stripe local (renovação, contada via invoice.paid)");
      return { ok: true, ignored: true, reason: "known_subscriber" };
    }
  }

  const creds = getStripeCredentials();
  if (creds) {
    try {
      const stripe = new Stripe(creds.secretKey);
      const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
      if (sessions.data.length > 0) {
        registra("ignorado · veio de um Checkout Session (checkout.session.completed cuida dela)");
        return { ok: true, ignored: true, reason: "has_checkout_session" };
      }
    } catch (e) {
      // Consulta à Stripe falhou (rede, chave) — não dá pra confirmar que
      // NÃO é duplicata. Mais seguro não gravar agora do que arriscar
      // duplicar: o próximo reenvio do Telegram/Stripe tenta de novo.
      registra(`ignorado · falha ao checar Checkout Session (${e instanceof Error ? e.message : "erro"})`);
      return { ok: true, ignored: true, reason: "check_failed" };
    }
  }

  // Passou pelas 3 checagens: cobrança de verdade, desta conta, que o
  // Hot-Dash não iniciou e não é renovação de assinatura conhecida — grava
  // como venda nova. Se o Canal de Vendas já mandou o relatório dessa venda
  // (ex.: Bobz), ela já nasce atribuída ao modelo/bot certo; sem relatório
  // ainda, nasce "Sem modelo" como sempre (corrige na tela de Financeiro, ou
  // sozinha se o relatório chegar depois).
  const vinculo = buscarRelatorioExterno("stripe", pi.id);
  const taxasPi = await buscarTaxas(pi.id);
  const nova = recordTransaction({
    provider: "stripe",
    providerRef: pi.id,
    profileId: vinculo?.profileId,
    botId: vinculo?.botId,
    description: vinculo?.planName,
    customer: pi.receipt_email || vinculo?.customerName || vinculo?.telegramUsername || undefined,
    amountCents: pi.amount_received || pi.amount,
    netAmountCents: taxasPi?.netCents,
    feeCents: taxasPi?.feeCents,
    splitCents: taxasPi?.splitCents,
    currency: (pi.currency || "usd").toUpperCase(),
    method: "card",
    // Mesma completude do outro caminho de venda fria: origem de tráfego e
    // "veio de bot" saem do relatório do Canal de Vendas.
    sourceCode: vinculo?.sourceCode,
    origin: vinculo?.botId ? "bot" : undefined,
    status: normalizeStatus("paid"),
  });
  registra(
    vinculo?.profileId
      ? `venda nova (PaymentIntent fora do checkout) · paid · vinculada pelo Canal de Vendas (bot ${vinculo.botId})`
      : "venda nova (PaymentIntent fora do checkout) · paid · sem relatório do Canal de Vendas ainda (Sem modelo)",
  );

  // Mesmo alerta da venda fria da SyncPay: esta cobrança não passa por
  // `deliverPaidTransaction` e, sem isto, entrava no Financeiro em silêncio.
  await avisarVendaAprovada(nova.id).catch(() => {});
  return { ok: true };
}
