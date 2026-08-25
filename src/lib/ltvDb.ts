import { getDb } from "./db";
import { v4 as uuidv4 } from "uuid";
import { getAppTimeZone } from "./settings";
import { partsInTimeZone } from "./timezone";

/**
 * Acesso às tabelas `ltv_*` — o LTV da modelo conversando com o lead pela
 * conta REAL dela. Vale para os dois canais: o que muda entre WhatsApp e
 * Telegram é só o adaptador de envio (ver `ltvAgent.ts`), não o dado.
 *
 * Uma REGRA de produto mora aqui e não só na tela: no WhatsApp a modelo tem
 * vários números; no Telegram, um chip só. Dois chips para a mesma modelo
 * seriam duas IAs falando pela mesma persona no mesmo lugar.
 */

export type LtvChannel = "whatsapp" | "telegram";

export type LtvAccount = {
  id: string;
  profileId: string;
  channel: LtvChannel;
  label: string;
  externalRef?: string;
  /** Id da instância no provedor (uazapi) — como o webhook acha a conta. */
  providerRef?: string;
  status: "connected" | "connecting" | "disconnected";
  active: boolean;
  createdAt: number;
};

export type LtvAgentSettings = {
  accountId: string;
  enabled: boolean;
  approach: "aquecer" | "direto";
  personaName: string;
  toneTags: string[];
  personality: string;
  mechanism: string;
  limits: string;
  rhythm: "humano" | "fixo";
  delayMinS: number;
  delayMaxS: number;
  dailyLimit: number;
  onlyReplyFirst: boolean;
  /**
   * Teto do desconto que a IA pode dar sozinha, em %. Zero = ela nunca baixa
   * do preço de tabela. Existe porque uma IA sem teto entrega o pacote por
   * qualquer valor assim que o lead reclama do preço.
   */
  maxDiscountPct: number;
  /**
   * Amostras/prévias: ids da Galeria escolhidos a dedo na tela (não mais por
   * etiqueta). A IA sorteia um destes a cada vez que manda uma prévia.
   */
  sampleMediaIds: string[];
};

export type LtvProduct = {
  id: string;
  accountId: string;
  name: string;
  priceCents: number;
  description: string;
  deliveryKind: "media" | "videocall";
  extraMessage: string;
  sortOrder: number;
  /** Ids da Galeria na ordem em que o cliente recebe depois de pagar. */
  mediaIds: string[];
};

export type LtvAudio = {
  id: string;
  accountId: string;
  filename: string;
  path: string;
  mime?: string;
  size: number;
  context: string;
  createdAt: number;
};

export type LtvChat = {
  id: string;
  accountId: string;
  peerRef: string;
  peerName?: string;
  /** Só Telegram: sem ele o chip não resolve o lead depois de um restart. */
  peerAccessHash?: string;
  state: "active" | "paused";
  spentCents: number;
  lastInteractionAt: number;
  createdAt: number;
};

export type LtvMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  type: string;
  createdAt: number;
};

const AGENT_PADRAO: Omit<LtvAgentSettings, "accountId"> = {
  enabled: false,
  approach: "aquecer",
  personaName: "",
  toneTags: [],
  personality: "",
  mechanism: "",
  limits: "",
  rhythm: "humano",
  delayMinS: 20,
  delayMaxS: 90,
  dailyLimit: 80,
  onlyReplyFirst: true,
  maxDiscountPct: 0,
  sampleMediaIds: [],
};

/**
 * A persona (nome, tom, personalidade, mecanismo, limites) mora só no
 * cadastro da modelo agora — não é mais editada por conta de LTV (ver
 * `PersonaBlock`, removido). Toda conta do mesmo perfil usa a MESMA
 * persona; só o resto do agente (ritmo, limite diário, desconto...)
 * continua por conta.
 */
