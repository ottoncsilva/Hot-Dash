import "server-only";
import { addDaysInTimeZone, partsInTimeZone, startOfDayInTimeZone, zonedWallTimeToUtcMs } from "./timezone";
import { isPeriodKey, type PeriodKey } from "./periods";

/**
 * Converte um período escolhido na tela em um intervalo absoluto [since, until).
 *
 * Os limites do dia saem do FUSO DA OPERAÇÃO (Configurações → Geral), não do
 * relógio do servidor — em produção ele roda em UTC e "hoje" começaria às 21h
 * de Brasília do dia anterior.
 *
 * `until` nulo = aberto (até agora). `since` nulo = sem limite (Máximo).
 */
export type ResolvedRange = { since: number | null; until: number | null };

export function resolvePeriod(
  periodRaw: string | null,
  fromDay: string | null,
  toDay: string | null,
  tz: string,
): { period: PeriodKey; range: ResolvedRange } {
  const period: PeriodKey = periodRaw && isPeriodKey(periodRaw) ? periodRaw : "today";
  const hoje = startOfDayInTimeZone(Date.now(), tz);

  switch (period) {
    case "today":
      return { period, range: { since: hoje, until: null } };
    case "yesterday":
      return { period, range: { since: addDaysInTimeZone(hoje, -1, tz), until: hoje } };
    case "thisWeek":
      return { period, range: { since: startOfWeek(hoje, tz), until: null } };
    case "last7":
      return { period, range: { since: addDaysInTimeZone(hoje, -6, tz), until: null } };
    case "thisMonth":
      return { period, range: { since: startOfMonth(hoje, tz), until: null } };
    case "last30":
      return { period, range: { since: addDaysInTimeZone(hoje, -29, tz), until: null } };
    case "custom":
      return { period, range: customRange(fromDay, toDay, tz) };
    case "all":
    default:
      return { period, range: { since: null, until: null } };
  }
}

/** Segunda-feira da semana do dia informado. */
function startOfWeek(dayStart: number, tz: string): number {
  const p = partsInTimeZone(dayStart, tz);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0=dom
  return addDaysInTimeZone(dayStart, -((dow + 6) % 7), tz);
}

/** Dia 1º do mês do dia informado. */
function startOfMonth(dayStart: number, tz: string): number {
  const p = partsInTimeZone(dayStart, tz);
  return zonedWallTimeToUtcMs(p.year, p.month, 1, 0, 0, tz);
}

/** Intervalo escolhido à mão: "AAAA-MM-DD" nas duas pontas, ambas INCLUSIVAS
 *  (o "até" vira o começo do dia seguinte). Aceita só uma das pontas. */
function customRange(fromDay: string | null, toDay: string | null, tz: string): ResolvedRange {
  const inicio = diaParaMs(fromDay, tz);
  const fim = diaParaMs(toDay, tz);
  return { since: inicio, until: fim === null ? null : addDaysInTimeZone(fim, 1, tz) };
}

function diaParaMs(dia: string | null, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dia || "").trim());
  if (!m) return null;
  return zonedWallTimeToUtcMs(+m[1], +m[2], +m[3], 0, 0, tz);
}
