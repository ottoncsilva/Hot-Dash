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

/**
 * A etiqueta que separa o vídeo de PRÉVIA CORTADA dos outros vídeos do acervo.
 *
 * Não é um nome escolhido aqui: o editor de vídeo já a aplica SOZINHO quando o
 * operador borra ou cobre alguma coisa (ver VideoEditor), do mesmo jeito que a
 * foto censurada recebe "Censurada". Ou seja, quem manda nessa classificação é
 * o próprio fluxo de censura — o método só lê o resultado.
 *
 * É essa a distinção que o Método MK usa para decidir o PAPEL do vídeo: o
 * censurado é o que converte (a curiosidade de ver sem a tarja é o que faz
 * clicar), e todo o resto do acervo de vídeo — reels, lifestyle, duplo sentido —
 * serve para engajar.
 */
export const TAG_VIDEO_CENSURADO = "Video Censurado";

/** Normalização tolerante a acento/caixa/espaço — a mesma de `getOrCreateTag`,
 *  para "Vídeo censurado" e "Video Censurado" contarem como a mesma etiqueta. */
function normTag(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const ALVO_CENSURADO = normTag(TAG_VIDEO_CENSURADO);

/** Este vídeo é uma prévia CORTADA (tem a etiqueta de censura)? */
export function ehVideoCensurado(m: MediaItem): boolean {
  return m.kind === "video" && m.tags.some((t) => normTag(t.name) === ALVO_CENSURADO);
}

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
    `INSERT OR IGNORE INTO media_post_log (id, media_id, profile_id, audience, post_id, posted_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const run = db.transaction((list: string[]) => {
    for (const mediaId of list) {
      // Id por ENVIO: (post, mídia, grupo, instante). O instante é o que estava
      // faltando — sem ele o id era só (post, mídia, grupo) e o `INSERT OR
      // IGNORE` engolia em silêncio o SEGUNDO envio do mesmo post.
      //
      // Isso acontece de verdade: o calendário do Telegram tem o botão de
      // marcar/desmarcar como postado (togglePostedStatus), e voltar um post
      // publicado para "agendado" faz o autopost enviá-lo de novo. A foto saía
      // duas vezes no grupo e a galeria continuava mostrando ×1.
      //
      // O backfill da migração continua enxergando este envio pela guarda de
      // NOT EXISTS (post_id + media_id + audience), então ele não duplica nada
      // — que era o motivo de o id ser determinístico em primeiro lugar.
      stmt.run(
        postId ? `${postId}:${mediaId}:${audience}:${now}` : randomUUID(),
        mediaId,
        profileId,
        audience,
        postId || null,
        now,
      );
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

/**
 * Quantas vezes cada mídia já está AGENDADA (ainda não foi ao ar) no grupo.
 *
 * `listScheduledMediaIds` responde "quais", esta responde "quantas vezes" — é o
 * que a geração em lotes precisa para continuar a fila de onde parou: o
 * histórico real (`media_post_log`) só cresce no envio, então entre um lote e
 * outro a única memória do que já foi consumido são os próprios posts agendados.
 */
export function getScheduledMediaUses(
  profileId: string,
  audience: MkAudience,
): Map<string, number> {
  const types = audience === "vip" ? ["VIP"] : ["Prévias", "Aquecimento"];
  const rows = getDb()
    .prepare(
      `SELECT pm.media_id AS id, COUNT(*) AS n
         FROM post_media pm
         JOIN posts p ON p.id = pm.post_id
         JOIN post_networks pn ON pn.post_id = p.id AND pn.network = 'telegram'
        WHERE p.profile_id = ? AND p.status = 'scheduled'
          AND pn.post_type IN (${types.map(() => "?").join(", ")})
        GROUP BY pm.media_id`,
    )
    .all(profileId, ...types) as { id: string; n: number }[];
  return new Map(rows.map((r) => [r.id, r.n]));
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
 *
 * A RECÊNCIA subiu para 2º critério (antes era o 3º, atrás de "há mais tempo sem
 * sair"). O objetivo é o conteúdo novo furar a fila: entre duas mídias já
 * postadas o mesmo número de vezes, sai primeiro a que entrou na galeria mais
 * recentemente. Material novo é o que reduz repetição e desperta interesse; a
 * data do último envio vira só desempate.
 *
 * `extraUses` soma usos que ainda NÃO estão no banco — os que a própria geração
 * acabou de agendar (ver createMediaQueue). Sem isso a segunda volta da fila
 * repetia exatamente a ordem da primeira.
 */
export function sortCandidates(
  pool: MediaItem[],
  counts: Map<string, MediaPostCounts>,
  audience: MkAudience,
  extraUses?: Map<string, number>,
): MediaItem[] {
  const usos = (id: string) => statsFor(counts, id, audience).times + (extraUses?.get(id) ?? 0);
  return [...pool].sort((a, b) => {
    const ua = usos(a.id);
    const ub = usos(b.id);
    if (ua !== ub) return ua - ub; // menos postada primeiro
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt; // mais nova primeiro
    const sa = statsFor(counts, a.id, audience);
    const sb = statsFor(counts, b.id, audience);
    return sa.lastAt - sb.lastAt; // desempate: há mais tempo sem sair
  });
}

/**
 * Substituta para um post cuja mídia sumiu da galeria entre o agendamento e o
 * envio. Sem isso o post saía só com o texto — e a legenda tinha sido escrita
 * para uma imagem, então descrevia uma foto que ninguém via.
 *
 * Usa a mesma ordem da geração (`sortCandidates`: menos postada naquele grupo
 * primeiro) e, nas Prévias, respeita as ETIQUETAS de aquecimento configuradas.
 * Isso não é detalhe: sem o filtro, o substituto poderia mandar para o grupo
 * gratuito uma imagem destinada só ao VIP.
 *
 * Devolve `null` quando não há nenhuma imagem elegível — aí o post sai como
 * texto mesmo, que é o melhor possível.
 */
export function pickReplacementMedia(
  profileId: string,
  audience: MkAudience,
  pool: MediaItem[],
): MediaItem | null {
  let candidatos = pool.filter((m) => m.kind === "image");
  if (audience === "previas") {
    const settings = getDb()
      .prepare("SELECT warmup_tags FROM telegram_autopost_settings WHERE profile_id = ?")
      .get(profileId) as { warmup_tags?: string } | undefined;
    const permitidas = (settings?.warmup_tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (permitidas.length > 0) {
      candidatos = candidatos.filter((m) =>
        m.tags.some((t) => permitidas.includes(t.name.toLowerCase())),
      );
    }
  }
  if (candidatos.length === 0) return null;
  return sortCandidates(candidatos, getMediaPostCounts(profileId), audience)[0] ?? null;
}

/**
 * O que um post PEDE da fila. "photo"/"video" é o pedido genérico (o VIP só usa
 * esses); as Prévias pedem o vídeo pelo PAPEL dele — ver `TAG_VIDEO_CENSURADO`.
 */
export type MediaSlot = "photo" | "video" | "video-censurado" | "video-outro";

/**
 * Fila de consumo de mídia de uma geração do Método MK (a mesma para Prévias e
 * VIP). Entrega sempre a próxima da ordem e, quando o acervo do dia acaba,
 * recomeça a rodada em vez de devolver nada — antes disso o post ia ao ar sem
 * foto assim que o material inédito terminava.
 *
 * A cada VOLTA a ordem é recalculada contando os usos desta própria execução.
 * Antes a fila reciclava com uma cópia da lista original, então a 2ª volta
 * repetia a 1ª na mesma sequência: numa geração de vários dias (~14 fotos/dia)
 * as repetições saíam agrupadas, sempre nas mesmas posições do dia. Agora quem
 * já saiu nesta geração vai para o fim, e o conteúdo novo continua na frente.
 *
 * Um pedido de vídeo cai para foto quando não há vídeo nenhum no acervo, que é
 * o comportamento que os geradores já tinham.
 */
export function createMediaQueue(
  pool: MediaItem[],
  counts: Map<string, MediaPostCounts>,
  audience: MkAudience,
  seedUses?: Map<string, number>,
) {
  const allPhotos = pool.filter((m) => m.kind === "image");
  const allVideos = pool.filter((m) => m.kind === "video");
  // Os vídeos ainda saem em DUAS filas, porque têm papéis diferentes no método:
  // o censurado é a prévia cortada que converte, o resto engaja. Filas
  // separadas é o que impede a fila única de gastar o vídeo censurado num post
  // de engajamento e deixar o post de venda sem material de venda.
  const videosCensurados = allVideos.filter(ehVideoCensurado);
  const videosOutros = allVideos.filter((m) => !ehVideoCensurado(m));
  // Usos desta execução, ainda não gravados em media_post_log. `seedUses` traz
  // os de lotes ANTERIORES da mesma geração — a geração roda em vários ticks do
  // agendador, e sem isso cada lote recomeçaria a fila do zero e as primeiras
  // mídias da ordem sairiam de novo a cada lote.
  const uses = new Map<string, number>(seedUses);
  let photoQueue = sortCandidates(allPhotos, counts, audience, uses);
  let videoQueue = sortCandidates(allVideos, counts, audience, uses);
  let censuradoQueue = sortCandidates(videosCensurados, counts, audience, uses);
  let outroQueue = sortCandidates(videosOutros, counts, audience, uses);

  function consume(item: MediaItem | null): MediaItem | null {
    if (item) uses.set(item.id, (uses.get(item.id) ?? 0) + 1);
    return item;
  }

  function takePhoto(): MediaItem | null {
    if (photoQueue.length === 0) photoQueue = sortCandidates(allPhotos, counts, audience, uses);
    return consume(photoQueue.shift() || null);
  }

  function takeVideo(): MediaItem | null {
    if (videoQueue.length === 0) videoQueue = sortCandidates(allVideos, counts, audience, uses);
    const next = videoQueue.shift();
    return next ? consume(next) : takePhoto();
  }

  return {
    /**
     * `photo` e `video` são o comportamento de sempre (o VIP usa só esses dois):
     * vídeo cai para foto quando não há vídeo nenhum.
     *
     * `video-censurado` e `video-outro` são as sub-filas das Prévias. A primeira
     * cai para os outros vídeos quando o acervo censurado acaba — quem percebe
     * a troca e rebaixa o TIPO do post é o gerador, olhando a mídia devolvida.
     * A segunda devolve `null` em vez de cair para o censurado: gastar a prévia
     * cortada num post de engajamento, que nem botão do VIP leva, é queimar
     * justamente o material que faz o cara clicar.
     */
    take(slot: MediaSlot): MediaItem | null {
      if (slot === "video") return takeVideo();
      if (slot === "video-censurado") {
        if (videosCensurados.length === 0) return takeVideo();
        if (censuradoQueue.length === 0) {
          censuradoQueue = sortCandidates(videosCensurados, counts, audience, uses);
        }
        const next = censuradoQueue.shift();
        return next ? consume(next) : takeVideo();
      }
      if (slot === "video-outro") {
        if (videosOutros.length === 0) return null;
        if (outroQueue.length === 0) {
          outroQueue = sortCandidates(videosOutros, counts, audience, uses);
        }
        const next = outroQueue.shift();
        return next ? consume(next) : null;
      }
      return takePhoto();
    },
  };
}
