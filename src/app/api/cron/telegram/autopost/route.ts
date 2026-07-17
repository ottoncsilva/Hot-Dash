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
import { requireUser } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    const forceProfileId = req.nextUrl.searchParams.get("forceProfile");
    const forceTarget = req.nextUrl.searchParams.get("target") as "vip" | "warmup" | null;

    let isAuthorized = false;
    if (token && token === process.env.SESSION_SECRET) {
      isAuthorized = true;
    } else {
      try {
        await requireUser(req);
        isAuthorized = true;
      } catch {
        isAuthorized = false;
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const profiles = await listProfiles();
    const now = Date.now();
    const db = getDb();
    const provider = getAiCredentials("grok") !== null ? "grok" : null;

    // --- ROTA DE DISPARO MANUAL (FORÇADO) ---
    if (forceProfileId && forceTarget) {
      const profile = profiles.find((p) => p.id === forceProfileId);
      if (!profile) {
        return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
      }
      const bot = getBotConfigByProfile(profile.id);
      if (!bot || !bot.botToken) {
        return NextResponse.json({ error: "Configuração do bot ou token ausente." }, { status: 400 });
      }
      const settings = db
        .prepare("SELECT * FROM telegram_autopost_settings WHERE profile_id = ?")
        .get(profile.id) as any;

      if (!settings) {
        return NextResponse.json({ error: "Configurações de autopost não encontradas." }, { status: 400 });
      }

      let posted = false;
      if (forceTarget === "vip") {
        posted = await attemptAutopost(
          profile,
          bot,
          settings,
          provider,
          "vip",
          bot.idVip,
          settings.vip_tags,
          settings.vip_prompt || "Legenda no tom provocante."
        );
        if (posted) {
          db.prepare(
            "UPDATE telegram_autopost_settings SET last_vip_post_at = ? WHERE profile_id = ?"
          ).run(now, profile.id);
        }
      } else if (forceTarget === "warmup") {
        posted = await attemptAutopost(
          profile,
          bot,
          settings,
          provider,
          "warmup",
          bot.idAquecimento,
          settings.warmup_tags,
          settings.warmup_prompt || "Legenda para chamar os inscritos para o VIP.",
          settings.warmup_link
        );
        if (posted) {
          db.prepare(
            "UPDATE telegram_autopost_settings SET last_warmup_post_at = ? WHERE profile_id = ?"
          ).run(now, profile.id);
        }
      }

      return NextResponse.json({ ok: posted, forced: true });
    }

    // --- CRON DAEMON DE DISPAROS PROGRAMADOS ---
    let totalPosted = 0;

    for (const profile of profiles) {
      const bot = getBotConfigByProfile(profile.id);
      if (!bot || !bot.botToken) continue;

      // Carrega configurações de autopost
      const settings = db
        .prepare("SELECT * FROM telegram_autopost_settings WHERE profile_id = ?")
        .get(profile.id) as any;

      if (!settings || !settings.enabled) continue;



      function isPostDue(type: string, interval: number, fixedTimes: string, lastPost: number): boolean {
        if (type === "manual") return false;
        if (type === "fixed") {
          const times = (fixedTimes || "").split(",").map(t => t.trim()).filter(Boolean);
          if (times.length === 0) return false;
          for (const timeStr of times) {
            const [hStr, mStr] = timeStr.split(":");
            if (!hStr || !mStr) continue;
            const target = new Date(now);
            target.setHours(parseInt(hStr, 10), parseInt(mStr, 10), 0, 0);
            if (now >= target.getTime() && lastPost < target.getTime()) return true;
          }
          return false;
        }
        return interval > 0 && now - lastPost >= interval * 60 * 1000;
      }

      // ---- 1. Processar postagem no VIP ----
      if (
        settings.vip_tags &&
        isPostDue(settings.vip_schedule_type || "interval", settings.vip_post_interval, settings.vip_fixed_times, settings.last_vip_post_at || 0)
      ) {
        const posted = await attemptAutopost(
          profile,
          bot,
          settings,
          provider,
          "vip",
          bot.idVip,
          settings.vip_tags,
          settings.vip_prompt || "Legenda no tom provocante."
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
        isPostDue(settings.warmup_schedule_type || "interval", settings.warmup_post_interval, settings.warmup_fixed_times, settings.last_warmup_post_at || 0)
      ) {
        const posted = await attemptAutopost(
          profile,
          bot,
          settings,
          provider,
          "warmup",
          bot.idAquecimento,
          settings.warmup_tags,
          settings.warmup_prompt || "Legenda para chamar os inscritos para o VIP.",
          settings.warmup_link
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
  provider: "openai" | "gemini" | "grok" | null,
  target: "vip" | "warmup",
  chatId: string,
  tagsString: string,
  promptTemplate: string,
  link?: string
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

    // Enriquecimento do prompt com a biografia da modelo
    let richNotes = profile.notes || "";
    if (profile.bioPhysical) richNotes += `\nCaracterísticas Físicas da modelo: ${profile.bioPhysical}`;
    if (profile.bioUnique) richNotes += `\nMecanismo Único / Fetiche: ${profile.bioUnique}`;
    if (profile.bioPersonality) {
      const pType = profile.bioPersonality === "santinha" 
        ? "Santinha (inocente por fora)" 
        : profile.bioPersonality === "explicita" 
        ? "Explícita (sem papas na língua, bem ousada e direta)" 
        : "Safadinha (safada na medida)";
      richNotes += `\nPersonalidade/Estilo de escrita: ${pType}`;
    }
    if (profile.bioVipLink) richNotes += `\nLink do VIP/Bot de assinatura: ${profile.bioVipLink}`;

    try {
      caption = await generateCaption({
        provider,
        networks: [{ network: "telegram", postType: "Mensagem" }],
        profileName: profile.name,
        profileNotes: richNotes,
        theme: promptTemplate,
        images,
      });
    } catch (aiErr) {
      console.error("Erro ao gerar legenda com IA:", aiErr);
      caption = "Novo conteúdo disponível no canal! 🔥😘";
    }
  } else {
    caption = "Novo conteúdo disponível no canal! 🔥😘";
  }

  if (target === "warmup" && link) {
    caption = `${caption}\n\n👉 Acesse: ${link}`;
  }

  // Prepara botões triplos de call-to-action apontando para o VIP Link
  let options: Record<string, any> = {};
  if (profile.bioVipLink) {
    options.reply_markup = {
      inline_keyboard: [
        [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }],
        [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }],
        [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }]
      ]
    };
  }

  // Dispara no Telegram
  await sendTelegramMedia(bot.botToken, chatId, row.path, caption, options);

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
