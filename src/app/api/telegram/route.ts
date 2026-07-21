import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import {
  getBotConfigByProfile,
  getBotConfig,
  saveBotConfig,
  listPlans,
  savePlan,
  deletePlan,
  listCustomButtons,
  saveCustomButton,
  deleteCustomButton,
  listSubscriptions,
  getSubscription,
  saveSubscription,
} from "@/lib/telegramDb";
import {
  setTelegramWebhook,
  getTelegramMe,
  getTelegramWebhookInfo,
  telegramWebhookSecret,
  createTelegramInviteLink,
  sendTelegramMessage,
  banTelegramMember,
  unbanTelegramMember,
} from "@/lib/telegramApi";

import { randomUUID } from "node:crypto";

/** Base pública do app para montar a URL do webhook do Telegram. */
function publicOrigin(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.WEBHOOK_APP_URL ||
    req.nextUrl.origin
  );
}

/** Registra (ou re-registra) o webhook do bot apontando para o Hot-Dash.
 *  Nunca lança — devolve {ok,message} para a UI mostrar o status. */
async function registerBotWebhook(
  req: NextRequest,
  botId: string,
  botToken: string,
): Promise<{ ok: boolean; message?: string; username?: string }> {
  try {
    let username: string | undefined;
    try {
      const me = await getTelegramMe(botToken);
      username = me.username;
    } catch {
      // token inválido → o setWebhook abaixo também falha e reporta.
    }
    const url = `${publicOrigin(req).replace(/\/+$/, "")}/api/webhooks/telegram/${botId}`;
    await setTelegramWebhook(botToken, url, telegramWebhookSecret(botId));
    return { ok: true, username };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao registrar webhook." };
  }
}

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

    // Dados do bot de vendas (planos, botões, assinantes) — só quando há bot.
    const plans = bot ? listPlans(bot.id) : [];
    const customButtons = bot ? listCustomButtons(bot.id) : [];
    const subscriptions = bot ? listSubscriptions(bot.id) : [];

    return NextResponse.json({
      bot,
      autopost,
      availableTags: tags,
      plans,
      customButtons,
      subscriptions,
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
        vipPrompt,
        vipScheduleType,
        vipFixedTimes,
        warmupPostInterval,
        warmupTags,
        warmupPrompt,
        warmupLink,
        warmupScheduleType,
        warmupFixedTimes,
      } = body;

      if (!profileId || !botToken || !idVip || !idAquecimento) {
        throw new ApiError(400, "Preencha o Token do Bot e os IDs dos grupos VIP e Prévias.");
      }

      // 1. Salva a config do bot (Token e IDs) PRESERVANDO os campos de vendas
      // (mensagens, funis, suporte, registro) — as duas páginas dividem a mesma
      // linha telegram_bots, então mesclamos com o que já existe.
      const existing = getBotConfigByProfile(profileId);
      const botId = existing?.id || randomUUID();

      saveBotConfig({
        id: botId,
        profileId,
        botToken: botToken.trim(),
        botUsername: existing?.botUsername,
        idVip: idVip.trim(),
        idAquecimento: idAquecimento.trim(),
        idRegistro: existing?.idRegistro,
        supportUsername: existing?.supportUsername,
        welcomeMessage: existing?.welcomeMessage || "Bem-vindo",
        welcomeMediaTags: existing?.welcomeMediaTags,
        successMessage: existing?.successMessage || "Aprovado",
        downsellFunnel: existing?.downsellFunnel,
        upsellFunnel: existing?.upsellFunnel,
      });

      // 2. Salva a config de Autopost
      db.prepare(
        `INSERT INTO telegram_autopost_settings (
          profile_id, enabled, 
          vip_post_interval, vip_tags, vip_prompt, vip_schedule_type, vip_fixed_times,
          warmup_post_interval, warmup_tags, warmup_prompt, warmup_link, warmup_schedule_type, warmup_fixed_times
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET
           enabled = excluded.enabled,
           vip_post_interval = excluded.vip_post_interval,
           vip_tags = excluded.vip_tags,
           vip_prompt = excluded.vip_prompt,
           vip_schedule_type = excluded.vip_schedule_type,
           vip_fixed_times = excluded.vip_fixed_times,
           warmup_post_interval = excluded.warmup_post_interval,
           warmup_tags = excluded.warmup_tags,
           warmup_prompt = excluded.warmup_prompt,
           warmup_link = excluded.warmup_link,
           warmup_schedule_type = excluded.warmup_schedule_type,
           warmup_fixed_times = excluded.warmup_fixed_times`
      ).run(
        profileId,
        enabled ? 1 : 0,
        Number(vipPostInterval || 12),
        vipTags || "",
        vipPrompt || "",
        vipScheduleType || "interval",
        vipFixedTimes || "",
        Number(warmupPostInterval || 24),
        warmupTags || "",
        warmupPrompt || "",
        warmupLink || "",
        warmupScheduleType || "interval",
        warmupFixedTimes || ""
      );

      // 3. Registra o webhook do bot no Telegram (aponta para o Hot-Dash) e
      // guarda o @username. Best-effort: não derruba o save se o Telegram falhar.
      const webhook = await registerBotWebhook(req, botId, botToken.trim());
      if (webhook.username && webhook.username !== existing?.botUsername) {
        const cur = getBotConfigByProfile(profileId);
        if (cur) saveBotConfig({ ...cur, botUsername: webhook.username });
      }

      return NextResponse.json({ ok: true, webhook });
    }

    // Helper: carrega o bot do perfil ou erro 400.
    function requireBot(profileId: string) {
      if (!profileId) throw new ApiError(400, "Informe o profileId.");
      const bot = getBotConfigByProfile(profileId);
      if (!bot) throw new ApiError(400, "Configure primeiro o bot em Automação de postagens (token e grupos).");
      return bot;
    }

    // ---- Mensagens / suporte / registro ----
    if (action === "save-bot-messages") {
      const bot = requireBot(body.profileId);
      saveBotConfig({
        ...bot,
        welcomeMessage: String(body.welcomeMessage ?? bot.welcomeMessage ?? "Bem-vindo"),
        welcomeMediaTags: body.welcomeMediaTags !== undefined ? String(body.welcomeMediaTags) : bot.welcomeMediaTags,
        successMessage: String(body.successMessage ?? bot.successMessage ?? "Aprovado"),
        supportUsername: body.supportUsername !== undefined ? String(body.supportUsername) : bot.supportUsername,
        idRegistro: body.idRegistro !== undefined ? String(body.idRegistro) : bot.idRegistro,
      });
      return NextResponse.json({ ok: true });
    }

    // ---- Funis (downsell / upsell) — JSON de FunnelStep[] ----
    if (action === "save-funnels") {
      const bot = requireBot(body.profileId);
      const norm = (v: unknown) => {
        if (v === undefined) return undefined;
        if (typeof v === "string") return v;
        try { return JSON.stringify(v); } catch { return undefined; }
      };
      saveBotConfig({
        ...bot,
        downsellFunnel: norm(body.downsellFunnel) ?? bot.downsellFunnel,
        upsellFunnel: norm(body.upsellFunnel) ?? bot.upsellFunnel,
      });
      return NextResponse.json({ ok: true });
    }

    // ---- Planos/ofertas — substitui a lista inteira do bot ----
    if (action === "save-plans") {
      const bot = requireBot(body.profileId);
      const incoming = Array.isArray(body.plans) ? body.plans : [];
      const existing = listPlans(bot.id);
      const keepIds = new Set<string>();
      for (const p of incoming) {
        const name = String(p.name || "").trim();
        const priceCents = Math.max(0, Math.round(Number(p.priceCents) || 0));
        const durationDays = Math.max(1, Math.round(Number(p.durationDays) || 30));
        if (!name || priceCents <= 0) continue;
        const id = typeof p.id === "string" && p.id ? p.id : randomUUID();
        keepIds.add(id);
        savePlan({ id, botId: bot.id, name, priceCents, durationDays });
      }
      // Remove os que sumiram da lista.
      for (const old of existing) if (!keepIds.has(old.id)) deletePlan(old.id);
      return NextResponse.json({ ok: true, plans: listPlans(bot.id) });
    }

    // ---- Botões personalizados — substitui a lista inteira ----
    if (action === "save-buttons") {
      const bot = requireBot(body.profileId);
      const incoming = Array.isArray(body.buttons) ? body.buttons : [];
      const existing = listCustomButtons(bot.id);
      const keepIds = new Set<string>();
      incoming.forEach((b: Record<string, unknown>, idx: number) => {
        const text = String(b.text || "").trim();
        const url = String(b.url || "").trim();
        if (!text || !url) return;
        const id = typeof b.id === "string" && b.id ? b.id : randomUUID();
        keepIds.add(id);
        saveCustomButton({ id, botId: bot.id, text, url, sortOrder: idx });
      });
      for (const old of existing) if (!keepIds.has(old.id)) deleteCustomButton(old.id);
      return NextResponse.json({ ok: true, customButtons: listCustomButtons(bot.id) });
    }

    // ---- (Re)registrar o webhook manualmente (botão da UI) ----
    if (action === "register-webhook") {
      const bot = requireBot(body.profileId);
      const webhook = await registerBotWebhook(req, bot.id, bot.botToken);
      if (webhook.username && webhook.username !== bot.botUsername) {
        saveBotConfig({ ...bot, botUsername: webhook.username });
      }
      return NextResponse.json({ ok: true, webhook });
    }

    // ---- Status do webhook (getWebhookInfo) ----
    if (action === "webhook-status") {
      const bot = requireBot(body.profileId);
      try {
        const info = await getTelegramWebhookInfo(bot.botToken);
        const expectedUrl = `${publicOrigin(req).replace(/\/+$/, "")}/api/webhooks/telegram/${bot.id}`;
        const ok = Boolean(info.url) && info.url === expectedUrl;
        return NextResponse.json({ ok: true, info, matches: ok, expectedUrl });
      } catch (e) {
        return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "Falha ao consultar." });
      }
    }

    // ---- Ações manuais sobre uma assinatura ----
    if (action === "sub-extend" || action === "sub-kick" || action === "sub-resend-link") {
      const sub = getSubscription(String(body.subscriptionId || ""));
      if (!sub) throw new ApiError(404, "Assinatura não encontrada.");
      const bot = getBotConfig(sub.botId);
      if (!bot) throw new ApiError(404, "Bot não encontrado.");

      if (action === "sub-extend") {
        const days = Math.max(1, Math.round(Number(body.days) || 30));
        const base = sub.status === "active" && sub.expiresAt > Date.now() ? sub.expiresAt : Date.now();
        sub.expiresAt = base + days * 24 * 60 * 60 * 1000;
        sub.status = "active";
        saveSubscription(sub);
        await sendTelegramMessage(
          bot.botToken,
          String(sub.telegramUserId),
          `✅ Sua assinatura VIP foi estendida por mais ${days} dia(s).`,
        ).catch(() => {});
        return NextResponse.json({ ok: true });
      }

      if (action === "sub-kick") {
        await banTelegramMember(bot.botToken, bot.idVip, sub.telegramUserId).catch(() => {});
        await unbanTelegramMember(bot.botToken, bot.idVip, sub.telegramUserId).catch(() => {});
        sub.status = "expired";
        saveSubscription(sub);
        return NextResponse.json({ ok: true });
      }

      // sub-resend-link
      const invite = await createTelegramInviteLink(bot.botToken, bot.idVip, `VIP_${sub.telegramUserId}`);
      sub.inviteLink = invite.invite_link;
      saveSubscription(sub);
      await sendTelegramMessage(
        bot.botToken,
        String(sub.telegramUserId),
        `🔗 Aqui está seu link de acesso ao VIP:\n${invite.invite_link}`,
      ).catch(() => {});
      return NextResponse.json({ ok: true, inviteLink: invite.invite_link });
    }

    throw new ApiError(400, "Ação inválida.");
  } catch (err) {
    return errorResponse(err);
  }
}
