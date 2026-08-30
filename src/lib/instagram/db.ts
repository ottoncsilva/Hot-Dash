import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";
import { getAppTimeZone } from "../settings";
import { partsInTimeZone } from "../timezone";

/**
 * Acesso às tabelas `ig_*`. Separado do `ltvDb` de propósito — ver o comentário
 * do schema em `db.ts`: a janela de 24 horas da Meta é um conceito que não
 * existe nos outros dois canais, e misturar os dois mundos contaminaria o que
 * já funciona.
 */

/** A janela da Meta: só se pode responder dentro de 24h da última mensagem
 *  DO LEAD. Não é configurável porque não é nossa. */
export const JANELA_MS = 24 * 60 * 60 * 1000;

export type IgAccount = {
  id: string;
  profileId: string;
  igUserId: string;
  username?: string;
  status: "connected" | "expired" | "error" | "disconnected";
  statusDetail?: string;
  active: boolean;
  tokenExpiresAt?: number;
  connectedAt?: number;
};

export type IgAgentSettings = {
  accountId: string;
  enabled: boolean;
  ctaTarget: "bio" | "stories" | "ambos";
  delayMinS: number;
  delayMaxS: number;
  dailyLimit: number;
  maxTurns: number;
  extraNotes: string;
};

export type IgChat = {
  id: string;
  accountId: string;
  peerRef: string;
  peerName?: string;
  peerUsername?: string;
  state: "active" | "paused";
  lastInboundAt: number;
  lastInteractionAt: number;
  turns: number;
  ctaSent: boolean;
};

export type IgMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type AccountRow = {
  id: string;
  profile_id: string;
  ig_user_id: string;
  username: string | null;
  status: string;
  status_detail: string | null;
  active: number;
  token_expires_at: number | null;
  connected_at: number | null;
};

function toAccount(r: AccountRow): IgAccount {
  return {
    id: r.id,
    profileId: r.profile_id,
    igUserId: r.ig_user_id,
    username: r.username || undefined,
    status: (r.status as IgAccount["status"]) || "disconnected",
    statusDetail: r.status_detail || undefined,
    active: !!r.active,
    tokenExpiresAt: r.token_expires_at ?? undefined,
    connectedAt: r.connected_at ?? undefined,
  };
}

const CAMPOS_CONTA = `id, profile_id, ig_user_id, username, status, status_detail,
                      active, token_expires_at, connected_at`;

export function listAccounts(profileId?: string): IgAccount[] {
  const rows = profileId
    ? (getDb()
        .prepare(`SELECT ${CAMPOS_CONTA} FROM ig_accounts WHERE profile_id = ? ORDER BY created_at`)
        .all(profileId) as AccountRow[])
    : (getDb().prepare(`SELECT ${CAMPOS_CONTA} FROM ig_accounts ORDER BY created_at`).all() as AccountRow[]);
  return rows.map(toAccount);
}

export function getAccount(id: string): IgAccount | null {
  const r = getDb().prepare(`SELECT ${CAMPOS_CONTA} FROM ig_accounts WHERE id = ?`).get(id) as
    | AccountRow
    | undefined;
  return r ? toAccount(r) : null;
}

/** A conta pelo id que a Meta manda no webhook — é assim que um evento acha
 *  de quem ele é, já que o payload não fala de modelo nenhuma. */
export function getAccountByIgId(igUserId: string): IgAccount | null {
  const r = getDb().prepare(`SELECT ${CAMPOS_CONTA} FROM ig_accounts WHERE ig_user_id = ?`).get(igUserId) as
    | AccountRow
    | undefined;
  return r ? toAccount(r) : null;
}

/** O token em claro. Só o servidor chama isto. */
export function getAccountToken(accountId: string): string | null {
  const r = getDb().prepare("SELECT token_enc FROM ig_accounts WHERE id = ?").get(accountId) as
    | { token_enc: string | null }
    | undefined;
  if (!r?.token_enc) return null;
  try {
    return decryptSecret(r.token_enc);
  } catch {
    return null;
  }
}

/**
 * Grava (ou reconecta) uma conta. Chave é o `ig_user_id`: refazer o login da
 * MESMA conta atualiza o token em vez de criar uma segunda linha — senão cada
 * renovação manual duplicaria a conta e dois agentes responderiam a mesma DM.
 */
