import "server-only";
import { getDb } from "./db";
import { partsInTimeZone } from "./timezone";

/**
 * Relatório do Financeiro — os números do período em uma estrutura só, para a
 * tela de relatório e para o CSV.
 *
 * A ideia central, e o motivo de isto não ser uma consulta trivial: **"PIX
 * gerado" e "PIX pago" são dois recortes diferentes do tempo**, não duas
 * colunas do mesmo. Um PIX gerado no dia 1 e pago no dia 3 entra em "gerados"
 * no dia 1 e em "pagos" no dia 3. Somar os dois pelo mesmo `created_at` (como
 * a listagem do Financeiro faz) responde bem "o que eu emiti", mas erra "o que
 * eu recebi" — some com o dinheiro que entrou hoje de um PIX de ontem.
 *
 * Por isso cada faixa carrega os dois lados, e a CONVERSÃO é calculada só
 * dentro da coorte: dos PIX gerados no período, quantos foram pagos. Dividir
 * pagos-no-período por gerados-no-período misturaria coortes e daria conversão
 * acima de 100% num dia de muita quitação atrasada.
 */

export type ReportBucket = { count: number; cents: number };

export type ReportCurveRow = {
  key: number;
  label: string;
  /** PIX gerados nesta faixa (pelo horário da GERAÇÃO). */
  gerados: ReportBucket;
  /** Pagamentos recebidos nesta faixa (pelo horário do PAGAMENTO). */
  pagos: ReportBucket;
  /** Dos gerados NESTA faixa, quantos acabaram pagos (mesma coorte). */
  geradosPagos: ReportBucket;
  /** `geradosPagos.count / gerados.count`. `null` quando nada foi gerado. */
  conversao: number | null;
};

export type ReportRow = {
  id: string;
  providerRef: string | null;
  /** Instante da geração do PIX. */
  createdAt: number;
  /** Instante do pagamento, quando pago. */
  paidAt: number | null;
  status: string;
  customer: string | null;
  profileName: string | null;
  amountCents: number;
  feeCents: number | null;
  splitCents: number | null;
  netAmountCents: number | null;
  method: string | null;
  sourceCode: string | null;
  /** A transação entrou no período pela geração, pelo pagamento, ou pelos dois. */
  entrouPor: "gerado" | "pago" | "ambos";
};

export type FinanceReport = {
  range: { since: number | null; until: number | null };
  totals: {
    /** Tudo que foi EMITIDO no período. */
    gerados: ReportBucket;
    /** Tudo que foi RECEBIDO no período (pode incluir PIX de antes). */
    pagos: ReportBucket & { netCents: number; feeCents: number; splitCents: number };
    /** Dos gerados no período, o que foi pago — a coorte fechada. */
    geradosPagos: ReportBucket;
    /** Conversão da coorte: geradosPagos / gerados. */
    conversao: number | null;
    /** Ticket médio do que foi recebido no período. */
    ticketMedioCents: number | null;
  };
  byHour: ReportCurveRow[];
  byWeekday: ReportCurveRow[];
  transactions: ReportRow[];
};

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Linha = {
  id: string;
  provider_ref: string | null;
  created_at: number;
  paid_at: number | null;
  status: string;
  customer: string | null;
  profile_name: string | null;
  amount_cents: number;
  fee_cents: number | null;
  split_cents: number | null;
  net_amount_cents: number | null;
  method: string | null;
  source_code: string | null;
};

const zero = (): ReportBucket => ({ count: 0, cents: 0 });

function novaCurva(total: number, label: (k: number) => string): ReportCurveRow[] {
  return Array.from({ length: total }, (_, key) => ({
    key,
    label: label(key),
    gerados: zero(),
    pagos: zero(),
    geradosPagos: zero(),
    conversao: null,
  }));
}

