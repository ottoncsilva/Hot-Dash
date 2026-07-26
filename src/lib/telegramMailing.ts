import { getDb } from "./db";
import { randomUUID } from "node:crypto";
import { getAppTimeZone } from "./settings";
import { partsInTimeZone, zonedWallTimeToUtcMs } from "./timezone";
import type { Audience } from "./telegramUsers";

/**
 * Mailing: disparo de mensagem em massa para os usuários do bot.
 *
 * Aqui ficam o armazenamento, o cálculo do próximo horário e o preenchimento
 * das variáveis do texto. O ENVIO em si mora em `telegramCron.ts`, que drena a
 * fila aos poucos — um disparo para mil pessoas não pode acontecer dentro de
 * uma requisição HTTP.
 */

export type MailingScheduleType = "once" | "daily" | "interval" | "weekdays";
export type MailingStatus = "draft" | "scheduled" | "sending" | "sent" | "paused";

export type MailingButton = { text: string; url: string };

export type MailingOffer = {
  id: string;
  mailingId: string;
  /** Plano de origem (para saber de onde veio); o preço cobrado é o daqui. */
  planId?: string;
  name: string;
  priceCents: number;
  durationDays: number;
  kind: "subscription" | "package";
  deliverable?: string;
  sortOrder: number;
};

export type Mailing = {
  id: string;
  botId: string;
  profileId: string;
  name: string;
  message: string;
  audiences: Audience[];
  mediaTags?: string;
  buttons: MailingButton[];
  scheduleType: MailingScheduleType;
  scheduleTimes?: string;
  scheduleWeekdays?: string;
  intervalHours?: number;
  scheduledAt?: number;
  status: MailingStatus;
  lastRunAt?: number;
  nextRunAt?: number;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  blockedCount: number;
  createdAt: number;
  offers: MailingOffer[];
};

function parseButtons(json?: string): MailingButton[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v)
      ? v
          .filter((b) => b && typeof b.text === "string" && typeof b.url === "string")
          .map((b) => ({ text: String(b.text), url: String(b.url) }))
      : [];
  } catch {
    return [];
  }
}

function toMailing(r: any, offers: MailingOffer[]): Mailing {
  return {
    id: r.id,
    botId: r.bot_id,
    profileId: r.profile_id,
    name: r.name,
    message: r.message || "",
    audiences: String(r.audiences || "todos")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean) as Audience[],
    mediaTags: r.media_tags || undefined,
    buttons: parseButtons(r.buttons),
    scheduleType: (r.schedule_type || "once") as MailingScheduleType,
    scheduleTimes: r.schedule_times || undefined,
    scheduleWeekdays: r.schedule_weekdays || undefined,
    intervalHours: r.interval_hours || undefined,
    scheduledAt: r.scheduled_at || undefined,
    status: (r.status || "draft") as MailingStatus,
    lastRunAt: r.last_run_at || undefined,
    nextRunAt: r.next_run_at || undefined,
    totalRecipients: r.total_recipients || 0,
    sentCount: r.sent_count || 0,
    failedCount: r.failed_count || 0,
    blockedCount: r.blocked_count || 0,
    createdAt: r.created_at,
    offers,
  };
}

function toOffer(r: any): MailingOffer {
  return {
    id: r.id,
    mailingId: r.mailing_id,
    planId: r.plan_id || undefined,
    name: r.name,
    priceCents: r.price_cents,
    durationDays: r.duration_days,
    kind: r.kind === "package" ? "package" : "subscription",
    deliverable: r.deliverable || undefined,
    sortOrder: r.sort_order,
  };
}

export function listMailingOffers(mailingId: string): MailingOffer[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_mailing_offers WHERE mailing_id = ? ORDER BY sort_order")
    .all(mailingId) as any[];
  return rows.map(toOffer);
}

export function getMailingOffer(id: string): MailingOffer | null {
  const row = getDb().prepare("SELECT * FROM telegram_mailing_offers WHERE id = ?").get(id) as any;
  return row ? toOffer(row) : null;
}

export function getMailing(id: string): Mailing | null {
  const row = getDb().prepare("SELECT * FROM telegram_mailings WHERE id = ?").get(id) as any;
  return row ? toMailing(row, listMailingOffers(id)) : null;
}

export function listMailings(botId: string): Mailing[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_mailings WHERE bot_id = ? ORDER BY created_at DESC")
    .all(botId) as any[];
  return rows.map((r) => toMailing(r, listMailingOffers(r.id)));
}

export type SaveMailingInput = {
  id?: string;
  botId: string;
  profileId: string;
  name: string;
  message: string;
  audiences: Audience[];
  mediaTags?: string;
  buttons: MailingButton[];
  scheduleType: MailingScheduleType;
  scheduleTimes?: string;
  scheduleWeekdays?: string;
  intervalHours?: number;
  scheduledAt?: number;
  status: MailingStatus;
  nextRunAt?: number;
  offers: Omit<MailingOffer, "id" | "mailingId" | "sortOrder">[];
};

