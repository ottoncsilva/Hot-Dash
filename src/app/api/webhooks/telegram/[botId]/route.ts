import { NextRequest, NextResponse } from "next/server";
import type { TelegramPlan, TelegramBotConfig } from "@/lib/telegramDb";
import { moedaPorIdioma, formatarMoeda, type MoedaIntl } from "@/lib/moedaIntl";
import { getBotConfig, listActivePlans, listCustomButtons, saveSubscription, getSubscription, getPlan, findActiveSubscription, getTelegramLead, countActiveSubscriptions, enqueueApproval, buildAccessMessage, buildPlanKeyboardRows, recurringFromDurationDays, primeiraVezQueVejoEsteUpdate, BUMP_DEFAULTS, PIX_DEFAULTS, CHECKOUT_DEFAULTS } from "@/lib/telegramDb";
import { upsertTelegramUser, setTelegramUserBlocked, setTelegramUserGroup, getTelegramUser, setTelegramUserLanguage, limparTelegramUserLanguage } from "@/lib/telegramUsers";
import { registrarChegadaTelegram, registraMudancaDeGrupo } from "@/lib/telegramIngest";
import { getMailingOffer } from "@/lib/telegramMailing";
import { sendTelegramMessage, sendTelegramMedia, sendTelegramMediaGroup, sendTelegramVoiceUrl, sendTelegramPhotoBuffer, approveTelegramJoinRequest, declineTelegramJoinRequest, telegramWebhookSecret } from "@/lib/telegramApi";
import { aplicarProvaSocial } from "@/lib/provaSocial";
import QRCode from "qrcode";
import { listMedia, getMediaRow } from "@/lib/media";
import { activeProvider, getProvider } from "@/lib/payments";
import { recordTransaction, overview, nomeDoProduto } from "@/lib/transactions";
import { ensureSyncpayWebhookShortToken, applyDynamicPrice, buttonStyleProps } from "@/lib/settings";
import { publicOrigin } from "@/lib/publicOrigin";
import { botaoCopiar, efeitoProps } from "@/lib/telegramEffects";
import { enviarMensagemDoBot } from "@/lib/telegramSend";
import { aplicarVariaveis } from "@/lib/telegramVars";
import { getDb } from "@/lib/db";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Textos FIXOS do fluxo internacional (checkout Stripe) — mecânica de
 * compra, não conteúdo de persona. Iguais para toda modelo, ao contrário das
 * mensagens editáveis na tela do bot (que continuam só em português até
 * alguém clicar "Traduzir" na mensagem de sucesso — ver SuccessRow).
 */
const CHECKOUT_INTL_TEXTS = {
  en: {
    noPlan: "⚠️ No plan available in USD right now.",
    choosePlan: "🌎 Choose your plan (charged in USD, via card):",
    unavailable: "⚠️ International checkout temporarily unavailable. Please try again later.",
    generating: "⏳ Generating your payment link...",
    linkFailed: "⚠️ Could not generate the payment link. Please try again in a moment.",
    finishPayment: "Finish the payment through the link below.",
    makePayment: "Make payment 👉",
    checkStatus: "Check payment status",
    planNotFound: "⚠️ Plan not found or not available in USD.",
    subNotFound: "⚠️ Subscription not found.",
    portalFailed: "⚠️ Couldn't open the portal right now. Please try again in a moment.",
    managePortal: "⚙️ Manage your subscription (cancel, view charges):",
    openPortal: "Open portal 👉",
  },
  es: {
    noPlan: "⚠️ No hay ningún plan disponible en USD por ahora.",
    choosePlan: "🌎 Elige tu plan (cobrado en USD, con tarjeta):",
    unavailable: "⚠️ El pago internacional no está disponible en este momento. Inténtalo más tarde.",
    generating: "⏳ Generando tu enlace de pago...",
    linkFailed: "⚠️ No se pudo generar el enlace de pago. Inténtalo de nuevo en un momento.",
    finishPayment: "Termina el pago a través del siguiente enlace.",
    makePayment: "Pagar 👉",
    checkStatus: "Verificar estado del pago",
    planNotFound: "⚠️ Plan no encontrado o no disponible en USD.",
    subNotFound: "⚠️ Suscripción no encontrada.",
    portalFailed: "⚠️ No pudimos abrir el portal ahora. Inténtalo de nuevo en un momento.",
    managePortal: "⚙️ Gestiona tu suscripción (cancelar, ver cobros):",
    openPortal: "Abrir portal 👉",
  },
} as const;

/** Boas-vindas do ramo internacional quando `welcomeMessageEn/Es` está vazio
 *  — mesmas variáveis da boas-vindas em PT ({nome} etc.), texto genérico. */
const WELCOME_INTL_DEFAULTS = {
  en: "Hi {nome}! 🔥 Choose your VIP access below 👇",
  es: "¡Hola {nome}! 🔥 Elige tu acceso VIP abajo 👇",
} as const;

/** Pergunta Brasil/International (`intlAskFirst`) quando o operador não
 *  editou nada em Configurações → Internacional — bilíngue PT/EN, mesmo
 *  modelo de outros bots do mercado. */
const ORIGIN_GATE_DEFAULT = {
  message: "🌎 Choose your language · Escolha o idioma\n\nWhere are you talking to me from? / De onde você fala comigo?",
  btnBr: "🇧🇷 Brasil (Português)",
  btnIntl: "🌐 International (English)",
} as const;

/** Prova social do ramo internacional quando `pixSocialProofTextEn/Es` está
 *  vazio — mesmos marcadores {vendas_hoje}/{assinantes} do texto em PT. */
const PROVA_SOCIAL_INTL_DEFAULTS = {
  en: "🔥 {vendas_hoje} people joined today · {assinantes} active subscribers",
  es: "🔥 {vendas_hoje} personas se unieron hoy · {assinantes} suscriptores activos",
} as const;

/**
 * Abertura BRASILEIRA do /start: planos em BRL + PIX, botão extra de cartão
 * (opcional), botões customizados, suporte e prova social — o funil de
 * sempre, sem tradução nenhuma. Função nomeada porque agora tem DOIS pontos
 * de entrada: direto (bot sem `intlAskFirst`, comportamento de sempre) ou
 * depois de escolher "🇧🇷 Brasil" na pergunta upfront (`origin_br`).
 */
