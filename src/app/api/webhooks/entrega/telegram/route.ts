import { NextRequest, NextResponse } from "next/server";
import {
  mostrarMenu,
  nomeDoChat,
  tratarCallbackDoMenu,
  tratarMensagemDoMenu,
} from "@/lib/deliveryBotMenu";
import { findTargetByPairCode, pairTarget } from "@/lib/deliveryTargets";
import {
  applyDeliveryAnswer,
  avisarAlertaDaResposta,
  enviarLegendaDoPost,
  fecharMensagemDaEntrega,
  DELIVERY_BOT_ID,
  type DeliveryAction,
} from "@/lib/postDelivery";
import { getProfile } from "@/lib/profiles";
import { authorizeDeliveryChat, getDeliveryBotToken } from "@/lib/settings";
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
 * Três coisas chegam aqui:
 *   • TEXTO — o código de acesso e os comandos, que abrem o MENU
 *     (`lib/deliveryBotMenu.ts`): a pessoa escolhe a modelo e o aparelho
 *     tocando em botões, em vez de decorar um código por aparelho.
 *   • `/vincular ABC123` — o pareamento antigo, mantido porque quem já tinha
 *     o comando na mão não pode ficar sem caminho.
 *   • `callback_query` — os toques: nos botões do menu (`dm_*`) e nos da
 *     entrega (`ent_*`).
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

    /* --------------------------------------------------- texto e menu */
    const msg = update?.message;
    const texto = typeof msg?.text === "string" ? msg.text.trim() : "";
    if (texto) {
      const chatId = String(msg.chat?.id ?? "");
      const quem = nomeDoChat(msg.from);

      // `/vincular ABC123` (e o `/start ABC123` do link t.me) — o caminho
      // antigo. Continua valendo e AUTORIZA o chat: quem tem o código de um
      // aparelho tirou-o do painel, então já pode usar o menu daqui em diante.
      const m = texto.match(/^\/(vincular|start)(?:@\S+)?(?:\s+(\S+))?/i);
      const comando = m?.[1]?.toLowerCase();
      const argumento = m?.[2];
      if (argumento) {
        const alvo = findTargetByPairCode(argumento);
        if (!alvo) {
          // Pelo `/start` o argumento vem de um link e pode ser o código de
          // ACESSO — quem trata isso (e explica o que fazer quando não é nem
          // um nem outro) é o menu.
          if (comando === "start") {
            await tratarMensagemDoMenu(botToken, chatId, argumento, quem);
            return NextResponse.json({ ok: true });
          }
          await sendTelegramMessage(
            botToken,
            chatId,
            "❌ Código não encontrado. Confira no painel, em Aparelhos de entrega — " +
              "o código some depois de usado, e cada aparelho tem o seu.\n\n" +
              "Se preferir, mande o <b>código de acesso</b> do painel e escolha a " +
              "modelo por uma lista.",
          );
          return NextResponse.json({ ok: true });
        }
        pairTarget(alvo.id, chatId, quem);
        authorizeDeliveryChat(chatId, quem);
        const perfil = await getProfile(alvo.profileId);
        await sendTelegramMessage(
          botToken,
          chatId,
          `✅ Aparelho <b>${alvo.label}</b> vinculado` +
            (perfil ? ` à modelo <b>${perfil.name}</b>` : "") +
            ".\n\nÉ aqui que os posts vão chegar, na hora de publicar.",
        );
        await mostrarMenu(botToken, chatId);
        return NextResponse.json({ ok: true });
      }

      await tratarMensagemDoMenu(botToken, chatId, texto, quem);
      return NextResponse.json({ ok: true });
    }

    /* ------------------------------------------------------------ botões */
    const cb = update?.callback_query;
    if (cb) {
      const data = String(cb.data || "");
      const chatId = String(cb.message?.chat?.id ?? "");
      const messageId =
        cb.message?.message_id === undefined ? undefined : String(cb.message.message_id);

      // Os botões do MENU vêm primeiro: eles são de cadastro, não de entrega.
      if (
        chatId &&
        (await tratarCallbackDoMenu(botToken, {
          id: cb.id,
          data,
          chatId,
          messageId,
          quem: nomeDoChat(cb.from),
        }))
      ) {
        return NextResponse.json({ ok: true });
      }

      const [prefixo, alvo] = data.split(":");

      // "Copiar legenda" de legenda longa: o Telegram só copia até 256
      // caracteres pelo botão, então acima disso o botão REENVIA a legenda
      // sozinha, numa bolha que dá para segurar e copiar inteira.
      if (prefixo === "ent_cap" && alvo && chatId) {
        const foi = await enviarLegendaDoPost(botToken, chatId, alvo);
        await answerTelegramCallback(
          botToken,
          cb.id,
          foi ? "Legenda enviada aqui embaixo." : "Este post não tem legenda.",
        );
        return NextResponse.json({ ok: true });
      }

      const acao = ACOES[prefixo];
      if (!acao || !alvo) {
        await answerTelegramCallback(botToken, cb.id);
        return NextResponse.json({ ok: true });
      }

      const r = applyDeliveryAnswer(alvo, acao);
      await answerTelegramCallback(botToken, cb.id, r.aviso || r.resumo);
      if (r.ok && r.entrega) {
        // Fecha a mensagem: os botões de resposta viram o selo do que foi
        // decidido (o de copiar legenda fica).
        await fecharMensagemDaEntrega(botToken, r.entrega);
        // E quem acompanha TODAS as modelos recebe o resultado: o espelho lá
        // em cima ganha o selo e chega um aviso novo (ver a função).
        await avisarAlertaDaResposta(botToken, r.entrega, acao);
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
