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

export type PlanoConversao = { planId: string; name: string; cents: number; count: number };

/** Planos que mais converteram no período (venda paga → inscrição → plano). */
export function topPlans(
  sinceMs: number | null,
  untilMs: number | null = null,
  profileId?: string,
  limit = 5,
): PlanoConversao[] {
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

/** Métricas completas do funil de UM recorte (todos os modelos ou um só). */
export type FunilMetricas = {
  totalStarts: number;
  pixGenerated: number;
  pixPaid: number;
  /** Faturamento das vendas pagas (valor cheio). */
  paidCents: number;
  /** Já sem a taxa do gateway. */
  netCents: number;
  /** PIX gerado e ainda não pago — dinheiro na mesa. */
  pendingCents: number;
  pendingCount: number;
  avgTicketCents: number;
  startToPix: number | null;
  pixToPaid: number | null;
  startToPaid: number | null;
};

function metricas(
  sinceMs: number | null,
  untilMs: number | null,
  profileId: string | null,
  semModelo = false,
): FunilMetricas {
  const db = getDb();

  const leads = range(sinceMs, untilMs);
  const leadsWhere = [...leads.clauses];
  const leadsParams = [...leads.params];
  if (profileId) {
    leadsWhere.push("profile_id = ?");
    leadsParams.push(profileId);
  }
  // Vendas sem modelo não têm /start nosso — o lead nasceu em outro sistema.
  const totalStarts = semModelo
    ? 0
    : (
        db
          .prepare(
            `SELECT COUNT(*) c FROM telegram_leads ${leadsWhere.length ? `WHERE ${leadsWhere.join(" AND ")}` : ""}`,
          )
          .get(...leadsParams) as { c: number }
      ).c;

  const tx = range(sinceMs, untilMs);
  const txWhere = [...tx.clauses];
  const txParams = [...tx.params];
  if (semModelo) txWhere.push("profile_id IS NULL");
  else if (profileId) {
    txWhere.push("profile_id = ?");
    txParams.push(profileId);
  }
  const onde = txWhere.length ? `WHERE ${txWhere.join(" AND ")}` : "";

  const geral = db
    .prepare(
      `SELECT COUNT(*) gerados,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) pagos,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) pago_cents,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN COALESCE(net_amount_cents, amount_cents) ELSE 0 END), 0) liq_cents,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) pendentes,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_cents ELSE 0 END), 0) pend_cents
       FROM transactions ${onde}`,
    )
    .get(...txParams) as {
    gerados: number;
    pagos: number;
    pago_cents: number;
    liq_cents: number;
    pendentes: number;
    pend_cents: number;
  };

  return {
    totalStarts,
    pixGenerated: geral.gerados,
    pixPaid: geral.pagos,
    paidCents: geral.pago_cents,
    netCents: geral.liq_cents,
    pendingCents: geral.pend_cents,
    pendingCount: geral.pendentes,
    avgTicketCents: geral.pagos > 0 ? Math.round(geral.pago_cents / geral.pagos) : 0,
    startToPix: totalStarts > 0 ? geral.gerados / totalStarts : null,
    pixToPaid: geral.gerados > 0 ? geral.pagos / geral.gerados : null,
    startToPaid: totalStarts > 0 ? geral.pagos / totalStarts : null,
  };
}

export type LinhaFunil = FunilMetricas & {
  profileId: string | null;
  profileName: string;
  botActive: boolean | null;
};

/**
 * Funil por MODELO.
 *
 * A atribuição acontece na CRIAÇÃO da cobrança: quando o bot gera o PIX ele já
 * sabe de qual perfil é, e grava `profile_id` na transação. Venda que chega só
 * pelo webhook (checkout externo, ou bot de outro sistema) não tem como ser
 * atribuída depois — a SyncPay não sabe de modelo nenhum. Essas aparecem numa
 * linha "sem modelo" em vez de sumirem ou serem chutadas para alguém.
 */
export function funnelByProfile(
  sinceMs: number | null,
  untilMs: number | null = null,
): { linhas: LinhaFunil[]; geral: FunilMetricas } {
  const db = getDb();
  const perfis = db
    .prepare(
      `SELECT pr.id, pr.name, b.operation_active
       FROM profiles pr LEFT JOIN telegram_bots b ON b.profile_id = pr.id
       ORDER BY pr.name`,
    )
    .all() as { id: string; name: string; operation_active: number | null }[];

  const linhas: LinhaFunil[] = perfis.map((p) => ({
    profileId: p.id,
    profileName: p.name,
    botActive: p.operation_active === null ? null : Boolean(p.operation_active),
    ...metricas(sinceMs, untilMs, p.id),
  }));

  const orfas = metricas(sinceMs, untilMs, null, true);
  if (orfas.pixGenerated > 0) {
    linhas.push({ profileId: null, profileName: "Sem modelo", botActive: null, ...orfas });
  }

  linhas.sort((a, b) => b.paidCents - a.paidCents);
  return { linhas, geral: metricas(sinceMs, untilMs, null) };
}

/** Métricas de um recorte só (todos ou um modelo). */
export function funnelMetrics(
  sinceMs: number | null,
  untilMs: number | null,
  profileId?: string,
): FunilMetricas {
  return metricas(sinceMs, untilMs, profileId || null);
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
