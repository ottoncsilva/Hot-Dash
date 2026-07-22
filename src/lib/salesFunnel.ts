import "server-only";
import { getDb } from "./db";

/**
 * Métricas do funil de vendas do Bot do Telegram (equivalente ao painel do
 * ApexVips/BobzBot): quantos leads deram /start, quantos PIX foram gerados e
 * pagos, e o faturamento por plano/modelo. Tudo lido das mesmas tabelas do
 * bot de vendas (telegram_leads, transactions, telegram_subscriptions,
 * telegram_plans) — nenhuma tabela nova.
 */

export type SalesFunnel = {
  totalStarts: number;
  pixGenerated: number;
  pixPaid: number;
  /** % de quem deu /start e chegou a pagar. Null se não há starts no período. */
  userConversion: number | null;
  /** % de PIX gerados que foram pagos. Null se não há PIX gerados no período. */
  paymentConversion: number | null;
};

function range(sinceMs: number | null, untilMs: number | null) {
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
  return { clauses, params };
}

export function salesFunnel(
  sinceMs: number | null,
  untilMs: number | null = null,
  profileId?: string,
): SalesFunnel {
  const db = getDb();

  const leadsRange = range(sinceMs, untilMs);
  const leadsClauses = [...leadsRange.clauses];
  const leadsParams = [...leadsRange.params];
  if (profileId) {
    leadsClauses.push("profile_id = ?");
    leadsParams.push(profileId);
  }
  const leadsWhere = leadsClauses.length ? `WHERE ${leadsClauses.join(" AND ")}` : "";
  const totalStarts = (
    db.prepare(`SELECT COUNT(*) c FROM telegram_leads ${leadsWhere}`).get(...leadsParams) as {
      c: number;
    }
  ).c;

  const txRange = range(sinceMs, untilMs);
  const txClauses = [...txRange.clauses];
  const txParams = [...txRange.params];
  if (profileId) {
    txClauses.push("profile_id = ?");
    txParams.push(profileId);
  }
  const txWhere = txClauses.length ? `WHERE ${txClauses.join(" AND ")}` : "";
  const pixGenerated = (
    db.prepare(`SELECT COUNT(*) c FROM transactions ${txWhere}`).get(...txParams) as { c: number }
  ).c;
  const paidClauses = [...txClauses, "status = 'paid'"];
  const pixPaid = (
    db
      .prepare(`SELECT COUNT(*) c FROM transactions WHERE ${paidClauses.join(" AND ")}`)
      .get(...txParams) as { c: number }
  ).c;

  return {
    totalStarts,
    pixGenerated,
    pixPaid,
    userConversion: totalStarts > 0 ? pixPaid / totalStarts : null,
    paymentConversion: pixGenerated > 0 ? pixPaid / pixGenerated : null,
  };
}

export type TopPlan = { planId: string; name: string; cents: number; count: number };

/** Ranking de planos por faturamento (join transações pagas → assinatura → plano). */
export function topPlansByRevenue(
  sinceMs: number | null,
  untilMs: number | null = null,
  profileId?: string,
  limit = 5,
): TopPlan[] {
  const db = getDb();
  const { clauses, params } = range(sinceMs, untilMs);
  const where = ["t.status = 'paid'", ...clauses.map((c) => `t.${c}`)];
  if (profileId) {
    where.push("t.profile_id = ?");
    params.push(profileId);
  }
  const rows = db
    .prepare(
      `SELECT p.id plan_id, p.name plan_name, SUM(t.amount_cents) cents, COUNT(*) cnt
       FROM transactions t
       JOIN telegram_subscriptions s ON s.transaction_id = t.id
       JOIN telegram_plans p ON p.id = s.plan_id
       WHERE ${where.join(" AND ")}
       GROUP BY p.id
       ORDER BY cents DESC
       LIMIT ?`,
    )
    .all(...params, limit) as { plan_id: string; plan_name: string; cents: number; cnt: number }[];
  return rows.map((r) => ({ planId: r.plan_id, name: r.plan_name, cents: r.cents, count: r.cnt }));
}

export type ProfileRevenue = {
  profileId: string;
  profileName: string;
  botActive: boolean | null; // null = sem bot configurado
  paidCents: number;
  paidCount: number;
};

/** Faturamento pago por modelo (perfil), maior primeiro. */
export function revenueByProfile(sinceMs: number | null, untilMs: number | null = null): ProfileRevenue[] {
  const db = getDb();
  const { clauses, params } = range(sinceMs, untilMs);
  const where = ["t.status = 'paid'", "t.profile_id IS NOT NULL", ...clauses.map((c) => `t.${c}`)];
  const rows = db
    .prepare(
      `SELECT pr.id profile_id, pr.name profile_name,
              b.operation_active bot_active_raw,
              COALESCE(SUM(t.amount_cents), 0) cents,
              COALESCE(COUNT(t.id), 0) cnt
       FROM profiles pr
       LEFT JOIN telegram_bots b ON b.profile_id = pr.id
       LEFT JOIN transactions t ON t.profile_id = pr.id AND ${where.join(" AND ")}
       GROUP BY pr.id
       ORDER BY cents DESC`,
    )
    .all(...params) as {
    profile_id: string;
    profile_name: string;
    bot_active_raw: number | null;
    cents: number;
    cnt: number;
  }[];
  return rows
    .filter((r) => r.cnt > 0 || r.bot_active_raw !== null)
    .map((r) => ({
      profileId: r.profile_id,
      profileName: r.profile_name,
      botActive: r.bot_active_raw === null ? null : Boolean(r.bot_active_raw),
      paidCents: r.cents,
      paidCount: r.cnt,
    }));
}
