import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { getAppTimeZone } from "./settings";
import { syncPayFeeCents } from "./payments/syncpayExport";
import type { PeriodKey } from "./periods";
import {
  addDaysInTimeZone,
  formatDayLabel,
  formatHourLabel,
  partsInTimeZone,
  startOfDayInTimeZone,
  zonedWallTimeToUtcMs,
} from "./timezone";

export type Transaction = {
  id: string;
  provider: string;
  providerRef?: string;
  profileId?: string;
  description?: string;
  customer?: string;
  /** Valor CHEIO da venda (faturamento bruto). */
  amountCents: number;
  /** Valor LÍQUIDO repassado pelo gateway ("você recebe"). */
  netAmountCents?: number;
  /** Taxa do gateway (fixa, R$ 0,80 na SyncPay). */
  feeCents?: number;
  /** Split: parte repassada a terceiros. Zero na maioria das vendas. */
  splitCents?: number;
  currency: string;
  method?: string;
  status: string;
  createdAt: number;
  /** Instante em que virou paga (diferente de createdAt = geração do Pix). */
  paidAt?: number;
  updatedAt: number;
};

type Row = {
  id: string;
  provider: string;
  provider_ref: string | null;
  profile_id: string | null;
  description: string | null;
  customer: string | null;
  amount_cents: number;
  net_amount_cents: number | null;
  fee_cents: number | null;
  split_cents: number | null;
  paid_at: number | null;
  reprocessed_at: number | null;
  currency: string;
  method: string | null;
  status: string;
  created_at: number;
  updated_at: number;
};

