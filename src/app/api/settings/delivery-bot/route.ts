import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { publicOrigin, webhookOriginProblem } from "@/lib/publicOrigin";
import { DELIVERY_BOT_ID } from "@/lib/postDelivery";
import {
  getDeliveryBotSettingsPublic,
  regenerateDeliveryAccessCode,
  removeDeliveryChat,
  setDeliveryChatAlert,
  updateDeliveryBotSettings,
} from "@/lib/settings";
import { unpairChat } from "@/lib/deliveryTargets";
import {
  diagnosticoDoToken,
  getTelegramMe,
  normalizarBotToken,
  setTelegramMyCommands,
  setTelegramWebhook,
  telegramWebhookSecret,
} from "@/lib/telegramApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O bot que entrega as postagens no celular (ver `lib/postDelivery.ts`).
 *
 * Salvar o token não é só guardar uma string: sem o webhook registrado, os
 * botões "Postei / Adiar / Não postei" não voltam para lugar nenhum e a
 * entrega vira um envio de mão única. Por isso os dois acontecem na mesma
 * ação, e um problema no endereço público é dito na hora — não descoberto
 * depois, quando o primeiro post não for confirmado.
 */

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const origin = publicOrigin(req);
    return NextResponse.json({
      settings: getDeliveryBotSettingsPublic(),
      /** Frase pronta quando o endereço público não serve para o Telegram. */
      originProblem: webhookOriginProblem(origin),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    if (typeof body.token !== "string") {
      throw new ApiError(400, "Informe o token do bot.");
    }

    // Campo apagado = desligar a entrega. Guardar antes de qualquer chamada ao
    // Telegram: não faz sentido validar um token vazio.
    if (!body.token.trim()) {
      return NextResponse.json({ settings: updateDeliveryBotSettings({ token: "" }) });
    }

    const token = normalizarBotToken(body.token);
    let username: string | undefined;
    try {
      const me = await getTelegramMe(token);
      username = me?.username;
    } catch (err) {
      throw new ApiError(400, diagnosticoDoToken(err) || "O Telegram não aceitou este token.");
    }

    const origin = publicOrigin(req);
    const problema = webhookOriginProblem(origin);
    if (problema) throw new ApiError(400, problema);

    let webhookAt: number | undefined;
    try {
      await setTelegramWebhook(
        token,
        `${origin}/api/webhooks/entrega/telegram`,
        telegramWebhookSecret(DELIVERY_BOT_ID),
      );
      webhookAt = Date.now();
    } catch (err) {
      throw new ApiError(
        400,
        `O token é válido, mas o Telegram recusou o registro do webhook: ${
          err instanceof Error ? err.message : "erro desconhecido"
        }`,
      );
    }

    // O menu do teclado do Telegram: sem isto, quem abre a conversa não tem
    // como descobrir que existe um menu — o bot fica parecendo mudo. Falha
    // aqui não derruba o cadastro: é enfeite, e o token e o webhook (que são
    // o que faz a entrega funcionar) já estão de pé.
    try {
      await setTelegramMyCommands(token, [
        { command: "menu", description: "Vincular este celular / receber alertas" },
      ]);
    } catch (err) {
      console.error("[hotdash] não consegui registrar os comandos do bot de entrega:", err);
    }

    return NextResponse.json({
      settings: updateDeliveryBotSettings({ token, botUsername: username, webhookAt }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * As ações do CÓDIGO DE ACESSO e dos celulares já autorizados.
 *
 * Ficam num POST com `action` (e não em rotas separadas) porque são três
 * botões da mesma tela, todos mexendo na mesma chave de settings.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "regenerate-code") {
      // Troca o código E esquece os celulares: código novo com os antigos
      // ainda dentro não protegeria de nada (ver `regenerateDeliveryAccessCode`).
      regenerateDeliveryAccessCode();
      return NextResponse.json({ settings: getDeliveryBotSettingsPublic() });
    }

    const chatId = String(body.chatId || "");
    if (!chatId) throw new ApiError(400, "Informe o celular.");

    if (action === "set-alert") {
      setDeliveryChatAlert(chatId, Boolean(body.alert));
      return NextResponse.json({ settings: getDeliveryBotSettingsPublic() });
    }

    if (action === "remove-chat") {
      // Os aparelhos que este celular recebia voltam a ter código, senão
      // ficariam órfãos: sem chat e sem como parear de novo.
      unpairChat(chatId);
      removeDeliveryChat(chatId);
      return NextResponse.json({ settings: getDeliveryBotSettingsPublic() });
    }

    throw new ApiError(400, "Ação desconhecida.");
  } catch (err) {
    return errorResponse(err);
  }
}
