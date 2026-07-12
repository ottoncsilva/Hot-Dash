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

export function getTransaction(id: string): Transaction | null {
  const r = getDb()
    .prepare("SELECT * FROM transactions WHERE id = ?")
    .get(id) as Row | undefined;
  return r ? toClient(r) : null;
}

export function listTransactions(limit = 50): Transaction[] {
  const rows = getDb()
    .prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map(toClient);
}

/** Normaliza o status de um provedor para o vocabulário interno. */
export function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (["paid", "completed", "approved", "confirmed", "success"].includes(s)) return "paid";
  if (["refunded", "chargeback", "med"].includes(s)) return "refunded";
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

export type Overview = {
  totalPaidCents: number;
  paidCount: number;
  pendingCount: number;
  pendingCents: number;
  todayPaidCents: number;
  todayCount: number;
  weekPaidCents: number;
  monthPaidCents: number;
  avgTicketCents: number;
  lastSaleAt: number | null;
  /** Últimos 14 dias de receita paga, para o mini-gráfico (mais antigo → hoje). */
  dailySeries: { day: string; cents: number }[];
};

export function overview(): Overview {
  const db = getDb();
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7)); // segunda
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const sumPaidSince = (ms: number) =>
    (db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) c FROM transactions WHERE status = 'paid' AND created_at >= ?",
      )
      .get(ms) as { s: number; c: number });

  const paid = db
    .prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid'",
    )
    .get() as { c: number; s: number };
  const pending = db
    .prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'pending'",
    )
    .get() as { c: number; s: number };
  const today = sumPaidSince(startOfToday.getTime());
  const week = sumPaidSince(startOfWeek.getTime());
  const month = sumPaidSince(startOfMonth.getTime());
  const last = db
    .prepare(
      "SELECT MAX(created_at) m FROM transactions WHERE status = 'paid'",
    )
    .get() as { m: number | null };

  // Série diária dos últimos 14 dias.
  const dailySeries: { day: string; cents: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - i);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const r = db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid' AND created_at >= ? AND created_at < ?",
      )
      .get(d.getTime(), next.getTime()) as { s: number };
    dailySeries.push({
      day: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      cents: r.s,
    });
  }

  return {
    totalPaidCents: paid.s,
    paidCount: paid.c,
    pendingCount: pending.c,
    pendingCents: pending.s,
    todayPaidCents: today.s,
    todayCount: today.c,
    weekPaidCents: week.s,
    monthPaidCents: month.s,
    avgTicketCents: paid.c > 0 ? Math.round(paid.s / paid.c) : 0,
    lastSaleAt: last.m,
    dailySeries,
  };
}
