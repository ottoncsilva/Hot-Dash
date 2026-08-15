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
  listSourceLinks,
  saveSourceLink,
  deleteSourceLink,
  sourceLinkStats,
  sanitizeSourceCode,
  sanitizeSlug,
  toApprovalMode,
  listSeenChats,
  recordSeenChat,
  PIX_DEFAULTS,
} from "@/lib/telegramDb";
import {
  setTelegramWebhook,
  deleteTelegramWebhook,
  getTelegramMe,
  getTelegramWebhookInfo,
  getTelegramUpdates,
  telegramWebhookSecret,
  createTelegramInviteLink,
  sendTelegramMessage,
  banTelegramMember,
  unbanTelegramMember,
} from "@/lib/telegramApi";
import { overview } from "@/lib/transactions";
import { listMedia } from "@/lib/media";
import { resolvePublicOrigin, webhookOriginProblem } from "@/lib/publicOrigin";

import { randomUUID } from "node:crypto";

/** URL que o Telegram deve chamar para este bot, e o diagnóstico da base. */
function webhookUrlFor(req: NextRequest, botId: string) {
  const { origin, source } = resolvePublicOrigin(req);
  return {
    url: `${origin}/api/webhooks/telegram/${botId}`,
    origin,
    originSource: source,
    problem: webhookOriginProblem(origin),
  };
}

/** Registra (ou re-registra) o webhook do bot apontando para o Hot-Dash.
 *  Nunca lança — devolve {ok,message} para a UI mostrar o status.
 *
 *  Checa a base pública ANTES de falar com o Telegram: sem isso o operador
 *  recebia só o eco cru da API ("bad webhook: IP address 0.0.0.0 is reserved"),
 *  que não diz o que fazer. O problema nunca é o bot — é o app não saber o
 *  próprio endereço público. */
