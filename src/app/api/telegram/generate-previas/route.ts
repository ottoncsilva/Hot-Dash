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
import { readBuffer } from "@/lib/storage";
import { getAiCredentials, type AiProvider } from "@/lib/settings";
import { createPost } from "@/lib/posts";
import type { MediaItem } from "@/lib/types";
import {
  planDay,
  saoPauloWallTimeToUtcMs,
  captionTheme,
  fallbackText,
  fallbackPoll,
} from "@/lib/previasAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Ângulos de variação (rotacionados por post) — o mesmo recurso do gerador de
// cronograma, para as legendas não começarem todas iguais.
const VARIATION_ANGLES = [
  "Abra com uma provocação ousada.",
  "Abra com uma pergunta direta pra quem tá lendo.",
  "Comece contando o que você tá fazendo ou sentindo agora.",
  "Comece com um convite safado e direto.",
  "Comece reagindo à própria roupa/corpo que aparece na foto.",
  "Comece com um tom mais carinhoso e íntimo.",
  "Comece com 'será que você aguenta…'.",
  "Comece descrevendo o clima/cenário da foto.",
];

/**
 * Método MK — gera a programação do dia (resto de hoje + N dias) do grupo de
 * PRÉVIAS. O SERVIDOR planeja (horários/tipos/distribuição); a legenda de cada
 * post é gerada por IA ANALISANDO A FOTO (visão) nos posts de foto/vídeo, para
 * não sair genérica. Só os posts de conversão levam o link do VIP (cta).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const profileId = body.profileId as string;
    const days = Math.max(1, Math.min(14, parseInt(body.days, 10) || 1));
    if (!profileId) return NextResponse.json({ error: "Informe o profileId." }, { status: 400 });

    const profileMaybe = await getProfile(profileId);
    if (!profileMaybe) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
    const profile = profileMaybe; // const não-nulo (narrowing persiste nos closures)

    const bot = getBotConfigByProfile(profile.id);
    if (!bot || !bot.botToken) return NextResponse.json({ error: "Bot não configurado." }, { status: 400 });

    const db = getDb();
    const settings = db
      .prepare("SELECT warmup_tags FROM telegram_autopost_settings WHERE profile_id = ?")
      .get(profile.id) as { warmup_tags?: string } | undefined;
    const allowedTagNames = (settings?.warmup_tags || "")
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
    // Trava no primeiro provedor que funcionar (evita ficar tentando todos).
    let activeProvider: AiProvider | null = null;
    let aiFailed = false;
    let aiError: string | null = null;

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

    // Mídias das prévias ainda não usadas — separadas em fotos e vídeos.
    const usedIds = listUsedMediaIds(profile.id);
    const allowed = listMedia(profile.id).filter(
      (m) =>
        !usedIds.has(m.id) &&
        (allowedTagNames.length === 0 ||
          m.tags.some((t) => allowedTagNames.includes(t.name.toLowerCase()))),
    );
    let photoPool = allowed.filter((m) => m.kind === "image");
    let videoPool = allowed.filter((m) => m.kind === "video");

    // Idempotência: horários já ocupados por Prévias agendadas (janela 5 min).
    const existing = db
      .prepare(
        `SELECT p.scheduled_at FROM posts p JOIN post_networks pn ON pn.post_id = p.id
         WHERE p.profile_id = ? AND pn.network = 'telegram' AND pn.post_type = 'Prévias' AND p.status = 'scheduled'`,
      )
      .all(profile.id) as { scheduled_at: number }[];
    const taken = new Set(existing.map((e) => e.scheduled_at));

    // Imagem (base64) da mídia para a IA "ver" a foto — em resolução boa o
    // suficiente para o modelo reconhecer roupa/pose/cenário (a miniatura da
    // galeria, de 480px, sai pequena demais e faz a legenda genérica). Foto:
    // render de até 1024px. Vídeo: 1º frame extraído já em ~1024px.
    async function mediaImageBase64(media: MediaItem): Promise<{ mime: string; base64: string } | null> {
      try {
        const row = getMediaRow(media.id);
        if (!row) return null;
        if (media.kind === "video") {
          const buf = await readBuffer(row.path);
          const frame = await extractVideoThumbnail(buf, extname(row.path), 1024);
          return { mime: "image/jpeg", base64: frame.toString("base64") };
        }
        const base64 = await renderVisionImageBase64(row.path);
        if (!base64) return null;
        return { mime: "image/jpeg", base64 };
      } catch {
        return null;
      }
    }

    async function writeCaption(type: Parameters<typeof captionTheme>[0], images: { mime: string; base64: string }[], angleIdx: number): Promise<string> {
      if (aiFailed) return fallbackText(type);
      const theme = `${captionTheme(type)}\n${VARIATION_ANGLES[angleIdx % VARIATION_ANGLES.length]}`;
      const toTry = activeProvider ? [activeProvider] : providerChain;
      const errors: string[] = [];
      for (const p of toTry) {
        try {
          const out = await generateCaption({
            provider: p,
            networks: [{ network: "telegram", postType: "Prévias" }],
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
      // Só desiste do dia inteiro quando a causa é SISTÊMICA (chave/cota/conexão).
      // Falhas pontuais (rate-limit, timeout, recusa, vazio) não travam o lote —
      // o próximo post volta a tentar a cadeia inteira.
      if (errors.length > 0 && errors.every((e) => isSystemicAiError(e))) {
        aiFailed = true;
      } else {
        activeProvider = null; // recomeça a cadeia no próximo post
      }
      return fallbackText(type);
    }

    async function writePoll(): Promise<{ question: string; options: string[] }> {
      if (aiFailed) return fallbackPoll();
      const toTry = activeProvider ? [activeProvider] : providerChain;
      for (const p of toTry) {
        try {
          const raw = await callAiRaw(
            'Crie UMA enquete curta e safada (sem vender) pro grupo de prévias no Telegram. Responda SÓ um JSON: {"question":"...","options":["..","..",".."]} com 2 a 4 opções curtas.',
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
    let angleIdx = 0;

    // Gera o RESTO de hoje (offset 0 — horários passados pulados) + os `days`
    // dias seguintes completos.
    for (let dayOffset = 0; dayOffset <= days; dayOffset++) {
      const base = new Date();
      base.setDate(base.getDate() + dayOffset);
      const plan = planDay();

      for (const slot of plan) {
        const at = saoPauloWallTimeToUtcMs(base, slot.time, true);
        if (at <= Date.now()) continue; // não agenda no passado
        let clash = false;
        for (const t of taken) if (Math.abs(t - at) < 5 * 60 * 1000) clash = true;
        if (clash) continue;

        // Enquete: gera pergunta/opções, sem mídia, sem link.
        if (slot.kind === "enquete") {
          const poll = await writePoll();
          createPost({
            profileId: profile.id,
            networks: [{ network: "telegram", postType: "Prévias" }],
            scheduledAt: at,
            poll,
            cta: false,
          });
          taken.add(at);
          created++;
          continue;
        }

        // Seleciona a mídia (vídeo → foto se faltar). Fotos/vídeos não repetem.
        let media: MediaItem | null = null;
        if (slot.kind === "video") {
          if (videoPool.length > 0) {
            media = videoPool[Math.floor(Math.random() * videoPool.length)];
            videoPool = videoPool.filter((m) => m.id !== media!.id);
          } else if (photoPool.length > 0) {
            media = photoPool[Math.floor(Math.random() * photoPool.length)];
            photoPool = photoPool.filter((m) => m.id !== media!.id);
          }
        } else if (slot.kind === "foto") {
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
          networks: [{ network: "telegram", postType: "Prévias" }],
          scheduledAt: at,
          caption,
          mediaIds: media ? [media.id] : undefined,
          cta: slot.cta,
        });
        taken.add(at);
        created++;
      }
    }

    return NextResponse.json({ ok: true, generated: created, aiError });
  } catch (err) {
    console.error("Generate Prévias Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