function personaDoPerfil(accountId: string): Pick<LtvAgentSettings, "personaName" | "toneTags" | "personality" | "mechanism" | "limits"> {
  const r = getDb()
    .prepare(
      `SELECT p.name, p.bio_physical, p.bio_unique, p.tone_tags, p.limits
         FROM ltv_accounts c JOIN profiles p ON p.id = c.profile_id
        WHERE c.id = ?`,
    )
    .get(accountId) as
    | { name?: string; bio_physical?: string; bio_unique?: string; tone_tags?: string; limits?: string }
    | undefined;
  let toneTags: string[] = [];
  try {
    const parsed = JSON.parse(r?.tone_tags || "[]");
    if (Array.isArray(parsed)) toneTags = parsed.filter((t) => typeof t === "string");
  } catch {
    /* cadastro com tom corrompido: melhor sem tom do que quebrar a tela */
  }
  return {
    personaName: r?.name || "",
    toneTags,
    personality: r?.bio_physical || "",
    mechanism: r?.bio_unique || "",
    limits: r?.limits || "",
  };
}

function mapAccount(r: any): LtvAccount {
  return {
    id: r.id,
    profileId: r.profile_id,
    channel: r.channel,
    label: r.label,
    externalRef: r.external_ref || undefined,
    providerRef: r.provider_ref || undefined,
    status: r.status,
    active: Boolean(r.active),
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------ contas */

export function listAccounts(profileId: string, channel?: LtvChannel): LtvAccount[] {
  const db = getDb();
  const rows = channel
    ? db
        .prepare(
          `SELECT * FROM ltv_accounts WHERE profile_id = ? AND channel = ? ORDER BY created_at`,
        )
        .all(profileId, channel)
    : db
        .prepare(`SELECT * FROM ltv_accounts WHERE profile_id = ? ORDER BY channel, created_at`)
        .all(profileId);
  return (rows as any[]).map(mapAccount);
}

export function getAccount(id: string): LtvAccount | null {
  const r = getDb().prepare(`SELECT * FROM ltv_accounts WHERE id = ?`).get(id) as any;
  return r ? mapAccount(r) : null;
}

/**
 * Acha a conta pelo que o provedor manda no webhook. Tenta o id da instância
 * primeiro e o telefone depois, porque o payload varia conforme o evento e o
 * telefone só existe depois que a conta conecta.
 */
export function findAccountByRef(channel: LtvChannel, ref: string): LtvAccount | null {
  const r = getDb()
    .prepare(
      `SELECT * FROM ltv_accounts
        WHERE channel = ? AND (provider_ref = ? OR external_ref = ?)
        LIMIT 1`,
    )
    .get(channel, ref, ref) as any;
  return r ? mapAccount(r) : null;
}

/**
 * Cria a conta. No Telegram recusa a segunda da mesma modelo com uma mensagem
 * que explica o porquê — o índice único do banco já barraria, mas com um erro
 * de SQLite que não diz nada para quem está na tela.
 */
export function createAccount(input: {
  profileId: string;
  channel: LtvChannel;
  label?: string;
  externalRef?: string;
}): LtvAccount {
  const db = getDb();
  if (input.channel === "telegram") {
    const jaTem = db
      .prepare(`SELECT id FROM ltv_accounts WHERE profile_id = ? AND channel = 'telegram'`)
      .get(input.profileId);
    if (jaTem) {
      throw new Error(
        "Esta modelo já tem um chip do Telegram. É um por modelo — desconecte o atual para trocar.",
      );
    }
  }
  const existentes = db
    .prepare(
      `SELECT COUNT(*) c FROM ltv_accounts WHERE profile_id = ? AND channel = ?`,
    )
    .get(input.profileId, input.channel) as { c: number };
  const agora = Date.now();
  const conta: LtvAccount = {
    id: uuidv4(),
    profileId: input.profileId,
    channel: input.channel,
    label: input.label || (input.channel === "telegram" ? "Chip" : `Número ${existentes.c + 1}`),
    externalRef: input.externalRef,
    status: "disconnected",
    active: true,
    createdAt: agora,
  };
  db.prepare(
    `INSERT INTO ltv_accounts
       (id, profile_id, channel, label, external_ref, status, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    conta.id,
    conta.profileId,
    conta.channel,
    conta.label,
    conta.externalRef ?? null,
    conta.status,
    agora,
    agora,
  );
  return conta;
}

export function updateAccount(
  id: string,
  patch: {
    label?: string;
    /** `null` limpa: a instância foi derrubada e a conta fica "sem número". */
    externalRef?: string | null;
    providerRef?: string | null;
    status?: LtvAccount["status"];
    active?: boolean;
    sessionEnc?: string | null;
  },
): void {
  const campos: string[] = [];
  const valores: unknown[] = [];
  const set = (col: string, v: unknown) => {
    campos.push(`${col} = ?`);
    valores.push(v);
  };
  if (patch.label !== undefined) set("label", patch.label);
  if (patch.externalRef !== undefined) set("external_ref", patch.externalRef ?? null);
  if (patch.providerRef !== undefined) set("provider_ref", patch.providerRef ?? null);
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.active !== undefined) set("active", patch.active ? 1 : 0);
  if (patch.sessionEnc !== undefined) set("session_enc", patch.sessionEnc);
  if (!campos.length) return;
  set("updated_at", Date.now());
  valores.push(id);
  getDb()
    .prepare(`UPDATE ltv_accounts SET ${campos.join(", ")} WHERE id = ?`)
    .run(...(valores as any[]));
}

export function getAccountSession(id: string): string | null {
  const r = getDb().prepare(`SELECT session_enc FROM ltv_accounts WHERE id = ?`).get(id) as
    | { session_enc: string | null }
    | undefined;
  return r?.session_enc || null;
}

export function deleteAccount(id: string): void {
  getDb().prepare(`DELETE FROM ltv_accounts WHERE id = ?`).run(id);
}

/* ------------------------------------------------------------------ agente */

export function getAgent(accountId: string): LtvAgentSettings {
  const persona = personaDoPerfil(accountId);
  const r = getDb()
    .prepare(`SELECT * FROM ltv_agent_settings WHERE account_id = ?`)
    .get(accountId) as any;
  if (!r) return { accountId, ...AGENT_PADRAO, ...persona };
  let sampleMediaIds: string[] = [];
  try {
    const parsed = JSON.parse(r.sample_media_ids || "[]");
    if (Array.isArray(parsed)) sampleMediaIds = parsed.filter((t) => typeof t === "string");
  } catch {
    /* idem: melhor sem amostra do que quebrar a tela */
  }
  return {
    accountId,
    enabled: Boolean(r.enabled),
    approach: r.approach === "direto" ? "direto" : "aquecer",
    ...persona,
    rhythm: r.rhythm === "fixo" ? "fixo" : "humano",
    delayMinS: r.delay_min_s,
    delayMaxS: r.delay_max_s,
    dailyLimit: r.daily_limit,
    onlyReplyFirst: Boolean(r.only_reply_first),
    maxDiscountPct: r.max_discount_pct ?? 0,
    sampleMediaIds,
  };
}

export function saveAgent(accountId: string, patch: Partial<LtvAgentSettings>): LtvAgentSettings {
  const atual = getAgent(accountId);
  const novo: LtvAgentSettings = { ...atual, ...patch, accountId };
  // A janela invertida (mín > máx) faria o sorteio do ritmo devolver NaN e a
  // IA responder na hora — justamente o que o modo humano evita.
  novo.delayMinS = Math.max(0, Math.round(novo.delayMinS));
  novo.delayMaxS = Math.max(novo.delayMinS, Math.round(novo.delayMaxS));
  novo.dailyLimit = Math.max(0, Math.round(novo.dailyLimit));
  // Acima de 100% o preço viraria negativo e a cobrança seria recusada pela
  // SyncPay com um erro que ninguém entenderia olhando a conversa.
  novo.maxDiscountPct = Math.min(100, Math.max(0, Math.round(novo.maxDiscountPct)));
  // Persona (nome/tom/personalidade/mecanismo/limites) NÃO é mais gravada
  // aqui — mora só no cadastro da modelo (ver `personaDoPerfil`). A tela
  // de LTV não manda mais esses campos (PersonaBlock foi removido), mas
  // mesmo que algum chamador antigo mandasse, esta função os ignora.
  getDb()
    .prepare(
      `INSERT INTO ltv_agent_settings
         (account_id, enabled, approach, rhythm, delay_min_s, delay_max_s, daily_limit,
          only_reply_first, max_discount_pct, sample_media_ids)
       VALUES (@accountId, @enabled, @approach, @rhythm, @delayMinS, @delayMaxS, @dailyLimit,
               @onlyReplyFirst, @maxDiscountPct, @sampleMediaIds)
       ON CONFLICT(account_id) DO UPDATE SET
         enabled = excluded.enabled,
         approach = excluded.approach,
         rhythm = excluded.rhythm,
         delay_min_s = excluded.delay_min_s,
         delay_max_s = excluded.delay_max_s,
         daily_limit = excluded.daily_limit,
         only_reply_first = excluded.only_reply_first,
         max_discount_pct = excluded.max_discount_pct,
         sample_media_ids = excluded.sample_media_ids`,
    )
    .run({
      accountId,
      enabled: novo.enabled ? 1 : 0,
      approach: novo.approach,
      rhythm: novo.rhythm,
      delayMinS: novo.delayMinS,
      delayMaxS: novo.delayMaxS,
      dailyLimit: novo.dailyLimit,
      onlyReplyFirst: novo.onlyReplyFirst ? 1 : 0,
      maxDiscountPct: novo.maxDiscountPct,
      sampleMediaIds: JSON.stringify(novo.sampleMediaIds || []),
    });
  return { ...novo, ...personaDoPerfil(accountId) };
}

/* ---------------------------------------------------------------- produtos */

export function listProducts(accountId: string): LtvProduct[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM ltv_products WHERE account_id = ? ORDER BY sort_order, created_at`)
    .all(accountId) as any[];
  const midias = db.prepare(
    `SELECT media_id FROM ltv_product_media WHERE product_id = ? ORDER BY sort_order`,
  );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    priceCents: r.price_cents,
    description: r.description || "",
    deliveryKind: r.delivery_kind === "videocall" ? "videocall" : "media",
    extraMessage: r.extra_message || "",
    sortOrder: r.sort_order,
    mediaIds: (midias.all(r.id) as { media_id: string }[]).map((m) => m.media_id),
  }));
}

