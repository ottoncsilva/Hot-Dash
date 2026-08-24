import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import {
  getBotConfigByProfile,
  getBotConfig,
  saveBotConfig,
  listPlans,
  planSalesStats,
  savePlan,
  deletePlan,
  listCustomButtons,
  saveCustomButton,
  deleteCustomButton,
  listSubscriptions,
  getSubscription,
  saveSubscription,
  toApprovalMode,
  listSeenChats,
  listMonitoredChats,
  recordSeenChat,
  buildAccessMessage,
  PIX_DEFAULTS,
  MESSAGE_DEFAULTS,
  RENEWAL_DEFAULT_STEPS,
} from "@/lib/telegramDb";
import {
  setTelegramWebhook,
  deleteTelegramWebhook,
  getTelegramMe,
  getTelegramWebhookInfo,
  getTelegramUpdates,
  getTelegramChat,
  getTelegramChatMember,
  telegramWebhookSecret,
  normalizarBotToken,
  diagnosticoDoToken,
  createTelegramInviteLink,
  sendTelegramMessage,
  banTelegramMember,
  unbanTelegramMember,
} from "@/lib/telegramApi";
import { overview } from "@/lib/transactions";
import { listMedia } from "@/lib/media";
import { resolvePublicOrigin, webhookOriginProblem } from "@/lib/publicOrigin";
import { buttonStyleProps, sanitizeButtonStyles, BUTTON_ROLES } from "@/lib/settings";
import { MESSAGE_EFFECTS } from "@/lib/telegramEffects";
import { resolverLinkDoVip, limparLinkDoVipAuto } from "@/lib/vipLink";

import { randomUUID } from "node:crypto";

/** Só deixa passar uma chave que existe na lista de efeitos. */
function efeitoValido(valor: unknown, atual: string | undefined): string | undefined {
  if (valor === undefined) return atual;
  const chave = String(valor || "").trim();
  return MESSAGE_EFFECTS.some((e) => e.key === chave) ? chave : "";
}

/** Aceita um funil como JSON pronto ou como array, e devolve sempre string. */
function normFunnel(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return undefined;
  }
}

/** Planos com o desempenho de cada um anexado — as duas telas que os listam
 *  querem sempre os dois juntos. */