async function enviarAberturaBrasil(
  bot: TelegramBotConfig,
  chat: { id: number | string },
  from: { id: number; first_name?: string; last_name?: string; username?: string },
): Promise<void> {
  // Só os ATIVOS: um plano desligado some dos botões mas continua no
  // painel, com o histórico de vendas.
  const plans = listActivePlans(bot.id);
  const customButtons = listCustomButtons(bot.id);

  const inlineKeyboard: any[] = [];

  // Botões de Planos
  if (plans.length > 0) {
    inlineKeyboard.push(...buildPlanKeyboardRows(bot, plans, { moeda: "BRL", prefix: "buy_plan_" }));
  }

  // "Not from Brazil?" — os dois toggles de Configurações internacionais são
  // INDEPENDENTES: este some/aparece só com o interruptor DELE
  // (`intlEnabled`), sem depender de `intlAskFirst` estar ligado também. Quem
  // chegou aqui respondeu "🇧🇷 Brasil" na pergunta upfront (quando ela existe)
  // ou nunca viu pergunta nenhuma — nos dois casos o botão continua sendo uma
  // saída válida pra quem clicou errado ou muda de ideia.
  if (bot.intlEnabled && plans.some((p) => (p.priceUsdCents || 0) > 0 && p.intlAvailable !== false)) {
    inlineKeyboard.push([
      { text: "🌎 Not from Brazil?", callback_data: "intl_menu", ...buttonStyleProps(bot, "notFromBrazil") },
    ]);
  }

  // Botões Personalizados
  if (customButtons.length > 0) {
    customButtons.forEach((btn) => {
      inlineKeyboard.push([{ text: btn.text, url: btn.url, ...buttonStyleProps(bot, "redirect") }]);
    });
  }

  // Se houver suporte cadastrado, adiciona o botão
  if (bot.supportUsername) {
    const supportUrl = bot.supportUsername.startsWith("http")
      ? bot.supportUsername
      : `https://t.me/${bot.supportUsername.replace("@", "")}`;
    inlineKeyboard.push([{ text: "💬 Suporte / Dúvidas", url: supportUrl, ...buttonStyleProps(bot, "support") }]);
  }

  const replyMarkup = inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;

  // Personaliza a mensagem substituindo o placeholder do nome
  // Todas as variáveis, não só {nome} — a tela oferece as seis e o /start
  // é a mensagem onde elas mais aparecem.
  const welcomeText = aplicarVariaveis(bot.welcomeMessage, {
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username,
    profileName: nomeDaModelo(bot.profileId),
    botUsername: bot.botUsername,
  });

  // A abertura sai pelo MESMO caminho de envio que a Recuperação e as
  // sequências de aprovação (lib/telegramSend.ts): mídias escolhidas a
  // dedo, em álbum ou uma por mensagem. As etiquetas continuam sendo
  // aceitas ali dentro, como legado, para quem já as tinha salvas.
  await enviarMensagemDoBot({
    botToken: bot.botToken,
    chatId: String(chat.id),
    profileId: bot.profileId,
    text: welcomeText,
    mediaIds: bot.welcomeMediaIds,
    mode: bot.welcomeMediaMode,
    mediaTags: bot.welcomeMediaTags,
    replyMarkup,
    extra: efeitoProps(bot.effectWelcome),
  });

  // Cartão no Brasil — botão EXTRA, numa mensagem em SEQUÊNCIA (não editada
  // na de cima): o lead brasileiro que preferir cartão a PIX abre o mesmo
  // catálogo, cobrado em BRL pela Stripe (`card_menu` → `buy_card_`). Só
  // aparece com a Stripe conectada — sem credenciais, o botão levaria a uma
  // cobrança que nunca seria gerada.
  if (bot.acceptCardBr && plans.length > 0) {
    const { getStripeCredentials } = await import("@/lib/settings");
    if (getStripeCredentials()) {
      await sendTelegramMessage(bot.botToken, String(chat.id), "💳 Prefere pagar no cartão?", {
        reply_markup: {
          inline_keyboard: [[{ text: "💳 Pagar no cartão", callback_data: "card_menu", ...buttonStyleProps(bot, "cardBrOffer") }]],
        },
      });
    }
  }

  // PROVA SOCIAL — sempre por ÚLTIMO: depois dos planos, do "Not from
  // Brazil?" (que já vem junto da mensagem de boas-vindas) e do "pagar no
  // cartão" acima. É o fechamento da abertura, não o meio dela.
  //
  // O portão de antes era `hoje > 0 || assinantes > 0`, um OU onde devia ser
  // um E: com assinantes ativos e nenhuma venda no dia, a linha saía
  // "0 pessoa(s) garantiram o acesso hoje" — prova social negativa, que vende
  // menos que prova social nenhuma. Agora os números passam por um PISO
  // (ver `lib/provaSocial.ts`), então não existe mais o caso do zero e a linha
  // pode sair sempre que o operador a ligou.
  if (bot.pixSocialProof && plans.length > 0) {
    const linha = aplicarProvaSocial(
      bot.pixSocialProofText?.trim() || PIX_DEFAULTS.socialProofText,
      bot.id,
      {
        vendasHoje: overview(bot.profileId).today.paidCount,
        assinantes: countActiveSubscriptions(bot.id),
      },
    );
    await sendTelegramMessage(bot.botToken, String(chat.id), linha);
  }
}

