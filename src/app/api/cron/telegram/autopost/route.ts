import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listProfiles } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { sendTelegramMedia } from "@/lib/telegramApi";
import { updatePost } from "@/lib/posts";
import { getMediaRow } from "@/lib/media";
import { requireUser } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");

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

    let totalPosted = 0;

    for (const profile of profiles) {
      const bot = getBotConfigByProfile(profile.id);
      if (!bot || !bot.botToken) continue;

      // Busca todos os posts agendados pendentes para Telegram (VIP ou Prévias) deste perfil cujo horário já chegou
      const pendingPosts = db
        .prepare(
          `
          SELECT p.id, p.caption, pn.post_type, pm.media_id
          FROM posts p
          JOIN post_networks pn ON pn.post_id = p.id
          LEFT JOIN post_media pm ON pm.post_id = p.id AND pm.sort_order = 0
          WHERE p.profile_id = ? AND p.status = 'scheduled' AND p.scheduled_at <= ? AND pn.network = 'telegram'
        `
        )
        .all(profile.id, now) as any[];

      for (const post of pendingPosts) {
        // Define o alvo
        let chatId = "";
        if (post.post_type === "VIP") chatId = bot.idVip;
        else if (post.post_type === "Prévias") chatId = bot.idAquecimento;
        else continue; // Ignora se for um post genérico manual ("Mensagem" ou "Outro") sem alvo específico

        if (!chatId) {
          updatePost(post.id, { status: "posted" }); // Ignora para não ficar travando a fila se o bot não estiver configurado corretamente
          continue;
        }

        // Obtém o caminho da mídia
        let mediaPath = "";
        if (post.media_id) {
          const row = getMediaRow(post.media_id);
          if (row) mediaPath = row.path;
        }

        // Prepara call-to-action (O Link e botões SÓ vão para as Prévias, nunca no VIP, conforme feedback do usuário)
        let options: Record<string, any> = {};
        if (post.post_type === "Prévias" && profile.bioVipLink) {
          options.reply_markup = {
            inline_keyboard: [
              [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }],
              [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }],
              [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }],
            ],
          };
        }

        // Dispara no Telegram
        try {
          await sendTelegramMedia(bot.botToken, chatId, mediaPath, post.caption || "", options);
          updatePost(post.id, { status: "posted" });
          totalPosted++;
        } catch (e) {
          console.error(`Erro ao postar post ${post.id} no Telegram:`, e);
          // O post permanece 'scheduled' e será tentado novamente no próximo minuto
        }
      }
    }

    return NextResponse.json({ ok: true, posted: totalPosted });
  } catch (err) {
    console.error("Cron Autopost Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
