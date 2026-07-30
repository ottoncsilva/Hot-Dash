import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { MediaItem, MediaPostCounts } from "./types";

/**
 * Histórico de publicação das mídias nos GRUPOS do Telegram e a regra de
 * escolha do Método MK.
 *
 * O método continua escolhendo sozinho — o que muda é o critério. Antes era
 * sorteio uniforme entre as mídias nunca usadas em post nenhum (`listUsedMediaIds`),
 * o que ignorava o grupo, ignorava a data de inserção e, quando o acervo não
 * usado acabava, deixava o post sair sem foto. Agora:
 *
 *   1º  menos postada NAQUELE grupo (tudo sai uma vez antes de qualquer repetição);
 *   2º  inserida mais recentemente na galeria (o conteúdo novo vai ao ar primeiro);
 *   3º  mais tempo sem sair naquele grupo (desempate).
 *
 * As etiquetas continuam mandando em QUEM pode ser escolhido: quem filtra por
 * `warmup_tags`/`vip_tags` é o gerador, antes de chamar daqui.
 */

/** Os dois grupos do Telegram que o Método MK alimenta. */
export type MkAudience = "previas" | "vip";

/** Converte o `post_type` do post no grupo de destino. "Aquecimento" é o
 *  rótulo legado de "Prévias" (posts manuais antigos). */
export function audienceFromPostType(postType: string): MkAudience | null {
  if (postType === "VIP") return "vip";
  if (postType === "Prévias" || postType === "Aquecimento") return "previas";
  return null;
}

/** Registra que estas mídias foram AO AR neste grupo. Só deve ser chamado
 *  depois do envio confirmado — falha de envio não conta. */
export function logMediaPosted(
  mediaIds: string[],
  profileId: string,
  audience: MkAudience,
  postId?: string,
): void {
  const ids = mediaIds.filter(Boolean);
  if (ids.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO media_post_log (id, media_id, profile_id, audience, post_id, posted_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const run = db.transaction((list: string[]) => {
    for (const mediaId of list) {
      stmt.run(randomUUID(), mediaId, profileId, audience, postId || null, now);
    }
  });
  run(ids);
}

/**
 * Quantas vezes cada mídia do perfil já foi publicada em cada grupo, e quando
 * foi a última vez. Uma única consulta agregada (não uma por mídia).
 */
export function getMediaPostCounts(profileId: string): Map<string, MediaPostCounts> {
  const rows = getDb()
    .prepare(
      `SELECT media_id, audience, COUNT(*) AS total, MAX(posted_at) AS last_at
         FROM media_post_log
        WHERE profile_id = ?
        GROUP BY media_id, audience`,
    )
    .all(profileId) as { media_id: string; audience: string; total: number; last_at: number }[];

  const map = new Map<string, MediaPostCounts>();
  for (const r of rows) {
    const entry = map.get(r.media_id) || { previas: 0, vip: 0 };
    if (r.audience === "vip") {
      entry.vip = r.total;
      entry.lastVipAt = r.last_at;
    } else {
      entry.previas = r.total;
      entry.lastPreviasAt = r.last_at;
    }
    map.set(r.media_id, entry);
  }
  return map;
}

/**
 * Mídias já comprometidas com posts AGENDADOS deste grupo. O gerador planeja
 * até 14 dias à frente e o histórico só cresce na hora do envio — sem isso a
 * mesma foto seria escolhida repetidas vezes dentro da própria fila.
 */
export function listScheduledMediaIds(profileId: string, audience: MkAudience): Set<string> {
  const types = audience === "vip" ? ["VIP"] : ["Prévias", "Aquecimento"];
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT pm.media_id AS id
         FROM post_media pm
         JOIN posts p ON p.id = pm.post_id
         JOIN post_networks pn ON pn.post_id = p.id AND pn.network = 'telegram'
        WHERE p.profile_id = ? AND p.status = 'scheduled'
          AND pn.post_type IN (${types.map(() => "?").join(", ")})`,
    )
    .all(profileId, ...types) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Contagem e último envio de uma mídia no grupo pedido. */
function statsFor(counts: Map<string, MediaPostCounts>, id: string, audience: MkAudience) {
  const c = counts.get(id);
  if (!c) return { times: 0, lastAt: 0 };
  return audience === "vip"
    ? { times: c.vip, lastAt: c.lastVipAt || 0 }
    : { times: c.previas, lastAt: c.lastPreviasAt || 0 };
}

/**
 * Ordena as mídias candidatas na ordem em que o Método MK deve consumi-las.
 */
export function sortCandidates(
  pool: MediaItem[],
  counts: Map<string, MediaPostCounts>,
  audience: MkAudience,
): MediaItem[] {
  return [...pool].sort((a, b) => {
    const sa = statsFor(counts, a.id, audience);
    const sb = statsFor(counts, b.id, audience);
    if (sa.times !== sb.times) return sa.times - sb.times; // menos postada primeiro
    if (sa.times > 0 && sa.lastAt !== sb.lastAt) return sa.lastAt - sb.lastAt; // há mais tempo sem sair
    return b.createdAt - a.createdAt; // inserida mais recentemente
  });
}

/**
 * Fila de consumo de mídia de uma geração do Método MK (a mesma para Prévias e
 * VIP). Entrega sempre a próxima da ordem e, quando o acervo do dia acaba,
 * recomeça a rodada em vez de devolver nada — antes disso o post ia ao ar sem
 * foto assim que o material inédito terminava.
 *
 * Um pedido de vídeo cai para foto quando não há vídeo nenhum no acervo, que é
 * o comportamento que os geradores já tinham.
 */
export function createMediaQueue(
  pool: MediaItem[],
  counts: Map<string, MediaPostCounts>,
  audience: MkAudience,
) {
  const photos = sortCandidates(pool.filter((m) => m.kind === "image"), counts, audience);
  const videos = sortCandidates(pool.filter((m) => m.kind === "video"), counts, audience);
  let photoQueue = [...photos];
  let videoQueue = [...videos];

  function takePhoto(): MediaItem | null {
    if (photoQueue.length === 0) photoQueue = [...photos];
    return photoQueue.shift() || null;
  }

  return {
    take(kind: "photo" | "video"): MediaItem | null {
      if (kind === "video") {
        if (videoQueue.length === 0) videoQueue = [...videos];
        return videoQueue.shift() || takePhoto();
      }
      return takePhoto();
    },
  };
}