export function saveMailing(input: SaveMailingInput): Mailing {
  const db = getDb();
  const id = input.id || randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO telegram_mailings
       (id, bot_id, profile_id, name, message, audiences, media_tags, buttons, schedule_type,
        schedule_times, schedule_weekdays, interval_hours, scheduled_at, status, next_run_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name              = excluded.name,
       message           = excluded.message,
       audiences         = excluded.audiences,
       media_tags        = excluded.media_tags,
       buttons           = excluded.buttons,
       schedule_type     = excluded.schedule_type,
       schedule_times    = excluded.schedule_times,
       schedule_weekdays = excluded.schedule_weekdays,
       interval_hours    = excluded.interval_hours,
       scheduled_at      = excluded.scheduled_at,
       status            = excluded.status,
       next_run_at       = excluded.next_run_at`,
  ).run(
    id,
    input.botId,
    input.profileId,
    input.name,
    input.message,
    input.audiences.join(","),
    input.mediaTags || null,
    JSON.stringify(input.buttons || []),
    input.scheduleType,
    input.scheduleTimes || null,
    input.scheduleWeekdays || null,
    input.intervalHours || null,
    input.scheduledAt || null,
    input.status,
    input.nextRunAt || null,
    now,
  );

  // As ofertas são substituídas em bloco: elas só existem para este disparo.
  db.prepare("DELETE FROM telegram_mailing_offers WHERE mailing_id = ?").run(id);
  const insertOffer = db.prepare(
    `INSERT INTO telegram_mailing_offers
       (id, mailing_id, plan_id, name, price_cents, duration_days, kind, deliverable, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  (input.offers || []).forEach((o, i) => {
    insertOffer.run(
      randomUUID(),
      id,
      o.planId || null,
      o.name,
      Math.max(0, Math.round(o.priceCents)),
      Math.max(1, Math.round(o.durationDays)),
      o.kind === "package" ? "package" : "subscription",
      o.deliverable || null,
      i,
    );
  });

  return getMailing(id)!;
}

export function deleteMailing(id: string): void {
  getDb().prepare("DELETE FROM telegram_mailings WHERE id = ?").run(id);
}

export function updateMailingStatus(id: string, status: MailingStatus, nextRunAt?: number | null): void {
  getDb()
    .prepare(
      `UPDATE telegram_mailings SET status = ?,
         next_run_at = CASE WHEN ? IS NULL THEN next_run_at ELSE ? END
       WHERE id = ?`,
    )
    .run(status, nextRunAt ?? null, nextRunAt ?? null, id);
}

// ---------------------------------------------------------------------------
// Fila de envio
// ---------------------------------------------------------------------------

/**
 * Enfileira os destinatários e coloca o disparo em "sending". A fila anterior
 * do mesmo mailing é apagada: um disparo recorrente recomeça do zero a cada
 * rodada, e o resumo mostrado é sempre o da rodada atual.
 */
export function enqueueMailing(
  mailingId: string,
  recipients: { telegramUserId: number; chatId: string }[],
): number {
  const db = getDb();
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO telegram_mailing_queue
       (id, mailing_id, telegram_user_id, chat_id, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  );
  const run = db.transaction(() => {
    db.prepare("DELETE FROM telegram_mailing_queue WHERE mailing_id = ?").run(mailingId);
    for (const r of recipients) insert.run(randomUUID(), mailingId, r.telegramUserId, r.chatId, now);
    db.prepare(
      `UPDATE telegram_mailings
          SET status = 'sending', total_recipients = ?, sent_count = 0,
              failed_count = 0, blocked_count = 0, last_run_at = ?
        WHERE id = ?`,
    ).run(recipients.length, now, mailingId);
  });
  run();
  return recipients.length;
}

export function nextQueueBatch(
  mailingId: string,
  limit: number,
): { id: string; telegramUserId: number; chatId: string }[] {
  const rows = getDb()
    .prepare(
      `SELECT id, telegram_user_id, chat_id FROM telegram_mailing_queue
        WHERE mailing_id = ? AND status = 'pending' ORDER BY created_at LIMIT ?`,
    )
    .all(mailingId, limit) as any[];
  return rows.map((r) => ({ id: r.id, telegramUserId: r.telegram_user_id, chatId: r.chat_id }));
}

export function markQueueItem(
  itemId: string,
  mailingId: string,
  status: "sent" | "failed" | "blocked",
  error?: string,
): void {
  const db = getDb();
  db.prepare("UPDATE telegram_mailing_queue SET status = ?, error = ?, sent_at = ? WHERE id = ?").run(
    status,
    error || null,
    Date.now(),
    itemId,
  );
  const col = status === "sent" ? "sent_count" : status === "blocked" ? "blocked_count" : "failed_count";
  db.prepare(`UPDATE telegram_mailings SET ${col} = ${col} + 1 WHERE id = ?`).run(mailingId);
}

export function pendingQueueCount(mailingId: string): number {
  return (getDb()
    .prepare("SELECT COUNT(*) c FROM telegram_mailing_queue WHERE mailing_id = ? AND status = 'pending'")
    .get(mailingId) as { c: number }).c;
}

/** Disparos que já podem rodar: agendados cujo horário chegou + os em andamento. */
export function listDueMailings(now = Date.now()): Mailing[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM telegram_mailings
        WHERE status = 'sending'
           OR (status = 'scheduled' AND next_run_at IS NOT NULL AND next_run_at <= ?)
        ORDER BY next_run_at`,
    )
    .all(now) as any[];
  return rows.map((r) => toMailing(r, listMailingOffers(r.id)));
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

function parseTimes(times?: string): { hour: number; minute: number }[] {
  return (times || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [h, m] = t.split(":");
      return { hour: Number(h) || 0, minute: Number(m) || 0 };
    })
    .filter((t) => t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

/**
 * Quando este disparo roda pela próxima vez, no FUSO DA OPERAÇÃO (Configurações
 * → Geral). Sem isso, "todo dia às 09:00" sairia no fuso do servidor (UTC) e o
 * lead receberia às 6 da manhã.
 *
 * Devolve `null` quando não há próxima rodada (disparo de uma vez só que já
 * aconteceu, ou agenda vazia).
 */
export function computeNextRunAt(m: {
  scheduleType: MailingScheduleType;
  scheduleTimes?: string;
  scheduleWeekdays?: string;
  intervalHours?: number;
  scheduledAt?: number;
}, from = Date.now()): number | null {
  const tz = getAppTimeZone();

  if (m.scheduleType === "once") {
    if (!m.scheduledAt) return null;
    return m.scheduledAt > from ? m.scheduledAt : null;
  }

  if (m.scheduleType === "interval") {
    const hours = Math.max(1, Math.round(m.intervalHours || 24));
    return from + hours * 60 * 60 * 1000;
  }

  const times = parseTimes(m.scheduleTimes);
  if (times.length === 0) return null;

  const weekdays =
    m.scheduleType === "weekdays"
      ? (m.scheduleWeekdays || "")
          .split(",")
          .map((d) => d.trim())
          // Sem o descarte do vazio, "" viraria Number("") = 0 e uma agenda sem
          // dia nenhum passaria a valer como "todo domingo".
          .filter(Boolean)
          .map(Number)
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
  if (m.scheduleType === "weekdays" && weekdays.length === 0) return null;

  // Procura o primeiro horário válido nos próximos 8 dias de calendário do fuso.
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const probe = new Date(from + dayOffset * 24 * 60 * 60 * 1000);
    const p = partsInTimeZone(probe.getTime(), tz);
    for (const t of times) {
      const candidate = zonedWallTimeToUtcMs(p.year, p.month, p.day, t.hour, t.minute, tz);
      if (candidate <= from) continue;
      if (m.scheduleType === "weekdays") {
        // O dia da semana tem de ser o do FUSO da operação: às 21h de Brasília
        // já é o dia seguinte em UTC, e a segunda-feira viraria domingo.
        const cp = partsInTimeZone(candidate, tz);
        const localDow = new Date(Date.UTC(cp.year, cp.month - 1, cp.day)).getUTCDay();
        if (!weekdays.includes(localDow)) continue;
      }
      return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Variáveis do texto
// ---------------------------------------------------------------------------

/** Escapa o que vem do CADASTRO (nome do lead) antes de entrar no HTML enviado. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function greetingForNow(): string {
  const p = partsInTimeZone(Date.now(), getAppTimeZone());
  if (p.hour < 12) return "bom dia";
  if (p.hour < 18) return "boa tarde";
  return "boa noite";
}

/** Variáveis oferecidas na tela (só as que o Telegram realmente nos dá). */
export const MAILING_VARIABLES = [
  "{nome}",
  "{sobrenome}",
  "{usuario}",
  "{saudacao}",
  "{modelo}",
  "{bot}",
  "{id}",
] as const;

/**
 * Substitui as variáveis do texto pelos dados da pessoa. O texto do disparo é
 * escrito com as tags de formatação do Telegram (<b>, <i>, <tg-spoiler>…), por
 * isso ele NÃO é escapado — mas tudo que vem de dados é.
 */
export function renderMailingText(
  template: string,
  user: { firstName?: string; lastName?: string; username?: string; telegramUserId: number },
  ctx: { profileName?: string; botUsername?: string },
): string {
  const map: Record<string, string> = {
    nome: user.firstName || "linda(o)",
    sobrenome: user.lastName || "",
    usuario: user.username ? `@${user.username}` : user.firstName || "",
    saudacao: greetingForNow(),
    modelo: ctx.profileName || "",
    bot: ctx.botUsername ? `@${ctx.botUsername}` : "",
    id: String(user.telegramUserId),
  };
  return template.replace(/\{([a-zA-Zç.]+)\}/g, (full, key: string) => {
    // "{bot.nome}" é aceito como apelido de "{bot}" (nome usado na referência).
    const k = key.toLowerCase().replace("bot.nome", "bot").replace("nome.bot", "bot");
    const v = map[k];
    return v === undefined ? full : escapeHtml(v);
  });
}
