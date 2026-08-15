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
import {
  DEFAULT_VIP_CTA_BUTTONS,
  DEFAULT_TELEGRAM_CTA_BUTTONS,
  WHATSAPP_CTA_FALLBACK,
  TELEGRAM_CTA_FALLBACK,
  appendCtaLines,
  pickCtaLinkTexts,
} from "./postTypes";
import { whatsappAccounts, telegramAccounts } from "./socialLinks";
import type { MediaItem } from "./types";
import { mkSlotToUtcMs, mkDayFromToday, mkWeekday, fallbackPoll } from "./previasAi";
import {
  planDayVip,
  spreadInteractions,
  captionThemeVip,
  fallbackTextVip,
  type VipContato,
  type VipType,
  type VipKind,
  type VipIntent,
} from "./vipAi";

/**
 * Geração do Método MK do GRUPO VIP, EM LOTES — o mesmo desenho das Prévias.
 *
 * A rota fazia tudo dentro da requisição: são ~22 chamadas de IA COM IMAGEM por
 * dia gerado, sequenciais, contra um `maxDuration` de 300s, e o campo da tela
 * aceita até 14 dias. Estourava, e os posts já criados ficavam gravados — meio
 * cronograma no calendário, sem nenhum aviso de erro.
 *
 * Agora a rota só ENFILEIRA (o plano é barato: 100% servidor, zero IA) e o tick
 * de 1 minuto escreve a copy, `BATCH_SIZE` posts por vez.
 */

/** Slots processados por tick — mesmo tamanho das Prévias. */
const BATCH_SIZE = 8;

/** Um slot do plano, já com o instante UTC resolvido. */
type JobSlot = {
  at: number;
  type: VipType;
  kind: VipKind;
  intent: VipIntent;
  cta: boolean;
  media?: "photo" | "video";
  weekday: number;
};

/** O que o processamento precisa lembrar entre um lote e outro. O destino do
 *  convite é escolhido NA GERAÇÃO, não é configuração salva; e o link já sai
 *  resolvido daqui para o post continuar apontando certo mesmo que a conta seja
 *  editada ou apagada depois. */
type JobParams = {
  contato: VipContato | null;
  ctaLink: string;
};

export type VipJob = GenerationJob;

// Ângulos de variação (rotacionados por post) — para as legendas não começarem
// todas iguais.
const VARIATION_ANGLES = [
  "Abra com um carinho gostoso.",
  "Abra com uma pergunta direta pra quem tá lendo.",
  "Comece contando o que você tá fazendo ou sentindo agora.",
  "Comece com uma provocação leve e íntima.",
  "Comece reagindo à própria roupa/corpo que aparece na foto.",
  "Comece com um tom mais safado.",
  "Comece com 'tava aqui pensando em você…'.",
  "Comece descrevendo o clima/cenário da foto.",
];

// --------------------------------------------------------------------------
// Enfileiramento
// --------------------------------------------------------------------------

/** Job do VIP em aberto (pending/processing) do perfil, se houver. */
export function getActiveVipJob(profileId: string): VipJob | null {
  return getActiveJob(profileId, "vip");
}

/** Último job do VIP do perfil, em qualquer estado — é o que a tela mostra. */
export function getLatestVipJob(profileId: string): VipJob | null {
  return getLatestJob(profileId, "vip");
}

/**
 * Monta o plano do resto de hoje + `days` dias e enfileira. Retorna o job.
 *
 * O plano sai pronto aqui porque é barato (nenhuma chamada de IA) e porque é ele
 * que dá o `total` da barra de progresso já na primeira resposta.
 */
