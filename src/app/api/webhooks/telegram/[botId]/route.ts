import { NextRequest, NextResponse } from "next/server";
import { getBotConfig, listPlans, listCustomButtons, saveSubscription, getPlan, findActiveSubscription, upsertTelegramLead } from "@/lib/telegramDb";
import { sendTelegramMessage, sendTelegramMedia, approveTelegramJoinRequest, declineTelegramJoinRequest, telegramWebhookSecret } from "@/lib/telegramApi";
import { listMedia, getMediaRow } from "@/lib/media";
import { activeProvider } from "@/lib/payments";
import { recordTransaction } from "@/lib/transactions";
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

    // Operação desligada → o bot de vendas não age (o ApexVips segue no
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

      if (isStart && from) {
        upsertTelegramLead({
          id: `${bot.id}_${from.id}`,
          profileId: bot.profileId,
          chatId: String(chat.id),
          lastInteractionAt: Date.now(),
          downsellStepIndex: 0,
          createdAt: Date.now(),
        });

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

      if (typeof data === "string" && data.startsWith("buy_plan_")) {
        const parts = data.replace("buy_plan_", "").split("_");
        const planId = parts[0];
        const discountPercent = parseInt(parts[1]) || 0;

        const plan = getPlan(planId);

        if (!plan) {
          await sendTelegramMessage(
            bot.botToken,
            String(message.chat.id),
            "⚠️ Plano não encontrado ou inativo."
          );
          return NextResponse.json({ ok: true });
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

        let amountCents = plan.priceCents;
        if (discountPercent > 0 && discountPercent <= 100) {
          amountCents = Math.floor(amountCents * (1 - discountPercent / 100));
        }
        const postbackUrl = `${req.nextUrl.origin}/api/webhooks/syncpay?token=${process.env.SESSION_SECRET}`;

        // Cria cobrança PIX no SyncPay
        const charge = await provider.createPixCharge({
          amountCents,
          description: `Assinatura ${plan.name}`,
          postbackUrl,
          customer: {
            name: from.first_name + (from.last_name ? ` ${from.last_name}` : ""),
            email: "cliente@telegram.com",
          },
        });

        // Registra transação
        const tx = recordTransaction({
          provider: provider.key,
          providerRef: charge.providerRef,
          profileId: bot.profileId,
          description: `Assinatura Telegram - ${plan.name}`,
          customer: from.first_name,
          amountCents,
          status: "pending",
        });

        // Registra inscrição pendente
        saveSubscription({
          id: randomUUID(),
          botId: bot.id,
          transactionId: tx.id,
          telegramUserId: from.id,
          telegramUsername: from.username || undefined,
          status: "pending",
          expiresAt: 0,
          lastUpsellAt: undefined,
          upsellStepIndex: 0,
          createdAt: Date.now(),
        });

        // Envia resposta com o PIX
        const pixMsg = `🔑 <b>PIX gerado com sucesso!</b>\n\n` +
          `Copie o código abaixo para pagar em seu aplicativo bancário:\n\n` +
          `<code>${charge.pixCode}</code>\n\n` +
          `<i>A confirmação é imediata. Após o pagamento, você receberá o link para entrar no grupo VIP.</i>`;

        await sendTelegramMessage(bot.botToken, String(message.chat.id), pixMsg);
      }
    }

    // ---- Solicitação de entrada nos grupos (Aprovação Automática) ----
    if (update.chat_join_request) {
      const { chat, from } = update.chat_join_request;
      const chatId = String(chat.id);

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
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram Webhook Error:", err);
    return NextResponse.json({ ok: true }); // Sempre retorna 200 para evitar loops do Telegram
  }
}
