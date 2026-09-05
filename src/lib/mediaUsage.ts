import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { MediaAccountCount, MediaItem, MediaPostCounts, SocialNetwork } from "./types";

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
 * ONDE uma mídia foi publicada: um dos dois grupos do Telegram ou uma rede
 * social. É o valor da coluna `audience` de `media_post_log`.
 *
 * Os dois mundos convivem na mesma tabela mas NÃO se misturam: a escolha de
 * mídia do Método MK consulta só `previas`/`vip` (ver `sortCandidates`), então
 * uma foto postada dez vezes no Instagram continua "nunca postada" para a fila
 * das prévias — que é o certo, são acervos com públicos diferentes.
 */
export type MediaDestino = MkAudience | SocialNetwork;

/** O destino é um dos grupos do Telegram (e não uma rede social)? */
export function ehGrupoDoTelegram(destino: MediaDestino): destino is MkAudience {
  return destino === "previas" || destino === "vip";
}

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
  audience: MediaDestino,
  postId?: string,
  accountId?: string,
): void {
  const ids = mediaIds.filter(Boolean);
  if (ids.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO media_post_log
       (id, media_id, profile_id, audience, post_id, posted_at, account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
        postId ? `${postId}:${mediaId}:${audience}:${accountId || ""}:${now}` : randomUUID(),
        mediaId,
        profileId,
        audience,
        postId || null,
        now,
        accountId || null,
      );
    }
  });
  run(ids);
}

/**
 * MARCAÇÃO MANUAL na Galeria: "esta foto eu já postei".
 *
 * Existe para o acervo que veio de antes do painel — centenas de fotos que já
 * foram ao ar no Instagram e que, para o sistema, eram inéditas. Sem isso o
 * Método MK oferecia primeiro justamente o que o público já tinha visto, e o
 * "nunca postada" do Cronograma mentia.
 *
 * É a MESMA tabela do envio de verdade (`media_post_log`), e não uma coluna
 * "jaPostada" à parte: a pergunta que o sistema faz é sempre "já saiu NESTE
 * destino?" — uma foto pode ter ido ao Instagram e nunca ao VIP. Um sinal
 * único não responderia isso e ainda teria de ser somado à contagem real em
 * todo lugar que já lê daqui.
 *
 * O que separa a marcação do envio é `post_id IS NULL`: registro de envio
 * sempre nasce de um post. É por isso que só a marcação pode ser desfeita
 * (ver `unlogManualMediaPost`).
 */
export function logManualMediaPost(
  mediaIds: string[],
  profileId: string,
  destino: MediaDestino,
  accountId?: string,
): void {
  logMediaPosted(mediaIds, profileId, destino, undefined, accountId);
}

/**
 * Desfaz a marcação manual — o "cliquei sem querer".
 *
 * `post_id IS NULL` é a guarda que protege o histórico REAL, inclusive nos
 * grupos do Telegram: lá o registro nasce de um envio confirmado pela API, e
 * apagá-lo faria o Método MK reoferecer uma foto que o grupo já viu. Aqui só
 * some o que foi marcado na mão.
 */
export function unlogManualMediaPost(
  mediaIds: string[],
  profileId: string,
  destino: MediaDestino,
  accountId?: string,
): void {
  const ids = mediaIds.filter(Boolean);
  if (ids.length === 0) return;
  const marcas = ids.map(() => "?").join(", ");
  getDb()
    .prepare(
      `DELETE FROM media_post_log
        WHERE profile_id = ? AND audience = ? AND post_id IS NULL
          AND account_id IS ?
          AND media_id IN (${marcas})`,
    )
    .run(profileId, destino, accountId || null, ...ids);
}

/**
 * Onde cada mídia tem marcação MANUAL — só o que dá para desmarcar.
 *
 * A tela precisa disso porque o selo "já postada" não diz de onde veio: uma
 * foto com ×3 nas prévias pode ter saído de verdade três vezes, e aí o botão
 * de desmarcar não teria efeito nenhum. Com esta lista, a Galeria mostra o
 * destino como desmarcável só quando ele de fato foi marcado na mão.
 *
 * A chave é o mesmo `audience` do log para os grupos (`previas`/`vip`) e o
 * `account_id` para as redes sociais — que é como a tela identifica cada
 * destino.
 */