export function enqueueVipJob(opts: {
  profileId: string;
  days: number;
  contato: VipContato | null;
  ctaLink: string;
}): VipJob {
  const db = getDb();
  const tz = getAppTimeZone();

  // Horários já ocupados por posts do VIP agendados (janela de 5 min).
  const existing = db
    .prepare(
      `SELECT p.scheduled_at FROM posts p JOIN post_networks pn ON pn.post_id = p.id
        WHERE p.profile_id = ? AND pn.network = 'telegram' AND pn.post_type = 'VIP'
          AND p.status = 'scheduled'`,
    )
    .all(opts.profileId) as { scheduled_at: number }[];
  const taken = existing.map((e) => e.scheduled_at);

  const slots: JobSlot[] = [];
  for (let dayOffset = 0; dayOffset <= opts.days; dayOffset++) {
    const base = mkDayFromToday(dayOffset, tz);
    for (const slot of planDayVip({ contato: opts.contato })) {
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
        weekday: mkWeekday(base, slot.time),
      });
    }
  }
  slots.sort((a, b) => a.at - b.at);

  // O plano nasce espalhado, mas os dois `continue` acima jogam fora parte dele
  // (horário vencido, horário ocupado) e o que sobra fecha fileira. Reavalia os
  // tipos sobre a lista que vai mesmo para o banco — sem isso, gerar no meio do
  // dia produzia enquetes em sequência.
  spreadInteractions(slots);

  const params: JobParams = { contato: opts.contato, ctaLink: opts.ctaLink };
  return insertJob({
    profileId: opts.profileId,
    audience: "vip",
    days: opts.days,
    slots,
    params,
  });
}

// --------------------------------------------------------------------------
// Processamento (chamado pelo tick de 1 minuto)
// --------------------------------------------------------------------------

/**
 * Processa UM lote do job do VIP mais antigo em aberto. Retorna quantos posts
 * criou. Uma falha marca o job como `error` sem derrubar o tick.
 */
