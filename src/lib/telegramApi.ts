import { readBuffer } from "./storage";

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

export async function setTelegramWebhook(botToken: string, url: string): Promise<boolean> {
  return telegramFetch(botToken, "setWebhook", { url });
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
