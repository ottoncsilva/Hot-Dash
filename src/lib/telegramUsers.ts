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
  /** Idioma escolhido no menu internacional ("Not from Brazil?"). Ausente =
   *  português, comportamento de sempre — o lead só entra em "modo
   *  traduzido" depois de escolher um idioma ali. */
  language?: "en" | "es";
  /** `language_code` cru do Telegram — escolhe a moeda internacional. */
  languageCode?: string;
};

/**
 * Rótulo da lista, na ordem de prioridade em que é decidido.
 *
 * Quem gerou PIX e não pagou é LEAD, não uma categoria à parte: continua sendo
 * alguém que ainda não comprou. Como "pendente" ficava fora dos quatro
 * cartões, uma lista com duas pessoas nesse estado mostrava Total 2 e todos os
 * cartões zerados. Agora os quatro somam o total.
 *
 * A informação não se perde: a linha diz "PIX gerado" no detalhe, e o Mailing
 * continua tendo o público "Pendentes" separado — lá a distinção muda a
 * conversa, aqui não muda o que a pessoa é.
 */
export type TelegramUserStatus = "bloqueado" | "vip" | "expirado" | "lead";

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
  /** Gerou PIX e não pagou. Não muda o status (é lead), mas vale mostrar. */
  pixPendente?: boolean;
  /** O prazo venceu e o bot ainda NÃO conseguiu tirar a pessoa do VIP. Ele
   *  continua tentando sozinho; a marca existe para isso não ficar só num
   *  push que pode passar despercebido. */
  removalPending?: boolean;
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
    language: r.language === "en" || r.language === "es" ? r.language : undefined,
    languageCode: r.language_code || undefined,
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
  /** `language_code` cru do Telegram — decide a moeda internacional. */
  languageCode?: string;
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
          can_dm, blocked, in_vip, in_previas, source, source_code, language_code, last_interaction_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         username            = COALESCE(excluded.username, telegram_users.username),
         first_name          = COALESCE(excluded.first_name, telegram_users.first_name),
         last_name           = COALESCE(excluded.last_name, telegram_users.last_name),
         chat_id             = COALESCE(excluded.chat_id, telegram_users.chat_id),
         can_dm              = MAX(excluded.can_dm, telegram_users.can_dm),
         in_vip              = COALESCE(?, telegram_users.in_vip),
         in_previas          = COALESCE(?, telegram_users.in_previas),
         source_code         = COALESCE(telegram_users.source_code, excluded.source_code),
         -- O idioma do aparelho pode mudar (a pessoa troca de celular); vale
         -- sempre o último visto, não o primeiro.
         language_code       = COALESCE(excluded.language_code, telegram_users.language_code),
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
      input.languageCode || null,
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

/** Grava o idioma escolhido no menu internacional — vale pra sempre para
 *  aquele lead, não só para a compra em curso. */
export function setTelegramUserLanguage(botId: string, telegramUserId: number, language: "en" | "es"): void {
  getDb()
    .prepare(`UPDATE telegram_users SET language = ? WHERE bot_id = ? AND telegram_user_id = ?`)
    .run(language, botId, telegramUserId);
}

/**
 * APAGA o idioma do lead — usado quando ele declara que é do BRASIL na
 * pergunta de origem (`origin_br`).
 *
 * Sem isto, quem espiou o menu "Not from Brazil?", escolheu um idioma e
 * depois voltou pro Brasil ficava com `language` gravado pra sempre. A
 * abertura brasileira mostra reais (ela é fixa em BRL), mas os funis de
 * downsell decidem a moeda POR ESSE CAMPO — então o lead via R$ no /start e
 * depois recebia a recuperação em dólar/euro. Declarar-se brasileiro tem que
 * valer pro funil inteiro, não só pra primeira tela.
 */
export function limparTelegramUserLanguage(botId: string, telegramUserId: number): void {
  getDb()
    .prepare(`UPDATE telegram_users SET language = NULL WHERE bot_id = ? AND telegram_user_id = ?`)
    .run(botId, telegramUserId);
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
  "recorrentes",
  "pacotes",
  "order_bump",
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
  recorrentes: "Recorrentes",
  pacotes: "Pacotes",
  order_bump: "Order Bump",
  previas: "Prévias",
  grupo_vip: "Canal VIP",
};

export const AUDIENCE_HINTS: Record<Audience, string> = {
  todos: "Todo mundo que já falou com o bot.",
  vips: "Assinatura VIP em dia.",
  novos: "Deu /start e nunca gerou cobrança.",
  expirados: "Assinatura VIP vencida.",
  pendentes: "Gerou PIX e não pagou.",
  compradores: "Já pagou pelo menos uma vez.",
  recorrentes: "Comprou mais de uma vez.",
  pacotes: "Comprou um pacote (compra única).",
  order_bump: "Aceitou uma oferta adicional na hora de pagar.",
  previas: "Está no canal de prévias.",
  grupo_vip: "Está dentro do canal VIP.",
};