export async function runVipGeneration(): Promise<number> {
  const row = nextOpenJobRow();
  if (!row || row.audience !== "vip") return 0;
  try {
    return await processBatch(row);
  } catch (err) {
    markError(row.id, err instanceof Error ? err.message : "Falha na geração.");
    console.error("[hotdash] Erro na geração do VIP:", err);
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

  const params = (row.params ? JSON.parse(row.params) : { contato: null, ctaLink: "" }) as JobParams;
  const contato = params.contato;
  const ctaLink = params.ctaLink || "";

  const profile = await getProfile(row.profile_id);
  if (!profile) throw new Error("Perfil não encontrado.");
  const bot = getBotConfigByProfile(profile.id);
  if (!bot || !bot.botToken) throw new Error("Bot não configurado.");

  markProcessing(row.id);

  const settings = db
    .prepare("SELECT vip_tags, vip_cta_buttons FROM telegram_autopost_settings WHERE profile_id = ?")
    .get(profile.id) as { vip_tags?: string; vip_cta_buttons?: string } | undefined;
  const allowedTagNames = (settings?.vip_tags || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  // Frases dos "Botões da copy (VIP)". A lista configurada é escrita pensando no
  // WhatsApp ("chama no meu zap"); quando o destino é o Telegram ela não serve, e
  // as frases próprias do Telegram entram no lugar.
  const configurada = (settings?.vip_cta_buttons ?? "").trim();
  const ctaList =
    contato === "telegram" ? DEFAULT_TELEGRAM_CTA_BUTTONS : configurada || DEFAULT_VIP_CTA_BUTTONS;
  const ctaFallback = contato === "telegram" ? TELEGRAM_CTA_FALLBACK : WHATSAPP_CTA_FALLBACK;

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

  // Persona rica (mesmo detalhamento dos outros geradores).
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

  // Fila de mídia do VIP. `getScheduledMediaUses` traz o que os lotes ANTERIORES
  // desta mesma geração já consumiram — sem isso cada lote recomeçaria a fila e
  // as primeiras fotos da ordem sairiam repetidas a cada 8 posts.
  const queue = createMediaQueue(
    listMedia(profile.id).filter(
      (m) =>
        allowedTagNames.length === 0 ||
        m.tags.some((t) => allowedTagNames.includes(t.name.toLowerCase())),
    ),
    getMediaPostCounts(profile.id),
    "vip",
    getScheduledMediaUses(profile.id, "vip"),
  );

  // Memória anti-repetição. No VIP ela pesa mais que nas Prévias: é o MESMO
  // público todo dia, então repetir a abertura é percebido na hora.
  const memoria = memoryBlock(recentOpenings(profile.id, ["VIP"]));

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
    type: VipType,
    weekday: number,
    images: { mime: string; base64: string }[],
    angleIdx: number,
  ): Promise<string> {
    if (aiFailed) return fallbackTextVip(type, contato ?? "whatsapp");
    const theme =
      `${captionThemeVip(type, contato ?? "whatsapp", weekday)}\n` +
      `${VARIATION_ANGLES[angleIdx % VARIATION_ANGLES.length]}${memoria}`;
    const toTry = activeProvider ? [activeProvider] : providerChain;
    const errors: string[] = [];
    for (const p of toTry) {
      try {
        const out = await generateCaption({
          provider: p,
          networks: [{ network: "telegram", postType: "VIP" }],
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
    return fallbackTextVip(type, contato ?? "whatsapp");
  }

  async function writePoll(): Promise<{ question: string; options: string[] }> {
    if (aiFailed) return fallbackPoll();
    const toTry = activeProvider ? [activeProvider] : providerChain;
    for (const p of toTry) {
      try {
        const raw = await callAiRaw(
          'Crie UMA enquete curta e safada (sem vender nada) pro grupo VIP no Telegram, tom íntimo de quem já conhece o público. Responda SÓ um JSON: {"question":"...","options":["..","..",".."]} com 2 a 4 opções curtas.',
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

    // Enquete: gera pergunta/opções, sem mídia, sem link.
    if (slot.kind === "enquete") {
      const poll = await writePoll();
      createPost({
        profileId: profile.id,
        networks: [{ network: "telegram", postType: "VIP" }],
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
    if (slot.media === "video") media = queue.take("video");
    else if (slot.media === "photo") media = queue.take("photo");

    // O acervo acabou de vídeo e a fila devolveu uma FOTO: rebaixa o tipo, senão
    // a legenda promete "gravei um vídeo" e vai uma foto anexada.
    if (slot.media === "video" && media?.kind === "image") type = "EXCLUSIVE_PHOTO";

    const images: { mime: string; base64: string }[] = [];
    if (media) {
      const img = await mediaImageBase64(media);
      if (img) images.push(img);
    }
    const written = await writeCaption(type, slot.weekday, images, row.done + i);

    // Só os slots de convite levam o link — e eles só existem quando a geração
    // pediu. Neles as 3 linhas já saem GRAVADAS na legenda, para aparecerem no
    // editor do calendário e poderem ser revisadas.
    const caption =
      slot.cta && ctaLink
        ? appendCtaLines(written, ctaLink, pickCtaLinkTexts(ctaList, 3), ctaFallback)
        : written;

    createPost({
      profileId: profile.id,
      networks: [{ network: "telegram", postType: "VIP" }],
      scheduledAt: slot.at,
      caption,
      mediaIds: media ? [media.id] : undefined,
      cta: slot.cta, // true só nos posts de convite → botão no envio
      // Só os posts de convite carregam o destino; nos outros ele não é usado e
      // gravá-lo só faria ruído no banco. Aqui o link vai SEMPRE resolvido (não
      // só quando há conta escolhida): sem isso o envio cairia no WhatsApp do
      // cadastro mesmo numa geração de Telegram.
      waLink: slot.cta ? ctaLink : undefined,
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

/**
 * Resolve o LINK do convite desta geração: a conta escolhida vira URL uma vez
 * só, no enfileiramento. Conta que não existe mais (ou de outra modelo) cai no
 * link do cadastro.
 */
export async function resolveVipCtaLink(
  profileId: string,
  contato: VipContato | null,
  contatoAccountId: string,
): Promise<string> {
  if (!contato) return "";
  const profile = await getProfile(profileId);
  if (!profile) return "";
  const contas =
    contato === "telegram" ? telegramAccounts(profile.accounts) : whatsappAccounts(profile.accounts);
  const escolhida = contatoAccountId ? contas.find((a) => a.id === contatoAccountId) : undefined;
  const padraoDoCadastro =
    contato === "telegram" ? profile.bioTelegramLink : profile.bioWhatsappLink;
  return escolhida?.url || padraoDoCadastro || "";
}
