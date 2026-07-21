import { NextRequest, NextResponse } from "next/server";
import { normalizeStatus, recordTransaction, updateStatusByRef } from "@/lib/transactions";
import { ensureSyncpayWebhookToken } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook da SyncPay (postbackUrl das cobranças). Recebe a confirmação de
 * pagamento e atualiza a transação correspondente no banco. NÃO exige login
 * (é a SyncPay chamando), mas só age sobre transações que já existem no nosso
 * banco (criadas pela cobrança) — a menos que ainda não exista, caso em que
 * registra para não perder a venda.
 *
 * Payload documentado:
 * { "data": { "id", "client": { name, email, document }, "pix_code",
 *   "amount", "final_amount", "currency", "status", "payment_method",
 *   "created_at", "updated_at" } }
 * status: pending | completed | failed | refunded | med
 */
export async function POST(req: NextRequest) {
  try {
    // Autenticidade do webhook: aceita o token gerenciado (o que a UI mostra
    // para colar na SyncPay) ou, por retrocompatibilidade, o SESSION_SECRET
    // usado nas versões antigas. O token pode vir em ?token= ou no header.
    const provided =
      req.nextUrl.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
    const expected = ensureSyncpayWebhookToken();
    const legacy = process.env.SESSION_SECRET || "";
    if (!provided || (provided !== expected && !(legacy && provided === legacy))) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Aceita tanto { data: {...} } quanto o objeto direto.
    const data = ((body.data as Record<string, unknown>) || body) as Record<
      string,
      unknown
    >;

    const providerRef = String(
      data.id || data.idTransaction || data.transaction_id || "",
    );
    const status = String(data.status || data.status_transaction || "");
    if (!providerRef || !status) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const updated = updateStatusByRef("syncpay", providerRef, status);

    if (updated && updated.becamePaid) {
      // Verifica se existe uma inscrição do Telegram pendente para esta transação
      const { findSubscriptionByTransaction, saveSubscription, getBotConfig, getPlan } = await import("@/lib/telegramDb");
      const sub = findSubscriptionByTransaction(updated.transaction.id);

      if (sub && sub.status === "pending") {
        const bot = getBotConfig(sub.botId);
        if (bot) {
          const { createTelegramInviteLink, sendTelegramMessage } = await import("@/lib/telegramApi");
          const plan = sub.planId ? getPlan(sub.planId) : null;
          const isPackage = plan?.kind === "package";

          try {
            if (isPackage) {
              // PACOTE (compra única): entrega o conteúdo, sem acesso VIP.
              // expiresAt = 0 marca "entregue" e faz a expiração ignorá-lo.
              sub.status = "active";
              sub.expiresAt = 0;
              sub.lastUpsellAt = Date.now();
              sub.upsellStepIndex = 0;
              saveSubscription(sub);

              const deliverable = plan?.deliverable?.trim();
              const msg = deliverable
                ? `✅ <b>Pagamento aprovado!</b>\n\n${deliverable}`
                : bot.successMessage.replace(/{link_vip}/gi, "");
              await sendTelegramMessage(bot.botToken, String(sub.telegramUserId), msg);
            } else {
              // ASSINATURA: gera o convite VIP com a duração REAL do plano.
              const invite = await createTelegramInviteLink(
                bot.botToken,
                bot.idVip,
                `VIP_${sub.telegramUserId}`,
              );
              const durationDays = plan?.durationDays || (sub.expiresAt > 0 ? sub.expiresAt : 30);
              sub.status = "active";
              sub.expiresAt = Date.now() + durationDays * 24 * 60 * 60 * 1000;
              sub.inviteLink = invite.invite_link;
              sub.lastUpsellAt = Date.now();
              sub.upsellStepIndex = 0;
              saveSubscription(sub);

              const clientMsg = bot.successMessage.replace(/{link_vip}/gi, invite.invite_link);
              await sendTelegramMessage(bot.botToken, String(sub.telegramUserId), clientMsg);

              // Entregável adicional (bônus da assinatura, ex.: WhatsApp).
              const deliverable = plan?.deliverable?.trim();
              if (deliverable) {
                await sendTelegramMessage(bot.botToken, String(sub.telegramUserId), deliverable);
              }
            }

            // Notifica o canal de registro (vale para assinatura e pacote).
            if (bot.idRegistro) {
              const valStr = (updated.transaction.amountCents / 100).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              });
              const adminMsg = `🔔 <b>Nova Venda!</b>\n` +
                `${isPackage ? "Pacote" : "Plano"}: <b>${plan?.name || updated.transaction.description || "VIP"}</b>\n` +
                `Valor: <b>${valStr}</b>\n` +
                `Cliente: <b>@${sub.telegramUsername || sub.telegramUserId}</b>`;
              await sendTelegramMessage(bot.botToken, bot.idRegistro, adminMsg);
            }
          } catch (tErr) {
            console.error("Erro ao processar pagamento no Telegram:", tErr);
          }
        }
      }
    }

    if (!updated) {
      // Venda que ainda não estava registrada (ex.: checkout externo): grava.
      const amount = Number(data.final_amount ?? data.amount ?? 0);
      const client = (data.client as Record<string, unknown>) || {};
      recordTransaction({
        provider: "syncpay",
        providerRef,
        description: "Venda (webhook)",
        customer: (client.name as string) || undefined,
        amountCents: Math.round(amount * 100),
        method: (data.payment_method as string) || "pix",
        status: normalizeStatus(status),
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    // Sempre 200 para o gateway não reenviar em loop por erro nosso.
    return NextResponse.json({ ok: true });
  }
}
