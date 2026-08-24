import "server-only";
import { getDb } from "./db";

/**
 * FUNIL DE LTV — a jornada do lead que chega pela conversa, não pelo /start.
 *
 * É o par do `salesFunnel.ts`, e mede coisa diferente de propósito. No bot de
 * vendas a base é o /start (`telegram_leads`); aqui a base é a CONVERSA
 * (`ltv_chats`), porque o lead do LTV chega falando no WhatsApp ou no chip do
 * Telegram e nunca passa por um /start. Misturar as duas pilhas estragava as
 * duas: o Funil de Vendas contava PIX sem lead correspondente, e o LTV ficava
 * escondido dentro de números que eram do bot.
 *
 * O PIX daqui sai de `ltv_orders`, que é o registro de venda do LTV, com a
 * transação do gateway pendurada. É o mesmo dado que o Financeiro vê — a
 * separação é só de leitura, ninguém deixa de faturar.
 */

export type LtvFunilMetricas = {
  /** Conversas abertas no período — o lead do LTV. */
  leads: number;
  /** Leads que chegaram a receber uma cobrança. */
  leadsComPix: number;
  pixGerados: number;
  pixPagos: number;
  /** Faturamento das vendas pagas (valor cheio). */
  pagosCents: number;
  /** Cobrado e ainda não pago — dinheiro na mesa. */
  pendentesCents: number;
  ticketMedioCents: number;
  /** % de leads que receberam um PIX. Null sem leads no período. */
  leadParaPix: number | null;
  /** % de PIX gerados que foram pagos. Null sem PIX no período. */
  pixParaPago: number | null;
  /** % de leads que compraram. Null sem leads no período. */
  leadParaPago: number | null;
  /**
   * Quanto de desconto a IA deu, em cima do preço de tabela, nas vendas PAGAS.
   * É o número que diz se o teto de desconto está apertado ou frouxo demais.
   */
  descontoMedioPct: number | null;
};

/** Uma linha do funil por conta (número de WhatsApp ou chip do Telegram). */
export type LtvFunilLinha = LtvFunilMetricas & {
  accountId: string;
  label: string;
  channel: "whatsapp" | "telegram";
  profileId: string;
  profileName: string;
};

type Filtro = {
  sinceMs: number | null;
  untilMs: number | null;
  profileId?: string;
  channel?: "whatsapp" | "telegram";
};

/** Condições e parâmetros comuns, sobre um alias de `ltv_accounts`. */
function recorteDeConta(f: Filtro, alias: string) {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (f.profileId) {
    clauses.push(`${alias}.profile_id = ?`);
    params.push(f.profileId);
  }
  if (f.channel) {
    clauses.push(`${alias}.channel = ?`);
    params.push(f.channel);
  }
  return { clauses, params };
}

/** Condições de período sobre uma coluna `created_at` de um alias qualquer. */
function recorteDePeriodo(f: Filtro, alias: string) {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (f.sinceMs !== null) {
    clauses.push(`${alias}.created_at >= ?`);
    params.push(f.sinceMs);
  }
  if (f.untilMs !== null) {
    clauses.push(`${alias}.created_at < ?`);
    params.push(f.untilMs);
  }
  return { clauses, params };
}

