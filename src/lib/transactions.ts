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

export type Overview = {
  totalPaidCents: number;
  paidCount: number;
  pendingCount: number;
  monthPaidCents: number;
};

export function overview(): Overview {
  const db = getDb();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const paid = db
    .prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid'",
    )
    .get() as { c: number; s: number };
  const pending = db
    .prepare("SELECT COUNT(*) c FROM transactions WHERE status = 'pending'")
    .get() as { c: number };
  const month = db
    .prepare(
      "SELECT COALESCE(SUM(amount_cents),0) s FROM transactions WHERE status = 'paid' AND created_at >= ?",
    )
    .get(startOfMonth.getTime()) as { s: number };

  return {
    totalPaidCents: paid.s,
    paidCount: paid.c,
    pendingCount: pending.c,
    monthPaidCents: month.s,
  };
}
