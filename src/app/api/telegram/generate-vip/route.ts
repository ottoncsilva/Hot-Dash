import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfile } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import {
  listMedia,
  listUsedMediaIds,
  getMediaRow,
  renderVisionImageBase64,
} from "@/lib/media";
import { generateCaption, callAiRaw, isSystemicAiError } from "@/lib/ai";
import { extractVideoThumbnail, extname } from "@/lib/metadata";
import { getAiCredentials, getAppTimeZone, type AiProvider } from "@/lib/settings";
import { readBuffer } from "@/lib/storage";
import { createPost } from "@/lib/posts";
import type { MediaItem } from "@/lib/types";
import { mkSlotToUtcMs, mkDayFromToday, fallbackPoll } from "@/lib/previasAi";
import { planDayVip, captionThemeVip, fallbackTextVip } from "@/lib/vipAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

/**
 * Método MK — versão do GRUPO VIP (pós-venda / LTV). O SERVIDOR planeja o dia
 * (20–25 posts, relacionamento + CTA de WhatsApp nos picos); a IA ESCREVE a
 * legenda de cada post ANALISANDO A FOTO. Só os posts de LTV levam o botão do
 * WhatsApp particular (cta=true) — o link vem do cadastro da modelo.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const profileId = body.profileId as string;
    const days = Math.max(1, Math.min(14, parseInt(body.days, 10) || 1));
    if (!profileId) return NextResponse.json({ error: "Informe o profileId." }, { status: 400 });

    const profileMaybe = await getProfile(profileId);
    if (!profileMaybe) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
    const profile = profileMaybe;

    const bot = getBotConfigByProfile(profile.id);
    if (!bot || !bot.botToken) return NextResponse.json({ error: "Bot não configurado." }, { status: 400 });

    const db = getDb();
    const settings = db
      .prepare("SELECT vip_tags FROM telegram_autopost_settings WHERE profile_id = ?")
      .get(profile.id) as { vip_tags?: string } | undefined;
    const allowedTagNames = (settings?.vip_tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    // Cadeia de provedores (grok primeiro — costuma aceitar conteúdo adulto).
    const providerChain: AiProvider[] = (["grok", "openai", "gemini"] as AiProvider[]).filter(
      (p) => getAiCredentials(p) !== null,
    );
    if (providerChain.length === 0) {
      return NextResponse.json(
        { error: "Nenhum provedor de IA conectado. Ative um em Configurações → Conexão com IA." },
        { status: 400 },
      );
    }
    let activeProvider: AiProvider | null = null;
    let aiFailed = false;
    let aiError: string | null = null;

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

    // Mídias do VIP ainda não usadas — separadas em fotos e vídeos.
    const usedIds = listUsedMediaIds(profile.id);
    const allowed = listMedia(profile.id).filter(
      (m) =>
        !usedIds.has(m.id) &&
        (allowedTagNames.length === 0 ||
          m.tags.some((t) => allowedTagNames.includes(t.name.toLowerCase()))),
    );
    let photoPool = allowed.filter((m) => m.kind === "image");
    let videoPool = allowed.filter((m) => m.kind === "video");

    // Idempotência: horários já ocupados por posts VIP agendados (janela 5 min).
    const existing = db
      .prepare(
        `SELECT p.scheduled_at FROM posts p JOIN post_networks pn ON pn.post_id = p.id
         WHERE p.profile_id = ? AND pn.network = 'telegram' AND pn.post_type = 'VIP' AND p.status = 'scheduled'`,
      )
      .all(profile.id) as { scheduled_at: number }[];
    const taken = new Set(existing.map((e) => e.scheduled_at));

    // Imagem (base64) reduzida (~1024px) para a IA "ver" a foto. Vídeo usa o 1º frame.
    async function mediaImageBase64(media: MediaItem): Promise<{ mime: string; base64: string } | null> {
      try {
        const row = getMediaRow(media.id);
        if (!row) return null;
        if (media.kind === "video") {
          const frame = await extractVideoThumbnail(await readBuffer(row.path), extname(row.path), 1024);
          return { mime: "image/jpeg", base64: frame.toString("base64") };
        }
        const base64 = await renderVisionImageBase64(row.path);
        if (!base64) return null;
        return { mime: "image/jpeg", base64 };
      } catch {
        return null;
      }
    }

    async function writeCaption(
      type: Parameters<typeof captionThemeVip>[0],
      images: { mime: string; base64: string }[],
      angleIdx: number,
    ): Promise<string> {
      if (aiFailed) return fallbackTextVip(type);
      const theme = `${captionThemeVip(type)}\n${VARIATION_ANGLES[angleIdx % VARIATION_ANGLES.length]}`;
      const toTry = activeProvider ? [activeProvider] : providerChain;
      const errors: string[] = [];
      for (const p of toTry) {
        try {
          const out = await generateCaption({
            provider: p,
            networks: [{ network: "telegram", postType: "VIP" }],
            profileName: profile.name,
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
      // Só desiste do dia todo em falha SISTÊMICA (chave/cota/conexão).
      if (errors.length > 0 && errors.every((e) => isSystemicAiError(e))) {
        aiFailed = true;
      } else {
        activeProvider = null;
      }
      return fallbackTextVip(type);
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

    let created = 0;
    let createdToday = 0;
    let angleIdx = 0;

    // Gera o RESTO de hoje (offset 0 — horários passados pulados) + os `days`
    // dias seguintes completos. O dia base vem do FUSO DA OPERAÇÃO, não do
    // relógio do servidor (UTC): senão, das 21h às 23h59 de Brasília o servidor
    // já estava em "amanhã" e o resto da noite era pulado.
    const tz = getAppTimeZone();
    for (let dayOffset = 0; dayOffset <= days; dayOffset++) {
      const base = mkDayFromToday(dayOffset, tz);
      const plan = planDayVip();

      for (const slot of plan) {
        const at = mkSlotToUtcMs(base, slot.time, tz, true);
        if (at <= Date.now()) continue; // não agenda no passado
        let clash = false;
        for (const t of taken) if (Math.abs(t - at) < 5 * 60 * 1000) clash = true;
        if (clash) continue;

        // Enquete: gera pergunta/opções, sem mídia, sem link.
        if (slot.kind === "enquete") {
          const poll = await writePoll();
          createPost({
            profileId: profile.id,
            networks: [{ network: "telegram", postType: "VIP" }],
            scheduledAt: at,
            poll,
            cta: false,
          });
          taken.add(at);
          created++;
          if (dayOffset === 0) createdToday++;
          continue;
        }

        // Seleciona a mídia (vídeo → foto se faltar). Fotos/vídeos não repetem.
        let media: MediaItem | null = null;
        if (slot.media === "video") {
          if (videoPool.length > 0) {
            media = videoPool[Math.floor(Math.random() * videoPool.length)];
            videoPool = videoPool.filter((m) => m.id !== media!.id);
          } else if (photoPool.length > 0) {
            media = photoPool[Math.floor(Math.random() * photoPool.length)];
            photoPool = photoPool.filter((m) => m.id !== media!.id);
          }
        } else if (slot.media === "photo") {
          if (photoPool.length > 0) {
            media = photoPool[Math.floor(Math.random() * photoPool.length)];
            photoPool = photoPool.filter((m) => m.id !== media!.id);
          }
        }

        // Legenda: com a FOTO (visão) quando houver mídia; senão texto puro.
        const images: { mime: string; base64: string }[] = [];
        if (media) {
          const img = await mediaImageBase64(media);
          if (img) images.push(img);
        }
        const caption = await writeCaption(slot.type, images, angleIdx++);

        createPost({
          profileId: profile.id,
          networks: [{ network: "telegram", postType: "VIP" }],
          scheduledAt: at,
          caption,
          mediaIds: media ? [media.id] : undefined,
          cta: slot.cta, // true nos posts de WhatsApp (LTV) → botão no envio
        });
        taken.add(at);
        created++;
        if (dayOffset === 0) createdToday++;
      }
    }

    return NextResponse.json({ ok: true, generated: created, generatedToday: createdToday, aiError });
  } catch (err) {
    console.error("Generate VIP Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