function onde(clauses: string[]): string {
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function monta(
  leads: number,
  o: {
    leads_com_pix: number;
    gerados: number;
    pagos: number;
    pagos_cents: number;
    pendentes_cents: number;
    desconto_soma: number | null;
    desconto_qtd: number;
  },
): LtvFunilMetricas {
  return {
    leads,
    leadsComPix: o.leads_com_pix,
    pixGerados: o.gerados,
    pixPagos: o.pagos,
    pagosCents: o.pagos_cents,
    pendentesCents: o.pendentes_cents,
    ticketMedioCents: o.pagos > 0 ? Math.round(o.pagos_cents / o.pagos) : 0,
    leadParaPix: leads > 0 ? o.leads_com_pix / leads : null,
    pixParaPago: o.gerados > 0 ? o.pagos / o.gerados : null,
    leadParaPago: leads > 0 ? o.pagos / leads : null,
    descontoMedioPct:
      o.desconto_qtd > 0 && o.desconto_soma !== null ? o.desconto_soma / o.desconto_qtd : null,
  };
}

/**
 * Os números do período inteiro (todas as contas, ou o recorte pedido).
 *
 * Leads e pedidos são contados em consultas separadas por serem grandezas de
 * tabelas diferentes: juntar num JOIN só multiplicaria o lead por quantas
 * cobranças ele tem, e o total de leads sairia inflado.
 */
export function ltvFunilMetricas(f: Filtro): LtvFunilMetricas {
  const db = getDb();

  const conta = recorteDeConta(f, "a");
  const perLead = recorteDePeriodo(f, "c");
  const leads = (
    db
      .prepare(
        `SELECT COUNT(*) c
           FROM ltv_chats c
           JOIN ltv_accounts a ON a.id = c.account_id
           ${onde([...conta.clauses, ...perLead.clauses])}`,
      )
      .get(...conta.params, ...perLead.params) as { c: number }
  ).c;

  const contaP = recorteDeConta(f, "a");
  const perPedido = recorteDePeriodo(f, "o");
  const pedidos = db
    .prepare(
      `SELECT COUNT(*) gerados,
              COUNT(DISTINCT o.chat_id) leads_com_pix,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN 1 ELSE 0 END), 0) pagos,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.amount_cents ELSE 0 END), 0) pagos_cents,
              COALESCE(SUM(CASE WHEN o.status = 'pending' THEN o.amount_cents ELSE 0 END), 0) pendentes_cents,
              SUM(CASE
                    WHEN o.status = 'paid' AND o.list_price_cents > 0
                    THEN (o.list_price_cents - o.amount_cents) * 100.0 / o.list_price_cents
                  END) desconto_soma,
              COALESCE(SUM(CASE
                    WHEN o.status = 'paid' AND o.list_price_cents > 0 THEN 1 ELSE 0
                  END), 0) desconto_qtd
         FROM ltv_orders o
         JOIN ltv_chats c ON c.id = o.chat_id
         JOIN ltv_accounts a ON a.id = c.account_id
         ${onde([...contaP.clauses, ...perPedido.clauses])}`,
    )
    .get(...contaP.params, ...perPedido.params) as Parameters<typeof monta>[1];

  return monta(leads, pedidos);
}

/** O mesmo funil, quebrado por conta — é o que mostra qual número vende. */
export function ltvFunilPorConta(f: Filtro): LtvFunilLinha[] {
  const db = getDb();

  const conta = recorteDeConta(f, "a");
  const perLead = recorteDePeriodo(f, "c");
  const leads = db
    .prepare(
      `SELECT a.id, a.label, a.channel, a.profile_id,
              COALESCE(p.name, '—') profile_name,
              COUNT(c.id) leads
         FROM ltv_accounts a
         LEFT JOIN profiles p ON p.id = a.profile_id
         LEFT JOIN ltv_chats c
                ON c.account_id = a.id
               ${perLead.clauses.length ? `AND ${perLead.clauses.join(" AND ")}` : ""}
         ${onde(conta.clauses)}
        GROUP BY a.id
        ORDER BY leads DESC, a.label`,
    )
    // A ordem dos parâmetros segue a da consulta: o LEFT JOIN vem antes do WHERE.
    .all(...perLead.params, ...conta.params) as {
    id: string;
    label: string;
    channel: "whatsapp" | "telegram";
    profile_id: string;
    profile_name: string;
    leads: number;
  }[];

  const contaP = recorteDeConta(f, "a");
  const perPedido = recorteDePeriodo(f, "o");
  const pedidos = db
    .prepare(
      `SELECT a.id,
              COUNT(*) gerados,
              COUNT(DISTINCT o.chat_id) leads_com_pix,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN 1 ELSE 0 END), 0) pagos,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.amount_cents ELSE 0 END), 0) pagos_cents,
              COALESCE(SUM(CASE WHEN o.status = 'pending' THEN o.amount_cents ELSE 0 END), 0) pendentes_cents,
              SUM(CASE
                    WHEN o.status = 'paid' AND o.list_price_cents > 0
                    THEN (o.list_price_cents - o.amount_cents) * 100.0 / o.list_price_cents
                  END) desconto_soma,
              COALESCE(SUM(CASE
                    WHEN o.status = 'paid' AND o.list_price_cents > 0 THEN 1 ELSE 0
                  END), 0) desconto_qtd
         FROM ltv_orders o
         JOIN ltv_chats c ON c.id = o.chat_id
         JOIN ltv_accounts a ON a.id = c.account_id
         ${onde([...contaP.clauses, ...perPedido.clauses])}
        GROUP BY a.id`,
    )
    .all(...contaP.params, ...perPedido.params) as ({ id: string } & Parameters<typeof monta>[1])[];

  const porConta = new Map(pedidos.map((p) => [p.id, p]));
  const vazio = {
    gerados: 0,
    leads_com_pix: 0,
    pagos: 0,
    pagos_cents: 0,
    pendentes_cents: 0,
    desconto_soma: null,
    desconto_qtd: 0,
  };

  return leads.map((l) => ({
    accountId: l.id,
    label: l.label,
    channel: l.channel,
    profileId: l.profile_id,
    profileName: l.profile_name,
    ...monta(l.leads, porConta.get(l.id) || vazio),
  }));
}

export type LtvTopProduto = {
  productId: string;
  name: string;
  count: number;
  cents: number;
};

/** Os produtos que mais venderam no LTV no período. */
export function ltvTopProdutos(f: Filtro, limit = 5): LtvTopProduto[] {
  const conta = recorteDeConta(f, "a");
  const periodo = recorteDePeriodo(f, "o");
  const rows = getDb()
    .prepare(
      `SELECT pr.id, pr.name, COUNT(*) cnt, COALESCE(SUM(o.amount_cents), 0) cents
         FROM ltv_orders o
         JOIN ltv_products pr ON pr.id = o.product_id
         JOIN ltv_chats c ON c.id = o.chat_id
         JOIN ltv_accounts a ON a.id = c.account_id
         ${onde(["o.status = 'paid'", ...conta.clauses, ...periodo.clauses])}
        GROUP BY pr.id
        ORDER BY cents DESC
        LIMIT ?`,
    )
    .all(...conta.params, ...periodo.params, limit) as {
    id: string;
    name: string;
    cnt: number;
    cents: number;
  }[];
  return rows.map((r) => ({ productId: r.id, name: r.name, count: r.cnt, cents: r.cents }));
}