export function getProduct(id: string): LtvProduct | null {
  const r = getDb().prepare(`SELECT account_id FROM ltv_products WHERE id = ?`).get(id) as
    | { account_id: string }
    | undefined;
  if (!r) return null;
  return listProducts(r.account_id).find((p) => p.id === id) || null;
}

/**
 * Grava a lista inteira de produtos de uma conta de uma vez — é assim que a
 * tela funciona (um "Salvar atendente" no fim, não um salvamento por linha).
 * Numa transação: metade dos produtos salvos seria pior que nenhum.
 */
export type LtvProductInput = Omit<LtvProduct, "id" | "accountId" | "sortOrder"> & {
  /** Ausente = produto novo. */
  id?: string;
};

export function saveProducts(accountId: string, produtos: LtvProductInput[]): LtvProduct[] {
  const db = getDb();
  const agora = Date.now();
  const gravar = db.transaction(() => {
    const manter = new Set<string>();
    produtos.forEach((p, i) => {
      const id = p.id || uuidv4();
      manter.add(id);
      db.prepare(
        `INSERT INTO ltv_products
           (id, account_id, name, price_cents, description, delivery_kind, extra_message, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           price_cents = excluded.price_cents,
           description = excluded.description,
           delivery_kind = excluded.delivery_kind,
           extra_message = excluded.extra_message,
           sort_order = excluded.sort_order`,
      ).run(
        id,
        accountId,
        p.name,
        Math.max(0, Math.round(p.priceCents)),
        p.description || "",
        p.deliveryKind === "videocall" ? "videocall" : "media",
        p.extraMessage || "",
        i,
        agora,
      );
      db.prepare(`DELETE FROM ltv_product_media WHERE product_id = ?`).run(id);
      const vincula = db.prepare(
        `INSERT OR IGNORE INTO ltv_product_media (product_id, media_id, sort_order) VALUES (?, ?, ?)`,
      );
      (p.mediaIds || []).forEach((mediaId, ordem) => vincula.run(id, mediaId, ordem));
    });
    // Produto apagado na tela some do banco — mas só desta conta.
    const antigos = db
      .prepare(`SELECT id FROM ltv_products WHERE account_id = ?`)
      .all(accountId) as { id: string }[];
    for (const a of antigos) {
      if (!manter.has(a.id)) db.prepare(`DELETE FROM ltv_products WHERE id = ?`).run(a.id);
    }
  });
  gravar();
  return listProducts(accountId);
}

