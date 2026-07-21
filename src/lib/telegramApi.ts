import { createHmac } from "node:crypto";
import { readBuffer } from "./storage";

/**
 * Secret determinístico por bot para o header X-Telegram-Bot-Api-Secret-Token.
 * Derivado do SESSION_SECRET + botId (HMAC), então não precisa de coluna nova
 * no banco e é o mesmo na hora de registrar o webhook e de validar cada update.
 * Sanitiza para o conjunto aceito pelo Telegram (A-Z a-z 0-9 _ -).
 */
export function telegramWebhookSecret(botId: string): string {
  const key = process.env.SESSION_SECRET || "hotdash";
  return createHmac("sha256", key).update(`tg-webhook:${botId}`).digest("hex");
}

async function telegramFetch(botToken: string, method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Telegram API: ${data.description || `Erro HTTP ${res.status}`}`);
  }
  return data.result;
}

async function telegramFormFetch(
  botToken: string,
  method: string,
  chatId: string,
  caption: string | undefined,
  relPath: string,
  fileField: "photo" | "video",
  options: Record<string, unknown> = {}
) {
  const buffer = await readBuffer(relPath);
  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  let mime = "application/octet-stream";
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    mime = `image/${ext.replace(".", "")}`;
  } else if ([".mp4", ".mov", ".mkv", ".webm"].includes(ext)) {
    mime = `video/${ext.replace(".", "")}`;
  }

  const formData = new FormData();
  formData.append("chat_id", chatId);
  if (caption) {
    formData.append("caption", caption);
    formData.append("parse_mode", "HTML");
  }

  const blob = new Blob([buffer as any], { type: mime });
  formData.append(fileField, blob, `file${ext}`);

  if (options.reply_markup) {
    formData.append("reply_markup", JSON.stringify(options.reply_markup));
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Telegram API: ${data.description || `Erro HTTP ${res.status}`}`);
  }
  return data.result;
}

/**
 * Registra o webhook do bot apontando para o Hot-Dash. Passa `allowed_updates`
 * EXPLÍCITO — o Telegram NÃO entrega `chat_join_request` por padrão, e é ele
 * que dispara a aprovação automática nos grupos VIP/Prévias. O `secret_token`
 * (opcional) é devolvido pelo Telegram no header X-Telegram-Bot-Api-Secret-Token
 * de cada update, e o handler do webhook o valida.
 */
export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken?: string,
): Promise<boolean> {
  return telegramFetch(botToken, "setWebhook", {
    url,
    allowed_updates: ["message", "callback_query", "chat_join_request"],
    secret_token: secretToken || undefined,
    drop_pending_updates: false,
  });
}

export type TelegramWebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

/** Consulta o estado atual do webhook do bot (para a UI mostrar status). */
export async function getTelegramWebhookInfo(botToken: string): Promise<TelegramWebhookInfo> {
  return telegramFetch(botToken, "getWebhookInfo", {}) as Promise<TelegramWebhookInfo>;
}

/** Remove o webhook do bot (usado se o operador quiser desligar o bot). */
export async function deleteTelegramWebhook(botToken: string): Promise<boolean> {
  return telegramFetch(botToken, "deleteWebhook", { drop_pending_updates: false });
}

/** Busca dados do próprio bot (getMe) — usado para validar o token e pegar o @username. */
export async function getTelegramMe(
  botToken: string,
): Promise<{ id: number; username?: string; first_name?: string }> {
  return telegramFetch(botToken, "getMe", {}) as Promise<{
    id: number;
    username?: string;
    first_name?: string;
  }>;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  return telegramFetch(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...options,
  });
}

export async function sendTelegramMedia(
  botToken: string,
  chatId: string,
  relPath: string,
  caption?: string,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  const isVideo = [".mp4", ".mov", ".mkv", ".webm"].includes(ext);
  if (isVideo) {
    return telegramFormFetch(botToken, "sendVideo", chatId, caption, relPath, "video", options);
  } else {
    return telegramFormFetch(botToken, "sendPhoto", chatId, caption, relPath, "photo", options);
  }
}

/** Envia uma foto a partir de um Buffer em memória (ex.: QR Code do PIX). */
export async function sendTelegramPhotoBuffer(
  botToken: string,
  chatId: string,
  buffer: Buffer,
  caption?: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  if (caption) {
    formData.append("caption", caption);
    formData.append("parse_mode", "HTML");
  }
  if (options.reply_markup) {
    formData.append("reply_markup", JSON.stringify(options.reply_markup));
  }
  const blob = new Blob([new Uint8Array(buffer)], { type: "image/png" });
  formData.append("photo", blob, "pix.png");

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Telegram API: ${data.description || `Erro HTTP ${res.status}`}`);
  }
  return data.result;
}

/** Cria um link de convite único que exige aprovação de entrada. */
export async function createTelegramInviteLink(
  botToken: string,
  chatId: string,
  name?: string
): Promise<{ invite_link: string }> {
  return telegramFetch(botToken, "createChatInviteLink", {
    chat_id: chatId,
    name,
    creates_join_request: true,
  });
}

export async function approveTelegramJoinRequest(
  botToken: string,
  chatId: string,
  userId: number
): Promise<boolean> {
  return telegramFetch(botToken, "approveChatJoinRequest", {
    chat_id: chatId,
    user_id: userId,
  });
}

export async function declineTelegramJoinRequest(
  botToken: string,
  chatId: string,
  userId: number
): Promise<boolean> {
  return telegramFetch(botToken, "declineChatJoinRequest", {
    chat_id: chatId,
    user_id: userId,
  });
}

export async function banTelegramMember(
  botToken: string,
  chatId: string,
  userId: number
): Promise<boolean> {
  return telegramFetch(botToken, "banChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
}

export async function unbanTelegramMember(
  botToken: string,
  chatId: string,
  userId: number
): Promise<boolean> {
  return telegramFetch(botToken, "unbanChatMember", {
    chat_id: chatId,
    user_id: userId,
    only_if_banned: true,
  });
}