function comStats(botId: string) {
  const stats = planSalesStats(botId);
  return listPlans(botId).map((p) => ({
    ...p,
    sales: stats.get(p.id) || { count: 0, cents: 0 },
  }));
}

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
      message:
        diagnosticoDoToken(e) ||
        (e instanceof Error ? e.message : "Falha ao registrar webhook."),
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
    const plans = bot ? comStats(bot.id) : [];
    const customButtons = bot ? listCustomButtons(bot.id) : [];
    const subscriptions = bot ? listSubscriptions(bot.id) : [];
    // Métricas de venda do modelo (reaproveita o painel financeiro).
    const metrics = overview(profileId);

    return NextResponse.json({
      bot,
      autopost,
      availableTags: tags,
      plans,
      customButtons,
      subscriptions,
      metrics,
      pixDefaults: PIX_DEFAULTS,
      // Os papéis de botão são fixos do produto (não do modelo) — a tela
      // precisa deles para desenhar a lista de cores.
      buttonRoles: BUTTON_ROLES,
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
      const colado = String(botToken || "").trim();
      let token = existing?.botToken || "";
      if (colado) {
        // NUNCA gravar cru o que foi colado. Um token torto (a frase inteira do
        // BotFather, uma quebra de linha no meio, um pedaço faltando) era aceito
        // sem checagem e derrubava o bot em silêncio: o Telegram passava a
        // responder 404 "Not Found" em TODA chamada, então nada de /start, nada
        // de aprovar entrada nas Prévias, e a tela mostrava só o eco cru.
        token = normalizarBotToken(colado);
        if (!token) {
          throw new ApiError(
            400,
            "Esse token não tem o formato de um token de bot do Telegram (algo como " +
              "8123456789:AAE...). Copie de novo no BotFather: /mybots → escolha o bot → " +
              "API Token.",
          );
        }
      }
      if (!profileId || !token || !idVip || !idAquecimento) {
        throw new ApiError(400, "Preencha o Token do Bot e os IDs dos grupos VIP e Prévias.");
      }
      const botId = existing?.id || randomUUID();

      // Confere o token COM O TELEGRAM antes de gravar. É o que impede que um
      // token recusado tome o lugar de um que funciona: se a resposta for uma
      // recusa (401/404), nada é salvo e o operador lê o motivo. Uma falha de
      // rede, ao contrário, não bloqueia — não dá para exigir que o Telegram
      // esteja de pé para o operador salvar o cadastro da modelo.
      let usernameDoToken: string | undefined;
      if (colado) {
        try {
          usernameDoToken = (await getTelegramMe(token)).username;
        } catch (e) {
          const motivo = diagnosticoDoToken(e);
          if (motivo) throw new ApiError(400, motivo);
        }
      }

      // Espalha o que já existe e sobrescreve só as credenciais: um campo novo
      // na configuração não precisa ser lembrado aqui para deixar de ser
      // apagado a cada salvamento das credenciais.
      saveBotConfig({
        ...(existing || {
          // Bot novo nasce com mensagens de verdade, não com "Bem-vindo"/"Aprovado".
          welcomeMessage: MESSAGE_DEFAULTS.welcome,
          successMessage: MESSAGE_DEFAULTS.success,
          successButtonText: MESSAGE_DEFAULTS.successButton,
          operationActive: false,
          vipApprovalMode: "subscribers" as const,
          previasApprovalMode: "all" as const,
          welcomeMediaMode: "album" as const,
          pixSocialProof: false,
          downsellEnabled: true,
          pixDownsellEnabled: true,
          upsellEnabled: true,
          // Alerta de Renovação já nasce ATIVO e com a sequência padrão
          // pronta (1 dia, 18h, 12h, 6h, 1h, 20min e 5min antes de vencer,
          // desconto subindo aos poucos) — a modelo edita por cima se quiser,
          // mas nunca começa sem nada configurado.
          renewalEnabled: true,
          renewalFunnel: JSON.stringify(RENEWAL_DEFAULT_STEPS),
        }),
        id: botId,
        profileId,
        botToken: token,
        botUsername: usernameDoToken || existing?.botUsername,
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
      // Trocou o token ou o grupo ⇒ o link do VIP descoberto antes pode estar
      // apontando para a operação errada. Esquece e redescobre agora, com as
      // credenciais novas — falha aqui não pode derrubar o salvamento.
      limparLinkDoVipAuto(profileId);
      const vipLink = await resolverLinkDoVip(profileId).catch(() => null);
      return NextResponse.json({ ok: true, webhook, vipLink });
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
        // EFEITOS DE MENSAGEM. Chave desconhecida vira "" (sem efeito) em vez
        // de ir para o Telegram e derrubar a mensagem inteira.
        effectWelcome: efeitoValido(body.effectWelcome, bot.effectWelcome),
        effectPix: efeitoValido(body.effectPix, bot.effectPix),
        effectSuccess: efeitoValido(body.effectSuccess, bot.effectSuccess),
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
        pixBtnCheck: body.pixBtnCheck !== undefined ? String(body.pixBtnCheck) : bot.pixBtnCheck,
        pixBtnQr: body.pixBtnQr !== undefined ? String(body.pixBtnQr) : bot.pixBtnQr,
        pixBtnCopy: body.pixBtnCopy !== undefined ? String(body.pixBtnCopy) : bot.pixBtnCopy,
        pixNotPaidMessage:
          body.pixNotPaidMessage !== undefined ? String(body.pixNotPaidMessage) : bot.pixNotPaidMessage,
        effectPix: efeitoValido(body.effectPix, bot.effectPix),
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
        // Sequências de boas-vindas: aceita JSON já pronto ou o array cru.
        previasWelcomeFunnel: normFunnel(body.previasWelcomeFunnel) ?? bot.previasWelcomeFunnel,
        vipWelcomeFunnel: normFunnel(body.vipWelcomeFunnel) ?? bot.vipWelcomeFunnel,
        previewsWelcomeMessage:
          body.previewsWelcomeMessage !== undefined
            ? String(body.previewsWelcomeMessage)
            : bot.previewsWelcomeMessage,
        previasUseWelcome:
          body.previasUseWelcome !== undefined ? Boolean(body.previasUseWelcome) : bot.previasUseWelcome,
        vipUseWelcome:
          body.vipUseWelcome !== undefined ? Boolean(body.vipUseWelcome) : bot.vipUseWelcome,
      });
      return NextResponse.json({ ok: true });
    }

    // ---- Planos/ofertas — substitui a lista inteira do bot ----
    if (action === "save-plans") {
      const bot = requireBot(body.profileId);
      const incoming = Array.isArray(body.plans) ? body.plans : [];
      const existing = listPlans(bot.id);
      const keepIds = new Set<string>();
      incoming.forEach((p: Record<string, unknown>, idx: number) => {
        const name = String(p.name || "").trim();
        const priceCents = Math.max(0, Math.round(Number(p.priceCents) || 0));
        // 0 = VITALÍCIO e é válido; por isso o piso é 0, não 1.
        const durationDays = Math.max(0, Math.round(Number(p.durationDays) || 0));
        const kind = p.kind === "package" ? "package" : "subscription";
        const deliverable = typeof p.deliverable === "string" ? p.deliverable : undefined;
        if (!name || priceCents <= 0) return;
        const id = typeof p.id === "string" && p.id ? p.id : randomUUID();
        keepIds.add(id);

        const botoes = Array.isArray(p.deliverableButtons)
          ? (p.deliverableButtons as Record<string, unknown>[])
              .map((b) => ({ text: String(b?.text || "").trim(), url: String(b?.url || "").trim() }))
              .filter((b) => b.text && b.url)
              .slice(0, 6)
          : undefined;

        const bumpCru = (p.bump || {}) as Record<string, unknown>;
        const bumpBotoes = Array.isArray(bumpCru.deliverableButtons)
          ? (bumpCru.deliverableButtons as Record<string, unknown>[])
              .map((b) => ({ text: String(b?.text || "").trim(), url: String(b?.url || "").trim() }))
              .filter((b) => b.text && b.url)
              .slice(0, 6)
          : undefined;

        savePlan({
          id,
          botId: bot.id,
          name,
          priceCents,
          durationDays,
          kind,
          deliverable,
          // A ordem vem da POSIÇÃO na lista enviada — é o que as setas da tela
          // mexem, sem precisar de um campo de número à mostra.
          sortOrder: idx,
          active: p.active !== false,
          highlight: ["green", "blue", "red"].includes(String(p.highlight)) ? String(p.highlight) : undefined,
          deliverableButtons: botoes?.length ? botoes : undefined,
          bump: {
            enabled: Boolean(bumpCru.enabled),
            name: String(bumpCru.name || "").trim().slice(0, 80),
            priceCents: Math.max(0, Math.round(Number(bumpCru.priceCents) || 0)),
            text: String(bumpCru.text || ""),
            acceptText: bumpCru.acceptText !== undefined ? String(bumpCru.acceptText) : undefined,
            declineText: bumpCru.declineText !== undefined ? String(bumpCru.declineText) : undefined,
            mediaIds: Array.isArray(bumpCru.mediaIds)
              ? (bumpCru.mediaIds as unknown[]).filter((v): v is string => typeof v === "string" && !!v).slice(0, 10)
              : undefined,
            audioUrl: bumpCru.audioUrl !== undefined ? String(bumpCru.audioUrl) : undefined,
            deliverable: bumpCru.deliverable !== undefined ? String(bumpCru.deliverable) : undefined,
            deliverableButtons: bumpBotoes?.length ? bumpBotoes : undefined,
          },
        });
      });
      // Remove os que sumiram da lista.
      for (const old of existing) if (!keepIds.has(old.id)) deletePlan(old.id);
      return NextResponse.json({ ok: true, plans: comStats(bot.id) });
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

    // ---- Funis de recuperação ----
    if (action === "save-funnels") {
      const bot = requireBot(body.profileId);
      saveBotConfig({
        ...bot,
        downsellFunnel: normFunnel(body.downsellFunnel) ?? bot.downsellFunnel,
        upsellFunnel: normFunnel(body.upsellFunnel) ?? bot.upsellFunnel,
        pixDownsellFunnel: normFunnel(body.pixDownsellFunnel) ?? bot.pixDownsellFunnel,
        downsellEnabled:
          body.downsellEnabled !== undefined ? Boolean(body.downsellEnabled) : bot.downsellEnabled,
        pixDownsellEnabled:
          body.pixDownsellEnabled !== undefined
            ? Boolean(body.pixDownsellEnabled)
            : bot.pixDownsellEnabled,
        upsellEnabled:
          body.upsellEnabled !== undefined ? Boolean(body.upsellEnabled) : bot.upsellEnabled,
        renewalFunnel: normFunnel(body.renewalFunnel) ?? bot.renewalFunnel,
        renewalEnabled:
          body.renewalEnabled !== undefined ? Boolean(body.renewalEnabled) : bot.renewalEnabled,
      });
      return NextResponse.json({ ok: true });
    }

    // ---- Liga/desliga da operação do bot de vendas (cutover) ----
    if (action === "set-operation") {
      const bot = requireBot(body.profileId);
      const active = Boolean(body.active);
      if (active) {
        const webhook = await registerBotWebhook(req, bot.id, bot.botToken);
        if (!webhook.ok) {
          return NextResponse.json({ ok: false, message: webhook.message || "Falha ao registrar webhook." });
        }
        saveBotConfig({ ...bot, botUsername: webhook.username || bot.botUsername, operationActive: true });
        return NextResponse.json({ ok: true, active: true });
      }
      await deleteTelegramWebhook(bot.botToken).catch(() => {});
      saveBotConfig({ ...bot, operationActive: false });
      return NextResponse.json({ ok: true, active: false });
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
        // Recusa do token tem remédio conhecido — diz qual, em vez de repassar
        // o "Not Found" cru do Telegram, que não significa nada para quem opera.
        const motivo = diagnosticoDoToken(e);
        return NextResponse.json({
          ok: false,
          tokenRecusado: Boolean(motivo),
          message: motivo || (e instanceof Error ? e.message : "Falha ao consultar."),
          expectedUrl,
          originSource,
          originProblem: problem,
        });
      }
    }

    // ---- "Detectar": em que canais/grupos este bot está ----
    //
    // A API do Telegram NÃO tem método que liste os chats de um bot: não existe
    // "meus chats". A descoberta depende de ter visto um update vindo de lá, e
    // com o bot já dentro dos canais ANTES do cutover esse update nunca chegou.
    // Por isso juntamos tudo que já se sabe e RESOLVEMOS cada um com o token —
    // que funciona para canal e para grupo igualmente, e é o que responde a
    // pergunta que importa: "o bot é admin aqui?".
    if (action === "detect-chats") {
      const bot = requireBot(body.profileId);

      const candidatos = new Map<string, { chatId: string; title?: string; type?: string }>();
      const anota = (chatId: string, title?: string, type?: string) => {
        const id = String(chatId || "").trim();
        if (!id || id === "0") return;
        const atual = candidatos.get(id);
        candidatos.set(id, { chatId: id, title: title || atual?.title, type: type || atual?.type });
      };

      // 1. O que já está no cadastro desta modelo.
      if (bot.idVip) anota(bot.idVip);
      if (bot.idAquecimento) anota(bot.idAquecimento);
      // 2. O que o webhook anotou desde o cutover.
      for (const c of listSeenChats(bot.id)) anota(c.chatId, c.title, c.type);
      // 3. O que o monitor de grupos já viu (roda com a operação desligada).
      for (const g of listMonitoredChats(bot.id)) anota(g.chatId, g.title);
      // 4. Um ID digitado na tela que ainda não foi salvo — assim dá para
      //    conferir se o bot é admin ANTES de gravar.
      if (typeof body.extraChatId === "string") anota(body.extraChatId);

      let semWebhook = false;
      try {
        semWebhook = !(await getTelegramWebhookInfo(bot.botToken)).url;
      } catch {
        /* segue com o que já temos */
      }
      if (semWebhook) {
        // Sem webhook a fila é legível. Sem `offset` de propósito: lemos sem
        // confirmar, para não roubar updates de outro sistema.
        try {
          for (const u of await getTelegramUpdates(bot.botToken)) {
            const c =
              u.message?.chat ||
              u.channel_post?.chat ||
              u.my_chat_member?.chat ||
              u.chat_member?.chat ||
              u.chat_join_request?.chat;
            if (c?.id && c.type && c.type !== "private") {
              recordSeenChat(bot.id, c);
              anota(String(c.id), c.title, c.type);
            }
          }
        } catch {
          /* bônus, não o caminho principal */
        }
      }

      const me = await getTelegramMe(bot.botToken).catch(() => null);
      const chats = await Promise.all(
        Array.from(candidatos.values()).map(async (c) => {
          const info = await getTelegramChat(bot.botToken, c.chatId).catch(() => null);
          const membro = me ? await getTelegramChatMember(bot.botToken, c.chatId, me.id) : null;
          const status = membro?.status;
          // Em CANAL o bot aparece como "administrator" quando tem permissão.
          // `creator` nunca é o caso de um bot, mas custa nada aceitar.
          const isAdmin = status === "administrator" || status === "creator";
          // Guarda o que foi resolvido: na próxima vez a lista já vem com nome
          // mesmo se a API falhar.
          if (info?.type) recordSeenChat(bot.id, { id: c.chatId, title: info.title, type: info.type });
          return {
            chatId: c.chatId,
            title: info?.title || c.title,
            type: info?.type || c.type,
            isAdmin,
            reachable: Boolean(info),
            status,
          };
        }),
      );

      let hint: string | undefined;
      if (chats.length === 0) {
        hint =
          "Nenhum canal ou grupo conhecido ainda. Cole o ID aqui e toque em Detectar para eu conferir, ou publique algo no canal com o bot dentro.";
      } else if (chats.every((c) => !c.isAdmin)) {
        hint =
          "O bot não é administrador de nenhum destes. Sem isso ele não aprova entrada nem gera o convite do VIP.";
      }

      return NextResponse.json({ ok: true, chats, hint });
    }

    // ---- O bot consegue mesmo operar os canais/grupos configurados? ----
    // Checa o que a venda vai precisar ANTES de a venda acontecer: sem ser
    // admin do VIP com permissão de convidar, o convite falha na confirmação
    // do pagamento — o cliente paga e fica sem o link.
    if (action === "group-health") {
      const bot = requireBot(body.profileId);
      const me = await getTelegramMe(bot.botToken).catch(() => null);
      if (!me) {
        return NextResponse.json({ ok: false, message: "Não foi possível falar com o bot (token inválido?)." });
      }
      const checar = async (chatId: string, rotulo: string) => {
        if (!chatId) return { rotulo, chatId, ok: false, motivo: "sem ID configurado" };
        const info = await getTelegramChat(bot.botToken, chatId).catch(() => null);
        if (!info) return { rotulo, chatId, ok: false, motivo: "o bot não enxerga este canal/grupo (ID errado ou removido)" };
        const membro = await getTelegramChatMember(bot.botToken, chatId, me.id);
        const admin = membro?.status === "administrator" || membro?.status === "creator";
        return {
          rotulo,
          chatId,
          title: info.title,
          ok: admin,
          motivo: admin ? undefined : "o bot está lá mas NÃO é administrador",
        };
      };
      const grupos = [
        await checar(bot.idVip, "Grupo VIP"),
        await checar(bot.idAquecimento, "Grupo de Prévias"),
      ];
      return NextResponse.json({ ok: true, grupos });
    }

    // ---- Preço dinâmico e cores dos botões, POR MODELO ----
    // Nasceram como configuração global do painel e isso estava errado: tudo
    // no bot de vendas é decidido modelo a modelo. Duas ações separadas porque
    // são decisões independentes — mexer no preço não é escolher cor.
    if (action === "save-dynamic-price") {
      const bot = requireBot(body.profileId);
      const p = (body.dynamicPrice || {}) as Record<string, unknown>;
      const cents = Number(p.cents);
      saveBotConfig({
        ...bot,
        dynamicPrice: {
          enabled: Boolean(p.enabled),
          cents: Number.isFinite(cents) ? Math.min(Math.max(Math.floor(cents), 1), 100) : 9,
          direction: p.direction === "up" || p.direction === "down" ? p.direction : "random",
        },
      });
      return NextResponse.json({ ok: true, dynamicPrice: getBotConfig(bot.id)?.dynamicPrice });
    }

    if (action === "save-button-styles") {
      const bot = requireBot(body.profileId);
      // Papel desconhecido e cor inválida são descartados aqui, não no envio:
      // um `style` inventado faria o Telegram recusar a mensagem inteira.
      saveBotConfig({ ...bot, buttonStyles: sanitizeButtonStyles(body.buttonStyles) });
      return NextResponse.json({ ok: true, buttonStyles: getBotConfig(bot.id)?.buttonStyles });
    }

    // ---- Link do VIP, descoberto sozinho ----
    // Devolve o que vale hoje e de onde ele veio. Com `forcar`, redescobre
    // (o botão "Atualizar" da tela do cadastro).
    if (action === "vip-link") {
      const profileId = String(body.profileId || "");
      if (!profileId) throw new ApiError(400, "Informe a modelo.");
      const r = await resolverLinkDoVip(profileId, Boolean(body.forcar));
      return NextResponse.json({ ok: Boolean(r.link), ...r });
    }

    // ---- Mídias que batem com as etiquetas de boas-vindas ----
    // O bot SORTEIA uma delas a cada /start. Sem isto a tela era um campo de
    // texto cego: você digitava "previa, quente" e não tinha como saber se
    // existia mídia com aquela etiqueta, muito menos qual apareceria.
    // NÃO É MAIS CHAMADA POR NENHUMA TELA: o campo de etiquetas saiu da
    // interface e a mídia passou a ser escolhida a dedo. Fica de pé porque o
    // envio ainda aceita etiquetas como legado, e é por aqui que dá para
    // conferir o que elas casam sem abrir o banco.
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
      // Mesma mensagem da entrega automática (com botão de acesso), para o
      // cliente não receber dois formatos diferentes do mesmo link.
      const reenvio = buildAccessMessage(bot, invite.invite_link, buttonStyleProps(bot, "access"));
      try {
        await sendTelegramMessage(bot.botToken, String(sub.telegramUserId), reenvio.text, reenvio.options);
      } catch (e) {
        // O link foi gerado e gravado, mas não chegou. Engolir isso era o que
        // fazia o operador achar que tinha resolvido.
        throw new ApiError(
          400,
          `Link gerado, mas não foi possível entregá-lo: ${e instanceof Error ? e.message : "falha no envio"}`,
        );
      }
      return NextResponse.json({ ok: true, inviteLink: invite.invite_link });
    }

    throw new ApiError(400, "Ação inválida.");
  } catch (err) {
    return errorResponse(err);
  }
}