/**
 * Clona os produtos de outra conta — é o "Copiar do WhatsApp" da tela. Os
 * copiados entram DEPOIS dos que já existem, com id novo: copiar é acrescentar,
 * não substituir o que a pessoa já cadastrou aqui.
 */
export function copyProducts(deAccountId: string, paraAccountId: string): LtvProduct[] {
  const origem = listProducts(deAccountId);
  if (!origem.length) return listProducts(paraAccountId);
  const destino = listProducts(paraAccountId);
  return saveProducts(paraAccountId, [
    ...destino,
    ...origem.map(({ id, ...resto }) => resto),
  ]);
}

/* ------------------------------------------------------------------ áudios */

export function listAudios(accountId: string): LtvAudio[] {
  const rows = getDb()
    .prepare(`SELECT * FROM ltv_audios WHERE account_id = ? ORDER BY created_at`)
    .all(accountId) as any[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    filename: r.filename,
    path: r.path,
    mime: r.mime || undefined,
    size: r.size,
    context: r.context || "",
    createdAt: r.created_at,
  }));
}

export function insertAudio(input: Omit<LtvAudio, "id" | "createdAt">): LtvAudio {
  const audio: LtvAudio = { ...input, id: uuidv4(), createdAt: Date.now() };
  getDb()
    .prepare(
      `INSERT INTO ltv_audios (id, account_id, filename, path, mime, size, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      audio.id,
      audio.accountId,
      audio.filename,
      audio.path,
      audio.mime ?? null,
      audio.size,
      audio.context,
      audio.createdAt,
    );
  return audio;
}

export function updateAudioContext(id: string, context: string): void {
  getDb().prepare(`UPDATE ltv_audios SET context = ? WHERE id = ?`).run(context, id);
}

export function getAudio(id: string): LtvAudio | null {
  const r = getDb().prepare(`SELECT * FROM ltv_audios WHERE id = ?`).get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    accountId: r.account_id,
    filename: r.filename,
    path: r.path,
    mime: r.mime || undefined,
    size: r.size,
    context: r.context || "",
    createdAt: r.created_at,
  };
}

export function deleteAudio(id: string): void {
  getDb().prepare(`DELETE FROM ltv_audios WHERE id = ?`).run(id);
}

/* --------------------------------------------------------- conversa e lead */

function mapChat(r: any): LtvChat {
  return {
    id: r.id,
    accountId: r.account_id,
    peerRef: r.peer_ref,
    peerName: r.peer_name || undefined,
    peerAccessHash: r.peer_access_hash || undefined,
    state: r.state === "paused" ? "paused" : "active",
    spentCents: r.spent_cents,
    lastInteractionAt: r.last_interaction_at,
    createdAt: r.created_at,
  };
}

export function ensureChat(
  accountId: string,
  peerRef: string,
  peerName?: string,
  peerAccessHash?: string,
): LtvChat {
  const db = getDb();
  const existente = db
    .prepare(`SELECT * FROM ltv_chats WHERE account_id = ? AND peer_ref = ?`)
    .get(accountId, peerRef) as any;
  const agora = Date.now();
  if (existente) {
    // O nome do lead pode chegar depois da primeira mensagem (ou mudar). O
    // access_hash é reescrito sempre que chega: ele muda quando o lead troca
    // de conta ou o Telegram o rotaciona, e um hash velho faz o envio falhar.
    if (peerName && peerName !== existente.peer_name) {
      db.prepare(`UPDATE ltv_chats SET peer_name = ? WHERE id = ?`).run(peerName, existente.id);
      existente.peer_name = peerName;
    }
    if (peerAccessHash && peerAccessHash !== existente.peer_access_hash) {
      db.prepare(`UPDATE ltv_chats SET peer_access_hash = ? WHERE id = ?`).run(
        peerAccessHash,
        existente.id,
      );
      existente.peer_access_hash = peerAccessHash;
    }
    return mapChat(existente);
  }
  const chat: LtvChat = {
    id: uuidv4(),
    accountId,
    peerRef,
    peerName,
    peerAccessHash,
    state: "active",
    spentCents: 0,
    lastInteractionAt: agora,
    createdAt: agora,
  };
  db.prepare(
    `INSERT INTO ltv_chats
       (id, account_id, peer_ref, peer_name, peer_access_hash, state, spent_cents,
        last_interaction_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
  ).run(chat.id, accountId, peerRef, peerName ?? null, peerAccessHash ?? null, agora, agora);
  return chat;
}

export function getChat(id: string): LtvChat | null {
  const r = getDb().prepare(`SELECT * FROM ltv_chats WHERE id = ?`).get(id) as any;
  return r ? mapChat(r) : null;
}

export function setChatState(id: string, state: "active" | "paused"): void {
  getDb().prepare(`UPDATE ltv_chats SET state = ? WHERE id = ?`).run(state, id);
}

export function touchChat(id: string): void {
  getDb()
    .prepare(`UPDATE ltv_chats SET last_interaction_at = ? WHERE id = ?`)
    .run(Date.now(), id);
}

export function insertMessage(input: {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  type?: string;
}): LtvMessage {
  const msg: LtvMessage = {
    id: uuidv4(),
    chatId: input.chatId,
    role: input.role,
    content: input.content,
    type: input.type || "text",
    createdAt: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO ltv_messages (id, chat_id, role, content, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(msg.id, msg.chatId, msg.role, msg.content, msg.type, msg.createdAt);
  touchChat(input.chatId);
  return msg;
}

export function listMessages(chatId: string, limite = 200): LtvMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM ltv_messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(chatId, limite) as any[];
  return rows
    .map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      role: r.role,
      content: r.content,
      type: r.type || "text",
      createdAt: r.created_at,
    }))
    .reverse();
}

