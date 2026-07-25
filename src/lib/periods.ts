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
