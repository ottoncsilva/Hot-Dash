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
  countActiveSubscriptions,
  getSubscription,
  saveSubscription,
  toApprovalMode,
  listSeenChats,
  listMonitoredChats,
  recordSeenChat,
  buildAccessMessage,
  PIX_DEFAULTS,
  CHECKOUT_DEFAULTS,
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
import { numerosDaProvaSocial } from "@/lib/provaSocial";
import { listMedia } from "@/lib/media";
import { resolvePublicOrigin, webhookOriginProblem } from "@/lib/publicOrigin";
import { buttonStyleProps, sanitizeButtonStyles, BUTTON_ROLES } from "@/lib/settings";
import { MESSAGE_EFFECTS } from "@/lib/telegramEffects";
import { resolverLinkDoVip, limparLinkDoVipAuto } from "@/lib/vipLink";
import { traduzirTexto } from "@/lib/telegramDownsellAi";
import type { FunnelStep } from "@/lib/telegramCron";

import { randomUUID } from "node:crypto";

/**
 * TRADUÇÃO AUTOMÁTICA — dispara sozinha quando o texto em PT muda no save
 * (não mais um botão manual). Sem mudança, mantém a tradução já salva (não
 * rechama a IA à toa a cada save de campo que nem mudou). Falha de tradução
 * (sem provedor de IA configurado, IA fora do ar) NUNCA derruba o save do
 * texto em PT — só fica sem tradução dessa vez, e o operador ainda pode
 * ajustar o resultado à mão depois.
 */
async function traduzirSeMudou(
  profileId: string,
  contexto: string,
  novo: string,
  antigo: string | undefined,
  enAntigo: string | undefined,
  esAntigo: string | undefined,
): Promise<{ en: string | undefined; es: string | undefined }> {
  const textoNovo = novo.trim();
  if (!textoNovo) return { en: undefined, es: undefined };
  if (textoNovo === (antigo || "").trim()) return { en: enAntigo, es: esAntigo };
  const [en, es] = await Promise.all([
    traduzirTexto(textoNovo, "en", profileId, contexto).catch(() => enAntigo),
    traduzirTexto(textoNovo, "es", profileId, contexto).catch(() => esAntigo),
  ]);
  return { en, es };
}

/**
 * Mesma ideia, por PASSO de um funil (downsell/PIX gerado) — casa passo novo
 * com o antigo pela POSIÇÃO na lista (não existe id de passo): só passos cujo
 * `text` mudou (ou são novos) chamam a IA de novo, os demais mantêm a
 * tradução que já tinham.
 */
async function traduzirFunilSeMudou(
  profileId: string,
  contexto: string,
  funilNovo: FunnelStep[],
  funilAntigo: FunnelStep[],
): Promise<FunnelStep[]> {
  return Promise.all(
    funilNovo.map(async (passo, i) => {
      const antigo = funilAntigo[i];
      const { en, es } = await traduzirSeMudou(profileId, contexto, passo.text || "", antigo?.text, antigo?.textEn, antigo?.textEs);
      return { ...passo, textEn: en, textEs: es };
    }),
  );
}

