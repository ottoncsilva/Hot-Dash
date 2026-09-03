import "server-only";
import { normalizeStatus, recordTransaction, updateStatusByRef } from "@/lib/transactions";
import { logWebhookEvent } from "@/lib/webhookLog";
import { avisarVendaAprovada, deliverPaidTransaction } from "./deliverPayment";
import { atualizarSaldoAposMovimento } from "./saldoSyncpay";
import { buscarRelatorioExterno } from "@/lib/externalSaleReport";

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

    // SAQUE: continua sem virar transação — não é venda, e some antes de
    // encostar no banco. Mas MEXE NO SALDO, e era o único movimento de
    // dinheiro que o painel via passar e ignorava por inteiro: o card seguia
    // mostrando o valor de antes do saque até alguém abrir o Dashboard.
    // Ignorado como venda, não como evento.
    if (tipo === "cashout") {
      atualizarSaldoAposMovimento();
      registra("ignorado como venda · saque (cashout) · saldo mandado atualizar");
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
    if (updated) registra(`cobrança atualizada · ${normalizeStatus(status)}`);

    // Entrou dinheiro? O saldo do Dashboard tem que saber. Ver
    // `atualizarSaldoAposMovimento` — os dois caminhos abaixo marcam aqui.
    let virouPaga = false;

    if (updated && updated.becamePaid) {
      virouPaga = true;
      await deliverPaidTransaction(updated.transaction, registra);
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
      // Se o Canal de Vendas já mandou o relatório dessa venda (ex.: Bobz),
      // ele já diz de qual modelo/bot é — nasce atribuída, sem precisar de
      // correção manual depois. Sem relatório ainda, nasce "Sem modelo" como
      // sempre (o relatório, se chegar depois, corrige sozinho).
      const vinculo = buscarRelatorioExterno("syncpay", providerRef);
      const nova = recordTransaction({
        provider: "syncpay",
        providerRef,
        profileId: vinculo?.profileId,
        botId: vinculo?.botId,
        // Sem relatório do Canal de Vendas ainda, o produto é DESCONHECIDO —
        // fica vazio (a tela mostra "—") em vez de "Venda SyncPay", que só
        // repetia o provedor e ocupava o lugar do nome de verdade. Quando o
        // relatório chegar, ele preenche (ver `registrarRelatorioExterno`).
        description: vinculo?.planName,
        customer:
          (client.name as string) || vinculo?.customerName || vinculo?.telegramUsername || undefined,
        amountCents: grossCents ?? netCents ?? 0,
        netAmountCents: netCents,
        // A palavra final sobre o método é do gateway; o relatório só entra
        // quando ele não disse nada (e aí "pix" deixa de ser um chute).
        method: (data.payment_method as string) || vinculo?.method || "pix",
        status: normalizeStatus(status),
        // Deep-link que trouxe o lead e "veio de bot" — sem eles a venda
        // entra no Financeiro sem origem e some do Funil de Vendas.
        sourceCode: vinculo?.sourceCode,
        origin: vinculo?.botId ? "bot" : undefined,
      });
      registra(
        vinculo?.profileId
          ? `venda nova · ${normalizeStatus(status)} · vinculada pelo Canal de Vendas (bot ${vinculo.botId})`
          : `venda nova · ${normalizeStatus(status)} · sem relatório do Canal de Vendas ainda (Sem modelo)`,
      );

      // ALERTA NO CELULAR desta venda. Ela não passa por
      // `deliverPaidTransaction` (não há inscrição para ativar nem pedido para
      // entregar: o bot é operado por fora), e por isso era a única venda paga
      // do painel que não avisava ninguém — justamente a que o operador não vê
      // acontecer. O texto é montado 5 segundos depois, quando o relatório do
      // Canal de Vendas já teve tempo de dizer o produto e a modelo.
      if (nova.status === "paid") {
        virouPaga = true;
        await avisarVendaAprovada(nova.id).catch(() => {});
      }
    }

    // Depois de tudo gravado, e sem segurar a resposta ao gateway: a consulta
    // sai sozinha alguns segundos depois.
    if (virouPaga) atualizarSaldoAposMovimento();

    return { ok: true };
  } catch {
    // Sempre ok para o gateway não reenviar em loop por erro nosso.
    return { ok: true };
  }
}
