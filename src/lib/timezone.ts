/**
 * Fuso horário da operação.
 *
 * O servidor roda em UTC (container), mas a operação é brasileira. Sem tratar
 * isso, "hoje" no painel começava à meia-noite UTC — ou seja, 21h de Brasília
 * do dia ANTERIOR — e as vendas das 21h às 23h59 caíam no dia seguinte. Da
 * mesma forma, o gerador de posts calculava o "dia de hoje" pelos campos locais
 * do servidor e, entre 21h e 23h59, pulava direto para o dia seguinte.
 *
 * Este módulo centraliza a conversão entre a hora de PAREDE do fuso escolhido e
 * o instante UTC (ms). É puro (sem acesso ao banco) para poder ser usado tanto
 * no servidor quanto no cliente.
 */

/** Fuso padrão da operação (Brasília, UTC−3 sem horário de verão desde 2019). */
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/** Opções oferecidas no seletor de Configurações. */
export const TIME_ZONES: { id: string; label: string }[] = [
  { id: "America/Sao_Paulo", label: "Brasília / São Paulo (UTC−3)" },
  { id: "America/Bahia", label: "Salvador / Bahia (UTC−3)" },
  { id: "America/Fortaleza", label: "Fortaleza / Nordeste (UTC−3)" },
  { id: "America/Recife", label: "Recife (UTC−3)" },
  { id: "America/Belem", label: "Belém (UTC−3)" },
  { id: "America/Campo_Grande", label: "Campo Grande / MS (UTC−4)" },
  { id: "America/Cuiaba", label: "Cuiabá / MT (UTC−4)" },
  { id: "America/Manaus", label: "Manaus / AM (UTC−4)" },
  { id: "America/Porto_Velho", label: "Porto Velho / RO (UTC−4)" },
  { id: "America/Boa_Vista", label: "Boa Vista / RR (UTC−4)" },
  { id: "America/Rio_Branco", label: "Rio Branco / AC (UTC−5)" },
  { id: "America/Noronha", label: "Fernando de Noronha (UTC−2)" },
  { id: "UTC", label: "UTC (sem ajuste)" },
];

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Campos de calendário/relógio de um instante, no fuso informado. */
export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
};

/** Decompõe um instante (ms UTC) nos campos de PAREDE do fuso informado. */
export function partsInTimeZone(atUtcMs: number, tz: string = DEFAULT_TIME_ZONE): ZonedParts {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const p = dtf.formatToParts(new Date(atUtcMs)).reduce<Record<string, number>>((acc, x) => {
      if (x.type !== "literal") acc[x.type] = parseInt(x.value, 10);
      return acc;
    }, {});
    return {
      year: p.year,
      month: p.month,
      day: p.day,
      hour: p.hour % 24, // "24" aparece à meia-noite em alguns ambientes
      minute: p.minute,
      second: p.second,
    };
  } catch {
    const d = new Date(atUtcMs);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
}

/** Offset (minutos) do fuso em relação ao UTC no instante informado (ex.: −180). */
export function timeZoneOffsetMinutes(atUtcMs: number, tz: string = DEFAULT_TIME_ZONE): number {
  const p = partsInTimeZone(atUtcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - atUtcMs) / 60000);
}

/**
 * Converte uma hora de PAREDE do fuso (ano/mês/dia/hora/min) no instante UTC.
 * Faz duas passadas para acertar a virada de horário de verão, quando existir.
 */
export function zonedWallTimeToUtcMs(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string = DEFAULT_TIME_ZONE,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = naive - timeZoneOffsetMinutes(naive, tz) * 60000;
  // Reavalia com o offset do instante estimado (borda de DST).
  guess = naive - timeZoneOffsetMinutes(guess, tz) * 60000;
  return guess;
}

/** Instante (ms) do início do dia (00:00) que contém `atUtcMs`, no fuso. */
export function startOfDayInTimeZone(atUtcMs: number, tz: string = DEFAULT_TIME_ZONE): number {
  const p = partsInTimeZone(atUtcMs, tz);
  return zonedWallTimeToUtcMs(p.year, p.month, p.day, 0, 0, tz);
}

/**
 * Soma dias no CALENDÁRIO do fuso, preservando a hora de parede 00:00. Somar
 * 86.400.000 ms não serve: em viradas de horário de verão o dia não tem 24h.
 */
export function addDaysInTimeZone(
  atUtcMs: number,
  days: number,
  tz: string = DEFAULT_TIME_ZONE,
): number {
  const p = partsInTimeZone(atUtcMs, tz);
  // Date.UTC normaliza estouro de mês/ano (ex.: 31 + 1 => dia 1 do mês seguinte).
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedWallTimeToUtcMs(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    tz,
  );
}

/** Rótulo curto "dd/mm" do dia, no fuso (usado no gráfico do painel). */
export function formatDayLabel(atUtcMs: number, tz: string = DEFAULT_TIME_ZONE): string {
  const p = partsInTimeZone(atUtcMs, tz);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}`;
}