async function registerBotWebhook(
  req: NextRequest,
  botId: string,
  botToken: string,
): Promise<{ ok: boolean; message?: string; username?: string; url?: string }> {
  const { url, problem } = webhookUrlFor(req, botId);
  if (problem) return { ok: false, message: problem, url };
  try {
    let username: string | undefined;
    try {
      const me = await getTelegramMe(botToken);
      username = me.username;
    } catch {
      // token inválido → o setWebhook abaixo também falha e reporta.
    }
    await setTelegramWebhook(botToken, url, telegramWebhookSecret(botId));
    return { ok: true, username, url };
  } catch (e) {
    return {
      ok: false,
      url,
      message: e instanceof Error ? e.message : "Falha ao registrar webhook.",
    };
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

    const botRaw = getBotConfigByProfile(profileId);
    // O TOKEN NÃO VAI PARA O NAVEGADOR. Ele dá controle total do bot (ler as
    // conversas, escrever como a modelo, trocar o webhook), e ia no JSON de
    // duas telas a cada carregamento — bastava um print ou uma tela
    // compartilhada para vazar. A UI só precisa saber se existe um token
    // salvo; para trocá-lo, o operador cola um novo.
    const bot = botRaw ? { ...botRaw, botToken: undefined, hasToken: Boolean(botRaw.botToken) } : null;
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
    // Métricas de venda do modelo (reaproveita o painel financeiro).
    const metrics = overview(profileId);

    // Trackeamento: os links de divulgação com o desempenho de cada código.
    // As estatísticas vêm de UMA consulta agregada para o perfil inteiro.
    const stats = bot ? sourceLinkStats(profileId) : new Map();
    const sourceLinks = (bot ? listSourceLinks(bot.id) : []).map((l) => ({
      ...l,
      stats: stats.get(l.code) || { starts: 0, pixGenerated: 0, pixPaid: 0, paidCents: 0 },
    }));
    // Códigos que apareceram nos leads/vendas mas não têm registro na tela —
    // links antigos, feitos à mão antes desta tela existir. Aparecem para o
    // operador poder nomeá-los em vez de ficarem invisíveis.
    const conhecidos = new Set(sourceLinks.map((l) => l.code));
    const orphanCodes = Array.from(stats.entries())
      .filter(([code]) => !conhecidos.has(code))
      .map(([code, s]) => ({ code, stats: s }));

    return NextResponse.json({
      bot,
      autopost,
      availableTags: tags,
      plans,
      customButtons,
      subscriptions,
      metrics,
      sourceLinks,
      orphanCodes,
      pixDefaults: PIX_DEFAULTS,
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

    // ---- Credenciais do bot (Token + IDs de grupo) — agora no CADASTRO do
    // modelo. Preserva os demais campos (mensagens, funis, vendas). Se a
    // operação já estiver ligada, re-registra o webhook (token/grupos mudaram).
    if (action === "save-bot-credentials") {
      const { profileId, botToken, idVip, idAquecimento } = body;
      const existing = getBotConfigByProfile(profileId);
      // O token não volta mais para o navegador, então a tela manda o campo
      // VAZIO quando o operador não quer trocá-lo — nesse caso o que já está
      // salvo é mantido. Só é obrigatório quando ainda não há token nenhum.
      const token = String(botToken || "").trim() || existing?.botToken || "";
      if (!profileId || !token || !idVip || !idAquecimento) {
        throw new ApiError(400, "Preencha o Token do Bot e os IDs dos grupos VIP e Prévias.");
      }
      const botId = existing?.id || randomUUID();

      // Espalha o que já existe e sobrescreve só as credenciais: um campo novo
      // na configuração não precisa ser lembrado aqui para deixar de ser
      // apagado a cada salvamento das credenciais.
      saveBotConfig({
        ...(existing || {
          welcomeMessage: "Bem-vindo",
          successMessage: "Aprovado",
          operationActive: false,
          vipApprovalMode: "subscribers" as const,
          previasApprovalMode: "all" as const,
          welcomeMediaMode: "album" as const,
          pixSocialProof: false,
        }),
        id: botId,
        profileId,
        botToken: token,
        idVip: String(idVip).trim(),
        idAquecimento: String(idAquecimento).trim(),
      });

      let webhook: { ok: boolean; message?: string; username?: string } | undefined;
      if (existing?.operationActive) {
        webhook = await registerBotWebhook(req, botId, token);
        if (webhook.username && webhook.username !== existing?.botUsername) {
          const cur = getBotConfigByProfile(profileId);
          if (cur) saveBotConfig({ ...cur, botUsername: webhook.username });
        }
      }
      return NextResponse.json({ ok: true, webhook });
    }

    if (action === "save-telegram-config") {
      const {
        profileId,
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

      if (!profileId) throw new ApiError(400, "Informe o profileId.");

      // Salva só a config de Autopost. As credenciais do bot (token/IDs) agora
      // ficam no cadastro do modelo (ação save-bot-credentials).
      db.prepare(
        `INSERT INTO telegram_autopost_settings (
          profile_id, enabled,
          vip_post_interval, vip_tags, vip_prompt, vip_schedule_type, vip_fixed_times, vip_cta_buttons,
          warmup_post_interval, warmup_tags, warmup_prompt, warmup_link, warmup_schedule_type, warmup_fixed_times,
          warmup_seed_reaction, warmup_seed_emoji, warmup_mk_prompt, warmup_cta_buttons
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET
           enabled = excluded.enabled,
           vip_post_interval = excluded.vip_post_interval,
           vip_tags = excluded.vip_tags,
           vip_prompt = excluded.vip_prompt,
           vip_schedule_type = excluded.vip_schedule_type,
           vip_fixed_times = excluded.vip_fixed_times,
           vip_cta_buttons = excluded.vip_cta_buttons,
           warmup_post_interval = excluded.warmup_post_interval,
           warmup_tags = excluded.warmup_tags,
           warmup_prompt = excluded.warmup_prompt,
           warmup_link = excluded.warmup_link,
           warmup_schedule_type = excluded.warmup_schedule_type,
           warmup_fixed_times = excluded.warmup_fixed_times,
           warmup_seed_reaction = excluded.warmup_seed_reaction,
           warmup_seed_emoji = excluded.warmup_seed_emoji,
           warmup_mk_prompt = excluded.warmup_mk_prompt,
           warmup_cta_buttons = excluded.warmup_cta_buttons`
      ).run(
        profileId,
        enabled ? 1 : 0,
        Number(vipPostInterval || 12),
        vipTags || "",
        vipPrompt || "",
        vipScheduleType || "interval",
        vipFixedTimes || "",
        typeof body.vipCtaButtons === "string" ? body.vipCtaButtons : "",
        Number(warmupPostInterval || 24),
        warmupTags || "",
        warmupPrompt || "",
        warmupLink || "",
        warmupScheduleType || "interval",
        warmupFixedTimes || "",
        body.warmupSeedReaction ? 1 : 0,
        (typeof body.warmupSeedEmoji === "string" && body.warmupSeedEmoji.trim()) || "🔥",
        typeof body.warmupMkPrompt === "string" ? body.warmupMkPrompt : "",
        typeof body.warmupCtaButtons === "string" ? body.warmupCtaButtons : ""
      );

      return NextResponse.json({ ok: true });
    }

    // Helper: carrega o bot do perfil ou erro 400.
    function requireBot(profileId: string) {
      if (!profileId) throw new ApiError(400, "Informe o profileId.");
      const bot = getBotConfigByProfile(profileId);
      if (!bot) throw new ApiError(400, "Configure primeiro o bot no cadastro do modelo (token e IDs dos grupos).");
      return bot;
    }

    // ---- Mensagens / suporte / registro ----
    if (action === "save-bot-messages") {
      const bot = requireBot(body.profileId);
      saveBotConfig({
        ...bot,
        welcomeMessage: String(body.welcomeMessage ?? bot.welcomeMessage ?? "Bem-vindo"),
        welcomeMediaTags: body.welcomeMediaTags !== undefined ? String(body.welcomeMediaTags) : bot.welcomeMediaTags,
        welcomeMediaIds: Array.isArray(body.welcomeMediaIds)
          ? body.welcomeMediaIds.filter((v: unknown) => typeof v === "string" && v).slice(0, 10)
          : bot.welcomeMediaIds,
        welcomeMediaMode:
          body.welcomeMediaMode === "separate" || body.welcomeMediaMode === "album"
            ? body.welcomeMediaMode
            : bot.welcomeMediaMode,
        successMessage: String(body.successMessage ?? bot.successMessage ?? "Aprovado"),
        previewsWelcomeMessage: body.previewsWelcomeMessage !== undefined ? String(body.previewsWelcomeMessage) : bot.previewsWelcomeMessage,
        supportUsername: body.supportUsername !== undefined ? String(body.supportUsername) : bot.supportUsername,
        idRegistro: body.idRegistro !== undefined ? String(body.idRegistro) : bot.idRegistro,
        successButtonText:
          body.successButtonText !== undefined ? String(body.successButtonText) : bot.successButtonText,
      });
      return NextResponse.json({ ok: true });
    }

    // ---- Tela de pagamento (PIX). Campo vazio = volta ao texto padrão. ----
    if (action === "save-pix") {
      const bot = requireBot(body.profileId);
      saveBotConfig({
        ...bot,
        pixGeneratingMessage:
          body.pixGeneratingMessage !== undefined
            ? String(body.pixGeneratingMessage)
            : bot.pixGeneratingMessage,
        pixCaption: body.pixCaption !== undefined ? String(body.pixCaption) : bot.pixCaption,
        pixSocialProof:
          body.pixSocialProof !== undefined ? Boolean(body.pixSocialProof) : bot.pixSocialProof,
        pixSocialProofText:
          body.pixSocialProofText !== undefined
            ? String(body.pixSocialProofText)
            : bot.pixSocialProofText,
        pixAudioUrl: body.pixAudioUrl !== undefined ? String(body.pixAudioUrl) : bot.pixAudioUrl,
      });
      return NextResponse.json({ ok: true });
    }

    // ---- Aprovação automática: o que o bot faz com cada pedido de entrada ----
    if (action === "save-approval") {
      const bot = requireBot(body.profileId);
      saveBotConfig({
        ...bot,
        vipApprovalMode: toApprovalMode(body.vipApprovalMode, bot.vipApprovalMode),
        previasApprovalMode: toApprovalMode(body.previasApprovalMode, bot.previasApprovalMode),
      });
      return NextResponse.json({ ok: true });
    }

    // ---- Trackeamento: substitui a lista inteira de links de divulgação ----
    if (action === "save-source-links") {
      const bot = requireBot(body.profileId);
      const incoming = Array.isArray(body.links) ? body.links : [];
      const existing = listSourceLinks(bot.id);
      const keepIds = new Set<string>();
      // Códigos e slugs são únicos: o banco recusaria o duplicado no meio do
      // laço e deixaria a lista pela metade, então filtramos antes de gravar.
      const usedCodes = new Set<string>();
      const usedSlugs = new Set<string>();
      for (const raw of incoming) {
        const code = sanitizeSourceCode(String(raw.code || ""));
        const name = String(raw.name || "").trim().slice(0, 80);
        const slug = sanitizeSlug(String(raw.slug || ""));
        if (!code || !name) continue;
        if (usedCodes.has(code)) continue;
        if (slug && usedSlugs.has(slug)) continue;
        usedCodes.add(code);
        if (slug) usedSlugs.add(slug);
        const id = typeof raw.id === "string" && raw.id ? raw.id : randomUUID();
        keepIds.add(id);
        saveSourceLink({
          id,
          botId: bot.id,
          profileId: bot.profileId,
          code,
          name,
          slug: slug || undefined,
          createdAt: Number(raw.createdAt) || Date.now(),
        });
      }
      for (const old of existing) if (!keepIds.has(old.id)) deleteSourceLink(old.id);
      const stats = sourceLinkStats(bot.profileId);
      return NextResponse.json({
        ok: true,
        sourceLinks: listSourceLinks(bot.id).map((l) => ({
          ...l,
          stats: stats.get(l.code) || { starts: 0, pixGenerated: 0, pixPaid: 0, paidCents: 0 },
        })),
      });
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
        const kind = p.kind === "package" ? "package" : "subscription";
        const deliverable = typeof p.deliverable === "string" ? p.deliverable : undefined;
        if (!name || priceCents <= 0) continue;
        const id = typeof p.id === "string" && p.id ? p.id : randomUUID();
        keepIds.add(id);
        savePlan({ id, botId: bot.id, name, priceCents, durationDays, kind, deliverable });
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

    // ---- Liga/desliga da operação do bot de vendas (cutover) ----
    if (action === "set-operation") {
      const bot = requireBot(body.profileId);
      const active = Boolean(body.active);
      if (active) {
        // Ligar → registra o webhook (assume o controle do bot, substituindo o
        // sistema anterior na hora, já que um bot só tem um webhook).
        const webhook = await registerBotWebhook(req, bot.id, bot.botToken);
        if (!webhook.ok) {
          return NextResponse.json({ ok: false, message: webhook.message || "Falha ao registrar webhook." });
        }
        saveBotConfig({ ...bot, botUsername: webhook.username || bot.botUsername, operationActive: true });
        return NextResponse.json({ ok: true, active: true });
      } else {
        // Desligar → remove o webhook (libera o bot; o Hot-Dash para de agir).
        await deleteTelegramWebhook(bot.botToken).catch(() => {});
        saveBotConfig({ ...bot, operationActive: false });
        return NextResponse.json({ ok: true, active: false });
      }
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
    // Devolve TAMBÉM a URL que este app usaria e o problema da base pública,
    // se houver: é o que deixa a tela explicar por que o registro falha, sem
    // depender de o operador ler o log do container.
    if (action === "webhook-status") {
      const bot = requireBot(body.profileId);
      const { url: expectedUrl, originSource, problem } = webhookUrlFor(req, bot.id);
      try {
        const info = await getTelegramWebhookInfo(bot.botToken);
        const ok = Boolean(info.url) && info.url === expectedUrl;
        return NextResponse.json({
          ok: true,
          info,
          matches: ok,
          expectedUrl,
          originSource,
          originProblem: problem,
        });
      } catch (e) {
        return NextResponse.json({
          ok: false,
          message: e instanceof Error ? e.message : "Falha ao consultar.",
          expectedUrl,
          originSource,
          originProblem: problem,
        });
      }
    }

    // ---- "Detectar": em que grupos este bot está ----
    //
    // A API do Telegram NÃO deixa um bot listar os próprios grupos: a única
    // forma de saber de um grupo é ter visto um update vindo dele. Por isso a
    // detecção junta duas fontes:
    //   • os chats que o nosso webhook já anotou (funciona com a operação
    //     ligada, que é quando os updates chegam aqui);
    //   • o getUpdates, para quando NÃO há webhook nenhum registrado — é o
    //     caso de quem ainda não fez o cutover.
    // Com um webhook de TERCEIRO ativo não dá para fazer nem um nem outro, e
    // aí a resposta explica isso em vez de devolver uma lista vazia sem motivo.
    if (action === "detect-chats") {
      const bot = requireBot(body.profileId);
      const chats = new Map<string, { chatId: string; title?: string; type?: string }>();
      for (const c of listSeenChats(bot.id)) chats.set(c.chatId, c);

      let hint: string | undefined;
      try {
        const info = await getTelegramWebhookInfo(bot.botToken);
        const nosso = webhookUrlFor(req, bot.id).url;
        if (!info.url) {
          // Sem webhook: a fila está nossa para ler (sem confirmar nada).
          for (const u of await getTelegramUpdates(bot.botToken)) {
            const c =
              u.message?.chat ||
              u.channel_post?.chat ||
              u.my_chat_member?.chat ||
              u.chat_member?.chat ||
              u.chat_join_request?.chat;
            if (c?.id && c.type && c.type !== "private") {
              recordSeenChat(bot.id, c);
              chats.set(String(c.id), { chatId: String(c.id), title: c.title, type: c.type });
            }
          }
          if (chats.size === 0) {
            hint =
              "Nenhum grupo encontrado. Envie qualquer mensagem no grupo (com o bot lá dentro) e toque em Detectar de novo.";
          }
        } else if (info.url !== nosso && chats.size === 0) {
          hint =
            "O bot está apontado para outro sistema, então não dá para ler a fila de mensagens dele. Ligue a operação do Hot-Dash e mande uma mensagem no grupo, ou informe o ID na mão.";
        } else if (chats.size === 0) {
          hint =
            "Ainda não vimos nenhum grupo. Mande uma mensagem no grupo (com o bot lá) e toque em Detectar de novo.";
        }
      } catch (e) {
        hint = e instanceof Error ? e.message : "Falha ao consultar o Telegram.";
      }

      return NextResponse.json({
        ok: true,
        chats: Array.from(chats.values()),
        hint,
      });
    }

    // ---- Mídias que batem com as etiquetas de boas-vindas ----
    // O bot SORTEIA uma delas a cada /start. Sem isto a tela era um campo de
    // texto cego: você digitava "previa, quente" e não tinha como saber se
    // existia mídia com aquela etiqueta, muito menos qual apareceria.
    if (action === "welcome-media") {
      const bot = requireBot(body.profileId);
      const raw = typeof body.tags === "string" ? body.tags : bot.welcomeMediaTags || "";
      const wanted = raw
        .split(",")
        .map((t: string) => t.trim().toLowerCase())
        .filter(Boolean);
      if (wanted.length === 0) return NextResponse.json({ ok: true, total: 0, items: [] });

      // Mesmo casamento que o webhook faz na hora de enviar — se divergir, o
      // preview mente.
      const matches = listMedia(bot.profileId).filter((m) =>
        m.tags.some((t) => wanted.includes(t.name.toLowerCase())),
      );
      return NextResponse.json({
        ok: true,
        total: matches.length,
        items: matches.slice(0, 12).map((m) => ({
          id: m.id,
          kind: m.kind,
          updatedAt: m.updatedAt || m.createdAt,
        })),
      });
    }

    // ---- Diagnóstico da base pública (a tela mostra mesmo com o bot
    // desligado, para o operador conferir ANTES de tentar o cutover) ----
    if (action === "webhook-origin") {
      const bot = requireBot(body.profileId);
      const { url, origin, originSource, problem } = webhookUrlFor(req, bot.id);
      return NextResponse.json({ ok: true, url, origin, originSource, problem });
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