/** Lê um funil salvo (JSON de passos) do bot — JSON inválido vira lista vazia. */
function lerFunnelSalvo(raw: string | undefined): FunnelStep[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

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
// "translate-all" chama a IA várias vezes em paralelo (mensagens + planos +
// passos de funil) — o padrão da plataforma pode cortar antes de terminar.
export const maxDuration = 120;

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
    const activeSubscriptions = bot ? countActiveSubscriptions(bot.id) : 0;
    // Os números que a prova social VAI MOSTRAR — já com o piso aplicado (ver
    // `lib/provaSocial.ts`). A prévia recebe estes, e não os crus: mostrar o
    // número real ali faria a tela do operador discordar do que o lead recebe,
    // justo na mensagem em que essa diferença importa.
    const provaSocial = bot
      ? numerosDaProvaSocial(bot.id, {
          vendasHoje: metrics.today.paidCount,
          assinantes: activeSubscriptions,
        })
      : null;

    return NextResponse.json({
      bot,
      autopost,
      availableTags: tags,
      plans,
      customButtons,
      subscriptions,
      metrics,
      activeSubscriptions,
      provaSocial,
      pixDefaults: PIX_DEFAULTS,
      checkoutDefaults: CHECKOUT_DEFAULTS,
      // Passos-modelo do Alerta de Renovação, para o botão "Puxar padrão" —
      // mesmo conteúdo que já vem pré-carregado em bot novo (ver POST
      // save-credentials), só que aqui para reaplicar em quem já apagou ou
      // editou o próprio.
      renewalDefaults: RENEWAL_DEFAULT_STEPS,
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
      const { profileId, botToken, idVip, idAquecimento, idVendas } = body;
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
        throw new ApiError(400, "Preencha o Token do Bot e os IDs dos canais VIP e Prévias.");
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
          intlEnabled: true,
        }),
        id: botId,
        profileId,
        botToken: token,
        botUsername: usernameDoToken || existing?.botUsername,
        idVip: String(idVip).trim(),
        idAquecimento: String(idAquecimento).trim(),
        // Canal de Vendas é OPCIONAL — ao contrário de VIP/Prévias, campo
        // vazio é uma escolha válida (bot sem relatório de vendas), não "não
        // mudou nada". Só cai no que já estava salvo quando a tela não manda
        // o campo (ex.: uma chamada antiga da API).
        idVendas: idVendas !== undefined ? String(idVendas).trim() || undefined : existing?.idVendas,
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
          warmup_seed_reaction, warmup_seed_emoji, warmup_mk_prompt, warmup_cta_buttons,
          vip_auto_generate, warmup_auto_generate
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           warmup_cta_buttons = excluded.warmup_cta_buttons,
           vip_auto_generate = excluded.vip_auto_generate,
           warmup_auto_generate = excluded.warmup_auto_generate`
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
        typeof body.warmupCtaButtons === "string" ? body.warmupCtaButtons : "",
        // Geração automática do dia seguinte, um interruptor por canal (ver
        // `lib/telegramAutoGeneration.ts`).
        body.vipAutoGenerate ? 1 : 0,
        body.warmupAutoGenerate ? 1 : 0
      );

      return NextResponse.json({ ok: true });
    }

    // Helper: carrega o bot do perfil ou erro 400.
    function requireBot(profileId: string) {
      if (!profileId) throw new ApiError(400, "Informe o profileId.");
      const bot = getBotConfigByProfile(profileId);
      if (!bot) throw new ApiError(400, "Configure primeiro o bot no cadastro do modelo (token e IDs dos canais).");
      return bot;
    }

    // ---- Mensagens / suporte / registro ----
    if (action === "save-bot-messages") {
      const bot = requireBot(body.profileId);
      const welcomeMessageNovo = String(body.welcomeMessage ?? bot.welcomeMessage ?? "Bem-vindo");
      const successMessageNovo = String(body.successMessage ?? bot.successMessage ?? "Aprovado");
      const successButtonTextNovo =
        body.successButtonText !== undefined ? String(body.successButtonText) : bot.successButtonText || "";
      // Traduções GRAVADAS — se a tela já mandou o valor pronto (botão
      // "Traduzir"/painel manual), respeita o que veio; senão, dispara a
      // tradução automática só quando o texto em PT mudou de verdade.
      const [traducaoWelcome, traducaoSuccess, traducaoBotao] = await Promise.all([
        body.welcomeMessageEn !== undefined || body.welcomeMessageEs !== undefined
          ? Promise.resolve({
              en: body.welcomeMessageEn !== undefined ? String(body.welcomeMessageEn) : bot.welcomeMessageEn,
              es: body.welcomeMessageEs !== undefined ? String(body.welcomeMessageEs) : bot.welcomeMessageEs,
            })
          : traduzirSeMudou(
              bot.profileId,
              "the welcome message she sends when someone starts a conversation with her on Telegram",
              welcomeMessageNovo,
              bot.welcomeMessage,
              bot.welcomeMessageEn,
              bot.welcomeMessageEs,
            ),
        body.successMessageEn !== undefined || body.successMessageEs !== undefined
          ? Promise.resolve({
              en: body.successMessageEn !== undefined ? String(body.successMessageEn) : bot.successMessageEn,
              es: body.successMessageEs !== undefined ? String(body.successMessageEs) : bot.successMessageEs,
            })
          : traduzirSeMudou(
              bot.profileId,
              "the message she sends on Telegram to a subscriber right after their payment was approved",
              successMessageNovo,
              bot.successMessage,
              bot.successMessageEn,
              bot.successMessageEs,
            ),
        body.successButtonTextEn !== undefined || body.successButtonTextEs !== undefined
          ? Promise.resolve({
              en: body.successButtonTextEn !== undefined ? String(body.successButtonTextEn) : bot.successButtonTextEn,
              es: body.successButtonTextEs !== undefined ? String(body.successButtonTextEs) : bot.successButtonTextEs,
            })
          : traduzirSeMudou(
              bot.profileId,
              "the SHORT label of a button (not a full message) that unlocks her VIP content after payment",
              successButtonTextNovo,
              bot.successButtonText,
              bot.successButtonTextEn,
              bot.successButtonTextEs,
            ),
      ]);
      saveBotConfig({
        ...bot,
        welcomeMessage: welcomeMessageNovo,
        welcomeMessageEn: traducaoWelcome.en,
        welcomeMessageEs: traducaoWelcome.es,
        welcomeMediaTags: body.welcomeMediaTags !== undefined ? String(body.welcomeMediaTags) : bot.welcomeMediaTags,
        welcomeMediaIds: Array.isArray(body.welcomeMediaIds)
          ? body.welcomeMediaIds.filter((v: unknown) => typeof v === "string" && v).slice(0, 10)
          : bot.welcomeMediaIds,
        welcomeMediaMode:
          body.welcomeMediaMode === "separate" || body.welcomeMediaMode === "album"
            ? body.welcomeMediaMode
            : bot.welcomeMediaMode,
        successMessage: successMessageNovo,
        successMessageEn: traducaoSuccess.en,
        successMessageEs: traducaoSuccess.es,
        previewsWelcomeMessage: body.previewsWelcomeMessage !== undefined ? String(body.previewsWelcomeMessage) : bot.previewsWelcomeMessage,
        supportUsername: body.supportUsername !== undefined ? String(body.supportUsername) : bot.supportUsername,
        idRegistro: body.idRegistro !== undefined ? String(body.idRegistro) : bot.idRegistro,
        successButtonText: successButtonTextNovo,
        successButtonTextEn: traducaoBotao.en,
        successButtonTextEs: traducaoBotao.es,
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
      const pixSocialProofTextNovo =
        body.pixSocialProofText !== undefined ? String(body.pixSocialProofText) : bot.pixSocialProofText || "";
      const traducaoProvaSocial =
        body.pixSocialProofTextEn !== undefined || body.pixSocialProofTextEs !== undefined
          ? {
              en: body.pixSocialProofTextEn !== undefined ? String(body.pixSocialProofTextEn) : bot.pixSocialProofTextEn,
              es: body.pixSocialProofTextEs !== undefined ? String(body.pixSocialProofTextEs) : bot.pixSocialProofTextEs,
            }
          : await traduzirSeMudou(
              bot.profileId,
              "a short social-proof line shown above the plans (e.g. how many people already subscribed today) — keep any placeholder like {vendas_hoje} or {assinantes} exactly as written",
              pixSocialProofTextNovo,
              bot.pixSocialProofText,
              bot.pixSocialProofTextEn,
              bot.pixSocialProofTextEs,
            );
      // Botões do checkout no cartão (Stripe) — mesmo padrão de tradução
      // gravada da prova social acima, só que pros dois botões do link de
      // pagamento internacional.
      const checkoutPayButtonTextNovo =
        body.checkoutPayButtonText !== undefined ? String(body.checkoutPayButtonText) : bot.checkoutPayButtonText || "";
      const traducaoPayButton =
        body.checkoutPayButtonTextEn !== undefined || body.checkoutPayButtonTextEs !== undefined
          ? {
              en: body.checkoutPayButtonTextEn !== undefined ? String(body.checkoutPayButtonTextEn) : bot.checkoutPayButtonTextEn,
              es: body.checkoutPayButtonTextEs !== undefined ? String(body.checkoutPayButtonTextEs) : bot.checkoutPayButtonTextEs,
            }
          : await traduzirSeMudou(
              bot.profileId,
              'the label of a BUTTON (not a message), the one that opens the payment link — short, like "Pay now" or "Make payment"',
              checkoutPayButtonTextNovo,
              bot.checkoutPayButtonText,
              bot.checkoutPayButtonTextEn,
              bot.checkoutPayButtonTextEs,
            );
      const checkoutCheckButtonTextNovo =
        body.checkoutCheckButtonText !== undefined
          ? String(body.checkoutCheckButtonText)
          : bot.checkoutCheckButtonText || "";
      const traducaoCheckButton =
        body.checkoutCheckButtonTextEn !== undefined || body.checkoutCheckButtonTextEs !== undefined
          ? {
              en:
                body.checkoutCheckButtonTextEn !== undefined
                  ? String(body.checkoutCheckButtonTextEn)
                  : bot.checkoutCheckButtonTextEn,
              es:
                body.checkoutCheckButtonTextEs !== undefined
                  ? String(body.checkoutCheckButtonTextEs)
                  : bot.checkoutCheckButtonTextEs,
            }
          : await traduzirSeMudou(
              bot.profileId,
              'the label of a BUTTON (not a message), the one the buyer taps to check whether their payment already went through — short, like "Check payment status"',
              checkoutCheckButtonTextNovo,
              bot.checkoutCheckButtonText,
              bot.checkoutCheckButtonTextEn,
              bot.checkoutCheckButtonTextEs,
            );
      saveBotConfig({
        ...bot,
        pixGeneratingMessage:
          body.pixGeneratingMessage !== undefined
            ? String(body.pixGeneratingMessage)
            : bot.pixGeneratingMessage,
        pixCaption: body.pixCaption !== undefined ? String(body.pixCaption) : bot.pixCaption,
        pixSocialProof:
          body.pixSocialProof !== undefined ? Boolean(body.pixSocialProof) : bot.pixSocialProof,
        pixSocialProofText: pixSocialProofTextNovo,
        pixSocialProofTextEn: traducaoProvaSocial.en,
        pixSocialProofTextEs: traducaoProvaSocial.es,
        pixAudioUrl: body.pixAudioUrl !== undefined ? String(body.pixAudioUrl) : bot.pixAudioUrl,
        pixBtnCheck: body.pixBtnCheck !== undefined ? String(body.pixBtnCheck) : bot.pixBtnCheck,
        pixBtnQr: body.pixBtnQr !== undefined ? String(body.pixBtnQr) : bot.pixBtnQr,
        pixBtnCopy: body.pixBtnCopy !== undefined ? String(body.pixBtnCopy) : bot.pixBtnCopy,
        pixNotPaidMessage:
          body.pixNotPaidMessage !== undefined ? String(body.pixNotPaidMessage) : bot.pixNotPaidMessage,
        effectPix: efeitoValido(body.effectPix, bot.effectPix),
        checkoutGeneratingMessage:
          body.checkoutGeneratingMessage !== undefined
            ? String(body.checkoutGeneratingMessage)
            : bot.checkoutGeneratingMessage,
        checkoutPayButtonText: checkoutPayButtonTextNovo,
        checkoutPayButtonTextEn: traducaoPayButton.en,
        checkoutPayButtonTextEs: traducaoPayButton.es,
        checkoutCheckButtonText: checkoutCheckButtonTextNovo,
        checkoutCheckButtonTextEn: traducaoCheckButton.en,
        checkoutCheckButtonTextEs: traducaoCheckButton.es,
        checkoutShowCheckButton:
          body.checkoutShowCheckButton !== undefined
            ? Boolean(body.checkoutShowCheckButton)
            : bot.checkoutShowCheckButton,
        acceptCardRecurring:
          body.acceptCardRecurring !== undefined
            ? Boolean(body.acceptCardRecurring)
            : bot.acceptCardRecurring,
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
      // Os 3 interruptores internacionais MORAVAM aqui (junto do preço em
      // USD); agora vivem em "Configurações internacionais" na aba
      // Configuração, salvos pela action `save-intl-config` abaixo. Este
      // bloco fica só de rede de segurança, pra uma chamada antiga (ou um
      // script) que ainda mande esses campos junto do save de planos não
      // silenciosamente ignorar o valor.
      if (body.intlEnabled !== undefined || body.intlAskFirst !== undefined || body.acceptCardBr !== undefined) {
        saveBotConfig({
          ...bot,
          intlEnabled: body.intlEnabled !== undefined ? Boolean(body.intlEnabled) : bot.intlEnabled,
          intlAskFirst: body.intlAskFirst !== undefined ? Boolean(body.intlAskFirst) : bot.intlAskFirst,
          acceptCardBr: body.acceptCardBr !== undefined ? Boolean(body.acceptCardBr) : bot.acceptCardBr,
        });
      }
      const incoming = Array.isArray(body.plans) ? body.plans : [];
      const existing = listPlans(bot.id);
      const keepIds = new Set<string>();
      for (let idx = 0; idx < incoming.length; idx++) {
        const p = incoming[idx] as Record<string, unknown>;
        const name = String(p.name || "").trim();
        const priceCents = Math.max(0, Math.round(Number(p.priceCents) || 0));
        const priceUsdCents =
          Number(p.priceUsdCents) > 0 ? Math.max(0, Math.round(Number(p.priceUsdCents))) : undefined;
        // 0 = VITALÍCIO e é válido; por isso o piso é 0, não 1.
        const durationDays = Math.max(0, Math.round(Number(p.durationDays) || 0));
        const kind = p.kind === "package" ? "package" : "subscription";
        const deliverable = typeof p.deliverable === "string" ? p.deliverable : undefined;
        if (!name || priceCents <= 0) continue;
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

        // Nome em inglês — tradução GRAVADA (só EN, sem versão em espanhol:
        // é um rótulo curto de botão, mesmo escopo do bobz). Ao contrário
        // das mensagens (que têm um botão "Salvar traduções" à parte), o
        // nome do plano viaja no MESMO save da lista inteira — por isso o
        // valor que chega é comparado com o que já estava salvo: se o
        // operador mudou o campo EN à mão, respeita; se veio igual (só um
        // eco do último save) OU vazio, dispara a tradução automática
        // quando o nome em PT mudou (e mantém a tradução de antes quando
        // não mudou nada).
        const antigo = existing.find((e) => e.id === id);
        const nameEnEnviado = typeof p.nameEn === "string" ? p.nameEn.trim() : "";
        const nameEn =
          nameEnEnviado && nameEnEnviado !== (antigo?.nameEn || "").trim()
            ? nameEnEnviado
            : (
                await traduzirSeMudou(
                  bot.profileId,
                  "the SHORT name of a subscription plan/product shown on a button — not a full message, just a product name",
                  name,
                  antigo?.name,
                  antigo?.nameEn,
                  undefined,
                )
              ).en;

        savePlan({
          id,
          botId: bot.id,
          name,
          nameEn,
          priceCents,
          priceUsdCents,
          intlAvailable: p.intlAvailable !== false,
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
      }
      // Remove os que sumiram da lista.
      for (const old of existing) if (!keepIds.has(old.id)) deletePlan(old.id);
      return NextResponse.json({ ok: true, plans: comStats(bot.id) });
    }

    // ---- Configurações internacionais (aba Configuração) — os 3 interruptores
    // sozinhos, sem mexer em plano nenhum. ----
    if (action === "save-intl-config") {
      const bot = requireBot(body.profileId);
      saveBotConfig({
        ...bot,
        intlEnabled: body.intlEnabled !== undefined ? Boolean(body.intlEnabled) : bot.intlEnabled,
        intlAskFirst: body.intlAskFirst !== undefined ? Boolean(body.intlAskFirst) : bot.intlAskFirst,
        originGateMessage:
          body.originGateMessage !== undefined ? String(body.originGateMessage) : bot.originGateMessage,
        originGateBtnBr:
          body.originGateBtnBr !== undefined ? String(body.originGateBtnBr) : bot.originGateBtnBr,
        originGateBtnIntl:
          body.originGateBtnIntl !== undefined ? String(body.originGateBtnIntl) : bot.originGateBtnIntl,
        acceptCardBr: body.acceptCardBr !== undefined ? Boolean(body.acceptCardBr) : bot.acceptCardBr,
      });
      return NextResponse.json({ ok: true });
    }

    // ---- "Traduzir tudo" — força a tradução (EN/ES) de TODO campo
    // traduzível do bot de uma vez: boas-vindas, mensagem de aprovação,
    // botão de acesso, prova social, nome de cada plano, e cada passo dos
    // dois funis de recuperação (geral e PIX gerado). Ao contrário do save
    // automático (que só traduz o que MUDOU), este ignora o que já existe e
    // força tudo de novo — é o botão pra quando a modelo troca a IA, quer
    // recalibrar tudo de uma vez, ou desconfia que alguma tradução ficou
    // velha. Mesma cadeia de provedores de sempre (Grok primeiro).
    if (action === "translate-all") {
      const bot = requireBot(body.profileId);
      const traduzDois = async (texto: string | undefined, contexto: string) => {
        const t = (texto || "").trim();
        if (!t) return { en: undefined as string | undefined, es: undefined as string | undefined };
        const [en, es] = await Promise.all([
          traduzirTexto(t, "en", bot.profileId, contexto).catch(() => undefined),
          traduzirTexto(t, "es", bot.profileId, contexto).catch(() => undefined),
        ]);
        return { en, es };
      };

      const [welcomeT, successT, botaoT, provaT] = await Promise.all([
        traduzDois(bot.welcomeMessage, "the welcome message she sends when someone starts a conversation with her on Telegram"),
        traduzDois(bot.successMessage, "the message she sends on Telegram to a subscriber right after their payment was approved"),
        traduzDois(bot.successButtonText, "the SHORT label of a button (not a full message) that unlocks her VIP content after payment"),
        traduzDois(
          bot.pixSocialProofText,
          "a short social-proof line shown above the plans (e.g. how many people already subscribed today) — keep any placeholder like {vendas_hoje} or {assinantes} exactly as written",
        ),
      ]);
      saveBotConfig({
        ...bot,
        welcomeMessageEn: welcomeT.en ?? bot.welcomeMessageEn,
        welcomeMessageEs: welcomeT.es ?? bot.welcomeMessageEs,
        successMessageEn: successT.en ?? bot.successMessageEn,
        successMessageEs: successT.es ?? bot.successMessageEs,
        successButtonTextEn: botaoT.en ?? bot.successButtonTextEn,
        successButtonTextEs: botaoT.es ?? bot.successButtonTextEs,
        pixSocialProofTextEn: provaT.en ?? bot.pixSocialProofTextEn,
        pixSocialProofTextEs: provaT.es ?? bot.pixSocialProofTextEs,
      });

      // Planos — só o nome, só EN (mesmo escopo do resto da feature).
      const planos = listPlans(bot.id);
      await Promise.all(
        planos.map(async (p) => {
          if (!p.name.trim()) return;
          const nameEn = await traduzirTexto(
            p.name,
            "en",
            bot.profileId,
            "the SHORT name of a subscription plan/product shown on a button — not a full message, just a product name",
          ).catch(() => undefined);
          if (nameEn) savePlan({ ...p, nameEn });
        }),
      );

      // Funis — cada passo, dos dois funis de recuperação.
      const traduzFunil = async (raw: string | undefined, contexto: string): Promise<string | undefined> => {
        if (!raw) return raw;
        let passos: FunnelStep[];
        try {
          const v = JSON.parse(raw);
          if (!Array.isArray(v)) return raw;
          passos = v;
        } catch {
          return raw;
        }
        const traduzidos = await Promise.all(
          passos.map(async (passo) => {
            if (!passo.text?.trim()) return passo;
            const { en, es } = await traduzDois(passo.text, contexto);
            return { ...passo, textEn: en ?? passo.textEn, textEs: es ?? passo.textEs };
          }),
        );
        return JSON.stringify(traduzidos);
      };
      const [downsellFunnel, pixDownsellFunnel] = await Promise.all([
        traduzFunil(
          bot.downsellFunnel,
          "one step of a re-engagement sequence sent to a lead who started a chat but hasn't bought anything yet",
        ),
        traduzFunil(
          bot.pixDownsellFunnel,
          "one step of a recovery sequence sent to a lead who already picked a plan and generated a payment but hasn't paid yet",
        ),
      ]);
      const botAtual = getBotConfigByProfile(bot.profileId)!;
      saveBotConfig({ ...botAtual, downsellFunnel, pixDownsellFunnel });

      return NextResponse.json({ ok: true });
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
      // Tradução GRAVADA passo a passo (ver `traduzirFunilSeMudou`) — só o
      // Downsell geral e o de PIX gerado traduzem automaticamente por ora;
      // upsell/renovação continuam só em PT (fora do pedido desta leva).
      const downsellNovoRaw = normFunnel(body.downsellFunnel);
      const pixDownsellNovoRaw = normFunnel(body.pixDownsellFunnel);
      const [downsellFunnel, pixDownsellFunnel] = await Promise.all([
        downsellNovoRaw !== undefined
          ? traduzirFunilSeMudou(
              bot.profileId,
              "one step of a re-engagement sequence sent to a lead who started a chat but hasn't bought anything yet",
              lerFunnelSalvo(downsellNovoRaw),
              lerFunnelSalvo(bot.downsellFunnel),
            ).then((passos) => JSON.stringify(passos))
          : Promise.resolve(bot.downsellFunnel),
        pixDownsellNovoRaw !== undefined
          ? traduzirFunilSeMudou(
              bot.profileId,
              "one step of a recovery sequence sent to a lead who already picked a plan and generated a payment but hasn't paid yet",
              lerFunnelSalvo(pixDownsellNovoRaw),
              lerFunnelSalvo(bot.pixDownsellFunnel),
            ).then((passos) => JSON.stringify(passos))
          : Promise.resolve(bot.pixDownsellFunnel),
      ]);
      saveBotConfig({
        ...bot,
        downsellFunnel,
        upsellFunnel: normFunnel(body.upsellFunnel) ?? bot.upsellFunnel,
        pixDownsellFunnel,
        downsellEnabled:
          body.downsellEnabled !== undefined ? Boolean(body.downsellEnabled) : bot.downsellEnabled,
        pixDownsellEnabled:
          body.pixDownsellEnabled !== undefined
            ? Boolean(body.pixDownsellEnabled)
            : bot.pixDownsellEnabled,
        // Padrão do botão do Downsell de PIX. Só 'all' é aceito como troca;
        // qualquer outra coisa volta para 'selected', que é o comportamento
        // que existia antes de isto ser configurável.
        pixDownsellPlanMode:
          body.pixDownsellPlanMode !== undefined
            ? body.pixDownsellPlanMode === "all"
              ? "all"
              : "selected"
            : bot.pixDownsellPlanMode,
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
        saveBotConfig({
          ...bot,
          botUsername: webhook.username || bot.botUsername,
          operationActive: true,
        });
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

    // ---- Importação em lote do histórico do Canal de Vendas (bots como o
    // Bobz, que o Telegram não deixa a gente ler pra trás sozinho) — texto
    // colado com uma ou várias mensagens, não amarrado a UM bot específico
    // (cada bloco resolve o bot dele pelo "ID Bot" do próprio texto). ----
    if (action === "import-sales-reports") {
      const texto = typeof body.text === "string" ? body.text : "";
      if (!texto.trim()) throw new ApiError(400, "Cole o texto do histórico.");
      const { importarRelatoriosExternos } = await import("@/lib/externalSaleReport");
      const resultado = importarRelatoriosExternos(texto);
      return NextResponse.json({ ok: true, ...resultado });
    }

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
          "Nenhum canal conhecido ainda. Cole o ID aqui e toque em Detectar para eu conferir, ou publique algo no canal com o bot dentro.";
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
        if (!info) return { rotulo, chatId, ok: false, motivo: "o bot não enxerga este canal (ID errado ou removido)" };
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
        await checar(bot.idVip, "Canal VIP"),
        await checar(bot.idAquecimento, "Canal de Prévias"),
        // Opcional: só entra na checagem quando configurado — vazio não é
        // problema nenhum aqui (ao contrário do VIP/Prévias, que são
        // obrigatórios), então não teria sentido aparecer como "sem ID".
        ...(bot.idVendas?.trim() ? [await checar(bot.idVendas.trim(), "Canal de Vendas")] : []),
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
