import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listProfiles } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { listMedia, listUsedMediaIds, getMediaRow } from "@/lib/media";
import { generateCaption } from "@/lib/ai";
import { getAiCredentials } from "@/lib/settings";
import { sendTelegramMedia } from "@/lib/telegramApi";
import { createPost, updatePost } from "@/lib/posts";
import { readBuffer } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Validação básica do cron
    const token = req.nextUrl.searchParams.get("token");
    if (!token || token !== process.env.SESSION_SECRET) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const profiles = await listProfiles();
    const now = Date.now();
    const db = getDb();
    let totalPosted = 0;

    for (const profile of profiles) {
      const bot = getBotConfigByProfile(profile.id);
      if (!bot || !bot.botToken) continue;

      // Carrega configurações de autopost
      const settings = db
        .prepare("SELECT * FROM telegram_autopost_settings WHERE profile_id = ?")
        .get(profile.id) as any;

      if (!settings || !settings.enabled) continue;

      const hasOpenAi = getAiCredentials("openai") !== null;
      const hasGemini = getAiCredentials("gemini") !== null;
      const provider = hasOpenAi ? "openai" : (hasGemini ? "gemini" : null);

      // ---- 1. Processar postagem no VIP ----
      if (
        settings.vip_tags &&
        settings.vip_post_interval > 0 &&
        now - (settings.last_vip_post_at || 0) >= settings.vip_post_interval * 60 * 60 * 1000
      ) {
        const posted = await attemptAutopost(
          profile,
          bot,
          settings,
          provider,
          "vip",
          bot.idVip,
          settings.vip_tags
        );
        if (posted) {
          db.prepare(
            "UPDATE telegram_autopost_settings SET last_vip_post_at = ? WHERE profile_id = ?"
          ).run(now, profile.id);
          totalPosted++;
        }
      }

      // ---- 2. Processar postagem no Aquecimento ----
      if (
        settings.warmup_tags &&
        settings.warmup_post_interval > 0 &&
        now - (settings.last_warmup_post_at || 0) >= settings.warmup_post_interval * 60 * 60 * 1000
      ) {
        const posted = await attemptAutopost(
          profile,
          bot,
          settings,
          provider,
          "warmup",
          bot.idAquecimento,
          settings.warmup_tags
        );
        if (posted) {
          db.prepare(
            "UPDATE telegram_autopost_settings SET last_warmup_post_at = ? WHERE profile_id = ?"
          ).run(now, profile.id);
          totalPosted++;
        }
      }
    }

    return NextResponse.json({ ok: true, posted: totalPosted });
  } catch (err) {
    console.error("Cron Autopost Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}

async function attemptAutopost(
  profile: any,
  bot: any,
  settings: any,
  provider: "openai" | "gemini" | null,
  target: "vip" | "warmup",
  chatId: string,
  tagsString: string
): Promise<boolean> {
  const allowedTagNames = tagsString
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (allowedTagNames.length === 0) return false;

  // Lista mídias da biblioteca e IDs já utilizados
  const library = listMedia(profile.id);
  const usedIds = listUsedMediaIds(profile.id);

  // Filtra mídias não usadas que possuem alguma das tags permitidas
  const candidates = library
    .filter((m) => !usedIds.has(m.id))
    .filter((m) =>
      m.tags.some((tag) => allowedTagNames.includes(tag.name.toLowerCase()))
    )
    .sort((a, b) => a.createdAt - b.createdAt); // Mais antiga primeiro

  if (candidates.length === 0) {
    console.warn(`[Autopost] Nenhuma mídia restante para ${profile.name} (${target})`);
    return false;
  }

  const media = candidates[0];
  const row = getMediaRow(media.id);
  if (!row) return false;

  // Gera legenda via IA
  let caption = "";
  if (provider) {
    const images: any[] = [];
    if (media.kind === "image") {
      try {
        const buf = await readBuffer(row.path);
        images.push({
          mime: media.mime || "image/jpeg",
          base64: buf.toString("base64"),
        });
      } catch (err) {
        console.error("Erro ao ler imagem para IA:", err);
      }
    }

    try {
      caption = await generateCaption({
        provider,
        networks: [{ network: "telegram", postType: "Mensagem" }],
        profileName: profile.name,
        profileNotes: profile.notes || "",
        theme: settings.ai_prompt_style || "provocante",
        images,
      });
    } catch (aiErr) {
      console.error("Erro ao gerar legenda com IA:", aiErr);
      caption = "Novo conteúdo disponível no canal! 🔥😘";
    }
  } else {
    caption = "Novo conteúdo disponível no canal! 🔥😘";
  }

  // Dispara no Telegram
  await sendTelegramMedia(bot.botToken, chatId, row.path, caption);

  // Grava o post no banco para marcar como usado e constar no histórico
  const p = createPost({
    profileId: profile.id,
    networks: [{ network: "telegram", postType: "Mensagem" }],
    scheduledAt: Date.now(),
    caption,
    mediaIds: [media.id],
  });

  updatePost(p.id, { status: "posted" });

  return true;
}