/**
 * Por quantos dias a conversa de cada lead fica guardada.
 *
 * Não é só espaço em disco: é o que a modelo (e a IA) conseguem lembrar do
 * lead quando ele volta semanas depois. Quarenta dias cobrem o ciclo inteiro de
 * um lead que some e reaparece, e mantêm o banco num tamanho que o SQLite lê
 * rápido.
 */
export const DIAS_DE_MEMORIA = 40;

/**
 * Apaga a conversa que passou de {@link DIAS_DE_MEMORIA}, de vez.
 *
 * Apaga MENSAGEM, não conversa: o `ltv_chats` fica, com o quanto o lead já
 * gastou e a etiqueta dele. Perder a linha do chat perderia também o histórico
 * de compra que alimenta o Funil de LTV — e o pedido era esquecer o que foi
 * conversado, não que o cliente existiu.
 *
 * Devolve quantas mensagens saíram.
 */
export function limparMensagensAntigas(dias = DIAS_DE_MEMORIA): number {
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const r = getDb().prepare("DELETE FROM ltv_messages WHERE created_at < ?").run(corte);
  return r.changes;
}

/**
 * O que este lead JÁ COMPROU — nome do produto, valor e quando.
 *
 * Vai no prompt junto do histórico. Sem isso a IA reoferece o pacote que o cara
 * pagou semana passada, que é a forma mais rápida de queimar um cliente bom.
 */