function toClient(r: Row): Transaction {
  return {
    id: r.id,
    provider: r.provider,
    providerRef: r.provider_ref || undefined,
    profileId: r.profile_id || undefined,
    description: r.description || undefined,
    customer: r.customer || undefined,
    amountCents: r.amount_cents,
    netAmountCents: r.net_amount_cents ?? undefined,
    feeCents: r.fee_cents ?? undefined,
    splitCents: r.split_cents ?? undefined,
    paidAt: r.paid_at ?? undefined,
    currency: r.currency,
    method: r.method || undefined,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function recordTransaction(input: {
  provider: string;
  providerRef?: string;
  profileId?: string;
  description?: string;
  customer?: string;
  amountCents: number;
  /** Valor líquido (sem a taxa), quando o gateway já informou. */
  netAmountCents?: number;
  currency?: string;
  method?: string;
  status: string;
  /** Código do deep-link que trouxe o lead (origem do tráfego). */
  sourceCode?: string;
}): Transaction {
  const now = Date.now();
  const id = randomUUID();
  // Já nasce com a conta fechada quando a venda entra paga: taxa pela tabela da
  // SyncPay (determinística), split com o que sobrar do desconto informado.
  let fee: number | null = null;
  let split: number | null = null;
  let net = input.netAmountCents ?? null;
  if (input.status === "paid") {
    const tabela = syncPayFeeCents(input.amountCents);
    const desconto = net !== null && net < input.amountCents ? input.amountCents - net : tabela;
    fee = Math.min(tabela, desconto);
    split = Math.max(0, desconto - fee);
    if (net === null) net = input.amountCents - desconto;
  }
  getDb()
    .prepare(
      `INSERT INTO transactions
        (id, provider, provider_ref, profile_id, description, customer,
         amount_cents, net_amount_cents, fee_cents, split_cents, paid_at,
         currency, method, status, source_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.provider,
      input.providerRef || null,
      input.profileId || null,
      input.description || null,
      input.customer || null,
      input.amountCents,
      net,
      fee,
      split,
      input.status === "paid" ? now : null,
      input.currency || "BRL",
      input.method || null,
      input.status,
      input.sourceCode || null,
      now,
      now,
    );
  return getTransaction(id)!;
}

/**
 * Soma leve das transações pagas de um perfil (usada na coluna Faturamento
 * da listagem de Modelos) — evita chamar `overview()`, que roda várias
 * queries por período e seria caro repetir uma vez por perfil.
 */
export function totalPaidCentsByProfile(profileId: string): number {
  const r = getDb()
    .prepare(
      "SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid' AND profile_id = ?",
    )
    .get(profileId) as { s: number };
  return r.s;
}

export function getTransaction(id: string): Transaction | null {
  const r = getDb()
    .prepare("SELECT * FROM transactions WHERE id = ?")
    .get(id) as Row | undefined;
  return r ? toClient(r) : null;
}

export function listTransactions(limit = 50, profileId?: string): Transaction[] {
  const rows = profileId
    ? (getDb()
        .prepare(
          "SELECT * FROM transactions WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(profileId, limit) as Row[])
    : (getDb()
        .prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?")
        .all(limit) as Row[]);
  return rows.map(toClient);
}

/**
 * Corrige os valores de uma cobrança à mão.
 *
 * O gateway nem sempre manda tudo (e nem sempre manda certo): uma venda de
 * R$ 19,90 já entrou como R$ 20,70 por leitura errada do payload. Em vez de
 * mexer no banco por fora, o operador ajusta na própria tela.
 *
 * O líquido não é editável de propósito — ele é sempre venda − taxa − split,
 * e deixar os quatro soltos abriria espaço para uma linha que não fecha.
 */
export function updateTransactionAmounts(
  id: string,
  input: {
    amountCents?: number;
    feeCents?: number;
    splitCents?: number;
    customer?: string;
    /** Modelo a que a venda pertence. "" desvincula. Venda que chega só pelo
     *  webhook nasce sem modelo — a SyncPay não sabe de qual é. */
    profileId?: string;
  },
): Transaction | null {
  const atual = getTransaction(id);
  if (!atual) return null;

  const venda = input.amountCents !== undefined && input.amountCents >= 0 ? input.amountCents : atual.amountCents;
  const taxa = input.feeCents !== undefined && input.feeCents >= 0 ? input.feeCents : atual.feeCents ?? 0;
  const split = input.splitCents !== undefined && input.splitCents >= 0 ? input.splitCents : atual.splitCents ?? 0;
  const liquido = Math.max(0, venda - taxa - split);
  const customer = input.customer !== undefined ? input.customer.trim() || null : atual.customer ?? null;
  const perfil = input.profileId !== undefined ? input.profileId.trim() || null : atual.profileId ?? null;

  getDb()
    .prepare(
      `UPDATE transactions
       SET amount_cents = ?, fee_cents = ?, split_cents = ?, net_amount_cents = ?,
           customer = ?, profile_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(venda, taxa, split, liquido, customer, perfil, Date.now(), id);
  return getTransaction(id);
}

/**
 * Apaga uma cobrança do histórico. Existe porque o webhook da SyncPay é por
 * CONTA e traz movimentos que não são venda (saque, por exemplo) — quando um
 * deles escapa da filtragem, o operador precisa poder tirar do Financeiro sem
 * mexer no banco. A inscrição do Telegram que apontasse para ela fica com
 * `transaction_id` nulo (ON DELETE SET NULL), sem perder o acesso do cliente.
 */
export function deleteTransaction(id: string): boolean {
  const r = getDb().prepare("DELETE FROM transactions WHERE id = ?").run(id);
  return r.changes > 0;
}

/** Cobranças de um intervalo [since, until) — as pontas vêm resolvidas no fuso
 *  da operação. Usada pelo Financeiro, que filtra por período na origem em vez
 *  de cortar as últimas 50 no navegador (senão o filtro só veria essas 50). */
export function listTransactionsInRange(
  sinceMs: number | null,
  untilMs: number | null,
  limit = 500,
  profileId?: string,
): Transaction[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (sinceMs !== null) {
    clauses.push("created_at >= ?");
    params.push(sinceMs);
  }
  if (untilMs !== null) {
    clauses.push("created_at < ?");
    params.push(untilMs);
  }
  if (profileId) {
    clauses.push("profile_id = ?");
    params.push(profileId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM transactions ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as Row[];
  return rows.map(toClient);
}

/**
 * Normaliza o status de um provedor para o vocabulário interno. "med"
 * (disputa/chargeback da SyncPay) fica separado de "refunded" para que o
 * painel financeiro mostre reembolso e chargeback como métricas distintas.
 */
export function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (["paid", "completed", "approved", "confirmed", "success"].includes(s)) return "paid";
  if (["chargeback", "med"].includes(s)) return "chargeback";
  if (["refunded"].includes(s)) return "refunded";
  if (["failed", "canceled", "cancelled", "expired", "declined", "error"].includes(s))
    return "failed";
  return "pending";
}

export function findByProviderRef(
  provider: string,
  providerRef: string,
): Transaction | null {
  const r = getDb()
    .prepare("SELECT * FROM transactions WHERE provider = ? AND provider_ref = ?")
    .get(provider, providerRef) as Row | undefined;
  return r ? toClient(r) : null;
}

/** Última venda paga registrada (qualquer perfil/provedor) — usado como
 *  diagnóstico em Configurações → Pagamentos para confirmar que o webhook da
 *  SyncPay está realmente chegando. */
export function lastPaidTransaction(): { at: number; amountCents: number; customer?: string } | null {
  const r = getDb()
    .prepare(
      "SELECT created_at, amount_cents, customer FROM transactions WHERE status = 'paid' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { created_at: number; amount_cents: number; customer: string | null } | undefined;
  if (!r) return null;
  return { at: r.created_at, amountCents: r.amount_cents, customer: r.customer || undefined };
}

/**
 * Atualiza o status de uma transação pelo provider_ref (usado no webhook).
 * Retorna a transação atualizada, ou null se não encontrada. Também
 * indica se houve transição para "paid" (para disparar alerta de nova venda).
 */
export function updateStatusByRef(
  provider: string,
  providerRef: string,
  status: string,
  /** Valores informados pelo gateway: o cheio e o líquido (já sem a taxa). */
  amounts?: { grossCents?: number; netCents?: number; feeCents?: number; splitCents?: number },
): { transaction: Transaction; becamePaid: boolean } | null {
  const existing = findByProviderRef(provider, providerRef);
  if (!existing) return null;
  const normalized = normalizeStatus(status);
  const becamePaid = existing.status !== "paid" && normalized === "paid";
  const now = Date.now();

  // `amount` da SyncPay é a VENDA CHEIA e `final_amount` o líquido (o cashin
  // documentado manda os dois). O histórico antigo ficou R$ 0,80 menor porque
  // o código de então gravava o `final_amount` no lugar da venda — não porque
  // o gateway informe o líquido no `amount`. Aqui o valor informado é aceito
  // como venda; só um valor ausente ou zerado preserva o da cobrança.
  const informado = amounts?.grossCents && amounts.grossCents > 0 ? amounts.grossCents : null;
  const gross = informado ?? existing.amountCents;
  let net =
    amounts?.netCents && amounts.netCents > 0 ? amounts.netCents : existing.netAmountCents ?? null;
  // paid_at marca a hora do PAGAMENTO (createdAt é a geração do Pix). Não
  // reescreve se já estava paga, para não mascarar a data original.
  const paidAt = normalized === "paid" ? existing.paidAt ?? now : existing.paidAt ?? null;

  // Separa o desconto entre TAXA (tabela do gateway) e SPLIT (repasse), como o
  // próprio painel da SyncPay mostra: entrada − taxas − split = você recebe.
  // Quando o gateway não manda o líquido, a taxa ainda é conhecida: a tabela da
  // SyncPay é determinística (R$ 0,80 até R$ 100; + 1,99% acima). Sem isso a
  // venda entraria no extrato sem taxa e sem líquido.
  let fee = amounts?.feeCents ?? existing.feeCents ?? null;
  let split = amounts?.splitCents ?? existing.splitCents ?? null;
  if (fee === null && normalized === "paid") {
    const tabela = syncPayFeeCents(gross);
    const desconto = net !== null ? Math.max(0, gross - net) : tabela;
    fee = Math.min(tabela, desconto);
    split = Math.max(0, desconto - fee);
  }
  if (net === null && fee !== null && normalized === "paid") {
    net = gross - fee - (split ?? 0);
  }

  getDb()
    .prepare(
      `UPDATE transactions
       SET status = ?, amount_cents = ?, net_amount_cents = ?, fee_cents = ?, split_cents = ?,
           paid_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(normalized, gross, net, fee, split, paidAt, now, existing.id);
  return { transaction: getTransaction(existing.id)!, becamePaid };
}

/** Normaliza um identificador para comparação (o export corta em 30 chars e
 *  às vezes omite os hifens do UUID). */
function normRef(v: string): string {
  return (v || "").toLowerCase().replace(/[^0-9a-z]/g, "");
}

export type ImportRow = {
  externalId: string;
  amountCents: number;
  netCents: number;
  feeCents: number;
  splitCents: number;
  status: string;
  createdAtMs: number;
  customer?: string;
};

export type ImportResult = {
  total: number;
  atualizadas: number;
  novas: number;
  semMudanca: number;
  amostra: { quando: number; venda: number; taxa: number; split: number; liquido: number; status: string; acao: string }[];
};

/**
 * Aplica as linhas da exportação do gateway sobre o banco.
 *
 * Casamento: primeiro pelo identificador (prefixo, porque o PDF trunca em 30
 * caracteres); se não achar, por valor + horário de criação próximos (±3 min),
 * que é o par praticamente único de uma cobrança. Não achando nada, a venda é
 * CRIADA — assim o histórico fica completo mesmo para vendas que nunca
 * chegaram ao painel.
 *
 * `dryRun` não grava nada: serve para a tela mostrar a prévia antes.
 */
export function importProviderRows(
  provider: string,
  linhas: ImportRow[],
  opts: { dryRun?: boolean } = {},
): ImportResult {
  const db = getDb();
  const existentes = db
    .prepare("SELECT * FROM transactions WHERE provider = ?")
    .all(provider) as Row[];

  const res: ImportResult = { total: linhas.length, atualizadas: 0, novas: 0, semMudanca: 0, amostra: [] };

  const aplicar = db.transaction(() => {
    for (const l of linhas) {
      const alvo = normRef(l.externalId);
      let achou: Row | undefined = existentes.find((e) => {
        const r = normRef(e.provider_ref || "");
        return r.length > 0 && alvo.length > 0 && (r.startsWith(alvo) || alvo.startsWith(r));
      });
      if (!achou) {
        achou = existentes.find(
          (e) => e.amount_cents === l.amountCents && Math.abs(e.created_at - l.createdAtMs) <= 3 * 60_000,
        );
      }

      const status = normalizeStatus(l.status);
      const pago = status === "paid";
      let acao: string;

      if (achou) {
        const mudou =
          achou.amount_cents !== l.amountCents ||
          achou.net_amount_cents !== l.netCents ||
          achou.fee_cents !== l.feeCents ||
          achou.split_cents !== l.splitCents ||
          achou.status !== status;
        if (mudou) {
          res.atualizadas++;
          acao = "atualizada";
          if (!opts.dryRun) {
            db.prepare(
              `UPDATE transactions
               SET amount_cents = ?, net_amount_cents = ?, fee_cents = ?, split_cents = ?,
                   status = ?, created_at = ?,
                   paid_at = COALESCE(paid_at, ?), customer = COALESCE(customer, ?),
                   reprocessed_at = ?, updated_at = ?
               WHERE id = ?`,
            ).run(
              l.amountCents, l.netCents, l.feeCents, l.splitCents, status, l.createdAtMs,
              pago ? l.createdAtMs : null, l.customer || null,
              Date.now(), Date.now(), achou.id,
            );
          }
        } else {
          res.semMudanca++;
          acao = "sem mudança";
        }
      } else {
        res.novas++;
        acao = "nova";
        if (!opts.dryRun) {
          db.prepare(
            `INSERT INTO transactions
              (id, provider, provider_ref, profile_id, description, customer,
               amount_cents, net_amount_cents, fee_cents, split_cents, paid_at,
               currency, method, status, reprocessed_at, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'BRL', 'pix', ?, ?, ?, ?)`,
          ).run(
            randomUUID(), provider, l.externalId, "Venda SyncPay", l.customer || null,
            l.amountCents, l.netCents, l.feeCents, l.splitCents,
            pago ? l.createdAtMs : null, status,
            Date.now(), l.createdAtMs, Date.now(),
          );
        }
      }

      if (res.amostra.length < 8) {
        res.amostra.push({
          quando: l.createdAtMs, venda: l.amountCents,
          taxa: l.feeCents, split: l.splitCents, liquido: l.netCents,
          status, acao,
        });
      }
    }
  });
  aplicar();
  return res;
}

/** Agrupa o método de pagamento bruto do provedor num rótulo de exibição. */
function methodBucket(method: string | null): "Pix" | "Cartão" | "Boleto" | "Outros" {
  const m = (method || "").toLowerCase();
  if (m.includes("pix")) return "Pix";
  if (m.includes("card") || m.includes("cart")) return "Cartão";
  if (m.includes("boleto")) return "Boleto";
  return "Outros";
}

export type PeriodStats = {
  /** Faturamento BRUTO (valor cheio das vendas pagas). */
  paidCents: number;
  /** Faturamento LÍQUIDO (já sem a taxa do gateway). Quando o gateway ainda não
   *  informou o líquido de alguma venda, cai no valor cheio dela. */
  paidNetCents: number;
  paidCount: number;
  pendingCents: number;
  pendingCount: number;
  refundedCents: number;
  refundedCount: number;
  chargebackCents: number;
  chargebackCount: number;
  avgTicketCents: number;
  /** Distribuição das vendas pagas por método (para o gráfico de rosca). */
  methodBreakdown: { method: string; count: number; cents: number }[];
};

/** Como computePeriodStats, mas aceita também um limite superior (untilMs) —
 *  necessário para períodos fechados como "Ontem" ([início, fim)). Exportada
 *  para o painel do bot de vendas (períodos Hoje/Ontem/7 dias/30 dias/Máximo). */
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/**
 * Vendas pagas agrupadas por DIA DA SEMANA e por HORA — "quando o público
 * compra". Serve para escolher os horários de pico do bot e do disparo.
 *
 * Os baldes saem do FUSO DA OPERAÇÃO, não do relógio do servidor: em produção
 * ele roda em UTC e uma venda das 22h de Brasília cairia no dia seguinte.
 * Devolve as faixas ORDENADAS por faturamento (maior primeiro), sem as vazias.
 */
export function revenueByWeekdayAndHour(
  sinceMs: number | null,
  untilMs: number | null,
  tz: string,
  profileId?: string,
): {
  weekday: { key: number; label: string; cents: number; count: number }[];
  hour: { key: number; label: string; cents: number; count: number }[];
} {
  const clauses = ["status = 'paid'"];
  const params: (string | number)[] = [];
  // COALESCE: transação antiga pode não ter paid_at — cai no created_at.
  if (sinceMs !== null) {
    clauses.push("COALESCE(paid_at, created_at) >= ?");
    params.push(sinceMs);
  }
  if (untilMs !== null) {
    clauses.push("COALESCE(paid_at, created_at) < ?");
    params.push(untilMs);
  }
  if (profileId) {
    clauses.push("profile_id = ?");
    params.push(profileId);
  }
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(paid_at, created_at) AS at, amount_cents
         FROM transactions WHERE ${clauses.join(" AND ")}`,
    )
    .all(...params) as { at: number; amount_cents: number }[];

  const porDia = new Map<number, { cents: number; count: number }>();
  const porHora = new Map<number, { cents: number; count: number }>();
  for (const r of rows) {
    const p = partsInTimeZone(r.at, tz);
    const dia = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    const soma = (m: Map<number, { cents: number; count: number }>, k: number) => {
      const cur = m.get(k) || { cents: 0, count: 0 };
      cur.cents += r.amount_cents;
      cur.count += 1;
      m.set(k, cur);
    };
    soma(porDia, dia);
    soma(porHora, p.hour);
  }

  const ordena = <T extends { cents: number }>(l: T[]) => l.sort((a, b) => b.cents - a.cents);
  return {
    weekday: ordena(
      [...porDia.entries()].map(([key, v]) => ({ key, label: DIAS_SEMANA[key], ...v })),
    ),
    hour: ordena(
      [...porHora.entries()].map(([key, v]) => ({
        key,
        label: `${String(key).padStart(2, "0")}h`,
        ...v,
      })),
    ),
  };
}

export function periodStatsInRange(
  sinceMs: number | null,
  untilMs: number | null,
  profileId?: string,
): PeriodStats {
  return computePeriodStats(sinceMs, profileId, untilMs);
}

function computePeriodStats(
  sinceMs: number | null,
  profileId?: string,
  untilMs: number | null = null,
): PeriodStats {
  const db = getDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (sinceMs !== null) {
    clauses.push("created_at >= ?");
    params.push(sinceMs);
  }
  if (untilMs !== null) {
    clauses.push("created_at < ?");
    params.push(untilMs);
  }
  if (profileId) {
    clauses.push("profile_id = ?");
    params.push(profileId);
  }
  const where = clauses.length ? `AND ${clauses.join(" AND ")}` : "";

  const byStatus = (status: string) =>
    db
      .prepare(
        // `n` = líquido: usa net_amount_cents quando o gateway já informou;
        // senão cai no valor cheio, para vendas antigas não sumirem do total.
        `SELECT COUNT(*) c, COALESCE(SUM(amount_cents),0) s,
                COALESCE(SUM(COALESCE(net_amount_cents, amount_cents)),0) n
         FROM transactions WHERE status = ? ${where}`,
      )
      .get(status, ...params) as { c: number; s: number; n: number };

  const paid = byStatus("paid");
  const pending = byStatus("pending");
  const refunded = byStatus("refunded");
  const chargeback = byStatus("chargeback");

  const methodRows = db
    .prepare(
      `SELECT COALESCE(method,'') method, COUNT(*) c, COALESCE(SUM(amount_cents),0) s
       FROM transactions WHERE status = 'paid' ${where}
       GROUP BY method`,
    )
    .all(...params) as { method: string; c: number; s: number }[];

  const bucketed = new Map<string, { count: number; cents: number }>();
  for (const row of methodRows) {
    const label = methodBucket(row.method);
    const acc = bucketed.get(label) || { count: 0, cents: 0 };
    acc.count += row.c;
    acc.cents += row.s;
    bucketed.set(label, acc);
  }

  return {
    paidCents: paid.s,
    paidNetCents: paid.n,
    paidCount: paid.c,
    pendingCents: pending.s,
    pendingCount: pending.c,
    refundedCents: refunded.s,
    refundedCount: refunded.c,
    chargebackCents: chargeback.s,
    chargebackCount: chargeback.c,
    avgTicketCents: paid.c > 0 ? Math.round(paid.s / paid.c) : 0,
    methodBreakdown: Array.from(bucketed.entries()).map(([method, v]) => ({
      method,
      count: v.count,
      cents: v.cents,
    })),
  };
}

export type Overview = {
  today: PeriodStats;
  week: PeriodStats;
  month: PeriodStats;
  total: PeriodStats;
  lastSaleAt: number | null;
  /** Últimos 14 dias de receita paga, para o mini-gráfico (mais antigo → hoje). */
  dailySeries: { day: string; cents: number }[];
};

/** Série diária de receita paga dos últimos N dias (hoje incluso), mais
 *  antigo → hoje. Usada no gráfico "Faturamento por período". */
export function revenueSeriesForDays(days: number, profileId?: string): { day: string; cents: number }[] {
  const db = getDb();
  // Os "dias" do gráfico seguem o FUSO DA OPERAÇÃO, não o do servidor (UTC).
  const tz = getAppTimeZone();
  const startOfToday = startOfDayInTimeZone(Date.now(), tz);
  const series: { day: string; cents: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = addDaysInTimeZone(startOfToday, -i, tz);
    const dayEnd = addDaysInTimeZone(dayStart, 1, tz);
    const params: (string | number)[] = [dayStart, dayEnd];
    let sql =
      "SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid' AND created_at >= ? AND created_at < ?";
    if (profileId) {
      sql += " AND profile_id = ?";
      params.push(profileId);
    }
    const r = db.prepare(sql).get(...params) as { s: number };
    series.push({ day: formatDayLabel(dayStart, tz), cents: r.s });
  }
  return series;
}

/**
 * Série do gráfico "faturamento por período" para um intervalo já resolvido.
 *
 * A granularidade acompanha o período escolhido em vez de sempre ser diária:
 *  - um dia só (Hoje, Ontem, ou uma única data no seletor) → por HORA;
 *  - "Esta semana" → segunda a domingo inteiros (7 pontos, dias futuros com zero);
 *  - "Este mês" → dia 1 ao último dia do mês (idem);
 *  - "Máximo" (sem início) → últimos 30 dias, como antes;
 *  - qualquer outro intervalo (últimos 7/30 dias, datas escolhidas à mão) →
 *    exatamente os dias do intervalo, sem completar para trás.
 */
export function revenueSeriesForRange(
  period: PeriodKey,
  sinceMs: number | null,
  untilMs: number | null,
  profileId?: string,
): { day: string; cents: number }[] {
  const tz = getAppTimeZone();
  if (sinceMs === null) return revenueSeriesForDays(30, profileId);

  if (period === "thisWeek") return seriesBetween(sinceMs, 7, profileId);
  if (period === "thisMonth") return seriesBetween(sinceMs, daysInMonth(sinceMs, tz), profileId);
  if (isSingleDayRange(sinceMs, untilMs, tz)) return hourlySeriesForDay(sinceMs, profileId);

  const inicio = startOfDayInTimeZone(sinceMs, tz);
  // `until` é exclusivo: o último dia mostrado é o anterior a ele.
  const fim = startOfDayInTimeZone(untilMs === null ? Date.now() : untilMs - 1, tz);
  const dias = Math.round((fim - inicio) / 86_400_000) + 1;
  return seriesBetween(inicio, Math.min(92, Math.max(1, dias)), profileId);
}

/** O período resolvido cobre um único dia de parede? (Hoje, Ontem, ou uma
 *  data só escolhida à mão) — nesses casos o gráfico vira por hora. */
function isSingleDayRange(sinceMs: number, untilMs: number | null, tz: string): boolean {
  if (untilMs !== null) return untilMs - sinceMs === 86_400_000;
  return sinceMs === startOfDayInTimeZone(Date.now(), tz);
}

/** Quantidade de dias do mês (de parede) que contém `monthStartMs`. */
function daysInMonth(monthStartMs: number, tz: string): number {
  const p = partsInTimeZone(monthStartMs, tz);
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

/** Série por hora (24 pontos) de um único dia — usada quando o período
 *  resolvido é Hoje, Ontem ou uma data única do seletor. */
function hourlySeriesForDay(dayStartMs: number, profileId?: string): { day: string; cents: number }[] {
  const db = getDb();
  const tz = getAppTimeZone();
  const out: { day: string; cents: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const hourStart = dayStartMs + h * 3_600_000;
    const hourEnd = hourStart + 3_600_000;
    const params: (string | number)[] = [hourStart, hourEnd];
    let sql =
      "SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid' AND created_at >= ? AND created_at < ?";
    if (profileId) {
      sql += " AND profile_id = ?";
      params.push(profileId);
    }
    const r = db.prepare(sql).get(...params) as { s: number };
    out.push({ day: formatHourLabel(hourStart, tz), cents: r.s });
  }
  return out;
}

function seriesBetween(
  primeiroDia: number,
  dias: number,
  profileId?: string,
): { day: string; cents: number }[] {
  const db = getDb();
  const tz = getAppTimeZone();
  const out: { day: string; cents: number }[] = [];
  for (let i = 0; i < dias; i++) {
    const dayStart = addDaysInTimeZone(primeiroDia, i, tz);
    const dayEnd = addDaysInTimeZone(dayStart, 1, tz);
    const params: (string | number)[] = [dayStart, dayEnd];
    let sql =
      "SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid' AND created_at >= ? AND created_at < ?";
    if (profileId) {
      sql += " AND profile_id = ?";
      params.push(profileId);
    }
    const r = db.prepare(sql).get(...params) as { s: number };
    out.push({ day: formatDayLabel(dayStart, tz), cents: r.s });
  }
  return out;
}

export function overview(profileId?: string): Overview {
  const db = getDb();
  // Hoje/semana/mês seguem o FUSO DA OPERAÇÃO (Configurações → Geral).
  const tz = getAppTimeZone();
  const startOfToday = startOfDayInTimeZone(Date.now(), tz);
  const p = partsInTimeZone(startOfToday, tz);
  // Dia da semana no fuso: usa o calendário local reconstruído em UTC.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0=dom
  const startOfWeek = addDaysInTimeZone(startOfToday, -((dow + 6) % 7), tz); // segunda
  const startOfMonth = zonedWallTimeToUtcMs(p.year, p.month, 1, 0, 0, tz);

  const lastSaleQuery = profileId
    ? (db
        .prepare(
          "SELECT MAX(created_at) m FROM transactions WHERE status = 'paid' AND profile_id = ?",
        )
        .get(profileId) as { m: number | null })
    : (db
        .prepare("SELECT MAX(created_at) m FROM transactions WHERE status = 'paid'")
        .get() as { m: number | null });

  return {
    today: computePeriodStats(startOfToday, profileId),
    week: computePeriodStats(startOfWeek, profileId),
    month: computePeriodStats(startOfMonth, profileId),
    total: computePeriodStats(null, profileId),
    lastSaleAt: lastSaleQuery.m,
    dailySeries: revenueSeriesForDays(14, profileId),
  };
}
