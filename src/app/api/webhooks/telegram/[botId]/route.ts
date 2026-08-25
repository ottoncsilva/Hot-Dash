import { NextRequest, NextResponse } from "next/server";
import type { TelegramPlan } from "@/lib/telegramDb";
import { getBotConfig, listActivePlans, listCustomButtons, saveSubscription, getSubscription, getPlan, findActiveSubscription, upsertTelegramLead, getTelegramLead, recordSeenChat, countActiveSubscriptions, enqueueApproval, buildAccessMessage, buildPlanKeyboardRows, recurringFromDurationDays, BUMP_DEFAULTS, PIX_DEFAULTS } from "@/lib/telegramDb";
import { upsertTelegramUser, setTelegramUserBlocked, setTelegramUserGroup, getTelegramUser, setTelegramUserLanguage } from "@/lib/telegramUsers";
import { recordGroupMembershipChange } from "@/lib/telegramMonitor";
import { getMailingOffer } from "@/lib/telegramMailing";
import { sendTelegramMessage, sendTelegramMedia, sendTelegramMediaGroup, sendTelegramVoiceUrl, sendTelegramPhotoBuffer, approveTelegramJoinRequest, declineTelegramJoinRequest, telegramWebhookSecret } from "@/lib/telegramApi";
import QRCode from "qrcode";
import { listMedia, getMediaRow } from "@/lib/media";
import { activeProvider, getProvider } from "@/lib/payments";
import { recordTransaction, overview } from "@/lib/transactions";
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

/** Nome da modelo, para a variável {modelo}. */
function nomeDaModelo(profileId: string): string {
  const row = getDb().prepare("SELECT name FROM profiles WHERE id = ?").get(profileId) as
    | { name: string }
    | undefined;
  return row?.name || "";
}

/**
 * Contabiliza a entrada/saída de um grupo para o gráfico de crescimento.
 *
 * Conta a TRANSIÇÃO, não o evento: o Telegram manda a mesma entrada por dois
 * caminhos (a mensagem de serviço `new_chat_members` e o update `chat_member`),
 * e contar os dois dobraria o número. Comparando com o estado que já está
 * guardado, o segundo aviso não muda nada e por isso não conta de novo.
 *
 * Precisa rodar ANTES do upsert que grava o novo estado — depois dele os dois
 * valores já seriam iguais e nenhuma transição seria detectada.
 */
