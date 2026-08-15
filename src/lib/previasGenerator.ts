import "server-only";
import { getDb } from "./db";
import {
  getActiveJob,
  getLatestJob,
  insertJob,
  markDone,
  markError,
  markProcessing,
  memoryBlock,
  nextOpenJobRow,
  recentOpenings,
  saveBatchProgress,
  type GenerationJob,
  type JobRow,
} from "./generationJobs";
import { getProfile } from "./profiles";
import { getBotConfigByProfile } from "./telegramDb";
import { listMedia, getMediaRow, renderVisionImageBase64 } from "./media";
import { createMediaQueue, getMediaPostCounts, getScheduledMediaUses } from "./mediaUsage";
import { generateCaption, callAiRaw, isSystemicAiError } from "./ai";
import { extractVideoThumbnail, extname } from "./metadata";
import { readBuffer } from "./storage";
import { getAiCredentials, getAppTimeZone, type AiProvider } from "./settings";
import { createPost } from "./posts";
import { DEFAULT_CTA_BUTTONS, appendCtaLines, pickCtaLinkTexts } from "./postTypes";
import type { MediaItem } from "./types";
import {
  planDay,
  spreadInteractions,
  mkSlotToUtcMs,
  mkDayFromToday,
  mkWeekday,
  captionTheme,
  fallbackText,
  fallbackPoll,
  TYPE_DEFS,
  type MkType,
  type MkKind,
  type MkIntent,
} from "./previasAi";

/**
 * Geração do Método MK das Prévias, EM LOTES.
 *
 * A rota antes fazia tudo dentro da requisição e estourava: são ~33 chamadas de
 * IA COM IMAGEM por dia gerado, sequenciais, contra um `maxDuration` de 300s. Com
 * o botão mandando `days: 1` (resto de hoje + 1 dia = ~66 posts) já encostava no
 * teto; com `days: 14` era impossível. Pior: os posts já criados ficavam gravados,
 * então a requisição morria no meio e sobrava meio cronograma sem aviso.
 *
 * Agora a rota só ENFILEIRA e responde na hora. O PLANO INTEIRO (horários e
 * tipos — a parte barata, 100% servidor) é calculado no enfileiramento e gravado
 * no job; o tick de 1 minuto (`instrumentation.ts`) consome `BATCH_SIZE` slots
 * por vez, escrevendo só a copy. Assim a tela mostra progresso real e nada
 * depende de uma requisição HTTP viva.
 */

/** Slots processados por tick. ~8 chamadas de IA com imagem cabem folgadas em
 *  1 minuto e deixam o resto do tick (autopost, funis) rodar sem atropelo. */
const BATCH_SIZE = 8;

/** Um slot do plano, já com o instante UTC resolvido. */
type JobSlot = {
  at: number;
  type: MkType;
  kind: MkKind;
  intent: MkIntent;
  cta: boolean;
  media?: "photo" | "video";
  hour: number;
  weekday: number;
};

export type PreviasJob = GenerationJob;

// Ângulos de variação (rotacionados por post) — o mesmo recurso do gerador de
// cronograma, para as legendas não começarem todas iguais.
const VARIATION_ANGLES = [
  "Abra com uma provocação ousada.",
  "Abra com uma pergunta safada e direta pra quem tá lendo.",
  "Comece contando o que você tá sentindo no corpo agora.",
  "Comece com um convite safado e sem rodeio.",
  "Comece reagindo à própria roupa/corpo que aparece na foto — o que aparece e o que quase aparece.",
  "Comece com um tom mais carinhoso e íntimo, e termine safada.",
  "Comece com 'será que você aguenta…'.",
  "Comece descrevendo o clima/cenário da foto e o que você faria ali.",
  "Comece contando o que você fez sozinha antes de tirar essa foto.",
  "Comece dizendo o que você quer que ele faça em você.",
];

// --------------------------------------------------------------------------
// Enfileiramento
// --------------------------------------------------------------------------

