import { NextRequest, NextResponse } from "next/server";
import { getBotConfig, listPlans, listCustomButtons, saveSubscription, getPlan, findActiveSubscription, upsertTelegramLead, getTelegramLead } from "@/lib/telegramDb";
import { upsertTelegramUser, setTelegramUserBlocked, setTelegramUserGroup } from "@/lib/telegramUsers";
import { getMailingOffer } from "@/lib/telegramMailing";
import { sendTelegramMessage, sendTelegramMedia, sendTelegramPhotoBuffer, approveTelegramJoinRequest, declineTelegramJoinRequest, telegramWebhookSecret } from "@/lib/telegramApi";
import QRCode from "qrcode";
import { listMedia, getMediaRow } from "@/lib/media";
import { activeProvider } from "@/lib/payments";
import { recordTransaction } from "@/lib/transactions";
import { ensureSyncpayWebhookShortToken } from "@/lib/settings";
import { publicOrigin } from "@/lib/publicOrigin";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

        const plans = listPlans(bot.id);
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
              },
            ]);
          });
        }

        // Botões Personalizados
        if (customButtons.length > 0) {
          customButtons.forEach((btn) => {
            inlineKeyboard.push([{ text: btn.text, url: btn.url }]);
          });
        }

        // Se houver suporte cadastrado, adiciona o botão
        if (bot.supportUsername) {
          const supportUrl = bot.supportUsername.startsWith("http")
            ? bot.supportUsername
            : `https://t.me/${bot.supportUsername.replace("@", "")}`;
          inlineKeyboard.push([{ text: "💬 Suporte / Dúvidas", url: supportUrl }]);
        }

        const replyMarkup = inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;

        // Personaliza a mensagem substituindo o placeholder do nome
        const welcomeText = bot.welcomeMessage.replace(/{nome}/gi, from.first_name || "linda(o)");

        let sentWithMedia = false;
        if (bot.welcomeMediaTags) {
          const tagsArray = bot.welcomeMediaTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
          if (tagsArray.length > 0) {
            const allMedia = listMedia(bot.profileId);
            const candidates = allMedia.filter(m => m.tags.some(t => tagsArray.includes(t.name.toLowerCase())));
            if (candidates.length > 0) {
              const randomMedia = candidates[Math.floor(Math.random() * candidates.length)];
              const row = getMediaRow(randomMedia.id);
              if (row) {
                await sendTelegramMedia(bot.botToken, String(chat.id), row.path, welcomeText, {
                  reply_markup: replyMarkup,
                });
                sentWithMedia = true;
              }
            }
          }
        }

        if (!sentWithMedia) {
          await sendTelegramMessage(bot.botToken, String(chat.id), welcomeText, {
            reply_markup: replyMarkup,
          });
        }
      }
    }

    // ---- Clique nos botões de compra (Callback Query) ----
    if (update.callback_query) {
      const { id, data, from, message } = update.callback_query;

      const isPlanBuy = typeof data === "string" && data.startsWith("buy_plan_");
      // Oferta de um MAILING: mesmo fluxo do plano, mas com nome/preço/duração
      // ajustados só para aquele disparo (o plano original fica intacto).
      const isOfferBuy = typeof data === "string" && data.startsWith("buy_offer_");

      if (isPlanBuy || isOfferBuy) {
        let planId = "";
        let offerId = "";
        let itemName = "";
        let basePriceCents = 0;
        let discountPercent = 0;

        if (isPlanBuy) {
          const parts = data.replace("buy_plan_", "").split("_");
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
          offerId = data.replace("buy_offer_", "");
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

        const provider = activeProvider();
        if (!provider) {
          await sendTelegramMessage(
            bot.botToken,
            String(message.chat.id),
            "⚠️ O checkout temporariamente indisponível. Tente novamente mais tarde."
          );
          return NextResponse.json({ ok: true });
        }

        // Informa que a cobrança está sendo gerada
        await sendTelegramMessage(
          bot.botToken,
          String(message.chat.id),
          "⏳ Gerando cobrança PIX..."
        );

        let amountCents = basePriceCents;
        if (discountPercent > 0 && discountPercent <= 100) {
          amountCents = Math.floor(amountCents * (1 - discountPercent / 100));
        }
        // Usa o token gerenciado (o mesmo mostrado na UI e aceito pelo webhook),
        // não o SESSION_SECRET — assim a confirmação autentica mesmo sem a env.
        // E usa a origem PÚBLICA: atrás de proxy/EasyPanel, req.nextUrl.origin
        // pode virar um host interno que a SyncPay não alcança — a cobrança é
        // criada, o cliente paga, mas a confirmação nunca chega e a venda some
        // do painel. Configure NEXT_PUBLIC_APP_URL (ou WEBHOOK_APP_URL) com o
        // domínio público para garantir isso em produção.
        const postbackUrl = `${publicOrigin(req)}/w/${ensureSyncpayWebhookShortToken()}`;

        // Cria cobrança PIX no SyncPay
        const charge = await provider.createPixCharge({
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
        saveSubscription({
          id: randomUUID(),
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
        });

        // Envia o PIX: QR Code (imagem) + código copia-e-cola na legenda. Se a
        // geração do QR falhar por algum motivo, cai para só o texto.
        const pixCode = charge.pixCode || "";
        const pixCaption = `🔑 <b>PIX gerado!</b>\n\n` +
          `📸 Escaneie o QR acima <b>ou</b> copie o código abaixo no seu app do banco:\n\n` +
          `<code>${pixCode}</code>\n\n` +
          `<i>A confirmação é imediata. Após pagar, você recebe o acesso automaticamente.</i>`;
        let sentPix = false;
        if (pixCode) {
          try {
            const qrBuffer = await QRCode.toBuffer(pixCode, { width: 512, margin: 1 });
            await sendTelegramPhotoBuffer(bot.botToken, String(message.chat.id), qrBuffer, pixCaption);
            sentPix = true;
          } catch {
            // cai para o texto abaixo
          }
        }
        if (!sentPix) {
          await sendTelegramMessage(bot.botToken, String(message.chat.id), pixCaption);
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

      if (chatId === bot.idVip) {
        // VIP: só entra quem tem assinatura ativa (pagou).
        const activeSub = findActiveSubscription(bot.id, from.id);
        if (activeSub) {
          if (from.username && activeSub.telegramUsername !== from.username) {
            activeSub.telegramUsername = from.username;
            saveSubscription(activeSub);
          }
          await approveTelegramJoinRequest(bot.botToken, chatId, from.id);
        } else {
          await declineTelegramJoinRequest(bot.botToken, chatId, from.id);
        }
      } else if (chatId === bot.idAquecimento) {
        // Prévias (aquecimento): grupo gratuito — aceita TODO novo lead.
        await approveTelegramJoinRequest(bot.botToken, chatId, from.id);
        // Mensagem de boas-vindas às prévias (opcional), no privado do lead.
        if (bot.previewsWelcomeMessage?.trim()) {
          const msg = bot.previewsWelcomeMessage.replace(/{nome}/gi, from.first_name || "linda(o)");
          await sendTelegramMessage(bot.botToken, String(from.id), msg).catch(() => {});
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
