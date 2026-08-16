import { getDb } from "./db";

/**
 * Lista de usuários do bot do Telegram — a base do Mailing.
 *
 * O que dá para saber, e como: o Telegram NÃO oferece "liste os membros deste
 * grupo" para bots (só contagem e administradores). Então a lista é montada
 * pelos eventos que o webhook recebe:
 *   • /start no privado           → a pessoa entra podendo receber mensagem;
 *   • pedido de entrada no grupo  → entra como membro do VIP ou das Prévias;
 *   • entrada/saída no grupo      → liga/desliga a marca do grupo;
 *   • bloqueio do bot             → marca `blocked` (some do disparo sozinho,
 *                                   e volta se a pessoa desbloquear).
 *
 * Só quem já falou com o bot no privado (`canDm`) pode receber um disparo —
 * é regra do Telegram, não escolha do painel: um bot não inicia conversa.
 */

export type TelegramUserSource = "start" | "compra" | "vip" | "previas" | "grupo";

export type TelegramUser = {
  id: string;
  botId: string;
  profileId: string;
  telegramUserId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatId?: string;
  canDm: boolean;
  blocked: boolean;
  inVip: boolean;
  inPrevias: boolean;
  source?: string;
  sourceCode?: string;
  lastInteractionAt?: number;
  createdAt: number;
};

/** Rótulo mostrado na lista, na ordem de prioridade em que é decidido. */
export type TelegramUserStatus = "bloqueado" | "vip" | "expirado" | "pendente" | "lead";

/**
 * A linha da tela de Usuários. É UMA lista só: a assinatura não tem tela
 * própria — ela vira a coluna de status e os dados de vencimento aqui dentro.
 * Antes eram duas listas (usuários e assinantes), e a mesma pessoa aparecia
 * nas duas sem que nada dissesse que era a mesma pessoa.
 */
export type TelegramUserWithStatus = TelegramUser & {
  status: TelegramUserStatus;
  /** Assinatura mais relevante (a ativa; senão a mais recente). */
  subscriptionId?: string;
  /** 0 = vitalício/pacote (não expira). Ausente = nunca assinou. */
  expiresAt?: number;
  /** Nome do plano comprado, quando dá para descobrir pela transação. */
  planName?: string;
};

