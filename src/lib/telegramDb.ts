import { getDb } from "./db";

export type TelegramBotConfig = {
  id: string;
  profileId: string;
  botToken: string;
  botUsername?: string;
  idVip: string;
  idAquecimento: string;
  idRegistro?: string;
  supportUsername?: string;
  welcomeMessage: string;
  successMessage: string;
};

export type TelegramPlan = {
  id: string;
  botId: string;
  name: string;
  priceCents: number;
  durationDays: number;
};

export type TelegramSubscription = {
  id: string;
  botId: string;
  transactionId?: string;
  telegramUserId: number;
  telegramUsername?: string;
  inviteLink?: string;
  status: "pending" | "active" | "expired" | "blocked";
  expiresAt: number;
  createdAt: number;
};

export function getBotConfigByProfile(profileId: string): TelegramBotConfig | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_bots WHERE profile_id = ?")
    .get(profileId) as any;
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    botToken: row.bot_token,
    botUsername: row.bot_username || undefined,
    idVip: row.id_vip,
    idAquecimento: row.id_aquecimento,
    idRegistro: row.id_registro || undefined,
    supportUsername: row.support_username || undefined,
    welcomeMessage: row.welcome_message,
    successMessage: row.success_message,
  };
}

export function getBotConfig(id: string): TelegramBotConfig | null {
  const row = getDb().prepare("SELECT * FROM telegram_bots WHERE id = ?").get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    botToken: row.bot_token,
    botUsername: row.bot_username || undefined,
    idVip: row.id_vip,
    idAquecimento: row.id_aquecimento,
    idRegistro: row.id_registro || undefined,
    supportUsername: row.support_username || undefined,
    welcomeMessage: row.welcome_message,
    successMessage: row.success_message,
  };
}

export function saveBotConfig(config: Omit<TelegramBotConfig, "id"> & { id?: string }): TelegramBotConfig {
  const db = getDb();
  const id = config.id || Math.random().toString(36).substring(2, 15);
  const now = Date.now();
  db.prepare(
    `INSERT INTO telegram_bots (id, profile_id, bot_token, bot_username, id_vip, id_aquecimento, id_registro, support_username, welcome_message, success_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       bot_token = excluded.bot_token,
       bot_username = excluded.bot_username,
       id_vip = excluded.id_vip,
       id_aquecimento = excluded.id_aquecimento,
       id_registro = excluded.id_registro,
       support_username = excluded.support_username,
       welcome_message = excluded.welcome_message,
       success_message = excluded.success_message`
  ).run(
    id,
    config.profileId,
    config.botToken,
    config.botUsername || null,
    config.idVip,
    config.idAquecimento,
    config.idRegistro || null,
    config.supportUsername || null,
    config.welcomeMessage,
    config.successMessage,
    now
  );
  return getBotConfig(id)!;
}

export function deleteBotConfig(profileId: string): void {
  getDb().prepare("DELETE FROM telegram_bots WHERE profile_id = ?").run(profileId);
}

export function listPlans(botId: string): TelegramPlan[] {
  const rows = getDb().prepare("SELECT * FROM telegram_plans WHERE bot_id = ?").all(botId) as any[];
  return rows.map((r) => ({
    id: r.id,
    botId: r.bot_id,
    name: r.name,
    priceCents: r.price_cents,
    durationDays: r.duration_days,
  }));
}

export function getPlan(id: string): TelegramPlan | null {
  const row = getDb().prepare("SELECT * FROM telegram_plans WHERE id = ?").get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    priceCents: row.price_cents,
    durationDays: row.duration_days,
  };
}

export function savePlan(plan: TelegramPlan): void {
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO telegram_plans (id, bot_id, name, price_cents, duration_days, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       price_cents = excluded.price_cents,
       duration_days = excluded.duration_days`
  ).run(plan.id, plan.botId, plan.name, plan.priceCents, plan.durationDays, now);
}

export function deletePlan(id: string): void {
  getDb().prepare("DELETE FROM telegram_plans WHERE id = ?").run(id);
}

export function listSubscriptions(botId: string): TelegramSubscription[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_subscriptions WHERE bot_id = ? ORDER BY created_at DESC")
    .all(botId) as any[];
  return rows.map((r) => ({
    id: r.id,
    botId: r.bot_id,
    transactionId: r.transaction_id || undefined,
    telegramUserId: r.telegram_user_id,
    telegramUsername: r.telegram_username || undefined,
    inviteLink: r.invite_link || undefined,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

export function getSubscription(id: string): TelegramSubscription | null {
  const row = getDb().prepare("SELECT * FROM telegram_subscriptions WHERE id = ?").get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    transactionId: row.transaction_id || undefined,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username || undefined,
    inviteLink: row.invite_link || undefined,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function findActiveSubscription(botId: string, telegramUserId: number): TelegramSubscription | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM telegram_subscriptions WHERE bot_id = ? AND telegram_user_id = ? AND status = 'active'"
    )
    .get(botId, telegramUserId) as any;
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    transactionId: row.transaction_id || undefined,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username || undefined,
    inviteLink: row.invite_link || undefined,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function findSubscriptionByTransaction(transactionId: string): TelegramSubscription | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_subscriptions WHERE transaction_id = ?")
    .get(transactionId) as any;
  if (!row) return null;
  return {
    id: row.id,
    botId: row.bot_id,
    transactionId: row.transaction_id || undefined,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username || undefined,
    inviteLink: row.invite_link || undefined,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function saveSubscription(sub: TelegramSubscription): void {
  getDb().prepare(
    `INSERT INTO telegram_subscriptions (id, bot_id, transaction_id, telegram_user_id, telegram_username, invite_link, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       expires_at = excluded.expires_at,
       invite_link = excluded.invite_link,
       telegram_username = excluded.telegram_username`
  ).run(
    sub.id,
    sub.botId,
    sub.transactionId || null,
    sub.telegramUserId,
    sub.telegramUsername || null,
    sub.inviteLink || null,
    sub.status,
    sub.expiresAt,
    sub.createdAt
  );
}

// ---- Botões Personalizados ----
export type CustomButton = {
  id: string;
  botId: string;
  text: string;
  url: string;
  sortOrder: number;
};

export function listCustomButtons(botId: string): CustomButton[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_custom_buttons WHERE bot_id = ? ORDER BY sort_order")
    .all(botId) as any[];
  return rows.map((r) => ({
    id: r.id,
    botId: r.bot_id,
    text: r.text,
    url: r.url,
    sortOrder: r.sort_order,
  }));
}

export function saveCustomButton(btn: CustomButton): void {
  getDb().prepare(
    `INSERT INTO telegram_custom_buttons (id, bot_id, text, url, sort_order)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       text = excluded.text,
       url = excluded.url,
       sort_order = excluded.sort_order`
  ).run(btn.id, btn.botId, btn.text, btn.url, btn.sortOrder);
}

export function deleteCustomButton(id: string): void {
  getDb().prepare("DELETE FROM telegram_custom_buttons WHERE id = ?").run(id);
}