/** Nome da modelo, para a variável {modelo}. */
function nomeDaModelo(profileId: string): string {
  const row = getDb().prepare("SELECT name FROM profiles WHERE id = ?").get(profileId) as
    | { name: string }
    | undefined;
  return row?.name || "";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { botId: string } }
) {
  try {
    const bot = getBotConfig(params.botId);
    if (!bot) {
      return NextResponse.json({ error: "Bot não configurado." }, { status: 404 });
    }

    // Segurança: o Telegram devolve o secret_token que registramos no header
    // abaixo. Se o webhook foi registrado com secret (padrão nas versões novas),
    // exigimos que bata. Webhooks antigos (sem secret) continuam aceitos. Vale
    // é sempre o Telegram chamando ESTE endpoint.
    const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (providedSecret && providedSecret !== telegramWebhookSecret(bot.id)) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    let update: any = {};
    try {
      update = await req.json();
    } catch {
      update = {};
    }

    // Operação desligada → quem tem controle total é outro sistema (ex.: o
    // Bobz), e o Hot-Dash não encosta em NADA deste bot: não grava, não
    // repassa, não responde. "Ou usa o Hot-Dash, ou usa o Bobz" — o
    // meio-termo (repasse/espiada) foi removido depois de derrubar, em
    // silêncio, o recebimento de vendas do sistema de origem.
    //
    // As vendas destes bots continuam entrando pelo Financeiro: o pagamento
    // chega pelo webhook da SyncPay/Stripe como sempre, e a atribuição ao
    // modelo/bot vem do relatório que o sistema de origem posta no Grupo de
    // Vendas (ver `externalSaleReport.ts`) — nada disso passa por aqui.
    //
    // Retorna 200 para o Telegram não reenviar em loop.
    if (!bot.operationActive) {
      return NextResponse.json({ ok: true, inactive: true });
    }

    // IDEMPOTÊNCIA: o Telegram reenvia o MESMO update se a nossa resposta
    // demorar ou falhar — sem isso, um /start (ou pior, um clique de compra)
    // reprocessado manda tudo de novo: boas-vindas duplicada, timer do
    // downsell reiniciado à toa, e no caso da compra, cobrança em dobro. Sai
    // ANTES de qualquer efeito colateral (inclusive o registro abaixo).
    if (!primeiraVezQueVejoEsteUpdate(bot.id, update.update_id)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    // Usuário visto, entrada/saída de grupo, lead do /start — o que dá pra
    // ENTENDER do update, sem mandar nada (ver `telegramIngest.ts`).
    registrarChegadaTelegram(bot, update);

    // ---- Mensagem comum (Ex: /start) ----
    if (update.message) {
      const { chat, text, from } = update.message;
      const isStart = typeof text === "string" && text.startsWith("/start");

      if (isStart && from) {
        // MODO INTERNACIONAL BILÍNGUE: com `intlAskFirst` ligado (e plano
        // qualificado em USD), pergunta Brasil/International ANTES de
        // qualquer conteúdo — 2 botões, mensagem própria. Sem isso (padrão),
        // segue direto pra abertura brasileira de sempre, sem mudar nada.
        // Independente de `intlEnabled` (o toggle do botão "Not from
        // Brazil?", só dele) — os dois interruptores de Configurações
        // internacionais ligam funcionalidades separadas, nenhum é
        // pré-requisito do outro.
        const plansParaGate = listActivePlans(bot.id);
        const temIntl = plansParaGate.some((p) => (p.priceUsdCents || 0) > 0 && p.intlAvailable !== false);
        if (bot.intlAskFirst && temIntl) {
          await sendTelegramMessage(
            bot.botToken,
            String(chat.id),
            bot.originGateMessage?.trim() || ORIGIN_GATE_DEFAULT.message,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: bot.originGateBtnBr?.trim() || ORIGIN_GATE_DEFAULT.btnBr,
                      callback_data: "origin_br",
                      ...buttonStyleProps(bot, "originGate"),
                    },
                    {
                      text: bot.originGateBtnIntl?.trim() || ORIGIN_GATE_DEFAULT.btnIntl,
                      callback_data: "origin_intl",
                      ...buttonStyleProps(bot, "originGate"),
                    },
                  ],
                ],
              },
            },
          );
        } else {
          await enviarAberturaBrasil(bot, chat, from);
        }
      }
    }

    // ---- Clique nos botões de compra (Callback Query) ----
    if (update.callback_query) {
      const { id, data, from, message } = update.callback_query;

      // ---- Pergunta upfront (modo internacional bilíngue, `intlAskFirst`) ----
      // "🇧🇷 Brasil" cai na MESMA abertura de sempre (planos BRL, PIX,
      // downsell etc. — nada muda). "🌎 International" cai no MESMO menu de
      // idioma que o botão "Not from Brazil?" já abre hoje — ver logo abaixo.
      if (data === "origin_br") {
        // Declarou-se brasileiro: o funil inteiro passa a ser em REAIS, na
        // mesma tabela do PIX da SyncPay. A abertura abaixo já é fixa em BRL,
        // mas os funis de downsell escolhem a moeda pelo idioma salvo — sem
        // limpar aqui, quem tinha espiado o menu internacional antes veria R$
        // no /start e receberia a recuperação em dólar/euro.
        limparTelegramUserLanguage(bot.id, from.id);
        await enviarAberturaBrasil(bot, message.chat, from);
        return NextResponse.json({ ok: true });
      }

      // ---- "Not from Brazil?" (botão no meio do funil, bots sem
      // `intlAskFirst`) / "🌎 International" (pergunta upfront) — os dois
      // caem no mesmo menu internacional (checkout Stripe). Primeiro
      // pergunta o IDIOMA (mensagem NOVA, mesmo padrão do bump) — só depois
      // mostra os planos em USD, já no idioma escolhido. Nenhum dos dois
      // botões aparece sem plano com priceUsdCents cadastrado.
      if (data === "intl_menu" || data === "origin_intl") {
        await sendTelegramMessage(
          bot.botToken,
          String(message.chat.id),
          "🌎 Choose your language / Elige tu idioma:",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🇬🇧 English", callback_data: "lang_en", ...buttonStyleProps(bot, "language") },
                  { text: "🇪🇸 Español", callback_data: "lang_es", ...buttonStyleProps(bot, "language") },
                ],
              ],
            },
          },
        );
        return NextResponse.json({ ok: true });
      }

      // ---- Escolha de idioma: grava no LEAD (vale pra sempre, não só pra
      // esta compra) e então mostra os planos em USD, já traduzidos. ----
      const langAcao = typeof data === "string" && data.match(/^lang_(en|es)$/);
      if (langAcao) {
        const idioma = langAcao[1] as "en" | "es";
        const t = CHECKOUT_INTL_TEXTS[idioma];
        // Garante a linha em telegram_users antes de gravar o idioma: o
        // /start só cria uma quando vem com código de origem (deep-link) —
        // sem isso, um lead "direto" ainda não tem linha nenhuma aqui, e um
        // UPDATE sozinho (setTelegramUserLanguage) não criaria nada.
        upsertTelegramUser({
          botId: bot.id,
          profileId: bot.profileId,
          telegramUserId: from.id,
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name,
          chatId: String(message.chat.id),
          canDm: true,
          source: "start",
        });
        setTelegramUserLanguage(bot.id, from.id, idioma);

        // Boas-vindas traduzida (nova) — vale tanto pra quem entrou pela
        // pergunta upfront quanto por quem clicou "Not from Brazil?" no meio
        // do funil de sempre: sem `welcomeMessageEn/Es`, cai num padrão em
        // inglês/espanhol (nunca sai muda). Mesma mídia da abertura em PT.
        const welcomeIntl =
          (idioma === "en" ? bot.welcomeMessageEn : bot.welcomeMessageEs)?.trim() || WELCOME_INTL_DEFAULTS[idioma];
        await enviarMensagemDoBot({
          botToken: bot.botToken,
          chatId: String(message.chat.id),
          profileId: bot.profileId,
          text: aplicarVariaveis(welcomeIntl, {
            firstName: from.first_name,
            lastName: from.last_name,
            username: from.username,
            profileName: nomeDaModelo(bot.profileId),
            botUsername: bot.botUsername,
          }),
          mediaIds: bot.welcomeMediaIds,
          mode: bot.welcomeMediaMode,
          mediaTags: bot.welcomeMediaTags,
          extra: efeitoProps(bot.effectWelcome),
        });

        const plans = listActivePlans(bot.id);
        // Cardápio já na moeda do lead — o mesmo número do preço em dólar
        // (6 dólares = 6 euros), pra ele não ter que converter de cabeça.
        const rows = buildPlanKeyboardRows(bot, plans, {
          moeda: moedaPorIdioma(from.language_code),
          prefix: "buy_intl_",
        });
        if (rows.length === 0) {
          await sendTelegramMessage(bot.botToken, String(message.chat.id), t.noPlan);
        } else {
          await sendTelegramMessage(bot.botToken, String(message.chat.id), t.choosePlan, {
            reply_markup: { inline_keyboard: rows },
          });
        }

        // PROVA SOCIAL traduzida — mesmo piso, mesmos marcadores. Passa pela
        // MESMA função da abertura em português: eram dois `replace` soltos, e
        // foi por isso que o zero apareceu nos dois de uma vez.
        if (bot.pixSocialProof && rows.length > 0) {
          const provaBase =
            (idioma === "en" ? bot.pixSocialProofTextEn : bot.pixSocialProofTextEs)?.trim() ||
            PROVA_SOCIAL_INTL_DEFAULTS[idioma];
          const linha = aplicarProvaSocial(provaBase, bot.id, {
            vendasHoje: overview(bot.profileId).today.paidCount,
            assinantes: countActiveSubscriptions(bot.id),
          });
          await sendTelegramMessage(bot.botToken, String(message.chat.id), linha);
        }
        return NextResponse.json({ ok: true });
      }

      // ---- "Prefere pagar no cartão?" (lead BRASILEIRO, Stripe em BRL) ----
      // Mesmo catálogo, mesmo preço do PIX — só troca `buy_plan_` (SyncPay)
      // por `buy_card_` (Stripe). Botão só existe com `acceptCardBr` ligado
      // (ver `enviarAberturaBrasil`), então chegar aqui sem plano nenhum é
      // caso raro (planos desativados depois do botão já ter saído).
      if (data === "card_menu") {
        const plans = listActivePlans(bot.id);
        const rows = buildPlanKeyboardRows(bot, plans, { moeda: "BRL", prefix: "buy_card_" });
        if (rows.length === 0) {
          await sendTelegramMessage(bot.botToken, String(message.chat.id), "⚠️ Nenhum plano disponível no momento.");
        } else {
          await sendTelegramMessage(bot.botToken, String(message.chat.id), "💳 Escolha seu plano (cobrado no cartão):", {
            reply_markup: { inline_keyboard: rows },
          });
        }
        return NextResponse.json({ ok: true });
      }

      // ---- Botões da tela do PIX ----
      // Os três agem sobre uma cobrança JÁ criada, por isso carregam o id da
      // inscrição: sem ele, ver o QR exigiria pedir um PIX novo e o cliente
      // ficaria com duas cobranças abertas.
      const pixAcao = typeof data === "string" && data.match(/^pix_(check|qr|copy)_(.+)$/);
      if (pixAcao) {
        const [, acao, subId] = pixAcao;
        const sub = getSubscription(subId);
        const chatId = String(message.chat.id);

        if (!sub || sub.telegramUserId !== from.id) {
          await sendTelegramMessage(bot.botToken, chatId, "⚠️ Cobrança não encontrada.");
          return NextResponse.json({ ok: true });
        }

        if (acao === "qr") {
          if (!sub.pixCode) {
            await sendTelegramMessage(bot.botToken, chatId, "⚠️ QR Code indisponível para esta cobrança.");
          } else {
            try {
              const qr = await QRCode.toBuffer(sub.pixCode, { width: 512, margin: 1 });
              await sendTelegramPhotoBuffer(bot.botToken, chatId, qr, "📸 Escaneie no app do seu banco.");
            } catch {
              await sendTelegramMessage(bot.botToken, chatId, "⚠️ Não consegui gerar o QR Code agora.");
            }
          }
          return NextResponse.json({ ok: true });
        }

        if (acao === "copy") {
          // O código sozinho, num <code>: assim o toque copia SÓ a chave, sem
          // levar junto o texto da oferta.
          await sendTelegramMessage(
            bot.botToken,
            chatId,
            sub.pixCode
              ? `👇 Toque para copiar:\n\n<code>${sub.pixCode}</code>`
              : "⚠️ Código indisponível para esta cobrança.",
          );
          return NextResponse.json({ ok: true });
        }

        // "Verificar Status": a fonte de verdade é a NOSSA transação, que o
        // webhook do gateway atualiza. Se já consta paga, a entrega também já
        // aconteceu por lá — aqui o que falta é reenviar o acesso para quem
        // perdeu a mensagem.
        const paga = sub.status === "active";
        if (!paga) {
          await sendTelegramMessage(
            bot.botToken,
            chatId,
            bot.pixNotPaidMessage?.trim() || PIX_DEFAULTS.notPaidMessage,
          );
        } else if (sub.inviteLink) {
          // Mesma montagem da entrega original: o link nunca fica de fora,
          // tenha o texto o marcador {link_vip} ou não.
          const aprovada = buildAccessMessage(bot, sub.inviteLink, buttonStyleProps(bot, "access"));
          await sendTelegramMessage(bot.botToken, chatId, aprovada.text, {
            ...aprovada.options,
            ...efeitoProps(bot.effectSuccess),
          });
        } else {
          await sendTelegramMessage(
            bot.botToken,
            chatId,
            "✅ Pagamento confirmado! Seu acesso está sendo liberado — se o link não chegar em instantes, chame o suporte.",
          );
        }
        return NextResponse.json({ ok: true });
      }

      // ---- "Gerenciar assinatura" (Billing Portal da Stripe) ----
      // Só existe pra quem comprou em `mode: "subscription"` (renovação
      // automática) — é o autoatendimento que evita contestação/chargeback:
      // sem um jeito de cancelar sozinho, quem esquece que assinou e é
      // cobrado de novo tende a contestar no banco em vez de escrever pro
      // suporte. A sessão é criada NA HORA do clique (não reaproveitada) —
      // evita um link salvo expirar antes de ser usado.
      const manageAcao = typeof data === "string" && data.match(/^manage_sub_(.+)$/);
      if (manageAcao) {
        const [, subId] = manageAcao;
        const sub = getSubscription(subId);
        const chatId = String(message.chat.id);
        // Só existe pra assinatura Stripe (nunca PIX/SyncPay) — a maioria é
        // internacional (EN/ES), mas o cartão no Brasil também gera
        // assinatura Stripe e esse lead nunca escolheu idioma nenhum.
        const idiomaManage = getTelegramUser(`${bot.id}_${from.id}`)?.language;
        const tManage =
          idiomaManage === "en" || idiomaManage === "es"
            ? CHECKOUT_INTL_TEXTS[idiomaManage]
            : {
                subNotFound: "⚠️ Assinatura não encontrada.",
                portalFailed: "⚠️ Não consegui abrir o portal agora. Tente novamente em instantes.",
                managePortal: "⚙️ Gerencie sua assinatura (cancelar, ver cobranças):",
                openPortal: "Abrir portal 👉",
              };
        if (!sub || sub.telegramUserId !== from.id || !sub.stripeCustomerId) {
          await sendTelegramMessage(bot.botToken, chatId, tManage.subNotFound);
          return NextResponse.json({ ok: true });
        }
        const { getStripeCredentials } = await import("@/lib/settings");
        const { createBillingPortalSession } = await import("@/lib/payments/stripe");
        const creds = getStripeCredentials();
        const url = creds
          ? await createBillingPortalSession(creds, sub.stripeCustomerId, `${publicOrigin(req)}/checkout/stripe/obrigado`)
          : null;
        if (!url) {
          await sendTelegramMessage(bot.botToken, chatId, tManage.portalFailed);
          return NextResponse.json({ ok: true });
        }
        await sendTelegramMessage(bot.botToken, chatId, tManage.managePortal, {
          reply_markup: { inline_keyboard: [[{ text: tManage.openPortal, url, ...buttonStyleProps(bot, "managePortal") }]] },
        });
        return NextResponse.json({ ok: true });
      }

      const isPlanBuy = typeof data === "string" && data.startsWith("buy_plan_");
      // Oferta de um MAILING: mesmo fluxo do plano, mas com nome/preço/duração
      // ajustados só para aquele disparo (o plano original fica intacto).
      const isOfferBuy = typeof data === "string" && data.startsWith("buy_offer_");
      // Compra INTERNACIONAL (cartão, via Stripe) — MESMO plano do catálogo,
      // só que cobrado pelo priceUsdCents em vez do priceCents. Sem bump: o
      // botão do bump só é oferecido a partir de `buy_plan_` (isPlanBuy),
      // então um clique em `buy_intl_` nunca entra naquele fluxo.
      const isIntlBuy = typeof data === "string" && data.startsWith("buy_intl_");
      // Compra no CARTÃO, lead BRASILEIRO (Stripe, em BRL) — MESMO plano do
      // catálogo, MESMO preço em reais do PIX (`priceCents`), só o método de
      // pagamento muda. Nasce do botão extra "Prefere pagar no cartão?"
      // (`card_menu`, ver `enviarAberturaBrasil`).
      const isCardBrBuy = typeof data === "string" && data.startsWith("buy_card_");
      // Idioma gravado quando o lead escolheu no menu internacional (D.2).
      // Sem escolha registrada (ex.: link antigo), cai em inglês — era o
      // único idioma do fluxo intl antes do menu de idioma existir.
      const idiomaIntl: "en" | "es" = isIntlBuy
        ? getTelegramUser(`${bot.id}_${from.id}`)?.language === "es"
          ? "es"
          : "en"
        : "en";
      const tIntl = CHECKOUT_INTL_TEXTS[idiomaIntl];
      // MOEDA do lead internacional, pelo `language_code` que o Telegram
      // manda em todo update (o único sinal por pessoa que existe — ver
      // `moedaIntl.ts`). O VALOR é o mesmo número do preço em dólar; só a
      // moeda cobrada muda. Fora do fluxo internacional isto não é usado.
      const moedaIntl: MoedaIntl = isIntlBuy ? moedaPorIdioma(from.language_code) : "USD";

      // ---- Order Bump: a oferta que aparece entre escolher o plano e gerar
      // o PIX. `bump_yes_` / `bump_no_` carregam o mesmo par (plano, desconto)
      // do clique original, para o fluxo seguir de onde parou.
      const bumpAcao = typeof data === "string" && data.match(/^bump_(yes|no)_(.+)$/);
      let bumpAceito: TelegramPlan["bump"] | null = null;
      let dataEfetivo = data;
      if (bumpAcao) {
        const [, resposta, resto] = bumpAcao;
        dataEfetivo = `buy_plan_${resto}`;
        if (resposta === "yes") {
          const p = getPlan(resto.split("_")[0]);
          if (p?.bump?.enabled && p.bump.priceCents > 0) bumpAceito = p.bump;
        }
      }

      const isPlanBuyEfetivo = typeof dataEfetivo === "string" && dataEfetivo.startsWith("buy_plan_");

      if (isPlanBuyEfetivo || isOfferBuy || isIntlBuy || isCardBrBuy) {
        let planId = "";
        let offerId = "";
        let itemName = "";
        let basePriceCents = 0;
        let discountPercent = 0;

        if (isPlanBuyEfetivo) {
          const parts = dataEfetivo.replace("buy_plan_", "").split("_");
          planId = parts[0];
          discountPercent = parseInt(parts[1]) || 0;
          const plan = getPlan(planId);
          if (!plan) {
            await sendTelegramMessage(
              bot.botToken,
              String(message.chat.id),
              "⚠️ Plano não encontrado ou inativo."
            );
            return NextResponse.json({ ok: true });
          }
          itemName = plan.name;
          basePriceCents = plan.priceCents;
        } else if (isIntlBuy) {
          // Mesmo formato de callback do plano (`<id>[_<desconto>]`) — MESMO
          // catálogo, só que o preço vem de `priceUsdCents`.
          const parts = data.replace("buy_intl_", "").split("_");
          planId = parts[0];
          discountPercent = parseInt(parts[1]) || 0;
          const plan = getPlan(planId);
          // Confere de novo aqui (não só na hora de montar o menu): se a
          // modelo desligou o plano da venda internacional DEPOIS de o lead
          // já ter o botão na tela, um toque atrasado não pode completar a
          // compra mesmo assim.
          if (!plan || !((plan.priceUsdCents || 0) > 0) || plan.intlAvailable === false) {
            await sendTelegramMessage(bot.botToken, String(message.chat.id), tIntl.planNotFound);
            return NextResponse.json({ ok: true });
          }
          itemName = plan.name;
          basePriceCents = plan.priceUsdCents!;
          // (o número é o mesmo; quem muda é a moeda em `moedaIntl`)
        } else if (isCardBrBuy) {
          // Mesmo formato de callback (`<id>[_<desconto>]`), mesmo catálogo —
          // só o método de pagamento (cartão via Stripe, não PIX) e a moeda
          // (BRL, não USD) mudam em relação ao `isIntlBuy`.
          const parts = data.replace("buy_card_", "").split("_");
          planId = parts[0];
          discountPercent = parseInt(parts[1]) || 0;
          const plan = getPlan(planId);
          if (!plan) {
            await sendTelegramMessage(bot.botToken, String(message.chat.id), "⚠️ Plano não encontrado ou inativo.");
            return NextResponse.json({ ok: true });
          }
          itemName = plan.name;
          basePriceCents = plan.priceCents;
        } else {
          // Mesmo sufixo de desconto do plano (`_<percentual>`) — o Downsell de
          // PIX gerado manda esse botão quando o lead escolheu a oferta de um
          // mailing, não um plano do catálogo. UUID não tem "_", então o split
          // é seguro do mesmo jeito que já era para `buy_plan_`.
          const parts = data.replace("buy_offer_", "").split("_");
          offerId = parts[0];
          discountPercent = parseInt(parts[1]) || 0;
          const offer = getMailingOffer(offerId);
          if (!offer) {
            await sendTelegramMessage(
              bot.botToken,
              String(message.chat.id),
              "⚠️ Esta oferta não está mais disponível."
            );
            return NextResponse.json({ ok: true });
          }
          planId = offer.planId || "";
          itemName = offer.name;
          basePriceCents = offer.priceCents;
        }

        // Primeiro clique num plano COM bump: oferece, e para por aqui. O PIX
        // só é gerado depois da resposta — gerar antes criaria uma cobrança
        // que precisaria ser refeita se ele aceitasse.
        if (isPlanBuy && !bumpAcao && planId) {
          const plano = getPlan(planId);
          const b = plano?.bump;
          if (b?.enabled && b.priceCents > 0 && b.text.trim()) {
            const total = basePriceCents + b.priceCents;
            const money = (c: number) =>
              (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            const texto = b.text
              .replace(/{selected_plan_name}/gi, itemName)
              .replace(/{order_bump_name}/gi, b.name)
              .replace(/{order_bump_value}/gi, money(b.priceCents))
              .replace(/{total_value}/gi, money(total));

            // O sufixo do callback repete plano+desconto do clique original.
            const sufixo = `${planId}${discountPercent > 0 ? `_${discountPercent}` : ""}`;
            // Emoji automático, a menos que o operador já tenha posto um.
            const comEmoji = (t: string, e: string) => (/\p{Extended_Pictographic}/u.test(t) ? t : `${e} ${t}`);
            const markup = {
              inline_keyboard: [
                [
                  {
                    text: comEmoji(b.acceptText?.trim() || BUMP_DEFAULTS.accept, "✅"),
                    callback_data: `bump_yes_${sufixo}`,
                    ...buttonStyleProps(bot, "bumpAccept"),
                  },
                  {
                    text: comEmoji(b.declineText?.trim() || BUMP_DEFAULTS.decline, "❌"),
                    callback_data: `bump_no_${sufixo}`,
                    ...buttonStyleProps(bot, "bumpDecline"),
                  },
                ],
              ],
            };

            const midias = (b.mediaIds || [])
              .map((id) => getMediaRow(id))
              .filter((r): r is NonNullable<typeof r> => Boolean(r))
              .map((r) => r.path);

            if (midias.length > 1) {
              await sendTelegramMediaGroup(bot.botToken, String(message.chat.id), midias);
              await sendTelegramMessage(bot.botToken, String(message.chat.id), texto, { reply_markup: markup });
            } else if (midias.length === 1) {
              await sendTelegramMedia(bot.botToken, String(message.chat.id), midias[0], texto, {
                reply_markup: markup,
              });
            } else {
              await sendTelegramMessage(bot.botToken, String(message.chat.id), texto, { reply_markup: markup });
            }

            if (b.audioUrl?.trim()) {
              await sendTelegramVoiceUrl(bot.botToken, String(message.chat.id), b.audioUrl.trim());
            }
            return NextResponse.json({ ok: true });
          }
        }

        const provider = isIntlBuy || isCardBrBuy ? getProvider("stripe") : activeProvider();
        if (!provider) {
          await sendTelegramMessage(
            bot.botToken,
            String(message.chat.id),
            isIntlBuy
              ? tIntl.unavailable
              : "⚠️ O checkout temporariamente indisponível. Tente novamente mais tarde."
          );
          return NextResponse.json({ ok: true });
        }

        // Informa que a cobrança está sendo gerada — três textos, um por
        // método: PIX é PIX, cartão (mesmo brasileiro, `isCardBrBuy`) NUNCA
        // pode mostrar "Gerando cobrança PIX..." (bug visto e corrigido: o
        // cartão caía no texto do PIX por engano), e o intl usa o texto fixo
        // já traduzido no idioma que o lead escolheu.
        await sendTelegramMessage(
          bot.botToken,
          String(message.chat.id),
          isIntlBuy
            ? tIntl.generating
            : isCardBrBuy
              ? bot.checkoutGeneratingMessage?.trim() || CHECKOUT_DEFAULTS.generatingMessage
              : bot.pixGeneratingMessage?.trim() || PIX_DEFAULTS.generatingMessage,
        );

        let amountCents = basePriceCents;
        if (discountPercent > 0 && discountPercent <= 100) {
          amountCents = Math.floor(amountCents * (1 - discountPercent / 100));
        }
        // PREÇO DINÂMICO: centavos derivados do ID do Telegram. Determinístico,
        // então o mesmo lead sempre paga o mesmo valor — é isso que permite
        // casar um PIX recebido com quem devia pagá-lo. Aplicado DEPOIS do
        // desconto, senão o desconto percentual apagaria a variação.
        // O bump entra ANTES da variação de centavos: a variação é o último
        // ajuste, para o valor final continuar único por lead.
        if (bumpAceito) amountCents += bumpAceito.priceCents;
        // A Stripe casa o pagamento pelo `session.id` (providerRef), não pelo
        // VALOR — a variação de centavos existe só para o PIX, que não tem
        // outra forma de saber quem pagou.
        if (!isIntlBuy && !isCardBrBuy) amountCents = applyDynamicPrice(bot, amountCents, from.id);
        // Usa o token gerenciado (o mesmo mostrado na UI e aceito pelo webhook),
        // não o SESSION_SECRET — assim a confirmação autentica mesmo sem a env.
        // E usa a origem PÚBLICA: atrás de proxy/EasyPanel, req.nextUrl.origin
        // pode virar um host interno que a SyncPay não alcança — a cobrança é
        // criada, o cliente paga, mas a confirmação nunca chega e a venda some
        // do painel. Configure NEXT_PUBLIC_APP_URL (ou WEBHOOK_APP_URL) com o
        // domínio público para garantir isso em produção.
        // (A Stripe não usa isso — o webhook dela é cadastrado uma vez no
        // Dashboard, não por cobrança — mas não custa nada calcular também.)
        const postbackUrl = `${publicOrigin(req)}/w/${ensureSyncpayWebhookShortToken()}`;

        // RENOVAÇÃO AUTOMÁTICA: em qualquer cobrança no CARTÃO via Stripe
        // (internacional ou brasileira — decisão: "só o cartão vira
        // automático", o PIX/SyncPay nunca tem esse conceito), só plano de
        // assinatura (pacote/vitalício não fazem sentido cobrar de novo
        // sozinho), e só SEM desconto — a Stripe cobra o MESMO valor todo
        // ciclo, então um desconto "só desta compra" (funil de recuperação)
        // viraria desconto pra sempre se entrasse numa assinatura. Duração
        // que não mapeia num ciclo da Stripe (recurringFromDurationDays)
        // também cai pra avulso. `acceptCardRecurring` (default ligado) é o
        // interruptor manual: desligado, TODA cobrança no cartão vira
        // avulsa, mesmo quando os outros critérios dariam recorrente.
        const isStripeBuy = isIntlBuy || isCardBrBuy;
        const planStripe = isStripeBuy ? getPlan(planId) : null;
        const recurring =
          isStripeBuy &&
          bot.acceptCardRecurring !== false &&
          planStripe?.kind === "subscription" &&
          discountPercent === 0
            ? recurringFromDurationDays(planStripe.durationDays)
            : null;

        // Cria a cobrança — PIX na SyncPay, Checkout Session na Stripe
        // (avulsa ou assinatura, conforme `recurring`).
        const charge = await provider.createCharge({
          amountCents,
          // A Stripe (isIntlBuy/isCardBrBuy) precisa da moeda EXPLÍCITA —
          // sem ela o `createCharge` da Stripe cai pro padrão dele (USD), o
          // que cobraria em dólar um lead brasileiro. SyncPay/PIX ignora
          // este campo (sempre BRL), então `undefined` nunca importou até
          // agora — mas com o cartão no Brasil passando pela Stripe também,
          // precisa ser explícito.
          currency: isIntlBuy ? moedaIntl : isCardBrBuy ? "BRL" : undefined,
          description: `Assinatura ${itemName}`,
          recurring: recurring || undefined,
          postbackUrl,
          customer: {
            name: from.first_name + (from.last_name ? ` ${from.last_name}` : ""),
            email: "cliente@telegram.com",
          },
          // Rede de segurança do webhook da Stripe: se por algum motivo a
          // transação `pending` não for encontrada pelo `providerRef`, esses
          // dados ainda identificam o pedido (ver deliverPayment.ts).
          metadata: isStripeBuy ? { botId: bot.id, telegramUserId: String(from.id), planId } : undefined,
        });

        // Registra transação
        // Origem do tráfego: vem do lead (gravada no /start) e acompanha a
        // venda, para o funil saber qual link trouxe o dinheiro.
        const lead = getTelegramLead(`${bot.id}_${from.id}`);
        const tx = recordTransaction({
          provider: provider.key,
          providerRef: charge.providerRef,
          profileId: bot.profileId,
          botId: bot.id,
          // Só o NOME do produto. O prefixo "Assinatura Telegram - " repetia
          // em toda linha do Financeiro (e em toda notificação de venda) uma
          // informação que a coluna Bot e o provedor já dão, e ainda empurrava
          // o nome do plano para fora da largura da coluna. O sufixo entra
          // quando esta compra vira assinatura na Stripe (`recurring`) — é a
          // única diferença visível entre ela e uma venda avulsa igual.
          description: nomeDoProduto(itemName, Boolean(recurring)),
          customer: from.first_name,
          amountCents,
          currency: isIntlBuy ? moedaIntl : undefined,
          // PIX é PIX; cartão (internacional OU brasileiro) é sempre Stripe
          // aqui — mesmo critério de `isStripeBuy` usado nas linhas acima.
          method: isStripeBuy ? "card" : "pix",
          status: "pending",
          sourceCode: lead?.sourceCode,
          origin: "bot",
        });

        // Alerta de cobrança GERADA pelo bot de vendas (lead pediu o pagamento).
        try {
          const { sendPushEvent } = await import("@/lib/push");
          const valStr = formatarMoeda(amountCents, isIntlBuy ? moedaIntl : "BRL");
          await sendPushEvent(
            "pix",
            `⏳ ${isIntlBuy ? "Cobrança internacional gerada" : isCardBrBuy ? "Cobrança no cartão gerada" : "Pix gerado"} — ${valStr}`,
            `${itemName} · ${from.first_name} (bot de vendas)`,
            "/dashboard/payments",
          );
        } catch (pErr) {
          console.error("Erro ao enviar push de cobrança gerada:", pErr);
        }

        // Registra inscrição pendente (guarda planId/offerId p/ resolver
        // duração e entregável na confirmação do pagamento).
        const subId = randomUUID();
        saveSubscription({
          id: subId,
          botId: bot.id,
          transactionId: tx.id,
          planId: planId || undefined,
          offerId: offerId || undefined,
          telegramUserId: from.id,
          telegramUsername: from.username || undefined,
          status: "pending",
          expiresAt: 0,
          lastUpsellAt: undefined,
          upsellStepIndex: 0,
          createdAt: Date.now(),
          // Guardado para os botões "Mostrar QR Code" e "Copiar Chave Pix"
          // funcionarem depois, sem precisar gerar uma cobrança nova.
          pixCode: charge.pixCode || undefined,
          bumpCents: bumpAceito?.priceCents || 0,
        });

        // ---- Checkout no cartão (Stripe): link, não PIX — internacional OU
        // cartão no Brasil. Sem código copia-e-cola nem QR — não existem pra
        // Stripe. O "Verificar status"/"Check payment status" reaproveita o
        // MESMO handler `pix_check_`: ele já é agnóstico de provedor, só
        // olha `sub.status`.
        if (isStripeBuy) {
          if (!charge.checkoutUrl) {
            await sendTelegramMessage(
              bot.botToken,
              String(message.chat.id),
              isIntlBuy ? tIntl.linkFailed : "⚠️ Não consegui gerar o link de pagamento. Tente novamente em instantes.",
            );
            return NextResponse.json({ ok: true });
          }
          // Texto do botão: configurável (PT direto, EN/ES gravados — mesmo
          // padrão de `successButtonTextEn/Es`), com o fixo de sempre como
          // fallback. `checkoutShowCheckButton` desligado tira a segunda
          // linha inteira, ficando só o link de pagamento.
          const payButtonText =
            (isIntlBuy
              ? idiomaIntl === "es"
                ? bot.checkoutPayButtonTextEs
                : bot.checkoutPayButtonTextEn
              : bot.checkoutPayButtonText
            )?.trim() || (isIntlBuy ? tIntl.makePayment : CHECKOUT_DEFAULTS.payButton);
          const checkButtonText =
            (isIntlBuy
              ? idiomaIntl === "es"
                ? bot.checkoutCheckButtonTextEs
                : bot.checkoutCheckButtonTextEn
              : bot.checkoutCheckButtonText
            )?.trim() || (isIntlBuy ? tIntl.checkStatus : CHECKOUT_DEFAULTS.checkButton);
          const inlineKeyboard: any[] = [
            [{ text: payButtonText, url: charge.checkoutUrl, ...buttonStyleProps(bot, "checkoutPay") }],
          ];
          if (bot.checkoutShowCheckButton !== false) {
            inlineKeyboard.push([
              { text: checkButtonText, callback_data: `pix_check_${subId}`, ...buttonStyleProps(bot, "pixCheck") },
            ]);
          }
          await sendTelegramMessage(
            bot.botToken,
            String(message.chat.id),
            isIntlBuy ? tIntl.finishPayment : "Finalize o pagamento pelo link abaixo.",
            {
              reply_markup: { inline_keyboard: inlineKeyboard },
              ...efeitoProps(bot.effectPix),
            },
          );
          return NextResponse.json({ ok: true });
        }

        // Envia o PIX: QR Code (imagem) + código copia-e-cola na legenda. Se a
        // geração do QR falhar por algum motivo, cai para só o texto.
        const pixCode = charge.pixCode || "";
        // Legenda configurável (aba Tela de pagamento). {pix_code} é o único
        // marcador que não pode faltar — sem ele o cliente não tem o que copiar,
        // então, se o operador o apagar, o código é acrescentado no fim.
        const valorStr = (amountCents / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        });
        let pixCaption = (bot.pixCaption?.trim() || PIX_DEFAULTS.caption)
          .replace(/{plano}/gi, itemName)
          .replace(/{valor}/gi, valorStr);
        if (/{pix_code}/i.test(pixCaption)) {
          pixCaption = pixCaption.replace(/{pix_code}/gi, `<code>${pixCode}</code>`);
        } else {
          pixCaption += `\n\n<code>${pixCode}</code>`;
        }

        // A tela do PIX vai como TEXTO, não como legenda de foto.
        //
        // A diferença é prática: o Telegram só faz "toque para copiar" no
        // conteúdo de um <code>, e legenda de foto tem limite de 1024
        // caracteres — o copia-e-cola do PIX sozinho já passa de 200, e com o
        // texto da oferta o corte vinha em cima justamente do código. O QR
        // continua disponível, mas atrás de um botão, que é o que também
        // deixa a mensagem curta o suficiente para o código aparecer inteiro
        // sem rolagem.
        const btn = (t: string | undefined, padrao: string) => (t?.trim() || padrao);
        await sendTelegramMessage(bot.botToken, String(message.chat.id), pixCaption, {
          reply_markup: {
            inline_keyboard: [
              [{ text: btn(bot.pixBtnCheck, PIX_DEFAULTS.btnCheck), callback_data: `pix_check_${subId}`, ...buttonStyleProps(bot, "pixCheck") }],
              [{ text: btn(bot.pixBtnQr, PIX_DEFAULTS.btnQr), callback_data: `pix_qr_${subId}`, ...buttonStyleProps(bot, "pixQr") }],
              // COPIAR: botão nativo do Telegram — o toque copia o código na
              // hora, sem o bot ter de responder com o <code> e sem o cliente
              // ter de tocar duas vezes. Código longo demais para o botão cai
              // sozinho no caminho antigo (callback).
              [botaoCopiar(btn(bot.pixBtnCopy, PIX_DEFAULTS.btnCopy), pixCode, `pix_copy_${subId}`, buttonStyleProps(bot, "pixCopy"))],
            ],
          },
          // O PIX é o momento de tensão da conversa: o efeito marca a chegada
          // da cobrança em vez de ela passar como mais uma mensagem.
          ...efeitoProps(bot.effectPix),
        });

        // Áudio opcional, DEPOIS do PIX: o código copia-e-cola é o que o
        // cliente veio buscar e não pode ficar atrás de um áudio. Best-effort
        // por dentro — uma URL fora do ar não derruba a cobrança.
        if (bot.pixAudioUrl?.trim()) {
          await sendTelegramVoiceUrl(bot.botToken, String(message.chat.id), bot.pixAudioUrl.trim());
        }
      }
    }

    // ---- Solicitação de entrada nos grupos (Aprovação Automática) ----
    if (update.chat_join_request) {
      const { chat, from } = update.chat_join_request;
      const chatId = String(chat.id);

      // Quem pede entrada entra na lista de usuários mesmo que seja recusado —
      // é um contato conhecido da operação.
      if (chatId === bot.idVip || chatId === bot.idAquecimento) {
        upsertTelegramUser({
          botId: bot.id,
          profileId: bot.profileId,
          telegramUserId: from.id,
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name,
          source: chatId === bot.idVip ? "vip" : "previas",
        });
      }

      // A regra de cada grupo agora vem da configuração (aba Aprovação
      // Automática). Os padrões — VIP "subscribers", Prévias "all" —
      // reproduzem o que antes estava fixo aqui.
      const isVip = chatId === bot.idVip;
      const isPrevias = chatId === bot.idAquecimento;
      if (isVip || isPrevias) {
        const mode = isVip ? bot.vipApprovalMode : bot.previasApprovalMode;

        // "manual": o bot não decide nada — o pedido continua na fila do
        // Telegram para um admin resolver. Note que NÃO é o mesmo que recusar.
        if (mode !== "manual") {
          let aprovar = mode === "all";
          if (mode === "subscribers") {
            const activeSub = findActiveSubscription(bot.id, from.id);
            if (activeSub) {
              aprovar = true;
              if (from.username && activeSub.telegramUsername !== from.username) {
                activeSub.telegramUsername = from.username;
                saveSubscription(activeSub);
              }
            }
          }
          if (aprovar) {
            await approveTelegramJoinRequest(bot.botToken, chatId, from.id);
          } else {
            await declineTelegramJoinRequest(bot.botToken, chatId, from.id);
          }

          // Boas-vindas de quem realmente entrou.
          //
          // A SEQUÊNCIA (vários passos, com atraso próprio) é só enfileirada:
          // o Telegram espera uma resposta rápida deste webhook, e um passo
          // marcado para "1h depois" não pode ser aguardado aqui. Quem entrega
          // é o tick de 1 minuto.
          //
          // Sem sequência configurada, cai na mensagem única de sempre — então
          // quem não mexer na tela não vê diferença.
          if (aprovar) {
            const grupo = isVip ? "vip" : "previas";
            const sequencia = isVip ? bot.vipWelcomeFunnel : bot.previasWelcomeFunnel;
            let temSequencia = false;
            try {
              const v = sequencia ? JSON.parse(sequencia) : [];
              temSequencia = Array.isArray(v) && v.length > 0;
            } catch {
              /* JSON quebrado = sem sequência */
            }

            // "Usar a mensagem de boas-vindas" também precisa da fila: ela
            // é entregue como passo zero pelo tick. Sem esta condição, ligar a
            // chave e não escrever nenhum passo próprio resultava em NADA
            // enviado — o lead era aprovado e recebia silêncio.
            const usaBoasVindas = isVip ? bot.vipUseWelcome : bot.previasUseWelcome;

            if (temSequencia || usaBoasVindas) {
              enqueueApproval({
                botId: bot.id,
                telegramUserId: from.id,
                grupo,
                // O privado do lead: é para lá que as boas-vindas vão, não
                // para o grupo.
                chatId: String(from.id),
                approvedAt: Date.now(),
              });
            } else if (isPrevias && bot.previewsWelcomeMessage?.trim()) {
              const msg = aplicarVariaveis(bot.previewsWelcomeMessage, {
                firstName: from.first_name,
                lastName: from.last_name,
                username: from.username,
                profileName: nomeDaModelo(bot.profileId),
                botUsername: bot.botUsername,
              });
              await sendTelegramMessage(bot.botToken, String(from.id), msg).catch(() => {});
            }
          }
        }
      }
    }

    // ---- Entrada/saída confirmada nos grupos (chat_member) ----
    // É o evento completo: cobre quem entrou por link direto, foi adicionado
    // por um admin ou saiu por conta própria — casos que a mensagem de serviço
    // nem sempre traz.
    if (update.chat_member) {
      const { chat, new_chat_member: member } = update.chat_member;
      const chatId = String(chat?.id);
      const group = chatId === bot.idVip ? "vip" : chatId === bot.idAquecimento ? "previas" : null;
      const user = member?.user;
      if (group && user && !user.is_bot) {
        const isMember = ["member", "administrator", "creator", "restricted"].includes(member.status);
        registraMudancaDeGrupo(bot, user.id, group, isMember);
        upsertTelegramUser({
          botId: bot.id,
          profileId: bot.profileId,
          telegramUserId: user.id,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          inVip: group === "vip" ? isMember : undefined,
          inPrevias: group === "previas" ? isMember : undefined,
          source: group,
        });
      }
    }

    // ---- Bloqueio/desbloqueio do bot (my_chat_member no privado) ----
    // "kicked" no chat privado é o Telegram dizendo que a pessoa bloqueou o
    // bot: ela sai dos disparos e volta sozinha se desbloquear.
    if (update.my_chat_member && update.my_chat_member.chat?.type === "private") {
      const status = update.my_chat_member.new_chat_member?.status;
      const user = update.my_chat_member.from;
      if (user && (status === "kicked" || status === "member")) {
        setTelegramUserBlocked(bot.id, user.id, status === "kicked");
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram Webhook Error:", err);
    return NextResponse.json({ ok: true }); // Sempre retorna 200 para evitar loops do Telegram
  }
}