export function comprasDoLead(chatId: string): { nome: string; cents: number; quando: number }[] {
  return getDb()
    .prepare(
      `SELECT COALESCE(p.name, 'pacote') nome, o.amount_cents cents, o.created_at quando
         FROM ltv_orders o
         LEFT JOIN ltv_products p ON p.id = o.product_id
        WHERE o.chat_id = ? AND o.status = 'paid'
        ORDER BY o.created_at`,
    )
    .all(chatId) as { nome: string; cents: number; quando: number }[];
}

export type LtvLead = LtvChat & { lastMessage: string; accountLabel: string };

/** A lista do Painel LTV: lead, quanto já gastou e a última mensagem. */
export function listLeads(accountId: string, busca?: string): LtvLead[] {
  const termo = (busca || "").trim().toLowerCase();
  const rows = getDb()
    .prepare(
      `SELECT c.*, a.label AS account_label,
              (SELECT m.content FROM ltv_messages m
                WHERE m.chat_id = c.id
                ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message
         FROM ltv_chats c
         JOIN ltv_accounts a ON a.id = c.account_id
        WHERE c.account_id = ?
        ORDER BY c.last_interaction_at DESC`,
    )
    .all(accountId) as any[];
  return rows
    .map((r) => ({
      ...mapChat(r),
      lastMessage: r.last_message || "",
      accountLabel: r.account_label,
    }))
    .filter(
      (l) =>
        !termo ||
        (l.peerName || "").toLowerCase().includes(termo) ||
        l.peerRef.toLowerCase().includes(termo),
    );
}