/** Job em aberto (pending/processing) do perfil, se houver. */
export function getActivePreviasJob(profileId: string): PreviasJob | null {
  return getActiveJob(profileId, "previas");
}

/** Último job do perfil, em qualquer estado — é o que a tela mostra. */
export function getLatestPreviasJob(profileId: string): PreviasJob | null {
  return getLatestJob(profileId, "previas");
}

/**
 * Monta o plano do resto de hoje + `days` dias e enfileira. Retorna o job.
 *
 * O plano sai pronto aqui porque é barato (nenhuma chamada de IA) e porque é ele
 * que dá o `total` da barra de progresso já na primeira resposta.
 */
export function enqueuePreviasJob(profileId: string, days: number): PreviasJob {
  const db = getDb();
  const tz = getAppTimeZone();

  // Horários já ocupados por Prévias agendadas (janela de 5 min) — a mesma
  // idempotência de antes, agora aplicada de uma vez sobre o plano inteiro.
  const existing = db
    .prepare(
      `SELECT p.scheduled_at FROM posts p JOIN post_networks pn ON pn.post_id = p.id
        WHERE p.profile_id = ? AND pn.network = 'telegram' AND pn.post_type = 'Prévias'
          AND p.status = 'scheduled'`,
    )
    .all(profileId) as { scheduled_at: number }[];
  const taken = existing.map((e) => e.scheduled_at);

  const slots: JobSlot[] = [];
  for (let dayOffset = 0; dayOffset <= days; dayOffset++) {
    const base = mkDayFromToday(dayOffset, tz);
    for (const slot of planDay()) {
      const at = mkSlotToUtcMs(base, slot.time, tz, true);
      if (at <= Date.now()) continue; // não agenda no passado
      if (taken.some((t) => Math.abs(t - at) < 5 * 60 * 1000)) continue;
      taken.push(at);
      slots.push({
        at,
        type: slot.type,
        kind: slot.kind,
        intent: slot.intent,
        cta: slot.cta,
        media: slot.media,
        hour: parseInt(slot.time.slice(0, 2), 10),
        weekday: mkWeekday(base, slot.time),
      });
    }
  }
  slots.sort((a, b) => a.at - b.at);

  // Mesma rede de segurança do VIP: o plano nasce espalhado, mas os `continue`
  // acima descartam horários vencidos e ocupados, e o que sobra fecha fileira.
  spreadInteractions(slots);

  return insertJob({ profileId, audience: "previas", days, slots });
}

// --------------------------------------------------------------------------
// Processamento (chamado pelo tick de 1 minuto)
// --------------------------------------------------------------------------

/**
 * Processa UM lote do job mais antigo em aberto. Retorna quantos posts criou.
 * Uma falha marca o job como `error` sem derrubar o tick.
 */
export async function runPreviasGeneration(): Promise<number> {
  const row = nextOpenJobRow();
  if (!row || row.audience !== "previas") return 0;
  try {
    return await processBatch(row);
  } catch (err) {
    markError(row.id, err instanceof Error ? err.message : "Falha na geração.");
    console.error("[hotdash] Erro na geração das Prévias:", err);
    return 0;
  }
}