export function getManualPostDestinos(profileId: string): Map<string, string[]> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT media_id, audience, account_id
         FROM media_post_log
        WHERE profile_id = ? AND post_id IS NULL`,
    )
    .all(profileId) as { media_id: string; audience: string; account_id: string | null }[];
  const mapa = new Map<string, string[]>();
  for (const r of rows) {
    const chave = r.account_id || r.audience;
    const lista = mapa.get(r.media_id);
    if (lista) lista.push(chave);
    else mapa.set(r.media_id, [chave]);
  }
  return mapa;
}

/**
 * Quantas vezes cada mídia do perfil já foi publicada, e quando foi a última
 * vez: nos dois grupos do Telegram e, separadamente, em cada CONTA de rede
 * social. Duas consultas agregadas — não uma por mídia.
 */
export function getMediaPostCounts(profileId: string): Map<string, MediaPostCounts> {
  const db = getDb();
  const map = new Map<string, MediaPostCounts>();
  const entrada = (mediaId: string): MediaPostCounts => {
    const atual = map.get(mediaId);
    if (atual) return atual;
    const nova: MediaPostCounts = { previas: 0, vip: 0 };
    map.set(mediaId, nova);
    return nova;
  };

  // 1) Os dois grupos do Telegram.
  //
  // O `audience IN ('previas','vip')` não é firula. O laço abaixo decide pelo
  // `else`, e antes de existir destino de rede social isso bastava — só havia
  // dois valores possíveis. Com 'instagram' na mesma tabela, o `else` passaria
  // a somar post de Instagram na conta das PRÉVIAS, e a fila de mídia do
  // Método MK (ver `sortCandidates`) começaria a pular fotos que nunca saíram
  // no grupo, achando que já tinham saído.
  const grupos = db
    .prepare(
      `SELECT media_id, audience, COUNT(*) AS total, MAX(posted_at) AS last_at
         FROM media_post_log
        WHERE profile_id = ? AND audience IN ('previas', 'vip')
        GROUP BY media_id, audience`,
    )
    .all(profileId) as { media_id: string; audience: string; total: number; last_at: number }[];
  for (const r of grupos) {
    const e = entrada(r.media_id);
    if (r.audience === "vip") {
      e.vip = r.total;
      e.lastVipAt = r.last_at;
    } else {
      e.previas = r.total;
      e.lastPreviasAt = r.last_at;
    }
  }

  // 2) Redes sociais, uma contagem POR CONTA — é o que permite ler "2x no
  //    @insta_um e 1x no @insta_dois" em vez de um "3x no Instagram" que não
  //    responde nada. O JOIN traz o @ e a rede de uma vez, para a galeria não
  //    consultar conta por linha.
  //
  //    JOIN e não LEFT JOIN: registro de uma conta APAGADA não tem mais o que
  //    dizer na tela (não dá para nomear onde a foto saiu), e a conta que se
  //    quer preservar hoje se desativa em vez de apagar.
  const contas = db
    .prepare(
      `SELECT l.media_id, l.account_id, a.username, a.network,
              COUNT(*) AS total, MAX(l.posted_at) AS last_at
         FROM media_post_log l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.profile_id = ? AND l.account_id IS NOT NULL
        GROUP BY l.media_id, l.account_id`,
    )
    .all(profileId) as {
    media_id: string;
    account_id: string;
    username: string;
    network: string;
    total: number;
    last_at: number;
  }[];
  for (const r of contas) {
    const e = entrada(r.media_id);
    const item: MediaAccountCount = {
      accountId: r.account_id,
      network: r.network as SocialNetwork,
      username: r.username,
      times: r.total,
      lastAt: r.last_at,
    };
    if (e.contas) e.contas.push(item);
    else e.contas = [item];
  }

  return map;
}

/**
 * Quantas vezes cada mídia do perfil está AGENDADA em cada conta de rede
 * social — post que ainda NÃO foi ao ar.
 *
 * Nada de Telegram aqui (`pn.network != 'telegram'`), e nada de post já
 * postado (`p.status = 'scheduled'`): a pergunta desta consulta é a do
 * Cronograma montando um post — "essa foto já está na fila DESTE perfil?".
 * Publicação passada é outra pergunta e mora em `getMediaPostCounts`.
 */
export function getMediaScheduledCounts(profileId: string): Map<string, MediaAccountCount[]> {
  const rows = getDb()
    .prepare(
      `SELECT pm.media_id, pn.account_id, a.username, a.network,
              COUNT(*) AS total, MIN(p.scheduled_at) AS proximo
         FROM post_media pm
         JOIN posts p ON p.id = pm.post_id
         JOIN post_networks pn ON pn.post_id = p.id
         JOIN accounts a ON a.id = pn.account_id
        WHERE p.profile_id = ? AND p.status = 'scheduled' AND pn.network != 'telegram'
        GROUP BY pm.media_id, pn.account_id`,
    )
    .all(profileId) as {
    media_id: string;
    account_id: string;
    username: string;
    network: string;
    total: number;
    proximo: number;
  }[];

  const mapa = new Map<string, MediaAccountCount[]>();
  for (const r of rows) {
    const item: MediaAccountCount = {
      accountId: r.account_id,
      network: r.network as SocialNetwork,
      username: r.username,
      times: r.total,
      lastAt: r.proximo,
    };
    const lista = mapa.get(r.media_id);
    if (lista) lista.push(item);
    else mapa.set(r.media_id, [item]);
  }
  return mapa;
}

/**
 * Desfaz o registro de publicação de um post em REDE SOCIAL.
 *
 * Existe porque nas redes sociais o "postado" é uma MARCAÇÃO do operador, não
 * um envio que o sistema fez: marcar sem querer e desmarcar tem que voltar a
 * contagem ao que era, senão a galeria acumula publicações que nunca houve.
 *
 * Os grupos do Telegram ficam de fora de propósito. Lá o registro nasce de um
 * envio CONFIRMADO pela API (ver telegramCron), e desmarcar o post no
 * calendário não desfaz uma mensagem que já está no grupo — apagar a linha
 * faria o Método MK reoferecer uma foto que o público já viu.
 */
export function unlogMediaPosted(postId: string): void {
  getDb()
    .prepare(
      `DELETE FROM media_post_log
        WHERE post_id = ? AND audience NOT IN ('previas', 'vip')`,
    )
    .run(postId);
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
