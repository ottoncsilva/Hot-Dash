import { NextRequest, NextResponse } from "next/server";
import { getBotConfig, listPlans, listCustomButtons, saveSubscription, getPlan, findActiveSubscription } from "@/lib/telegramDb";
import { sendTelegramMessage, approveTelegramJoinRequest, declineTelegramJoinRequest } from "@/lib/telegramApi";
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

    const update = await req.json().catch(() => ({}));

    // ---- Mensagem comum (Ex: /start) ----
    if (update.message) {
      const { chat, text, from } = update.message;
      const isStart = typeof text === "string" && text.startsWith("/start");

      if (isStart && from) {
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

        await sendTelegramMessage(bot.botToken, String(chat.id), welcomeText, {
          reply_markup: replyMarkup,
        });
      }
    }

    // ---- Clique nos botões de compra (Callback Query) ----
    if (update.callback_query) {
      const { id, data, from, message } = update.callback_query;

      if (typeof data === "string" && data.startsWith("buy_plan_")) {
        const planId = data.replace("buy_plan_", "");
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

        const amountCents = plan.priceCents;
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

    // ---- Solicitação de entrada no grupo VIP (Aprovação Automática) ----
    if (update.chat_join_request) {
      const { chat, from } = update.chat_join_request;

      if (String(chat.id) === bot.idVip) {
        const activeSub = findActiveSubscription(bot.id, from.id);
        if (activeSub) {
          if (from.username && activeSub.telegramUsername !== from.username) {
            activeSub.telegramUsername = from.username;
            saveSubscription(activeSub);
          }
          await approveTelegramJoinRequest(bot.botToken, String(chat.id), from.id);
        } else {
          await declineTelegramJoinRequest(bot.botToken, String(chat.id), from.id);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram Webhook Error:", err);
    return NextResponse.json({ ok: true }); // Sempre retorna 200 para evitar loops do Telegram
  }
}