async function processBatch(row: JobRow): Promise<number> {
  const db = getDb();
  const slots = JSON.parse(row.slots) as JobSlot[];
  const lote = slots.slice(row.done, row.done + BATCH_SIZE);
  if (lote.length === 0) {
    markDone(row.id);
    return 0;
  }

  const profile = await getProfile(row.profile_id);
  if (!profile) throw new Error("Perfil não encontrado.");
  const bot = getBotConfigByProfile(profile.id);
  if (!bot || !bot.botToken) throw new Error("Bot não configurado.");

  markProcessing(row.id);

  const settings = db
    .prepare(
      "SELECT warmup_tags, warmup_cta_buttons FROM telegram_autopost_settings WHERE profile_id = ?",
    )
    .get(profile.id) as { warmup_tags?: string; warmup_cta_buttons?: string } | undefined;
  const allowedTagNames = (settings?.warmup_tags || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const ctaList = (settings?.warmup_cta_buttons ?? "").trim() || DEFAULT_CTA_BUTTONS;

  // Cadeia de provedores (grok primeiro — costuma aceitar conteúdo adulto).
  const providerChain: AiProvider[] = (["grok", "openai", "gemini"] as AiProvider[]).filter(
    (p) => getAiCredentials(p) !== null,
  );
  if (providerChain.length === 0) {
    throw new Error("Nenhum provedor de IA conectado. Ative um em Configurações → Conexão com IA.");
  }
  let activeProvider: AiProvider | null = null;
  let aiFailed = false;
  let aiError: string | null = row.ai_error;

  // Persona rica (mesmo detalhamento do gerador de cronograma).
  let richNotes = profile.notes || "";
  if (profile.bioPhysical) richNotes += `\nCaracterísticas físicas: ${profile.bioPhysical}`;
  if (profile.bioUnique) richNotes += `\nDiferencial/fetiche: ${profile.bioUnique}`;
  if (profile.bioPersonality) {
    const pType =
      profile.bioPersonality === "santinha"
        ? "Santinha (inocente por fora, safada por dentro)"
        : profile.bioPersonality === "explicita"
          ? "Explícita (sem papas na língua, ousada e direta)"
          : "Safadinha (safada na medida)";
    richNotes += `\nPersonalidade/estilo: ${pType}`;
  }

  // Fila de mídia. `getScheduledMediaUses` traz o que os lotes ANTERIORES desta
  // mesma geração já consumiram — sem isso cada lote recomeçaria a fila e as
  // primeiras fotos da ordem sairiam repetidas a cada 8 posts.
  const queue = createMediaQueue(
    listMedia(profile.id).filter(
      (m) =>
        allowedTagNames.length === 0 ||
        m.tags.some((t) => allowedTagNames.includes(t.name.toLowerCase())),
    ),
    getMediaPostCounts(profile.id),
    "previas",
    getScheduledMediaUses(profile.id, "previas"),
  );

  const memoria = memoryBlock(recentOpenings(profile.id, ["Prévias", "Aquecimento"]));

  async function mediaImageBase64(
    media: MediaItem,
  ): Promise<{ mime: string; base64: string } | null> {
    try {
      const r = getMediaRow(media.id);
      if (!r) return null;
      if (media.kind === "video") {
        const buf = await readBuffer(r.path);
        const frame = await extractVideoThumbnail(buf, extname(r.path), 1024);
        return { mime: "image/jpeg", base64: frame.toString("base64") };
      }
      const base64 = await renderVisionImageBase64(r.path);
      return base64 ? { mime: "image/jpeg", base64 } : null;
    } catch {
      return null;
    }
  }

  async function writeCaption(
    type: MkType,
    hour: number,
    weekday: number,
    images: { mime: string; base64: string }[],
    angleIdx: number,
  ): Promise<string> {
    if (aiFailed) return fallbackText(type);
    const theme =
      `${captionTheme(type, hour, weekday)}\n` +
      `${VARIATION_ANGLES[angleIdx % VARIATION_ANGLES.length]}${memoria}`;
    const toTry = activeProvider ? [activeProvider] : providerChain;
    const errors: string[] = [];
    for (const p of toTry) {
      try {
        const out = await generateCaption({
          provider: p,
          networks: [{ network: "telegram", postType: "Prévias" }],
          profileName: profile!.name,
          profileNotes: richNotes,
          theme,
          images,
        });
        if (out && out.trim()) {
          activeProvider = p;
          return out.trim().slice(0, 800);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha na IA.";
        aiError = msg;
        errors.push(msg);
      }
    }
    // Só desiste quando a causa é SISTÊMICA (chave/cota/conexão). Falhas
    // pontuais (rate-limit, timeout, recusa) não travam o lote.
    if (errors.length > 0 && errors.every((e) => isSystemicAiError(e))) aiFailed = true;
    else activeProvider = null;
    return fallbackText(type);
  }

  async function writePoll(): Promise<{ question: string; options: string[] }> {
    if (aiFailed) return fallbackPoll();
    const toTry = activeProvider ? [activeProvider] : providerChain;
    for (const p of toTry) {
      try {
        const raw = await callAiRaw(
          "Você é uma influenciadora adulta brasileira. Crie UMA enquete curta e bem safada (sem vender nada) " +
            "pro seu grupo de prévias no Telegram — o público é adulto e espera putaria. A pergunta faz ele " +
            'imaginar a cena ("por onde você começaria", "como você me prefere", "o que eu faço no vídeo de hoje"). ' +
            'Responda SÓ um JSON: {"question":"...","options":["..","..",".."]} com 2 a 4 opções curtas.',
          p,
          { json: true, maxTokens: 300 },
        );
        const parsed = JSON.parse(raw) as { question?: string; options?: unknown };
        const q = typeof parsed.question === "string" ? parsed.question.trim() : "";
        const opts = Array.isArray(parsed.options)
          ? parsed.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
          : [];
        if (q && opts.length >= 2) {
          activeProvider = p;
          return { question: q, options: opts.slice(0, 4) };
        }
      } catch (e) {
        aiError = e instanceof Error ? e.message : "Falha na IA.";
      }
    }
    return fallbackPoll();
  }

  const tz = getAppTimeZone();
  const hojeFim = mkSlotToUtcMs(mkDayFromToday(1, tz), "05:00", tz);
  let criados = 0;
  let hoje = 0;

  for (let i = 0; i < lote.length; i++) {
    const slot = lote[i];
    if (slot.at <= Date.now()) continue; // o lote demorou e o horário passou

    if (slot.kind === "enquete") {
      const poll = await writePoll();
      createPost({
        profileId: profile.id,
        networks: [{ network: "telegram", postType: "Prévias" }],
        scheduledAt: slot.at,
        poll,
        cta: false,
      });
      criados++;
      if (slot.at < hojeFim) hoje++;
      continue;
    }

    // Próxima mídia da fila (vídeo cai para foto quando não há vídeo).
    let media: MediaItem | null = null;
    let type = slot.type;
    if (slot.kind === "video") media = queue.take("video");
    else if (slot.kind === "foto") media = queue.take("photo");

    // O acervo acabou de vídeo e a fila devolveu uma FOTO: rebaixa o tipo, senão
    // a legenda promete "gravei um vídeo" e vai uma foto anexada.
    if (slot.kind === "video" && media?.kind === "image") type = "PHOTO_PREMIUM";

    const images: { mime: string; base64: string }[] = [];
    if (media) {
      const img = await mediaImageBase64(media);
      if (img) images.push(img);
    }
    const written = await writeCaption(type, slot.hour, slot.weekday, images, row.done + i);

    // Toda foto e todo vídeo já sai com as 3 linhas de convite ao VIP GRAVADAS
    // na legenda — assim aparecem no editor do calendário e podem ser revisadas
    // antes de ir ao ar. Post sem mídia recebe o convite só no envio.
    const caption =
      media && profile.bioVipLink
        ? appendCtaLines(written, profile.bioVipLink, pickCtaLinkTexts(ctaList, 3))
        : written;

    createPost({
      profileId: profile.id,
      networks: [{ network: "telegram", postType: "Prévias" }],
      scheduledAt: slot.at,
      caption,
      mediaIds: media ? [media.id] : undefined,
      cta: TYPE_DEFS[type].cta,
    });
    criados++;
    if (slot.at < hojeFim) hoje++;
  }

  const done = row.done + lote.length;
  saveBatchProgress({
    id: row.id,
    done,
    created: criados,
    today: hoje,
    finished: done >= slots.length,
    aiError,
  });

  return criados;
}