export function upsertAccount(input: {
  profileId: string;
  igUserId: string;
  username?: string;
  token: string;
  expiresInS: number;
}): IgAccount {
  const now = Date.now();
  const expiresAt = input.expiresInS > 0 ? now + input.expiresInS * 1000 : null;
  getDb()
    .prepare(
      `INSERT INTO ig_accounts
         (id, profile_id, ig_user_id, username, token_enc, token_expires_at,
          status, status_detail, active, connected_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'connected', NULL, 1, ?, ?, ?)
       ON CONFLICT(ig_user_id) DO UPDATE SET
         profile_id = excluded.profile_id,
         username = COALESCE(excluded.username, ig_accounts.username),
         token_enc = excluded.token_enc,
         token_expires_at = excluded.token_expires_at,
         status = 'connected',
         status_detail = NULL,
         connected_at = excluded.connected_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      randomUUID(),
      input.profileId,
      input.igUserId,
      input.username || null,
      encryptSecret(input.token),
      expiresAt,
      now,
      now,
      now,
    );
  return getAccountByIgId(input.igUserId)!;
}

export function setAccountToken(accountId: string, token: string, expiresInS: number): void {
  getDb()
    .prepare(
      `UPDATE ig_accounts
          SET token_enc = ?, token_expires_at = ?, status = 'connected', status_detail = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .run(encryptSecret(token), Date.now() + expiresInS * 1000, Date.now(), accountId);
}

export function setAccountStatus(
  accountId: string,
  status: IgAccount["status"],
  detail?: string,
): void {
  getDb()
    .prepare("UPDATE ig_accounts SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?")
    .run(status, detail?.slice(0, 300) || null, Date.now(), accountId);
}

export function setAccountActive(accountId: string, active: boolean): void {
  getDb()
    .prepare("UPDATE ig_accounts SET active = ?, updated_at = ? WHERE id = ?")
    .run(active ? 1 : 0, Date.now(), accountId);
}

/** Desconecta: apaga a conta e, em cascata, as conversas dela. */
export function deleteAccount(accountId: string): boolean {
  return getDb().prepare("DELETE FROM ig_accounts WHERE id = ?").run(accountId).changes > 0;
}

const PADRAO: Omit<IgAgentSettings, "accountId"> = {
  enabled: false,
  ctaTarget: "bio",
  delayMinS: 4,
  delayMaxS: 15,
  dailyLimit: 200,
  maxTurns: 6,
  extraNotes: "",
};

export function getAgentSettings(accountId: string): IgAgentSettings {
  const r = getDb().prepare("SELECT * FROM ig_agent_settings WHERE account_id = ?").get(accountId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return { accountId, ...PADRAO };
  return {
    accountId,
    enabled: !!r.enabled,
    ctaTarget: (r.cta_target as IgAgentSettings["ctaTarget"]) || "bio",
    delayMinS: Number(r.delay_min_s) || PADRAO.delayMinS,
    delayMaxS: Number(r.delay_max_s) || PADRAO.delayMaxS,
    dailyLimit: Number(r.daily_limit) ?? PADRAO.dailyLimit,
    maxTurns: Number(r.max_turns) || PADRAO.maxTurns,
    extraNotes: (r.extra_notes as string) || "",
  };
}

export function saveAgentSettings(accountId: string, patch: Partial<IgAgentSettings>): IgAgentSettings {
  const atual = getAgentSettings(accountId);
  const s = { ...atual, ...patch };
  // Faixa de atraso invertida vira uma espera negativa lá na frente; conserta
  // aqui, onde ainda dá para explicar o que aconteceu.
  if (s.delayMaxS < s.delayMinS) s.delayMaxS = s.delayMinS;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO ig_agent_settings
         (account_id, enabled, cta_target, delay_min_s, delay_max_s, daily_limit, max_turns,
          extra_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         enabled = excluded.enabled, cta_target = excluded.cta_target,
         delay_min_s = excluded.delay_min_s, delay_max_s = excluded.delay_max_s,
         daily_limit = excluded.daily_limit, max_turns = excluded.max_turns,
         extra_notes = excluded.extra_notes, updated_at = excluded.updated_at`,
    )
    .run(
      accountId,
      s.enabled ? 1 : 0,
      s.ctaTarget,
      Math.max(0, s.delayMinS),
      Math.max(0, s.delayMaxS),
      Math.max(0, s.dailyLimit),
      Math.max(1, s.maxTurns),
      s.extraNotes.slice(0, 2000),
      now,
      now,
    );
  return getAgentSettings(accountId);
}

type ChatRow = {
  id: string;
  account_id: string;
  peer_ref: string;
  peer_name: string | null;
  peer_username: string | null;
  state: string;
  last_inbound_at: number;
  last_interaction_at: number;
  turns: number;
  cta_sent: number;
};

function toChat(r: ChatRow): IgChat {
  return {
    id: r.id,
    accountId: r.account_id,
    peerRef: r.peer_ref,
    peerName: r.peer_name || undefined,
    peerUsername: r.peer_username || undefined,
    state: r.state === "paused" ? "paused" : "active",
    lastInboundAt: r.last_inbound_at,
    lastInteractionAt: r.last_interaction_at,
    turns: r.turns,
    ctaSent: !!r.cta_sent,
  };
}

export function getChat(id: string): IgChat | null {
  const r = getDb().prepare("SELECT * FROM ig_chats WHERE id = ?").get(id) as ChatRow | undefined;
  return r ? toChat(r) : null;
}

export function listChats(accountId: string, limit = 50): IgChat[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM ig_chats WHERE account_id = ?
          ORDER BY last_interaction_at DESC LIMIT ?`,
      )
      .all(accountId, limit) as ChatRow[]
  ).map(toChat);
}

/**
 * Registra a chegada de uma DM. `last_inbound_at` é o que reabre a janela de
 * 24 horas — e só ele: `last_interaction_at` anda também quando somos nós que
 * falamos, e usar esse para a janela faria o painel achar que pode responder
 * quando a Meta já fechou.
 */
export function registrarEntrada(input: {
  accountId: string;
  peerRef: string;
  peerName?: string;
  peerUsername?: string;
}): IgChat {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO ig_chats
         (id, account_id, peer_ref, peer_name, peer_username, state,
          last_inbound_at, last_interaction_at, turns, cta_sent, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 0, 0, ?)
       ON CONFLICT(account_id, peer_ref) DO UPDATE SET
         peer_name = COALESCE(excluded.peer_name, ig_chats.peer_name),
         peer_username = COALESCE(excluded.peer_username, ig_chats.peer_username),
         last_inbound_at = excluded.last_inbound_at,
         last_interaction_at = excluded.last_interaction_at`,
    )
    .run(
      randomUUID(),
      input.accountId,
      input.peerRef,
      input.peerName || null,
      input.peerUsername || null,
      now,
      now,
      now,
    );
  const r = getDb()
    .prepare("SELECT * FROM ig_chats WHERE account_id = ? AND peer_ref = ?")
    .get(input.accountId, input.peerRef) as ChatRow;
  return toChat(r);
}

/** Quanto falta da janela de 24h. Zero ou menos = não dá mais para responder. */
export function janelaRestanteMs(chat: IgChat, agora = Date.now()): number {
  return chat.lastInboundAt + JANELA_MS - agora;
}

export function setChatState(chatId: string, state: "active" | "paused"): void {
  getDb().prepare("UPDATE ig_chats SET state = ? WHERE id = ?").run(state, chatId);
}

/** Marca que respondemos: conta o turno e, quando for o caso, que o lead já foi
 *  mandado para a bio. Não mexe em `last_inbound_at` — responder não estende a
 *  janela da Meta. */
export function registrarSaida(chatId: string, mandouParaBio: boolean): void {
  getDb()
    .prepare(
      `UPDATE ig_chats
          SET turns = turns + 1,
              cta_sent = CASE WHEN ? THEN 1 ELSE cta_sent END,
              last_interaction_at = ?
        WHERE id = ?`,
    )
    .run(mandouParaBio ? 1 : 0, Date.now(), chatId);
}

export function addMessage(
  chatId: string,
  role: "user" | "assistant",
  content: string,
): void {
  getDb()
    .prepare("INSERT INTO ig_messages (id, chat_id, role, content, type, created_at) VALUES (?,?,?,?,'text',?)")
    .run(randomUUID(), chatId, role, content, Date.now());
}

export function listMessages(chatId: string, limit = 40): IgMessage[] {
  // Desempate por `rowid`: `created_at` é em MILISSEGUNDOS, e o aviso de
  // automação seguido da primeira resposta cai no mesmo milissegundo com
  // facilidade. Empatados, a ordem fica indefinida — e histórico fora de ordem
  // é entregue à IA como se a lead tivesse dito as coisas ao contrário.
  // `rowid` cresce a cada inserção, então é a ordem real de chegada.
  const rows = getDb()
    .prepare(
      `SELECT * FROM (
         SELECT rowid AS rid, id, chat_id, role, content, created_at FROM ig_messages
          WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
       ) ORDER BY created_at ASC, rid ASC`,
    )
    .all(chatId, limit) as { id: string; chat_id: string; role: string; content: string; created_at: number }[];
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    role: r.role === "assistant" ? "assistant" : "user",
    content: r.content,
    createdAt: r.created_at,
  }));
}

/** O mesmo evento chega duas vezes quando a nossa resposta demora — a Meta
 *  reenvia. Devolve true na PRIMEIRA vez que este `mid` aparece. */
export function marcarEventoNovo(mid: string): boolean {
  try {
    getDb()
      .prepare("INSERT INTO ig_seen_messages (mid, created_at) VALUES (?, ?)")
      .run(mid, Date.now());
    return true;
  } catch {
    return false; // já estava lá: é reenvio
  }
}

/** Faxina do registro de idempotência: o que passou de uma semana não volta. */
export function limparEventosAntigos(): void {
  getDb()
    .prepare("DELETE FROM ig_seen_messages WHERE created_at < ?")
    .run(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

function diaAtual(): string {
  const p = partsInTimeZone(Date.now(), getAppTimeZone());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function enviosHoje(accountId: string): number {
  const r = getDb()
    .prepare("SELECT sent FROM ig_daily_usage WHERE account_id = ? AND dia = ?")
    .get(accountId, diaAtual()) as { sent: number } | undefined;
  return r?.sent ?? 0;
}

export function contarEnvio(accountId: string): void {
  getDb()
    .prepare(
      `INSERT INTO ig_daily_usage (account_id, dia, sent) VALUES (?, ?, 1)
       ON CONFLICT(account_id, dia) DO UPDATE SET sent = ig_daily_usage.sent + 1`,
    )
    .run(accountId, diaAtual());
}
