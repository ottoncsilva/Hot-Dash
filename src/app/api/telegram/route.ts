import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import {
  getBotConfigByProfile,
  saveBotConfig,
  listPlans,
  savePlan,
  deletePlan,
  listCustomButtons,
  saveCustomButton,
  deleteCustomButton,
  listSubscriptions,
  saveSubscription,
  getSubscription,
} from "@/lib/telegramDb";
import { setTelegramWebhook, banTelegramMember, unbanTelegramMember, createTelegramInviteLink, sendTelegramMessage } from "@/lib/telegramApi";
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
    let plans: any[] = [];
    let customButtons: any[] = [];
    let members: any[] = [];
    let autopost: any = null;

    if (bot) {
      plans = listPlans(bot.id);
      customButtons = listCustomButtons(bot.id);
      members = listSubscriptions(bot.id);
    }

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
      plans,
      customButtons,
      members,
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

    if (action === "save-bot") {
      const { profileId, botToken, idVip, idAquecimento, idRegistro, supportUsername, welcomeMessage, successMessage } = body;

      if (!profileId || !botToken || !idVip || !idAquecimento || !welcomeMessage) {
        throw new ApiError(400, "Preencha todos os campos obrigatórios.");
      }

      // 1. Salva ou atualiza a config no banco
      const existing = getBotConfigByProfile(profileId);
      const botId = existing?.id || randomUUID();

      const saved = saveBotConfig({
        id: botId,
        profileId,
        botToken: botToken.trim(),
        idVip: idVip.trim(),
        idAquecimento: idAquecimento.trim(),
        idRegistro: idRegistro ? idRegistro.trim() : undefined,
        supportUsername: supportUsername ? supportUsername.trim() : undefined,
        welcomeMessage: welcomeMessage.trim(),
        successMessage: successMessage ? successMessage.trim() : undefined,
      });

      // 2. Registra automaticamente o webhook no Telegram
      const webhookUrl = `${req.nextUrl.origin}/api/webhooks/telegram/${saved.id}`;
      try {
        await setTelegramWebhook(saved.botToken, webhookUrl);
      } catch (webhookErr: any) {
        console.warn("Erro ao configurar setWebhook:", webhookErr);
      }

      return NextResponse.json({ bot: saved });
    }

    if (action === "save-plan") {
      const { botId, name, priceCents, durationDays } = body;
      const planId = body.id || randomUUID();

      if (!botId || !name || !priceCents || !durationDays) {
        throw new ApiError(400, "Dados incompletos do plano.");
      }

      savePlan({
        id: planId,
        botId,
        name: name.trim(),
        priceCents: Number(priceCents),
        durationDays: Number(durationDays),
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "delete-plan") {
      const { id } = body;
      if (!id) throw new ApiError(400, "ID do plano ausente.");
      deletePlan(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "save-button") {
      const { botId, text, url, sortOrder } = body;
      const btnId = body.id || randomUUID();

      if (!botId || !text || !url) {
        throw new ApiError(400, "Preencha o texto e link do botão.");
      }

      saveCustomButton({
        id: btnId,
        botId,
        text: text.trim(),
        url: url.trim(),
        sortOrder: Number(sortOrder || 0),
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "delete-button") {
      const { id } = body;
      if (!id) throw new ApiError(400, "ID do botão ausente.");
      deleteCustomButton(id);
      return NextResponse.json({ ok: true });
    }

    if (action === "save-autopost") {
      const { profileId, enabled, vipPostInterval, vipTags, warmupPostInterval, warmupTags, aiPromptStyle } = body;

      if (!profileId) throw new ApiError(400, "ProfileId ausente.");

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

    // Ações de gerenciamento manual de membros
    if (action === "member-expire") {
      const { id } = body;
      const sub = getSubscription(id);
      if (!sub) throw new ApiError(404, "Inscrição não encontrada.");

      const bot = getBotConfigByProfile(body.profileId);
      if (!bot) throw new ApiError(404, "Bot não configurado.");

      try {
        await banTelegramMember(bot.botToken, bot.idVip, sub.telegramUserId);
        await unbanTelegramMember(bot.botToken, bot.idVip, sub.telegramUserId);
      } catch (err) {
        console.warn("Erro ao banir membro manualmente:", err);
      }

      sub.status = "expired";
      saveSubscription(sub);
      return NextResponse.json({ ok: true });
    }

    if (action === "member-activate") {
      const { id } = body;
      const sub = getSubscription(id);
      if (!sub) throw new ApiError(404, "Inscrição não encontrada.");

      const bot = getBotConfigByProfile(body.profileId);
      if (!bot) throw new ApiError(404, "Bot não configurado.");

      const invite = await createTelegramInviteLink(bot.botToken, bot.idVip, `Manual_${sub.telegramUserId}`).catch(() => null);
      
      sub.status = "active";
      sub.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // Estende por 30 dias
      if (invite) sub.inviteLink = invite.invite_link;
      saveSubscription(sub);

      return NextResponse.json({ ok: true });
    }

    throw new ApiError(400, "Ação inválida.");
  } catch (err) {
    return errorResponse(err);
  }
}
