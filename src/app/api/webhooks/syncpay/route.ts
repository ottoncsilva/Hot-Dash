import { NextRequest, NextResponse } from "next/server";
import { normalizeStatus, recordTransaction, updateStatusByRef } from "@/lib/transactions";
import { ensureSyncpayWebhookToken } from "@/lib/settings";
import { logWebhookEvent } from "@/lib/webhookLog";

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

/** Campos onde os gateways costumam dizer que evento é este. */
const CAMPOS_TIPO = [
  "type", "event", "event_type", "eventType", "transaction_type", "transactionType",
  "operation", "operation_type", "kind", "flow", "action", "movement", "category",
];
/** SAÍDA de dinheiro: saque, transferência, estorno. Nada disso é venda. */
const EH_SAIDA = /cash.?out|saque|withdraw|payout|transfer|sa[ií]da|debit|d[eé]bito|estorno|refund|chargeback/i;

/**
 * O webhook da SyncPay é cadastrado POR CONTA, então ela manda por ele todo
 * tipo de movimento — inclusive SAQUE (cash-out). Sem esta checagem um saque
 * de R$ 273,61 entrava no Financeiro como venda paga e inflava o faturamento.
 *
 * A varredura é pelos campos de tipo em qualquer nível do payload, porque o
 * nome varia (`type`, `event`, `transaction_type`…), mais uma rede de segurança
 * para valor negativo — que também só existe em saída.
 */
function ehSaida(raiz: unknown): boolean {
  const fila: unknown[] = [raiz];
  let guard = 0;
  while (fila.length > 0 && guard++ < 100) {
    const no = fila.shift();
    if (!no || typeof no !== "object") continue;
    const obj = no as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const chave = k.toLowerCase().replace(/[^a-z_]/g, "");
      if (CAMPOS_TIPO.includes(chave) && typeof v === "string" && EH_SAIDA.test(v)) return true;
      if (chave === "amount" && Number(v) < 0) return true;
      if (v && typeof v === "object") fila.push(v);
    }
  }
  return false;
}

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
      data.id || data.identifier || data.idTransaction || data.transaction_id || "",
    );
    const status = String(data.status || data.status_transaction || "");
    // Todo evento é registrado cru (ver lib/webhookLog): é a única forma de
    // saber depois qual campo distingue venda de saque neste gateway.
    const registra = (decision: string) =>
      logWebhookEvent({ provider: "syncpay", providerRef, decision, body });

    if (!providerRef || !status) {
      registra("ignorado · sem id ou status");
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Saque e afins: reconhece e descarta antes de encostar no banco.
    if (ehSaida(body)) {
      registra("ignorado · movimento de saída");
      return NextResponse.json({ ok: true, ignored: true, reason: "movimento de saída" });
    }

    // A SyncPay manda os DOIS valores: `amount` é o valor CHEIO que o cliente
    // pagou (faturamento) e `final_amount` é o que ela repassa depois da taxa
    // (faturamento líquido). Guardamos os dois para o painel separar bruto de
    // líquido — antes só um número era gravado e a taxa sumia da conta.
    const toCents = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
    };
    const grossCents = toCents(data.amount);
    const netCents = toCents(data.final_amount ?? data.net_amount);

    const updated = updateStatusByRef("syncpay", providerRef, status, { grossCents, netCents });
    registra(updated ? `cobrança atualizada · ${normalizeStatus(status)}` : `venda nova · ${normalizeStatus(status)}`);

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

      // Alerta de VENDA no celular (push do PWA). Fica FORA do fluxo do
      // Telegram de propósito: vale também para checkout externo, que não tem
      // inscrição vinculada. Vem depois da entrega ao cliente para nunca
      // atrasá-la, e num try/catch próprio — falha de push não pode derrubar
      // o webhook (o gateway reenviaria em loop).
      try {
        const { sendPushEvent } = await import("@/lib/push");
        const t = updated.transaction;
        const valStr = (t.amountCents / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        });
        const detalhe = [t.description, t.customer].filter(Boolean).join(" · ");
        await sendPushEvent(
          "sale",
          `💰 Venda aprovada — ${valStr}`,
          detalhe || "Pagamento confirmado no SyncPay.",
          "/dashboard",
        );
      } catch (pErr) {
        console.error("Erro ao enviar push de venda:", pErr);
      }
    }

    if (!updated) {
      // Venda que ainda não estava registrada (ex.: checkout externo): grava.
      // Sem uma cobrança nossa para comparar, vale a mesma leitura do resto do
      // sistema: a SyncPay confirma o LÍQUIDO. Só tratamos `amount` como venda
      // cheia quando ela manda os dois valores e um é maior que o outro.
      const client = (data.client as Record<string, unknown>) || {};
      const { syncPayFeeCents } = await import("@/lib/payments/syncpayExport");
      const doisValores = grossCents !== undefined && netCents !== undefined && grossCents > netCents;
      const liquido = doisValores ? (netCents as number) : (netCents ?? grossCents ?? 0);
      const cheio = doisValores ? (grossCents as number) : liquido + syncPayFeeCents(liquido);
      recordTransaction({
        provider: "syncpay",
        providerRef,
        description: "Venda SyncPay",
        customer: (client.name as string) || undefined,
        amountCents: cheio,
        netAmountCents: liquido || undefined,
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