function toUser(r: any): TelegramUser {
  return {
    id: r.id,
    botId: r.bot_id,
    profileId: r.profile_id,
    telegramUserId: r.telegram_user_id,
    username: r.username || undefined,
    firstName: r.first_name || undefined,
    lastName: r.last_name || undefined,
    chatId: r.chat_id || undefined,
    canDm: !!r.can_dm,
    blocked: !!r.blocked,
    inVip: !!r.in_vip,
    inPrevias: !!r.in_previas,
    source: r.source || undefined,
    sourceCode: r.source_code || undefined,
    lastInteractionAt: r.last_interaction_at || undefined,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Captura (chamada pelo webhook)
// ---------------------------------------------------------------------------

export type UpsertUserInput = {
  botId: string;
  profileId: string;
  telegramUserId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  /** Chat privado com o bot. Só existe depois do /start. */
  chatId?: string;
  canDm?: boolean;
  inVip?: boolean;
  inPrevias?: boolean;
  source?: TelegramUserSource;
  sourceCode?: string;
};

/**
 * Grava/atualiza um usuário visto pelo webhook.
 *
 * Os campos só somam informação: um evento de grupo (que não diz nada sobre o
 * chat privado) nunca apaga o `chat_id`/`can_dm` conquistado por um /start, e
 * `in_vip`/`in_previas` só mudam quando o evento fala daquele grupo — por isso
 * são `undefined` (não mexe) em vez de `false` (desliga).
 */
export function upsertTelegramUser(input: UpsertUserInput): void {
  const now = Date.now();
  const id = `${input.botId}_${input.telegramUserId}`;
  getDb()
    .prepare(
      `INSERT INTO telegram_users
         (id, bot_id, profile_id, telegram_user_id, username, first_name, last_name, chat_id,
          can_dm, blocked, in_vip, in_previas, source, source_code, last_interaction_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         username            = COALESCE(excluded.username, telegram_users.username),
         first_name          = COALESCE(excluded.first_name, telegram_users.first_name),
         last_name           = COALESCE(excluded.last_name, telegram_users.last_name),
         chat_id             = COALESCE(excluded.chat_id, telegram_users.chat_id),
         can_dm              = MAX(excluded.can_dm, telegram_users.can_dm),
         in_vip              = COALESCE(?, telegram_users.in_vip),
         in_previas          = COALESCE(?, telegram_users.in_previas),
         source_code         = COALESCE(telegram_users.source_code, excluded.source_code),
         last_interaction_at = excluded.last_interaction_at,
         -- Voltou a interagir ⇒ não está mais bloqueado.
         blocked             = CASE WHEN excluded.can_dm = 1 THEN 0 ELSE telegram_users.blocked END`,
    )
    .run(
      id,
      input.botId,
      input.profileId,
      input.telegramUserId,
      input.username || null,
      input.firstName || null,
      input.lastName || null,
      input.chatId || null,
      input.canDm ? 1 : 0,
      input.inVip === undefined ? 0 : input.inVip ? 1 : 0,
      input.inPrevias === undefined ? 0 : input.inPrevias ? 1 : 0,
      input.source || null,
      input.sourceCode || null,
      now,
      now,
      input.inVip === undefined ? null : input.inVip ? 1 : 0,
      input.inPrevias === undefined ? null : input.inPrevias ? 1 : 0,
    );
}

/** Marca (ou desmarca) que a pessoa bloqueou o bot — vem do evento `my_chat_member`. */
export function setTelegramUserBlocked(botId: string, telegramUserId: number, blocked: boolean): void {
  getDb()
    .prepare(
      `UPDATE telegram_users SET blocked = ?, last_interaction_at = ?
        WHERE bot_id = ? AND telegram_user_id = ?`,
    )
    .run(blocked ? 1 : 0, Date.now(), botId, telegramUserId);
}

/** Liga/desliga a marca de participação num dos grupos (entrada/saída). */
export function setTelegramUserGroup(
  botId: string,
  telegramUserId: number,
  group: "vip" | "previas",
  member: boolean,
): void {
  const col = group === "vip" ? "in_vip" : "in_previas";
  getDb()
    .prepare(`UPDATE telegram_users SET ${col} = ? WHERE bot_id = ? AND telegram_user_id = ?`)
    .run(member ? 1 : 0, botId, telegramUserId);
}

export function deleteTelegramUser(id: string): void {
  getDb().prepare("DELETE FROM telegram_users WHERE id = ?").run(id);
}

/** Carrega vários usuários de uma vez (o disparo precisa do nome de cada um). */
export function getTelegramUsersByIds(botId: string, telegramUserIds: number[]): Map<number, TelegramUser> {
  const out = new Map<number, TelegramUser>();
  if (telegramUserIds.length === 0) return out;
  const marks = telegramUserIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM telegram_users WHERE bot_id = ? AND telegram_user_id IN (${marks})`)
    .all(botId, ...telegramUserIds) as any[];
  for (const r of rows) out.set(r.telegram_user_id, toUser(r));
  return out;
}

export function getTelegramUser(id: string): TelegramUser | null {
  const row = getDb().prepare("SELECT * FROM telegram_users WHERE id = ?").get(id) as any;
  return row ? toUser(row) : null;
}

// ---------------------------------------------------------------------------
// Consulta / públicos-alvo
// ---------------------------------------------------------------------------

/** Público-alvo de um disparo. Os nomes aparecem tal e qual na tela de Mailing. */
export const AUDIENCES = [
  "todos",
  "vips",
  "novos",
  "expirados",
  "pendentes",
  "compradores",
  "previas",
  "grupo_vip",
] as const;

export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<Audience, string> = {
  todos: "Todos",
  vips: "VIPs",
  novos: "Novos",
  expirados: "Expirados",
  pendentes: "Pendentes",
  compradores: "Compradores",
  previas: "Prévias",
  grupo_vip: "Grupo VIP",
};

export const AUDIENCE_HINTS: Record<Audience, string> = {
  todos: "Todo mundo que já falou com o bot.",
  vips: "Assinatura VIP em dia.",
  novos: "Deu /start e nunca gerou cobrança.",
  expirados: "Assinatura VIP vencida.",
  pendentes: "Gerou PIX e não pagou.",
  compradores: "Já pagou pelo menos uma vez.",
  previas: "Está no grupo de prévias.",
  grupo_vip: "Está dentro do grupo VIP.",
};

/**
 * As condições de cada público, em SQL, sobre o apelido `u` (telegram_users).
 * `?` é sempre o instante atual (em ms) — quem chama monta os parâmetros na
 * mesma ordem em que os públicos aparecem.
 */
const ACTIVE_VIP = `EXISTS (SELECT 1 FROM telegram_subscriptions s
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id
     AND s.status = 'active' AND s.expires_at > ?)`;

const EVER_PAID = `EXISTS (SELECT 1 FROM telegram_subscriptions s
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id
     AND s.status IN ('active', 'expired'))`;

const HAS_EXPIRED = `EXISTS (SELECT 1 FROM telegram_subscriptions s
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id
     AND s.status = 'expired')`;

const HAS_PENDING = `EXISTS (SELECT 1 FROM telegram_subscriptions s
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id
     AND s.status = 'pending')`;

const HAS_ANY_SUB = `EXISTS (SELECT 1 FROM telegram_subscriptions s
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id)`;

/** Devolve o trecho WHERE (sem o "WHERE") e os parâmetros do público pedido. */
function audienceClause(audience: Audience, now: number): { sql: string; params: unknown[] } {
  switch (audience) {
    case "vips":
      return { sql: ACTIVE_VIP, params: [now] };
    case "novos":
      return { sql: `NOT ${HAS_ANY_SUB}`, params: [] };
    case "expirados":
      return { sql: `${HAS_EXPIRED} AND NOT ${ACTIVE_VIP}`, params: [now] };
    case "pendentes":
      return { sql: `${HAS_PENDING} AND NOT ${ACTIVE_VIP}`, params: [now] };
    case "compradores":
      return { sql: EVER_PAID, params: [] };
    case "previas":
      return { sql: "u.in_previas = 1", params: [] };
    case "grupo_vip":
      return { sql: "u.in_vip = 1", params: [] };
    case "todos":
    default:
      return { sql: "1 = 1", params: [] };
  }
}

/** Só quem o bot consegue alcançar: falou no privado e não bloqueou. */
const REACHABLE = "u.can_dm = 1 AND u.blocked = 0 AND u.chat_id IS NOT NULL";

/**
 * Destinatários de um disparo: a UNIÃO dos públicos escolhidos, sem repetir
 * ninguém (quem é VIP e comprador entra uma vez só).
 */
export function listAudienceRecipients(
  botId: string,
  audiences: Audience[],
): { telegramUserId: number; chatId: string }[] {
  const list = audiences.length > 0 ? audiences : (["todos"] as Audience[]);
  const now = Date.now();
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const a of list) {
    const { sql, params: p } = audienceClause(a, now);
    parts.push(`(${sql})`);
    params.push(...p);
  }
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT u.telegram_user_id, u.chat_id
         FROM telegram_users u
        WHERE u.bot_id = ? AND ${REACHABLE} AND (${parts.join(" OR ")})
        ORDER BY u.created_at DESC`,
    )
    .all(botId, ...params) as { telegram_user_id: number; chat_id: string }[];
  return rows.map((r) => ({ telegramUserId: r.telegram_user_id, chatId: r.chat_id }));
}

/** Quantas pessoas cada público alcança hoje (números dos cartões da tela). */
export function audienceCounts(botId: string): Record<Audience, number> {
  const now = Date.now();
  const out = {} as Record<Audience, number>;
  for (const a of AUDIENCES) {
    const { sql, params } = audienceClause(a, now);
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) c FROM telegram_users u
          WHERE u.bot_id = ? AND ${REACHABLE} AND (${sql})`,
      )
      .get(botId, ...params) as { c: number };
    out[a] = row.c;
  }
  return out;
}

/** Cartões do topo da tela de Usuários. */
export function userStats(botId: string): {
  total: number;
  vips: number;
  expirados: number;
  leads: number;
  bloqueados: number;
} {
  const db = getDb();
  const now = Date.now();
  const one = (where: string, params: unknown[] = []) =>
    (db.prepare(`SELECT COUNT(*) c FROM telegram_users u WHERE u.bot_id = ? AND ${where}`)
      .get(botId, ...params) as { c: number }).c;

  // Quem bloqueou o bot conta só em "bloqueados": é assim que o rótulo de cada
  // linha da lista é decidido, e as abas precisam bater com o que elas mostram.
  return {
    total: one("1 = 1"),
    vips: one(`u.blocked = 0 AND ${ACTIVE_VIP}`, [now]),
    expirados: one(`u.blocked = 0 AND ${HAS_EXPIRED} AND NOT ${ACTIVE_VIP}`, [now]),
    leads: one(`u.blocked = 0 AND NOT ${HAS_ANY_SUB}`),
    bloqueados: one("u.blocked = 1"),
  };
}

/**
 * Como `userStats`, mas somando TODOS os bots — é o número que o Dashboard
 * mostra. Sem `profileId`, é a operação inteira; com ele, só a modelo.
 *
 * Vale para bot com automação DESLIGADA: o webhook registra usuário, lead,
 * entrada em grupo e assinatura sem olhar essa chave. Desligado o bot não
 * dispara nada, mas continua captando.
 */
export function userStatsAll(profileId?: string): {
  total: number;
  vips: number;
  expirados: number;
  leads: number;
  bloqueados: number;
} {
  const db = getDb();
  const now = Date.now();
  const escopo = profileId ? "u.profile_id = ?" : "1 = 1";
  const base = profileId ? [profileId] : [];
  const one = (where: string, params: unknown[] = []) =>
    (
      db
        .prepare(`SELECT COUNT(*) c FROM telegram_users u WHERE ${escopo} AND ${where}`)
        .get(...base, ...params) as { c: number }
    ).c;

  return {
    total: one("1 = 1"),
    vips: one(`u.blocked = 0 AND ${ACTIVE_VIP}`, [now]),
    expirados: one(`u.blocked = 0 AND ${HAS_EXPIRED} AND NOT ${ACTIVE_VIP}`, [now]),
    leads: one(`u.blocked = 0 AND NOT ${HAS_ANY_SUB}`),
    bloqueados: one("u.blocked = 1"),
  };
}

export type UserFilter = "todos" | "vips" | "expirados" | "leads" | "bloqueados";

/**
 * Lista paginada da tela de Usuários. A busca aceita nome, @username ou o ID
 * numérico do Telegram — é como o operador procura na prática.
 */
export function listTelegramUsers(opts: {
  botId: string;
  filter?: UserFilter;
  search?: string;
  limit?: number;
  offset?: number;
}): { users: TelegramUserWithStatus[]; total: number } {
  const db = getDb();
  const now = Date.now();
  const where: string[] = ["u.bot_id = ?"];
  const params: unknown[] = [opts.botId];

  // As abas seguem o mesmo critério dos cartões (ver userStats): quem bloqueou
  // o bot aparece só em "Bloqueados".
  switch (opts.filter) {
    case "vips":
      where.push(`u.blocked = 0 AND ${ACTIVE_VIP}`);
      params.push(now);
      break;
    case "expirados":
      where.push(`u.blocked = 0 AND ${HAS_EXPIRED} AND NOT ${ACTIVE_VIP}`);
      params.push(now);
      break;
    case "leads":
      where.push(`u.blocked = 0 AND NOT ${HAS_ANY_SUB}`);
      break;
    case "bloqueados":
      where.push("u.blocked = 1");
      break;
    default:
      break;
  }

  const search = (opts.search || "").trim();
  if (search) {
    const like = `%${search.replace(/^@/, "").toLowerCase()}%`;
    where.push(
      `(LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) LIKE ?
        OR LOWER(COALESCE(u.username, '')) LIKE ?
        OR CAST(u.telegram_user_id AS TEXT) LIKE ?)`,
    );
    params.push(like, like, like);
  }

  const whereSql = where.join(" AND ");
  const total = (db
    .prepare(`SELECT COUNT(*) c FROM telegram_users u WHERE ${whereSql}`)
    .get(...params) as { c: number }).c;

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  // A assinatura entra na MESMA linha: prefere a ativa e, na falta dela, a mais
  // recente. É o que permite mostrar vencimento e plano sem uma segunda lista.
  // O plano vem da descrição da transação ("Assinatura Telegram - X"), que é o
  // único lugar onde o nome do que foi vendido fica gravado junto da cobrança.
  const rows = db
    .prepare(
      `SELECT u.*,
              ${ACTIVE_VIP}  AS is_vip,
              ${HAS_EXPIRED} AS is_expired,
              ${HAS_PENDING} AS is_pending,
              s.id         AS sub_id,
              s.expires_at AS sub_expires_at,
              p.name       AS plan_name,
              t.description AS tx_description
         FROM telegram_users u
         LEFT JOIN telegram_subscriptions s
                ON s.id = (SELECT s2.id FROM telegram_subscriptions s2
                            WHERE s2.bot_id = u.bot_id
                              AND s2.telegram_user_id = u.telegram_user_id
                            ORDER BY (s2.status = 'active') DESC, s2.created_at DESC
                            LIMIT 1)
         LEFT JOIN telegram_plans p ON p.id = s.plan_id
         LEFT JOIN transactions   t ON t.id = s.transaction_id
        WHERE ${whereSql}
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(now, ...params, limit, offset) as any[];

  const users = rows.map((r) => {
    const status: TelegramUserStatus = r.blocked
      ? "bloqueado"
      : r.is_vip
        ? "vip"
        : r.is_expired
          ? "expirado"
          : r.is_pending
            ? "pendente"
            : "lead";
    const plano =
      r.plan_name ||
      (typeof r.tx_description === "string"
        ? r.tx_description.replace(/^Assinatura(\s+Telegram)?\s*-?\s*/i, "").trim()
        : "");
    return {
      ...toUser(r),
      status,
      subscriptionId: r.sub_id || undefined,
      expiresAt: r.sub_id ? Number(r.sub_expires_at || 0) : undefined,
      planName: plano || undefined,
    };
  });

  return { users, total };
}
