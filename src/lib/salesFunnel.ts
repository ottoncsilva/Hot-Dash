import "server-only";
import { getDb } from "./db";
import { resolvePeriod } from "./periodRange";

/**
 * Métricas do funil de vendas do Bot do Telegram (equivalente ao painel do
 * do bot de vendas): quantos leads deram /start, quantos PIX foram gerados e
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

export type FonteTrafego = {
  /** Código do deep-link. Vazio = veio sem código. */
  code: string;
  starts: number;
  pixGenerated: number;
  pixPaid: number;
  paidCents: number;
};

/**
 * Faturamento por ORIGEM de tráfego (o código do deep-link do /start).
 *
 * O código chega em `t.me/<bot>?start=CODIGO`, é gravado no lead e copiado
 * para a venda na criação do PIX. Sem isso não dá para saber qual divulgação
 * traz dinheiro — só quantos leads cada uma traz, que é a métrica errada.
 */
export function trafficSources(
  sinceMs: number | null,
  untilMs: number | null = null,
  profileId?: string,
): FonteTrafego[] {
  const db = getDb();

  const l = range(sinceMs, untilMs);
  const leadWhere = [...l.clauses];
  const leadParams = [...l.params];
  if (profileId) {
    leadWhere.push("profile_id = ?");
    leadParams.push(profileId);
  }
  const leads = db
    .prepare(
      `SELECT COALESCE(source_code, '') code, COUNT(*) c FROM telegram_leads
       ${leadWhere.length ? `WHERE ${leadWhere.join(" AND ")}` : ""}
       GROUP BY COALESCE(source_code, '')`,
    )
    .all(...leadParams) as { code: string; c: number }[];

  const t = range(sinceMs, untilMs);
  const txWhere = [...t.clauses];
  const txParams = [...t.params];
  if (profileId) {
    txWhere.push("profile_id = ?");
    txParams.push(profileId);
  }
  const vendas = db
    .prepare(
      `SELECT COALESCE(source_code, '') code, COUNT(*) gerados,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) pagos,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) cents
       FROM transactions ${txWhere.length ? `WHERE ${txWhere.join(" AND ")}` : ""}
       GROUP BY COALESCE(source_code, '')`,
    )
    .all(...txParams) as { code: string; gerados: number; pagos: number; cents: number }[];

  const mapa = new Map<string, FonteTrafego>();
  const pega = (code: string) => {
    let f = mapa.get(code);
    if (!f) {
      f = { code, starts: 0, pixGenerated: 0, pixPaid: 0, paidCents: 0 };
      mapa.set(code, f);
    }
    return f;
  };
  for (const r of leads) pega(r.code).starts = r.c;
  for (const r of vendas) {
    const f = pega(r.code);
    f.pixGenerated = r.gerados;
    f.pixPaid = r.pagos;
    f.paidCents = r.cents;
  }
  return [...mapa.values()].sort((a, b) => b.paidCents - a.paidCents || b.starts - a.starts);
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

// ---------------------------------------------------------------------------
// Tempo até a compra, valor mais comprado e o comparativo Hoje/Mês/Total
// ---------------------------------------------------------------------------

export type TempoAteCompra = {
  /** Média das durações, em ms. */
  mediaMs: number;
  /** Mediana — "metade das vendas em até X". É a manchete, não a média: quem
   *  deu /start há meses e só agora comprou puxa a média sozinho. */
  medianaMs: number;
  /** PRIMEIRAS compras com /start ligado — a base real do cálculo. */
  base: number;
  /** Vendas pagas SEM /start ligado — entraram por fora do bot, então não dá
   *  para cronometrar. Vai para a tela junto: sem esse número a média engana
   *  por omissão do denominador. */
  semStart: number;
  /** Compras que NÃO são a primeira daquele lead (renovação/upsell). Ficam de
   *  fora: para quem já comprou em março, "tempo até a compra" mediria cinco
   *  meses de relacionamento, não a decisão de compra. */
  renovacoes: number;
};

/**
 * Quanto tempo o lead leva do primeiro /start até pagar.
 *
 * O caminho é venda → inscrição → lead. A chave do lead é montada no webhook
 * como `${botId}_${telegramUserId}`, então a junção por ela é exata e não
 * confunde a mesma pessoa em bots diferentes.
 *
 * Usa `telegram_leads.created_at`, que é o PRIMEIRO /start: o upsert do lead
 * atualiza `last_interaction_at`, nunca o `created_at`.
 *
 * Ressalva no dado antigo: a migração preencheu `paid_at = created_at` nas
 * vendas pagas que não tinham a coluna (ver `db.ts`). Nessas linhas o que se
 * mede é /start → PIX gerado, não → pagamento, então o histórico longo sai um
 * pouco mais otimista que a realidade.
 */
export function tempoAteCompra(
  sinceMs: number | null,
  untilMs: number | null,
  profileId?: string,
): TempoAteCompra {
  const db = getDb();
  // Recorte da JANELA (e do modelo). Fica separado do filtro de "paga", que
  // precisa valer dentro do CTE para a numeração por lead ver o histórico todo.
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
  const recorte = clauses.length ? clauses.join(" AND ") : "1 = 1";
  const onde = `status = 'paid' AND paid_at IS NOT NULL AND ${recorte}`;

  const pagas = (
    db.prepare(`SELECT COUNT(*) c FROM transactions WHERE ${onde}`).get(...params) as { c: number }
  ).c;

  // `ordem` numera as compras DE CADA LEAD ao longo de TODO o histórico, não
  // dentro da janela — senão a renovação de hoje passaria por "primeira compra
  // de hoje". Por isso o recorte da janela só entra no SELECT de fora.
  const linhas = db
    .prepare(
      `WITH pagas AS (
         SELECT t.id, t.created_at, t.profile_id, t.paid_at,
                (t.paid_at - l.created_at) AS ms,
                ROW_NUMBER() OVER (PARTITION BY l.id ORDER BY t.paid_at, t.id) AS ordem
           FROM transactions t
           JOIN telegram_subscriptions s ON s.transaction_id = t.id
           JOIN telegram_leads l ON l.id = s.bot_id || '_' || CAST(s.telegram_user_id AS TEXT)
          WHERE t.status = 'paid' AND t.paid_at IS NOT NULL
       )
       SELECT ms, ordem FROM pagas WHERE ${recorte}`,
    )
    .all(...params) as { ms: number; ordem: number }[];

  const renovacoes = linhas.filter((r) => r.ordem > 1).length;
  // Duração negativa = pagamento antes do /start, o que é impossível (lead
  // recriado, relógio torto). Não vira zero: é medida inválida e sai da conta.
  const duracoes = linhas
    .filter((r) => r.ordem === 1 && Number.isFinite(r.ms) && r.ms >= 0)
    .map((r) => r.ms)
    .sort((a, b) => a - b);

  const base = duracoes.length;
  const semStart = Math.max(0, pagas - linhas.length);
  if (base === 0) return { mediaMs: 0, medianaMs: 0, base: 0, semStart, renovacoes };

  const soma = duracoes.reduce((s, ms) => s + ms, 0);
  const meio = Math.floor(base / 2);
  const medianaMs =
    base % 2 === 1 ? duracoes[meio] : Math.round((duracoes[meio - 1] + duracoes[meio]) / 2);

  return { mediaMs: Math.round(soma / base), medianaMs, base, semStart, renovacoes };
}

export type ValorMaisComprado = { cents: number; vezes: number };

/** Valor que MAIS SE REPETE nas vendas pagas. Complementa o ticket médio: a
 *  média de R$ 19,90 com R$ 99,00 não é o preço de nada que alguém comprou. */
export function valorMaisComprado(
  sinceMs: number | null,
  untilMs: number | null,
  profileId?: string,
): ValorMaisComprado | null {
  const db = getDb();
  const clauses: string[] = ["status = 'paid'"];
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
  const row = db
    .prepare(
      `SELECT amount_cents cents, COUNT(*) vezes
         FROM transactions
        WHERE ${clauses.join(" AND ")}
        GROUP BY amount_cents
        ORDER BY vezes DESC, cents DESC
        LIMIT 1`,
    )
    .get(...params) as { cents: number; vezes: number } | undefined;
  return row ?? null;
}

export type JanelaComparativa = FunilMetricas & {
  tempo: TempoAteCompra;
  valorMaisComprado: ValorMaisComprado | null;
};

export type Comparativo = {
  hoje: JanelaComparativa;
  mes: JanelaComparativa;
  total: JanelaComparativa;
};

/**
 * A MESMA métrica em três janelas — hoje, este mês e desde sempre.
 *
 * É o que deixa a tendência visível sem obrigar a trocar o período: 11% hoje
 * só quer dizer alguma coisa ao lado dos 6% de sempre. Reaproveita `metricas`
 * e o `resolvePeriod`, que já resolvem "hoje" e "este mês" no fuso da operação
 * (o servidor roda em UTC — sem isso "hoje" começaria às 21h de ontem).
 */
export function metricasComparadas(tz: string, profileId?: string): Comparativo {
  const janela = (chave: "today" | "thisMonth" | null): JanelaComparativa => {
    const { since, until } = chave
      ? resolvePeriod(chave, null, null, tz).range
      : { since: null, until: null };
    return {
      ...funnelMetrics(since, until, profileId),
      tempo: tempoAteCompra(since, until, profileId),
      valorMaisComprado: valorMaisComprado(since, until, profileId),
    };
  };
  return { hoje: janela("today"), mes: janela("thisMonth"), total: janela(null) };
}
