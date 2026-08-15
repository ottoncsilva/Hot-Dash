import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";

/**
 * Fila da geração do Método MK — a parte comum entre PRÉVIAS e VIP.
 *
 * Os dois grupos têm o mesmo problema: a copy de um dia inteiro não cabe no
 * `maxDuration` de uma requisição (~33 chamadas de IA com imagem por dia nas
 * Prévias, ~22 no VIP). Então a rota só ENFILEIRA o plano (barato, sem IA) e o
 * tick de 1 minuto escreve a copy em lotes.
 *
 * O que muda de um grupo para o outro é só o processamento do lote — o plano, a
 * fila de mídia e o prompt. Todo o resto (estado do job, progresso, memória
 * anti-repetição) é igual e mora aqui.
 */

export type GenerationAudience = "previas" | "vip";

export type GenerationJob = {
  id: string;
  profileId: string;
  audience: GenerationAudience;
  days: number;
  status: "pending" | "processing" | "done" | "error";
  total: number;
  done: number;
  created: number;
  today: number;
  error: string | null;
  aiError: string | null;
  /** Posts que saíram com o texto de reserva em vez da legenda da IA. */
  reserveCount: number;
};

export type JobRow = {
  id: string;
  profile_id: string;
  audience: GenerationAudience;
  days: number;
  status: GenerationJob["status"];
  slots: string;
  params: string | null;
  total: number;
  done: number;
  created: number;
  today: number;
  error: string | null;
  ai_error: string | null;
  reserve_count: number | null;
};

export function toJob(r: JobRow): GenerationJob {
  return {
    id: r.id,
    profileId: r.profile_id,
    audience: r.audience,
    days: r.days,
    status: r.status,
    total: r.total,
    done: r.done,
    created: r.created,
    today: r.today,
    error: r.error,
    aiError: r.ai_error,
    reserveCount: r.reserve_count ?? 0,
  };
}

/** Job em aberto (pending/processing) do perfil naquele grupo, se houver. */
export function getActiveJob(
  profileId: string,
  audience: GenerationAudience,
): GenerationJob | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM previas_generation_jobs
        WHERE profile_id = ? AND audience = ? AND status IN ('pending', 'processing')
        ORDER BY created_at ASC LIMIT 1`,
    )
    .get(profileId, audience) as JobRow | undefined;
  return row ? toJob(row) : null;
}

/**
 * Encerra o job em aberto do perfil naquele grupo. Serve para destravar a fila
 * quando a geração emperra (o `total` é o plano inteiro, então um job parado
 * segurava o botão por horas sem jeito de desistir pela tela).
 *
 * Os posts já criados nos lotes anteriores ficam — quem cancela quer parar de
 * gerar, não desfazer o que já está no calendário.
 */
export function cancelActiveJob(profileId: string, audience: GenerationAudience): boolean {
  const info = getDb()
    .prepare(
      `UPDATE previas_generation_jobs
          SET status = 'error', error = ?, updated_at = ?
        WHERE profile_id = ? AND audience = ? AND status IN ('pending', 'processing')`,
    )
    .run("Geração cancelada.", Date.now(), profileId, audience);
  return info.changes > 0;
}

/** Último job do perfil naquele grupo, em qualquer estado — é o que a tela mostra. */
export function getLatestJob(
  profileId: string,
  audience: GenerationAudience,
): GenerationJob | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM previas_generation_jobs
        WHERE profile_id = ? AND audience = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(profileId, audience) as JobRow | undefined;
  return row ? toJob(row) : null;
}

/** Grava o job com o plano inteiro já resolvido. `params` é o que o
 *  processamento precisa lembrar entre lotes (no VIP: destino e link do convite). */
export function insertJob(opts: {
  profileId: string;
  audience: GenerationAudience;
  days: number;
  slots: unknown[];
  params?: unknown;
}): GenerationJob {
  const now = Date.now();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO previas_generation_jobs
         (id, profile_id, audience, days, status, slots, params, total, done, created, today,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 0, 0, 0, ?, ?)`,
    )
    .run(
      id,
      opts.profileId,
      opts.audience,
      opts.days,
      JSON.stringify(opts.slots),
      opts.params === undefined ? null : JSON.stringify(opts.params),
      opts.slots.length,
      now,
      now,
    );
  return {
    id,
    profileId: opts.profileId,
    audience: opts.audience,
    days: opts.days,
    status: "pending",
    total: opts.slots.length,
    done: 0,
    created: 0,
    today: 0,
    error: null,
    aiError: null,
    reserveCount: 0,
  };
}

