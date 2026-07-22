import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";

export type Transaction = {
  id: string;
  provider: string;
  providerRef?: string;
  profileId?: string;
  description?: string;
  customer?: string;
  amountCents: number;
  currency: string;
  method?: string;
  status: string;
  createdAt: number;
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
  currency?: string;
  method?: string;
  status: string;
}): Transaction {
  const now = Date.now();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO transactions
        (id, provider, provider_ref, profile_id, description, customer,
         amount_cents, currency, method, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.provider,
      input.providerRef || null,
      input.profileId || null,
      input.description || null,
      input.customer || null,
      input.amountCents,
      input.currency || "BRL",
      input.method || null,
      input.status,
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

/**
 * Atualiza o status de uma transação pelo provider_ref (usado no webhook).
 * Retorna a transação atualizada, ou null se não encontrada. Também
 * indica se houve transição para "paid" (para disparar alerta de nova venda).
 */
export function updateStatusByRef(
  provider: string,
  providerRef: string,
  status: string,
): { transaction: Transaction; becamePaid: boolean } | null {
  const existing = findByProviderRef(provider, providerRef);
  if (!existing) return null;
  const normalized = normalizeStatus(status);
  const becamePaid = existing.status !== "paid" && normalized === "paid";
  getDb()
    .prepare("UPDATE transactions SET status = ?, updated_at = ? WHERE id = ?")
    .run(normalized, Date.now(), existing.id);
  return { transaction: getTransaction(existing.id)!, becamePaid };
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
  paidCents: number;
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
        `SELECT COUNT(*) c, COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = ? ${where}`,
      )
      .get(status, ...params) as { c: number; s: number };

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
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const series: { day: string; cents: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - i);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const params: (string | number)[] = [d.getTime(), next.getTime()];
    let sql =
      "SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid' AND created_at >= ? AND created_at < ?";
    if (profileId) {
      sql += " AND profile_id = ?";
      params.push(profileId);
    }
    const r = db.prepare(sql).get(...params) as { s: number };
    series.push({
      day: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      cents: r.s,
    });
  }
  return series;
}

export function overview(profileId?: string): Overview {
  const db = getDb();
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7)); // segunda
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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
    today: computePeriodStats(startOfToday.getTime(), profileId),
    week: computePeriodStats(startOfWeek.getTime(), profileId),
    month: computePeriodStats(startOfMonth.getTime(), profileId),
    total: computePeriodStats(null, profileId),
    lastSaleAt: lastSaleQuery.m,
    dailySeries: revenueSeriesForDays(14, profileId),
  };
}