/**
 * As condições de cada público, em SQL, sobre o apelido `u` (telegram_users).
 * `?` é sempre o instante atual (em ms) — quem chama monta os parâmetros na
 * mesma ordem em que os públicos aparecem.
 */
/**
 * É VIP AGORA.
 *
 * Dois caminhos, porque existem dois mundos:
 *
 * 1. BOT QUE O HOT-DASH OPERA — a assinatura ativa é a verdade. Ela tem
 *    vencimento, foi criada pelo nosso checkout e é o que o despejo
 *    (`runTelegramEviction`) usa para tirar quem venceu. Continua sendo o
 *    critério, exatamente como antes.
 *
 * 2. BOT OPERADO POR FORA — não existe assinatura nenhuma: a venda não passou
 *    pelo nosso checkout, e nenhum update chega pelo webhook (ele pertence ao
 *    outro sistema). Pelo critério 1, TODO MUNDO era lead para sempre, mesmo
 *    quem estava dentro do canal — o card de VIPs ficava em zero e a aba de
 *    VIPs, vazia. Aqui a verdade é a única que dá para obter: a presença real
 *    no canal, perguntada ao Telegram por `getChatMember` (só precisa do
 *    token) e guardada em `in_vip` — ver `runTelegramVipMembershipSync`.
 *
 * A presença de canal NÃO vale para o bot que o Hot-Dash opera, de propósito.
 * Lá `in_vip = 1` sem assinatura ativa é justamente o caso "venceu e ainda não
 * saiu do canal" (`removal_pending`), que a tela mostra como EXPIRADO — chamar
 * essa pessoa de VIP esconderia o único aviso de que o despejo está falhando.
 */
const ACTIVE_VIP = `(EXISTS (SELECT 1 FROM telegram_subscriptions s
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id
     AND s.status = 'active' AND s.expires_at > ?)
   OR (u.in_vip = 1 AND EXISTS (SELECT 1 FROM telegram_bots b
        WHERE b.id = u.bot_id AND COALESCE(b.operation_active, 0) = 0)))`;

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

/** Comprou MAIS DE UMA vez — o público que já provou que renova. */
const RECORRENTE = `(SELECT COUNT(*) FROM telegram_subscriptions s
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id
     AND s.status IN ('active', 'expired')) > 1`;

/** Comprou um PACOTE (compra única). `plan_id` é o que diz o tipo. */
const COMPROU_PACOTE = `EXISTS (SELECT 1 FROM telegram_subscriptions s
   JOIN telegram_plans p ON p.id = s.plan_id
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id
     AND s.status IN ('active', 'expired') AND p.kind = 'package')`;

/** Aceitou o order bump em alguma compra — bump_cents > 0 é o registro disso. */
const ACEITOU_BUMP = `EXISTS (SELECT 1 FROM telegram_subscriptions s
   WHERE s.bot_id = u.bot_id AND s.telegram_user_id = u.telegram_user_id
     AND s.status IN ('active', 'expired') AND COALESCE(s.bump_cents, 0) > 0)`;

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
    case "recorrentes":
      return { sql: RECORRENTE, params: [] };
    case "pacotes":
      return { sql: COMPROU_PACOTE, params: [] };
    case "order_bump":
      return { sql: ACEITOU_BUMP, params: [] };
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
    // Lead = não é VIP nem expirado. Inclui quem gerou PIX e não pagou, que
    // antes não entrava em cartão nenhum e sumia da conta.
    leads: one(`u.blocked = 0 AND NOT ${ACTIVE_VIP} AND NOT ${HAS_EXPIRED}`, [now]),
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
    leads: one(`u.blocked = 0 AND NOT ${ACTIVE_VIP} AND NOT ${HAS_EXPIRED}`, [now]),
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
      where.push(`u.blocked = 0 AND NOT ${ACTIVE_VIP} AND NOT ${HAS_EXPIRED}`);
      params.push(now);
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
  // O plano vem da descrição da transação, que é o único lugar onde o nome do
  // que foi vendido fica gravado junto da cobrança. Hoje ela já é só o nome do
  // produto; o prefixo antigo ("Assinatura Telegram - X") ainda é recortado
  // abaixo para cobrir linha gravada antes da limpeza.
  const rows = db
    .prepare(
      `SELECT u.*,
              ${ACTIVE_VIP}  AS is_vip,
              ${HAS_EXPIRED} AS is_expired,
              ${HAS_PENDING} AS is_pending,
              s.id         AS sub_id,
              s.expires_at AS sub_expires_at,
              s.removal_pending AS sub_removal_pending,
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
      removalPending: Boolean(r.sub_removal_pending),
      pixPendente: Boolean(r.is_pending) && status === "lead",
    };
  });

  return { users, total };
}