export function buildFinanceReport(
  sinceMs: number | null,
  untilMs: number | null,
  tz: string,
  profileId?: string,
): FinanceReport {
  // Uma consulta só, pegando quem toca o período por QUALQUER um dos dois
  // lados — senão o pagamento de hoje de um PIX da semana passada ficaria de
  // fora, que é justamente o número que o relatório existe para mostrar.
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const dentro = (col: string) => {
    const partes: string[] = [];
    if (sinceMs !== null) {
      partes.push(`${col} >= ?`);
      params.push(sinceMs);
    }
    if (untilMs !== null) {
      partes.push(`${col} < ?`);
      params.push(untilMs);
    }
    return partes.length ? `(${col} IS NOT NULL AND ${partes.join(" AND ")})` : `${col} IS NOT NULL`;
  };
  clauses.push(`(${dentro("t.created_at")} OR ${dentro("t.paid_at")})`);
  if (profileId) {
    clauses.push("t.profile_id = ?");
    params.push(profileId);
  }

  const linhas = getDb()
    .prepare(
      `SELECT t.id, t.provider_ref, t.created_at, t.paid_at, t.status, t.customer,
              p.name AS profile_name, t.amount_cents, t.fee_cents, t.split_cents,
              t.net_amount_cents, t.method, t.source_code
         FROM transactions t
         LEFT JOIN profiles p ON p.id = t.profile_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY t.created_at DESC`,
    )
    .all(...params) as Linha[];

  const noPeriodo = (at: number | null): boolean =>
    at !== null && (sinceMs === null || at >= sinceMs) && (untilMs === null || at < untilMs);

  const totals: FinanceReport["totals"] = {
    gerados: zero(),
    pagos: { count: 0, cents: 0, netCents: 0, feeCents: 0, splitCents: 0 },
    geradosPagos: zero(),
    conversao: null,
    ticketMedioCents: null,
  };
  const byHour = novaCurva(24, (k) => `${String(k).padStart(2, "0")}h`);
  const byWeekday = novaCurva(7, (k) => DIAS_SEMANA[k]);
  const transactions: ReportRow[] = [];

  const soma = (b: ReportBucket, cents: number) => {
    b.count += 1;
    b.cents += cents;
  };
  const diaDaSemana = (at: number) => {
    const p = partsInTimeZone(at, tz);
    return { dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(), hour: p.hour };
  };

  for (const l of linhas) {
    const pago = l.status === "paid";
    const geradoNoPeriodo = noPeriodo(l.created_at);
    // `paid_at` pode estar vazio em venda antiga importada; nesse caso a data de
    // pagamento conhecida é a própria criação.
    const instantePago = pago ? (l.paid_at ?? l.created_at) : null;
    const pagoNoPeriodo = pago && noPeriodo(instantePago);

    if (geradoNoPeriodo) {
      soma(totals.gerados, l.amount_cents);
      const g = diaDaSemana(l.created_at);
      soma(byHour[g.hour].gerados, l.amount_cents);
      soma(byWeekday[g.dow].gerados, l.amount_cents);
      if (pago) {
        soma(totals.geradosPagos, l.amount_cents);
        soma(byHour[g.hour].geradosPagos, l.amount_cents);
        soma(byWeekday[g.dow].geradosPagos, l.amount_cents);
      }
    }

    if (pagoNoPeriodo && instantePago !== null) {
      totals.pagos.count += 1;
      totals.pagos.cents += l.amount_cents;
      totals.pagos.feeCents += l.fee_cents ?? 0;
      totals.pagos.splitCents += l.split_cents ?? 0;
      totals.pagos.netCents += l.net_amount_cents ?? l.amount_cents;
      const p = diaDaSemana(instantePago);
      soma(byHour[p.hour].pagos, l.amount_cents);
      soma(byWeekday[p.dow].pagos, l.amount_cents);
    }

    transactions.push({
      id: l.id,
      providerRef: l.provider_ref,
      createdAt: l.created_at,
      paidAt: l.paid_at,
      status: l.status,
      customer: l.customer,
      profileName: l.profile_name,
      amountCents: l.amount_cents,
      feeCents: l.fee_cents,
      splitCents: l.split_cents,
      netAmountCents: l.net_amount_cents,
      method: l.method,
      sourceCode: l.source_code,
      entrouPor:
        geradoNoPeriodo && pagoNoPeriodo ? "ambos" : geradoNoPeriodo ? "gerado" : "pago",
    });
  }

  totals.conversao =
    totals.gerados.count > 0 ? totals.geradosPagos.count / totals.gerados.count : null;
  totals.ticketMedioCents =
    totals.pagos.count > 0 ? Math.round(totals.pagos.cents / totals.pagos.count) : null;
  for (const faixa of [...byHour, ...byWeekday]) {
    faixa.conversao =
      faixa.gerados.count > 0 ? faixa.geradosPagos.count / faixa.gerados.count : null;
  }

  return { range: { since: sinceMs, until: untilMs }, totals, byHour, byWeekday, transactions };
}