/** O job mais antigo em aberto, de QUALQUER grupo. Uma fila só: dois lotes no
 *  mesmo tick dobrariam o tempo do ciclo e atrasariam o autopost. */
export function nextOpenJobRow(): JobRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM previas_generation_jobs
        WHERE status IN ('pending', 'processing')
        ORDER BY created_at ASC LIMIT 1`,
    )
    .get() as JobRow | undefined;
}

export function markProcessing(id: string): void {
  getDb()
    .prepare("UPDATE previas_generation_jobs SET status = 'processing', updated_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function markDone(id: string): void {
  getDb()
    .prepare("UPDATE previas_generation_jobs SET status = 'done', updated_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function markError(id: string, message: string): void {
  getDb()
    .prepare(
      "UPDATE previas_generation_jobs SET status = 'error', error = ?, updated_at = ? WHERE id = ?",
    )
    .run(message, Date.now(), id);
}

/**
 * Fecha um lote: avança o `done` e soma o que foi criado.
 *
 * O `WHERE` exige que o job ainda esteja em aberto: um lote leva minutos, e sem
 * isso um cancelamento que chegasse no meio seria desfeito aqui no fim — o job
 * voltava para `processing` e a fila continuava travada.
 */
export function saveBatchProgress(opts: {
  id: string;
  done: number;
  created: number;
  today: number;
  finished: boolean;
  aiError: string | null;
  /** Posts DESTE lote que saíram com o texto de reserva. */
  reserve: number;
}): void {
  getDb()
    .prepare(
      `UPDATE previas_generation_jobs
          SET done = ?, created = created + ?, today = today + ?, status = ?,
              ai_error = ?, reserve_count = reserve_count + ?, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'processing')`,
    )
    .run(
      opts.done,
      opts.created,
      opts.today,
      opts.finished ? "done" : "processing",
      opts.aiError,
      opts.reserve,
      Date.now(),
      opts.id,
    );
}

// --------------------------------------------------------------------------
// Memória dos últimos dias (anti-repetição)
// --------------------------------------------------------------------------

/** Quantos dias de histórico a memória anti-repetição enxerga. */
export const MEMORY_DAYS = 7;

/**
 * Aberturas das legendas já usadas naquele grupo nos últimos {@link MEMORY_DAYS}
 * dias — agendadas e já postadas. Vira um bloco "não repita" no prompt.
 *
 * Só as primeiras palavras interessam: é a abertura que denuncia a repetição
 * ("Bom dia… acordei" três dias seguidos). O corpo inteiro estouraria o prompt.
 */
export function recentOpenings(
  profileId: string,
  postTypes: string[],
  limit = 40,
): string[] {
  const since = Date.now() - MEMORY_DAYS * 24 * 60 * 60 * 1000;
  const marks = postTypes.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT p.caption FROM posts p
         JOIN post_networks pn ON pn.post_id = p.id AND pn.network = 'telegram'
        WHERE p.profile_id = ? AND pn.post_type IN (${marks})
          AND p.caption IS NOT NULL AND p.caption <> '' AND p.scheduled_at >= ?
        ORDER BY p.scheduled_at DESC LIMIT ?`,
    )
    .all(profileId, ...postTypes, since, limit * 2) as { caption: string }[];

  const vistos = new Set<string>();
  const out: string[] = [];
  for (const { caption } of rows) {
    // Tira as linhas de convite (que são iguais em todo post) e as tags HTML.
    const corpo = caption
      .split("\n")
      .filter((l) => !l.includes("<a href="))
      .join(" ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!corpo) continue;
    const abertura = corpo.split(" ").slice(0, 6).join(" ");
    const chave = abertura.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(abertura);
    if (out.length >= limit) break;
  }
  return out;
}

export function memoryBlock(openings: string[]): string {
  if (openings.length === 0) return "";
  return (
    "\nJÁ USADO NOS ÚLTIMOS DIAS — não repita nenhuma destas aberturas nem o mesmo " +
    `assunto delas, invente outra coisa: ${openings.map((o) => `"${o}"`).join(" | ")}`
  );
}