function registraMudancaDeGrupo(
  bot: { id: string; profileId: string },
  telegramUserId: number,
  kind: "vip" | "previas",
  entrou: boolean,
): void {
  const atual = getTelegramUser(`${bot.id}_${telegramUserId}`);
  const estavaDentro = kind === "vip" ? atual?.inVip === true : atual?.inPrevias === true;
  if (estavaDentro === entrou) return; // nada mudou: aviso repetido
  recordGroupMembershipChange(bot.id, bot.profileId, kind, entrou);
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

    // Operação desligada → o bot de vendas não age (quem opera o bot segue no
    // controle). Retorna 200 para o Telegram não reenviar em loop.
    if (!bot.operationActive) {
      return NextResponse.json({ ok: true, inactive: true });
    }

    // Segurança: o Telegram devolve o secret_token que registramos no header
    // abaixo. Se o webhook foi registrado com secret (padrão nas versões novas),
    // exigimos que bata. Webhooks antigos (sem secret) continuam aceitos.
    const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (providedSecret && providedSecret !== telegramWebhookSecret(bot.id)) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const update = await req.json().catch(() => ({}));

    // Anota TODO grupo/canal que aparecer, venha por onde vier. É a única
    // forma de o painel saber em que grupos o bot está: a API do Telegram não
    // deixa um bot listar os próprios chats. É o que alimenta o "Detectar".
    for (const c of [
      update.message?.chat,
      update.channel_post?.chat,
      update.my_chat_member?.chat,
      update.chat_member?.chat,
      update.chat_join_request?.chat,
    ]) {
      if (c) recordSeenChat(bot.id, c);
    }

    // ---- Mensagem comum (Ex: /start) ----
    if (update.message) {
      const { chat, text, from } = update.message;
      const isStart = typeof text === "string" && text.startsWith("/start");

      // Qualquer mensagem no PRIVADO confirma que o bot pode falar com a
      // pessoa — é o que a habilita a receber mailing. Nos GRUPOS, a mensagem
      // serve para reconhecer quem já era membro antes de o painel existir
      // (o Telegram não deixa um bot listar os membros de um grupo).
      if (from && !from.is_bot) {
        const isPrivate = chat?.type === "private";
        const inVipGroup = String(chat?.id) === bot.idVip;
        const inPreviasGroup = String(chat?.id) === bot.idAquecimento;
        if (isPrivate || inVipGroup || inPreviasGroup) {
          upsertTelegramUser({
            botId: bot.id,
            profileId: bot.profileId,
            telegramUserId: from.id,
            username: from.username,
            firstName: from.first_name,
            lastName: from.last_name,
            chatId: isPrivate ? String(chat.id) : undefined,
            canDm: isPrivate,
            inVip: inVipGroup ? true : undefined,
            inPrevias: inPreviasGroup ? true : undefined,
            source: isPrivate ? "start" : "grupo",
          });
        }
      }

      // Entradas e saídas dos grupos chegam como mensagem de serviço.
      const joinedGroup =
        String(chat?.id) === bot.idVip ? "vip" : String(chat?.id) === bot.idAquecimento ? "previas" : null;
      if (joinedGroup && Array.isArray(update.message.new_chat_members)) {
        for (const member of update.message.new_chat_members) {
          if (member?.is_bot) continue;
          registraMudancaDeGrupo(bot, member.id, joinedGroup, true);
          upsertTelegramUser({
            botId: bot.id,
            profileId: bot.profileId,
            telegramUserId: member.id,
            username: member.username,
            firstName: member.first_name,
            lastName: member.last_name,
            inVip: joinedGroup === "vip" ? true : undefined,
            inPrevias: joinedGroup === "previas" ? true : undefined,
            source: joinedGroup === "vip" ? "vip" : "previas",
          });
        }
      }
      if (joinedGroup && update.message.left_chat_member && !update.message.left_chat_member.is_bot) {
        registraMudancaDeGrupo(bot, update.message.left_chat_member.id, joinedGroup, false);
        setTelegramUserGroup(bot.id, update.message.left_chat_member.id, joinedGroup, false);
      }

      if (isStart && from) {
        // Deep-link de divulgação: t.me/<bot>?start=CODIGO chega como
        // "/start CODIGO". É o que liga a venda à origem do tráfego.
        const sourceCode = (text.slice("/start".length).trim().split(/\s+/)[0] || "")
          .replace(/[^\w-]/g, "")
          .slice(0, 40);
        upsertTelegramLead({
          id: `${bot.id}_${from.id}`,
          profileId: bot.profileId,
          chatId: String(chat.id),
          lastInteractionAt: Date.now(),
          downsellStepIndex: 0,
          createdAt: Date.now(),
          // Reinicia o funil de Downsell geral A CADA /start: se o lead
          // sumiu e voltou dias depois, ele entra de novo do zero — não
          // encontra o funil na metade (ou já acabado) por causa da PRIMEIRA
          // vez que ele deu /start. `createdAt` acima não muda de verdade
          // pra quem já existe (upsertTelegramLead preserva o primeiro
          // /start pras métricas do Funil de Vendas); só este campo conta
          // pro Downsell.
          downsellStartedAt: Date.now(),
          sourceCode: sourceCode || undefined,
        });
        // O mesmo código de origem também fica no usuário, para a lista mostrar
        // por qual link cada pessoa chegou.
        if (sourceCode) {
          upsertTelegramUser({
            botId: bot.id,
            profileId: bot.profileId,
            telegramUserId: from.id,
            username: from.username,
            firstName: from.first_name,
            lastName: from.last_name,
            chatId: String(chat.id),
            canDm: true,
            source: "start",
            sourceCode,
          });
        }

        // Só os ATIVOS: um plano desligado some dos botões mas continua no
        // painel, com o histórico de vendas.
        const plans = listActivePlans(bot.id);
        const customButtons = listCustomButtons(bot.id);

        const inlineKeyboard: any[] = [];

        // Botões de Planos
        if (plans.length > 0) {
          inlineKeyboard.push(...buildPlanKeyboardRows(bot, plans, { moeda: "BRL", prefix: "buy_plan_" }));
        }

        // "Not from Brazil?" — precisa das TRÊS coisas: o interruptor geral
        // ligado (Configurações → Planos), ao menos um plano com preço em
        // USD cadastrado, e esse plano estar disponível pra outras moedas
        // (interruptor por plano — ver PlansCard). Abre o menu internacional
        // (checkout Stripe) numa mensagem NOVA, não editada.
        if (bot.intlEnabled && plans.some((p) => (p.priceUsdCents || 0) > 0 && p.intlAvailable !== false)) {
          inlineKeyboard.push([
            { text: "🌎 Not from Brazil?", callback_data: "intl_menu", ...buttonStyleProps(bot, "redirect") },
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
          inlineKeyboard.push([{ text: "💬 Suporte / Dúvidas", url: supportUrl, ...buttonStyleProps(bot, "redirect") }]);
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

        // PROVA SOCIAL, logo abaixo dos planos — pesa na hora de decidir, não
        // depois que o lead já escolheu (por isso saiu da tela do PIX, onde
        // morava antes). Números REAIS desta modelo, nunca inventados: se o
        // dia ainda estiver zerado, a mensagem simplesmente não sai — dizer
        // "0 pessoas hoje" seria pior que não dizer nada.
        if (bot.pixSocialProof && plans.length > 0) {
          const hoje = overview(bot.profileId).today.paidCount;
          const assinantes = countActiveSubscriptions(bot.id);
          if (hoje > 0 || assinantes > 0) {
            const linha = (bot.pixSocialProofText?.trim() || PIX_DEFAULTS.socialProofText)
              .replace(/{vendas_hoje}/gi, String(hoje))
              .replace(/{assinantes}/gi, String(assinantes));
            await sendTelegramMessage(bot.botToken, String(chat.id), linha);
          }
        }
      }
    }

    // ---- Clique nos botões de compra (Callback Query) ----
    if (update.callback_query) {
      const { id, data, from, message } = update.callback_query;

      // ---- "Not from Brazil?" — menu internacional (checkout Stripe) ----
      // Primeiro pergunta o IDIOMA (mensagem NOVA, mesmo padrão do bump) —
      // só depois mostra os planos em USD, já no idioma escolhido. O botão
      // nem aparece no /start sem plano com priceUsdCents cadastrado.
      if (data === "intl_menu") {
        await sendTelegramMessage(
          bot.botToken,
          String(message.chat.id),
          "🌎 Choose your language / Elige tu idioma:",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🇬🇧 English", callback_data: "lang_en" },
                  { text: "🇪🇸 Español", callback_data: "lang_es" },
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
        const plans = listActivePlans(bot.id);
        const rows = buildPlanKeyboardRows(bot, plans, { moeda: "USD", prefix: "buy_intl_" });
        if (rows.length === 0) {
          await sendTelegramMessage(bot.botToken, String(message.chat.id), t.noPlan);
        } else {
          await sendTelegramMessage(bot.botToken, String(message.chat.id), t.choosePlan, {
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
        // Só existe pra assinatura Stripe (nunca PIX) — sempre EN/ES.
        const tManage = CHECKOUT_INTL_TEXTS[getTelegramUser(`${bot.id}_${from.id}`)?.language || "en"];
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
          reply_markup: { inline_keyboard: [[{ text: tManage.openPortal, url }]] },
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
      // Idioma gravado quando o lead escolheu no menu internacional (D.2).
      // Sem escolha registrada (ex.: link antigo), cai em inglês — era o
      // único idioma do fluxo intl antes do menu de idioma existir.
      const tIntl = CHECKOUT_INTL_TEXTS[
        isIntlBuy ? getTelegramUser(`${bot.id}_${from.id}`)?.language || "en" : "en"
      ];

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

      if (isPlanBuyEfetivo || isOfferBuy || isIntlBuy) {
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

        const provider = isIntlBuy ? getProvider("stripe") : activeProvider();
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

        // Informa que a cobrança está sendo gerada (texto configurável — só
        // faz sentido em PT para o PIX; o intl usa um dos textos fixos D.3,
        // no idioma que o lead escolheu no menu internacional).
        await sendTelegramMessage(
          bot.botToken,
          String(message.chat.id),
          isIntlBuy ? tIntl.generating : (bot.pixGeneratingMessage?.trim() || PIX_DEFAULTS.generatingMessage),
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
        if (!isIntlBuy) amountCents = applyDynamicPrice(bot, amountCents, from.id);
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

        // RENOVAÇÃO AUTOMÁTICA: só no checkout internacional, só plano de
        // assinatura (pacote/vitalício não fazem sentido cobrar de novo
        // sozinho), e só SEM desconto — a Stripe cobra o MESMO valor todo
        // ciclo, então um desconto "só desta compra" (funil de recuperação)
        // viraria desconto pra sempre se entrasse numa assinatura. Duração
        // que não mapeia num ciclo da Stripe (recurringFromDurationDays)
        // também cai pra avulso — nenhum desses casos precisa de ação da
        // modelo, o fallback é automático.
        const planIntl = isIntlBuy ? getPlan(planId) : null;
        const recurring =
          isIntlBuy && planIntl?.kind === "subscription" && discountPercent === 0
            ? recurringFromDurationDays(planIntl.durationDays)
            : null;

        // Cria a cobrança — PIX na SyncPay, Checkout Session na Stripe
        // (avulsa ou assinatura, conforme `recurring`).
        const charge = await provider.createCharge({
          amountCents,
          currency: isIntlBuy ? "USD" : undefined,
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
          metadata: isIntlBuy ? { botId: bot.id, telegramUserId: String(from.id), planId } : undefined,
        });

        // Registra transação
        // Origem do tráfego: vem do lead (gravada no /start) e acompanha a
        // venda, para o funil saber qual link trouxe o dinheiro.
        const lead = getTelegramLead(`${bot.id}_${from.id}`);
        const tx = recordTransaction({
          provider: provider.key,
          providerRef: charge.providerRef,
          profileId: bot.profileId,
          description: `Assinatura Telegram - ${itemName}`,
          customer: from.first_name,
          amountCents,
          currency: isIntlBuy ? "USD" : undefined,
          status: "pending",
          sourceCode: lead?.sourceCode,
          origin: "bot",
        });

        // Alerta de cobrança GERADA pelo bot de vendas (lead pediu o pagamento).
        try {
          const { sendPushEvent } = await import("@/lib/push");
          const valStr = isIntlBuy
            ? (amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
            : (amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          await sendPushEvent(
            "pix",
            `⏳ ${isIntlBuy ? "Cobrança internacional gerada" : "Pix gerado"} — ${valStr}`,
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

        // ---- Checkout internacional (Stripe): link, não PIX ----
        // Sem código copia-e-cola nem QR — não existem pra Stripe. O "Check
        // payment status" reaproveita o MESMO handler `pix_check_`: ele já é
        // agnóstico de provedor, só olha `sub.status`.
        if (isIntlBuy) {
          if (!charge.checkoutUrl) {
            await sendTelegramMessage(bot.botToken, String(message.chat.id), tIntl.linkFailed);
            return NextResponse.json({ ok: true });
          }
          await sendTelegramMessage(
            bot.botToken,
            String(message.chat.id),
            tIntl.finishPayment,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: tIntl.makePayment, url: charge.checkoutUrl }],
                  [{ text: tIntl.checkStatus, callback_data: `pix_check_${subId}`, ...buttonStyleProps(bot, "pixCheck") }],
                ],
              },
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
