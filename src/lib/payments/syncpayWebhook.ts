import "server-only";
import { normalizeStatus, recordTransaction, updateStatusByRef } from "@/lib/transactions";
import { logWebhookEvent } from "@/lib/webhookLog";

/**
 * Webhook da SyncPay. Recebe os eventos da conta e atualiza o Financeiro.
 * NÃO exige login (é a SyncPay chamando) — a autenticidade vem do token na URL.
 *
 * A SyncPay manda por esta URL os DOIS tipos de movimento, e o tipo vem no
 * HEADER `event`, não no corpo:
 *
 *   cashin.create  / cashin.update   -> venda
 *   cashout.create / cashout.update  -> SAQUE
 *
 * Corpo do cashin  (venda): data { id, client{name,email,document}, pix_code,
 *   amount, final_amount, currency, status, payment_method, created_at,
 *   updated_at } — e, no update, também end_to_end e debtor_account.
 * Corpo do cashout (saque): data { id, amount, final_amount, currency, status,
 *   payment_method, pix_type, pix_key, created_at, updated_at }.
 *
 * `amount` é o valor CHEIO e `final_amount` o líquido já sem a taxa. Datas em
 * GMT. status: pending | completed | failed | refunded | med.
 */

type TipoEvento = "cashin" | "cashout" | "desconhecido";

/**
 * De que tipo é este evento.
 *
 * O header `event` é a fonte oficial. Um saque de R$ 273,61 entrou como venda
 * porque a checagem antiga olhava só o corpo — e o corpo do cashout não tem
 * campo nenhum dizendo que é saque. Por isso, além do header, valem os dois
 * sinais estruturais do payload documentado: saque traz `pix_key`/`pix_type` e
 * NÃO traz `client`; venda traz `client` e `pix_code`.
 */
function tipoDoEvento(header: string, data: Record<string, unknown>): TipoEvento {
  const h = header.trim().toLowerCase();
  if (h.startsWith("cashout")) return "cashout";
  if (h.startsWith("cashin")) return "cashin";

  const temChavePix = Boolean(data.pix_key || data.pix_type);
  const temCliente = Boolean(data.client || data.pix_code || data.debtor_account);
  if (temChavePix && !temCliente) return "cashout";
  if (temCliente) return "cashin";

  // Sem header e sem os campos que distinguem: cai nos nomes de tipo que
  // outros gateways usam, mais valor negativo (que só existe em saída).
  if (ehSaida(data)) return "cashout";
  return "desconhecido";
}

/** Campos onde outros gateways dizem que evento é este (reserva). */
const CAMPOS_TIPO = [
  "type", "event", "event_type", "eventType", "transaction_type", "transactionType",
  "operation", "operation_type", "kind", "flow", "action", "movement", "category",
];
/** SAÍDA de dinheiro: saque, transferência, estorno. Nada disso é venda. */
const EH_SAIDA = /cash.?out|saque|withdraw|payout|transfer|sa[ií]da|debit|d[eé]bito|estorno/i;

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

export type ResultadoWebhook = { ok: true; ignored?: boolean; reason?: string };

/**
 * Processa um evento já autenticado. As rotas (a URL curta e a longa) cuidam
 * só do token e chamam isto — a lógica de venda/saque mora num lugar só.
 */
export async function processarWebhookSyncPay(
  body: Record<string, unknown>,
  eventHeader: string,
): Promise<ResultadoWebhook> {
  try {
    // Aceita tanto { data: {...} } quanto o objeto direto.
    const data = ((body.data as Record<string, unknown>) || body) as Record<
      string,
      unknown
    >;

    const providerRef = String(
      data.id || data.identifier || data.idTransaction || data.transaction_id || "",
    );
    const status = String(data.status || data.status_transaction || "");
    // Tipo do evento: o header é a fonte oficial da SyncPay.
    const tipo = tipoDoEvento(eventHeader, data);

    // Todo evento é registrado cru (ver lib/webhookLog), com o header junto:
    // é o que permite conferir depois por que algo entrou ou não.
    const registra = (decision: string) =>
      logWebhookEvent({
        provider: "syncpay",
        providerRef,
        decision: eventHeader ? `${decision} · event: ${eventHeader}` : decision,
        body,
      });

    if (!providerRef || !status) {
      registra("ignorado · sem id ou status");
      return { ok: true, ignored: true };
    }

    // SAQUE: some antes de encostar no banco.
    if (tipo === "cashout") {
      registra("ignorado · saque (cashout)");
      return { ok: true, ignored: true, reason: "cashout" };
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
          // O que foi comprado: normalmente um plano do bot, mas a compra pode
          // ter vindo de uma OFERTA DE MAILING — nome, preço e duração
          // ajustados só para aquele disparo. Quando existe, ela manda.
          const basePlan = sub.planId ? getPlan(sub.planId) : null;
          let plan: { name: string; durationDays: number; kind: string; deliverable?: string } | null =
            basePlan;
          if (sub.offerId) {
            const { getMailingOffer } = await import("@/lib/telegramMailing");
            const offer = getMailingOffer(sub.offerId);
            if (offer) {
              plan = {
                name: offer.name,
                durationDays: offer.durationDays,
                kind: offer.kind,
                // Sem entregável próprio, herda o do plano de origem.
                deliverable: offer.deliverable || basePlan?.deliverable,
              };
            }
          }
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
      // `amount` é a VENDA CHEIA e `final_amount` o líquido — é o que a
      // documentação do cashin diz, e o painel confirma. Nada de deduzir um a
      // partir do outro: uma venda de R$ 19,90 chegou a virar R$ 20,70 porque
      // o valor recebido era tratado como líquido e a taxa somada por cima.
      // Quando só o líquido vier, a taxa é preenchida pela tabela em
      // recordTransaction, sem inflar a venda.
      const client = (data.client as Record<string, unknown>) || {};
      recordTransaction({
        provider: "syncpay",
        providerRef,
        description: "Venda SyncPay",
        customer: (client.name as string) || undefined,
        amountCents: grossCents ?? netCents ?? 0,
        netAmountCents: netCents,
        method: (data.payment_method as string) || "pix",
        status: normalizeStatus(status),
      });
    }

    return { ok: true };
  } catch {
    // Sempre ok para o gateway não reenviar em loop por erro nosso.
    return { ok: true };
  }
}
