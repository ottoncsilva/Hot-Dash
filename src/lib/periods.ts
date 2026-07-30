/**
 * Períodos do Dashboard e do Financeiro — a MESMA lista nas duas telas, para
 * "últimos 7 dias" significar a mesma coisa nos dois lugares.
 *
 * Sem `server-only` de propósito: os rótulos são usados no cliente (os botões)
 * e as datas são resolvidas no servidor (`periodRange.ts`), onde o fuso da
 * operação é conhecido.
 */

export type PeriodKey =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "last7"
  | "thisMonth"
  | "last30"
  | "all"
  | "custom";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "thisWeek", label: "Esta semana" },
  { key: "last7", label: "Últimos 7 dias" },
  { key: "thisMonth", label: "Este mês" },
  { key: "last30", label: "Últimos 30 dias" },
  { key: "all", label: "Máximo" },
  { key: "custom", label: "Escolher datas" },
];

export const PERIOD_KEYS = PERIOD_OPTIONS.map((p) => p.key);

export function isPeriodKey(v: string): v is PeriodKey {
  return (PERIOD_KEYS as string[]).includes(v);
}

/** Período padrão das duas telas: o dia de hoje. */
export const DEFAULT_PERIOD: PeriodKey = "today";

/** Intervalo absoluto [since, until). `null` em uma ponta = aberto. */
export type LocalRange = { since: number | null; until: number | null };

/**
 * Mesma conta do `resolvePeriod` do servidor (`periodRange.ts`), porém no FUSO
 * DO NAVEGADOR — para telas que filtram no cliente uma lista já carregada
 * (ex.: a galeria de mídia), onde não há requisição para o servidor resolver.
 *
 * As duas pontas do intervalo escolhido à mão são INCLUSIVAS (o "até" vira o
 * começo do dia seguinte, por isso `until` é exclusivo).
 */
export function resolvePeriodLocal(
  period: PeriodKey,
  fromDay?: string,
  toDay?: string,
): LocalRange {
  const hoje = startOfLocalDay(new Date());
  switch (period) {
    case "today":
      return { since: hoje.getTime(), until: null };
    case "yesterday":
      return { since: addLocalDays(hoje, -1).getTime(), until: hoje.getTime() };
    case "thisWeek": {
      const dow = hoje.getDay(); // 0=dom
      return { since: addLocalDays(hoje, -((dow + 6) % 7)).getTime(), until: null };
    }
    case "last7":
      return { since: addLocalDays(hoje, -6).getTime(), until: null };
    case "thisMonth":
      return { since: new Date(hoje.getFullYear(), hoje.getMonth(), 1).getTime(), until: null };
    case "last30":
      return { since: addLocalDays(hoje, -29).getTime(), until: null };
    case "custom": {
      const fim = diaLocalParaMs(toDay);
      return {
        since: diaLocalParaMs(fromDay),
        until: fim === null ? null : addLocalDays(new Date(fim), 1).getTime(),
      };
    }
    case "all":
    default:
      return { since: null, until: null };
  }
}

/** Meia-noite local do dia informado (aritmética em hora de parede: atravessa
 *  horário de verão sem escorregar uma hora). */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function diaLocalParaMs(dia?: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dia || "").trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}