export type LtvResumo = { leads: number; compradores: number; receitaCents: number };

export function accountSummary(accountId: string): LtvResumo {
  const db = getDb();
  const { leads } = db
    .prepare(`SELECT COUNT(*) leads FROM ltv_chats WHERE account_id = ?`)
    .get(accountId) as { leads: number };
  const r = db
    .prepare(
      `SELECT COUNT(DISTINCT c.id) compradores, COALESCE(SUM(o.amount_cents), 0) receita
         FROM ltv_orders o
         JOIN ltv_chats c ON c.id = o.chat_id
        WHERE c.account_id = ? AND o.status = 'paid'`,
    )
    .get(accountId) as { compradores: number; receita: number };
  return { leads, compradores: r.compradores, receitaCents: r.receita };
}

/* ------------------------------------------------------------------ vendas */

export type LtvOrder = {
  id: string;
  chatId: string;
  productId?: string;
  transactionId?: string;
  amountCents: number;
  /** O preço de tabela na hora da venda — a diferença é o desconto dado. */
  listPriceCents?: number;
  status: "pending" | "paid" | "canceled";
  source: "ia" | "manual";
  deliveredAt?: number;
  createdAt: number;
};

export function createOrder(input: {
  chatId: string;
  productId?: string;
  transactionId?: string;
  amountCents: number;
  listPriceCents?: number;
  source?: "ia" | "manual";
  status?: "pending" | "paid";
}): LtvOrder {
  const order: LtvOrder = {
    id: uuidv4(),
    chatId: input.chatId,
    productId: input.productId,
    transactionId: input.transactionId,
    amountCents: input.amountCents,
    listPriceCents: input.listPriceCents,
    status: input.status || "pending",
    source: input.source || "ia",
    createdAt: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO ltv_orders
         (id, chat_id, product_id, transaction_id, amount_cents, list_price_cents,
          status, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      order.id,
      order.chatId,
      order.productId ?? null,
      order.transactionId ?? null,
      order.amountCents,
      order.listPriceCents ?? null,
      order.status,
      order.source,
      order.createdAt,
    );
  if (order.status === "paid") somarGasto(order.chatId, order.amountCents);
  return order;
}

export function findOrderByTransaction(transactionId: string): LtvOrder | null {
  const r = getDb()
    .prepare(`SELECT * FROM ltv_orders WHERE transaction_id = ?`)
    .get(transactionId) as any;
  if (!r) return null;
  return {
    id: r.id,
    chatId: r.chat_id,
    productId: r.product_id || undefined,
    transactionId: r.transaction_id || undefined,
    amountCents: r.amount_cents,
    listPriceCents: r.list_price_cents ?? undefined,
    status: r.status,
    source: r.source,
    deliveredAt: r.delivered_at || undefined,
    createdAt: r.created_at,
  };
}

function somarGasto(chatId: string, cents: number) {
  getDb()
    .prepare(`UPDATE ltv_chats SET spent_cents = spent_cents + ? WHERE id = ?`)
    .run(cents, chatId);
}

/**
 * Marca a venda como paga. Devolve `false` se ela JÁ estava paga — a SyncPay
 * reenvia o mesmo webhook, e sem essa trava o cliente receberia o pacote de
 * fotos duas vezes e o faturamento contaria a venda em dobro.
 */
export function markOrderPaid(id: string): boolean {
  const r = getDb()
    .prepare(`UPDATE ltv_orders SET status = 'paid' WHERE id = ? AND status <> 'paid'`)
    .run(id);
  if (!r.changes) return false;
  const o = getDb().prepare(`SELECT chat_id, amount_cents FROM ltv_orders WHERE id = ?`).get(id) as
    | { chat_id: string; amount_cents: number }
    | undefined;
  if (o) somarGasto(o.chat_id, o.amount_cents);
  return true;
}

export function markOrderDelivered(id: string): void {
  getDb().prepare(`UPDATE ltv_orders SET delivered_at = ? WHERE id = ?`).run(Date.now(), id);
}

/* ------------------------------------------------------- limite diário */

/**
 * O dia de hoje no fuso do painel. `toISOString()` daria o dia em UTC, e o
 * limite diário viraria às 21h no horário de Brasília — bem no meio do
 * horário de maior movimento.
 */
function diaDeHoje(): string {
  const p = partsInTimeZone(Date.now(), getAppTimeZone());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Conta uma mensagem enviada e diz se ainda cabe no limite do dia. É a
 * proteção que segura a conta viva: passar do limite é o caminho curto para
 * o bloqueio, principalmente no chip do Telegram.
 */
export function podeEnviar(accountId: string, limite: number): boolean {
  if (limite <= 0) return true; // 0 = sem limite
  const r = getDb()
    .prepare(`SELECT sent FROM ltv_daily_usage WHERE account_id = ? AND dia = ?`)
    .get(accountId, diaDeHoje()) as { sent: number } | undefined;
  return (r?.sent || 0) < limite;
}

export function contarEnvio(accountId: string): void {
  getDb()
    .prepare(
      `INSERT INTO ltv_daily_usage (account_id, dia, sent) VALUES (?, ?, 1)
       ON CONFLICT(account_id, dia) DO UPDATE SET sent = sent + 1`,
    )
    .run(accountId, diaDeHoje());
}
