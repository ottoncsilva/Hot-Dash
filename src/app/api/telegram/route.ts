import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import {
  getBotConfigByProfile,
  saveBotConfig,
} from "@/lib/telegramDb";

import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const profileId = sp.get("profileId");

    if (!profileId) {
      throw new ApiError(400, "Informe o profileId.");
    }

    const bot = getBotConfigByProfile(profileId);
    let autopost: any = null;

    // Carrega configurações de autopost
    autopost = getDb()
      .prepare("SELECT * FROM telegram_autopost_settings WHERE profile_id = ?")
      .get(profileId) || {
      profile_id: profileId,
      enabled: 0,
      vip_post_interval: 12,
      vip_tags: "",
      warmup_post_interval: 24,
      warmup_tags: "",
      ai_prompt_style: "provocante",
    };

    // Carrega etiquetas disponíveis para o perfil escolher
    const tags = getDb().prepare("SELECT * FROM tags ORDER BY name").all();

    return NextResponse.json({
      bot,
      autopost,
      availableTags: tags,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    const db = getDb();

    if (action === "save-telegram-config") {
      const {
        profileId,
        botToken,
        idVip,
        idAquecimento,
        enabled,
        vipPostInterval,
        vipTags,
        warmupPostInterval,
        warmupTags,
        aiPromptStyle
      } = body;

      if (!profileId || !botToken || !idVip || !idAquecimento) {
        throw new ApiError(400, "Preencha o Token do Bot e os IDs dos grupos VIP e Prévias.");
      }

      // 1. Salva a config do bot (apenas Token e IDs)
      const existing = getBotConfigByProfile(profileId);
      const botId = existing?.id || randomUUID();

      saveBotConfig({
        id: botId,
        profileId,
        botToken: botToken.trim(),
        idVip: idVip.trim(),
        idAquecimento: idAquecimento.trim(),
        welcomeMessage: existing?.welcomeMessage || "Bem-vindo",
        successMessage: existing?.successMessage || "Aprovado",
      });

      // 2. Salva a config de Autopost
      db.prepare(
        `INSERT INTO telegram_autopost_settings (profile_id, enabled, vip_post_interval, vip_tags, warmup_post_interval, warmup_tags, ai_prompt_style)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET
           enabled = excluded.enabled,
           vip_post_interval = excluded.vip_post_interval,
           vip_tags = excluded.vip_tags,
           warmup_post_interval = excluded.warmup_post_interval,
           warmup_tags = excluded.warmup_tags,
           ai_prompt_style = excluded.ai_prompt_style`
      ).run(
        profileId,
        enabled ? 1 : 0,
        Number(vipPostInterval || 12),
        vipTags || "",
        Number(warmupPostInterval || 24),
        warmupTags || "",
        aiPromptStyle || "provocante"
      );

      return NextResponse.json({ ok: true });
    }

    throw new ApiError(400, "Ação inválida.");
  } catch (err) {
    return errorResponse(err);
  }
}
