import { NextRequest, NextResponse } from "next/server";
import { findTargetByPairCode, pairTarget } from "@/lib/deliveryTargets";
import {
  applyDeliveryAnswer,
  fecharMensagemDaEntrega,
  DELIVERY_BOT_ID,
  type DeliveryAction,
} from "@/lib/postDelivery";
import { getProfile } from "@/lib/profiles";
import { getDeliveryBotToken } from "@/lib/settings";
import {
  answerTelegramCallback,
  sendTelegramMessage,
  telegramWebhookSecret,
} from "@/lib/telegramApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O webhook do BOT DE ENTREGA — o bot que leva o post pronto ao celular de
 * quem publica e recebe de volta o "postei / adiei / não postei".
 *
 * Endereço próprio, e não `/api/webhooks/telegram/[botId]`, de propósito:
 * aquele é o bot de VENDAS de uma modelo, com funil, planos e pagamento. Este
 * fala com a OPERAÇÃO e é um só para o painel inteiro. Misturar os dois
 * colocaria um teclado interno de "não postei" no meio de um funil de compra.
 *
 * Duas coisas chegam aqui:
 *   • `/vincular ABC123` — o pareamento. Existe porque a API do Telegram não
 *     deixa um bot iniciar conversa: sem alguém falar com ele primeiro, não
 *     há chat_id nenhum para onde mandar o post.
 *   • `callback_query` — o toque num dos três botões.
 */

const ACOES: Record<string, DeliveryAction> = {
  ent_ok: "posted",
  ent_snz: "snooze",
  ent_no: "failed",
};

export async function POST(req: NextRequest) {
  try {
    const botToken = getDeliveryBotToken();
    if (!botToken) return NextResponse.json({ ok: true });

    // Mesma checagem do webhook de vendas: o Telegram devolve no header o
    // secret com que registramos o webhook. Sem secret (registro antigo) o
    // update continua aceito.
    const secret = req.headers.get("x-telegram-bot-api-secret-token");
    if (secret && secret !== telegramWebhookSecret(DELIVERY_BOT_ID)) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const update = await req.json().catch(() => ({}) as any);

    /* -------------------------------------------------------- pareamento */
    const msg = update?.message;
    const texto = typeof msg?.text === "string" ? msg.text.trim() : "";
    if (texto) {
      const chatId = String(msg.chat?.id ?? "");
      const quem =
        msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || undefined;
      const m = texto.match(/^\/(?:vincular|start)(?:@\S+)?(?:\s+(\S+))?/i);
      if (m) {
        const codigo = m[1];
        if (!codigo) {
          await sendTelegramMessage(
            botToken,
            chatId,
            "👋 Este é o bot de entrega do Hot Dash.\n\n" +
              "Para ligar este celular a uma modelo, cadastre um aparelho no painel " +
              "(Modelos → a modelo → Aparelhos de entrega) e mande aqui:\n\n" +
              "<code>/vincular SEUCODIGO</code>",
          );
          return NextResponse.json({ ok: true });
        }
        const alvo = findTargetByPairCode(codigo);
        if (!alvo) {
          await sendTelegramMessage(
            botToken,
            chatId,
            "❌ Código não encontrado. Confira no painel, em Aparelhos de entrega — " +
              "o código some depois de usado, e cada aparelho tem o seu.",
          );
          return NextResponse.json({ ok: true });
        }
        pairTarget(alvo.id, chatId, quem);
        const perfil = await getProfile(alvo.profileId);
        await sendTelegramMessage(
          botToken,
          chatId,
          `✅ Aparelho <b>${alvo.label}</b> vinculado` +
            (perfil ? ` à modelo <b>${perfil.name}</b>` : "") +
            ".\n\nÉ aqui que os posts vão chegar, na hora de publicar.",
        );
        return NextResponse.json({ ok: true });
      }
    }

    /* ------------------------------------------------------------ botões */
    const cb = update?.callback_query;
    if (cb) {
      const data = String(cb.data || "");
      const [prefixo, deliveryId] = data.split(":");
      const acao = ACOES[prefixo];
      if (!acao || !deliveryId) {
        await answerTelegramCallback(botToken, cb.id);
        return NextResponse.json({ ok: true });
      }

      const r = applyDeliveryAnswer(deliveryId, acao);
      await answerTelegramCallback(botToken, cb.id, r.aviso || r.resumo);
      if (r.ok && r.entrega) {
        // Fecha a mensagem: os três botões viram o selo do que foi decidido.
        await fecharMensagemDaEntrega(botToken, r.entrega);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    // O Telegram REPETE todo update que não recebeu 200 — devolver erro aqui
    // faria o mesmo clique ser reprocessado em laço. O log é o registro.
    console.error("[hotdash] webhook da entrega:", err);
    return NextResponse.json({ ok: true });
  }
}
