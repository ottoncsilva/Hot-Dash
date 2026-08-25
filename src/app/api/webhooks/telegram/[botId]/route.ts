import { NextRequest, NextResponse } from "next/server";
import type { TelegramPlan } from "@/lib/telegramDb";
import { getBotConfig, listActivePlans, listCustomButtons, saveSubscription, getSubscription, getPlan, findActiveSubscription, upsertTelegramLead, getTelegramLead, recordSeenChat, countActiveSubscriptions, enqueueApproval, buildAccessMessage, BUMP_DEFAULTS, PIX_DEFAULTS } from "@/lib/telegramDb";
import { upsertTelegramUser, setTelegramUserBlocked, setTelegramUserGroup, getTelegramUser } from "@/lib/telegramUsers";
import { recordGroupMembershipChange } from "@/lib/telegramMonitor";
import { getMailingOffer } from "@/lib/telegramMailing";
import { sendTelegramMessage, sendTelegramMedia, sendTelegramMediaGroup, sendTelegramVoiceUrl, sendTelegramPhotoBuffer, approveTelegramJoinRequest, declineTelegramJoinRequest, telegramWebhookSecret } from "@/lib/telegramApi";
import QRCode from "qrcode";
import { listMedia, getMediaRow } from "@/lib/media";
import { activeProvider } from "@/lib/payments";
import { recordTransaction, overview } from "@/lib/transactions";
import { ensureSyncpayWebhookShortToken, applyDynamicPrice, buttonStyleProps, planButtonStyleProps } from "@/lib/settings";
import { publicOrigin } from "@/lib/publicOrigin";
import { botaoCopiar, efeitoProps } from "@/lib/telegramEffects";
import { enviarMensagemDoBot } from "@/lib/telegramSend";
import { aplicarVariaveis } from "@/lib/telegramVars";
import { getDb } from "@/lib/db";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
          plans.forEach((plan) => {
            const priceStr = (plan.priceCents / 100).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            });
            inlineKeyboard.push([
              {
                text: `${plan.name} - ${priceStr}`,
                callback_data: `buy_plan_${plan.id}`,
                // A cor do PLANO vence a global — é o que destaca a oferta
                // principal no meio das outras.
                ...planButtonStyleProps(bot, plan.highlight),
              },
            ]);
          });
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
      }
    }

    // ---- Clique nos botões de compra (Callback Query) ----
    if (update.callback_query) {
      const { id, data, from, message } = update.callback_query;

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

      const isPlanBuy = typeof data === "string" && data.startsWith("buy_plan_");
      // Oferta de um MAILING: mesmo fluxo do plano, mas com nome/preço/duração
      // ajustados só para aquele disparo (o plano original fica intacto).
      const isOfferBuy = typeof data === "string" && data.startsWith("buy_offer_");

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

      if (isPlanBuyEfetivo || isOfferBuy) {
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

        const provider = activeProvider();
        if (!provider) {
          await sendTelegramMessage(
            bot.botToken,
            String(message.chat.id),
            "⚠️ O checkout temporariamente indisponível. Tente novamente mais tarde."
          );
          return NextResponse.json({ ok: true });
        }

        // Informa que a cobrança está sendo gerada (texto configurável).
        await sendTelegramMessage(
          bot.botToken,
          String(message.chat.id),
          bot.pixGeneratingMessage?.trim() || PIX_DEFAULTS.generatingMessage,
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
        amountCents = applyDynamicPrice(bot, amountCents, from.id);
        // Usa o token gerenciado (o mesmo mostrado na UI e aceito pelo webhook),
        // não o SESSION_SECRET — assim a confirmação autentica mesmo sem a env.
        // E usa a origem PÚBLICA: atrás de proxy/EasyPanel, req.nextUrl.origin
        // pode virar um host interno que a SyncPay não alcança — a cobrança é
        // criada, o cliente paga, mas a confirmação nunca chega e a venda some
        // do painel. Configure NEXT_PUBLIC_APP_URL (ou WEBHOOK_APP_URL) com o
        // domínio público para garantir isso em produção.
        const postbackUrl = `${publicOrigin(req)}/w/${ensureSyncpayWebhookShortToken()}`;

        // Cria cobrança PIX no SyncPay
        const charge = await provider.createCharge({
          amountCents,
          description: `Assinatura ${itemName}`,
          postbackUrl,
          customer: {
            name: from.first_name + (from.last_name ? ` ${from.last_name}` : ""),
            email: "cliente@telegram.com",
          },
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
          status: "pending",
          sourceCode: lead?.sourceCode,
          origin: "bot",
        });

        // Alerta de PIX GERADO pelo bot de vendas (lead pediu o pagamento).
        try {
          const { sendPushEvent } = await import("@/lib/push");
          const valStr = (amountCents / 100).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          });
          await sendPushEvent(
            "pix",
            `⏳ Pix gerado — ${valStr}`,
            `${itemName} · ${from.first_name} (bot de vendas)`,
            "/dashboard/payments",
          );
        } catch (pErr) {
          console.error("Erro ao enviar push de Pix gerado:", pErr);
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

        // PROVA SOCIAL com números REAIS desta modelo. Se o número do dia for
        // zero, a linha inteira é omitida — dizer "0 pessoas garantiram hoje"
        // seria pior que não dizer nada, e inventar um número seria enganar o
        // cliente que está prestes a pagar.
        if (bot.pixSocialProof) {
          const hoje = overview(bot.profileId).today.paidCount;
          const assinantes = countActiveSubscriptions(bot.id);
          if (hoje > 0 || assinantes > 0) {
            const linha = (bot.pixSocialProofText?.trim() || PIX_DEFAULTS.socialProofText)
              .replace(/{vendas_hoje}/gi, String(hoje))
              .replace(/{assinantes}/gi, String(assinantes));
            pixCaption = `${linha}\n\n${pixCaption}`;
          }
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
