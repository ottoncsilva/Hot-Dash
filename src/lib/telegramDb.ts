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
  welcomeMediaTags?: string;
  successMessage: string;
  downsellFunnel?: string;
  upsellFunnel?: string;
  /** Mensagem enviada ao aprovar um lead no grupo de prévias (opcional). */
  previewsWelcomeMessage?: string;
  /** Liga/desliga da operação do bot de vendas (cutover para o Hot-Dash). */
  operationActive: boolean;
  /** Regra de aprovação de quem pede entrada no grupo VIP. */
  vipApprovalMode: ApprovalMode;
  /** Regra de aprovação de quem pede entrada no grupo de Prévias. */
  previasApprovalMode: ApprovalMode;
  /** Aviso enviado enquanto a cobrança é criada. Vazio = padrão. */
  pixGeneratingMessage?: string;
  /** Legenda do PIX. Aceita {plano}, {valor} e {pix_code}. Vazio = padrão. */
  pixCaption?: string;
  /** Texto do botão de acesso ao VIP na aprovação. Vazio = link solto no texto. */
  successButtonText?: string;
};

/** Textos padrão da tela de pagamento — os mesmos que antes viviam fixos no
 *  handler do webhook. Ficam aqui para a UI conseguir mostrá-los como
 *  placeholder e oferecer um "restaurar padrão" honesto. */
export const PIX_DEFAULTS = {
  generatingMessage: "⏳ Gerando cobrança PIX...",
  caption:
    `🔑 <b>PIX gerado!</b>\n\n` +
    `📸 Escaneie o QR acima <b>ou</b> copie o código abaixo no seu app do banco:\n\n` +
    `<code>{pix_code}</code>\n\n` +
    `<i>A confirmação é imediata. Após pagar, você recebe o acesso automaticamente.</i>`,
} as const;

/**
 * O que o bot faz com um pedido de entrada no grupo:
 *   subscribers → aprova só quem tem assinatura ativa (recusa o resto);
 *   all         → aprova todo mundo (grupo gratuito, de aquecimento);
 *   manual      → não decide: o pedido fica na fila do Telegram para o admin.
 */
export type ApprovalMode = "subscribers" | "all" | "manual";

const APPROVAL_MODES: ApprovalMode[] = ["subscribers", "all", "manual"];

/** Lê um modo vindo do banco ou da UI, caindo no padrão se vier lixo. */
export function toApprovalMode(value: unknown, fallback: ApprovalMode): ApprovalMode {
  return APPROVAL_MODES.includes(value as ApprovalMode) ? (value as ApprovalMode) : fallback;
}

export type TelegramPlan = {
  id: string;
  botId: string;
  name: string;
  priceCents: number;
  durationDays: number;
  /** "subscription" = dá acesso VIP por N dias; "package" = compra única. */
  kind: "subscription" | "package";
  /** Conteúdo/link entregue ao pagar (bônus da assinatura ou item do pacote). */
  deliverable?: string;
};

export type TelegramSubscription = {
  id: string;
  botId: string;
  transactionId?: string;
  planId?: string;
  /** Oferta de um MAILING (nome/preço/duração só daquele disparo), se veio de lá. */
  offerId?: string;
  telegramUserId: number;
  telegramUsername?: string;
  inviteLink?: string;
  status: "pending" | "active" | "expired" | "blocked";
  expiresAt: number;
  lastUpsellAt?: number;
  upsellStepIndex: number;
  createdAt: number;
};

/** Linha do banco → config do bot. Um lugar só: as duas consultas abaixo
 *  liam os mesmos campos em cópias separadas, e um campo novo tinha de ser
 *  lembrado nas duas. */
function toBotConfig(row: any): TelegramBotConfig {
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
    welcomeMediaTags: row.welcome_media_tags || undefined,
    successMessage: row.success_message,
    downsellFunnel: row.downsell_funnel || undefined,
    upsellFunnel: row.upsell_funnel || undefined,
    previewsWelcomeMessage: row.previews_welcome_message || undefined,
    operationActive: !!row.operation_active,
    vipApprovalMode: toApprovalMode(row.vip_approval_mode, "subscribers"),
    previasApprovalMode: toApprovalMode(row.previas_approval_mode, "all"),
    pixGeneratingMessage: row.pix_generating_message || undefined,
    pixCaption: row.pix_caption || undefined,
    successButtonText: row.success_button_text || undefined,
  };
}

export function getBotConfigByProfile(profileId: string): TelegramBotConfig | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_bots WHERE profile_id = ?")
    .get(profileId) as any;
  return row ? toBotConfig(row) : null;
}

export function getBotConfig(id: string): TelegramBotConfig | null {
  const row = getDb().prepare("SELECT * FROM telegram_bots WHERE id = ?").get(id) as any;
  return row ? toBotConfig(row) : null;
}

export function saveBotConfig(config: Omit<TelegramBotConfig, "id"> & { id?: string }): TelegramBotConfig {
  const db = getDb();
  const id = config.id || Math.random().toString(36).substring(2, 15);
  const now = Date.now();
  db.prepare(
    `INSERT INTO telegram_bots (id, profile_id, bot_token, bot_username, id_vip, id_aquecimento, id_registro, support_username, welcome_message, welcome_media_tags, success_message, downsell_funnel, upsell_funnel, previews_welcome_message, operation_active, vip_approval_mode, previas_approval_mode, pix_generating_message, pix_caption, success_button_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       bot_token = excluded.bot_token,
       bot_username = excluded.bot_username,
       id_vip = excluded.id_vip,
       id_aquecimento = excluded.id_aquecimento,
       id_registro = excluded.id_registro,
       support_username = excluded.support_username,
       welcome_message = excluded.welcome_message,
       welcome_media_tags = excluded.welcome_media_tags,
       success_message = excluded.success_message,
       downsell_funnel = excluded.downsell_funnel,
       upsell_funnel = excluded.upsell_funnel,
       previews_welcome_message = excluded.previews_welcome_message,
       operation_active = excluded.operation_active,
       vip_approval_mode = excluded.vip_approval_mode,
       previas_approval_mode = excluded.previas_approval_mode,
       pix_generating_message = excluded.pix_generating_message,
       pix_caption = excluded.pix_caption,
       success_button_text = excluded.success_button_text`
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
    config.welcomeMediaTags || null,
    config.successMessage,
    config.downsellFunnel || null,
    config.upsellFunnel || null,
    config.previewsWelcomeMessage || null,
    config.operationActive ? 1 : 0,
    toApprovalMode(config.vipApprovalMode, "subscribers"),
    toApprovalMode(config.previasApprovalMode, "all"),
    config.pixGeneratingMessage?.trim() || null,
    config.pixCaption?.trim() || null,
    config.successButtonText?.trim() || null,
    now
  );
  return getBotConfig(id)!;
}

export function deleteBotConfig(profileId: string): void {
  getDb().prepare("DELETE FROM telegram_bots WHERE profile_id = ?").run(profileId);
}

function toPlan(r: any): TelegramPlan {
  return {
    id: r.id,
    botId: r.bot_id,
    name: r.name,
    priceCents: r.price_cents,
    durationDays: r.duration_days,
    kind: r.kind === "package" ? "package" : "subscription",
    deliverable: r.deliverable || undefined,
  };
}

export function listPlans(botId: string): TelegramPlan[] {
  const rows = getDb().prepare("SELECT * FROM telegram_plans WHERE bot_id = ?").all(botId) as any[];
  return rows.map(toPlan);
}

export function getPlan(id: string): TelegramPlan | null {
  const row = getDb().prepare("SELECT * FROM telegram_plans WHERE id = ?").get(id) as any;
  return row ? toPlan(row) : null;
}

export function savePlan(plan: TelegramPlan): void {
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO telegram_plans (id, bot_id, name, price_cents, duration_days, kind, deliverable, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       price_cents = excluded.price_cents,
       duration_days = excluded.duration_days,
       kind = excluded.kind,
       deliverable = excluded.deliverable`
  ).run(
    plan.id,
    plan.botId,
    plan.name,
    plan.priceCents,
    plan.durationDays,
    plan.kind || "subscription",
    plan.deliverable || null,
    now,
  );
}

export function deletePlan(id: string): void {
  getDb().prepare("DELETE FROM telegram_plans WHERE id = ?").run(id);
}

function toSubscription(r: any): TelegramSubscription {
  return {
    id: r.id,
    botId: r.bot_id,
    transactionId: r.transaction_id || undefined,
    planId: r.plan_id || undefined,
    offerId: r.offer_id || undefined,
    telegramUserId: r.telegram_user_id,
    telegramUsername: r.telegram_username || undefined,
    inviteLink: r.invite_link || undefined,
    status: r.status,
    expiresAt: r.expires_at,
    lastUpsellAt: r.last_upsell_at || undefined,
    upsellStepIndex: r.upsell_step_index,
    createdAt: r.created_at,
  };
}

export function listSubscriptions(botId: string): TelegramSubscription[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_subscriptions WHERE bot_id = ? ORDER BY created_at DESC")
    .all(botId) as any[];
  return rows.map(toSubscription);
}

export function getSubscription(id: string): TelegramSubscription | null {
  const row = getDb().prepare("SELECT * FROM telegram_subscriptions WHERE id = ?").get(id) as any;
  return row ? toSubscription(row) : null;
}

export function findActiveSubscription(botId: string, telegramUserId: number): TelegramSubscription | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM telegram_subscriptions WHERE bot_id = ? AND telegram_user_id = ? AND status = 'active'"
    )
    .get(botId, telegramUserId) as any;
  return row ? toSubscription(row) : null;
}

export function findSubscriptionByTransaction(transactionId: string): TelegramSubscription | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_subscriptions WHERE transaction_id = ?")
    .get(transactionId) as any;
  return row ? toSubscription(row) : null;
}

export function saveSubscription(sub: TelegramSubscription): void {
  getDb().prepare(
    `INSERT INTO telegram_subscriptions (id, bot_id, transaction_id, plan_id, offer_id, telegram_user_id, telegram_username, invite_link, status, expires_at, last_upsell_at, upsell_step_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       expires_at = excluded.expires_at,
       invite_link = excluded.invite_link,
       telegram_username = excluded.telegram_username,
       last_upsell_at = excluded.last_upsell_at,
       upsell_step_index = excluded.upsell_step_index,
       plan_id = excluded.plan_id,
       offer_id = excluded.offer_id`
  ).run(
    sub.id,
    sub.botId,
    sub.transactionId || null,
    sub.planId || null,
    sub.offerId || null,
    sub.telegramUserId,
    sub.telegramUsername || null,
    sub.inviteLink || null,
    sub.status,
    sub.expiresAt,
    sub.lastUpsellAt || null,
    sub.upsellStepIndex,
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

// ---- Trackeamento: links de divulgação (deep-link ?start=CODIGO) ----
export type TelegramSourceLink = {
  id: string;
  botId: string;
  profileId: string;
  /** O que viaja no deep-link. Só [A-Za-z0-9_-], até 40 chars (limite do /start). */
  code: string;
  /** Nome legível: "bio do Instagram", "anúncio X". */
  name: string;
  /** Slug do redirecionador público (/r/<slug>). Vazio = sem link curto. */
  slug?: string;
  createdAt: number;
};

/**
 * Sanitiza um código para o formato que sobrevive ao `/start`.
 *
 * O handler do webhook já corta o que chega em `[^\w-]` e 40 chars — se aqui
 * aceitássemos mais que isso, o código salvo na tela e o código gravado no lead
 * seriam diferentes, e a atribuição de origem apontaria para um link que não
 * existe no painel.
 */
export function sanitizeSourceCode(raw: string): string {
  return String(raw || "").trim().replace(/[^\w-]/g, "").slice(0, 40);
}

/** Mesma ideia para o slug da URL curta, que também vai aparecer numa bio. */
export function sanitizeSlug(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

function toSourceLink(r: any): TelegramSourceLink {
  return {
    id: r.id,
    botId: r.bot_id,
    profileId: r.profile_id,
    code: r.code,
    name: r.name,
    slug: r.slug || undefined,
    createdAt: r.created_at,
  };
}

export function listSourceLinks(botId: string): TelegramSourceLink[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_source_links WHERE bot_id = ? ORDER BY created_at DESC")
    .all(botId) as any[];
  return rows.map(toSourceLink);
}

/** Resolve o redirecionador público: slug → link (e daí o bot e o código). */
export function getSourceLinkBySlug(slug: string): TelegramSourceLink | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_source_links WHERE slug = ?")
    .get(slug) as any;
  return row ? toSourceLink(row) : null;
}

export function saveSourceLink(link: TelegramSourceLink): void {
  getDb().prepare(
    `INSERT INTO telegram_source_links (id, bot_id, profile_id, code, name, slug, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       code = excluded.code,
       name = excluded.name,
       slug = excluded.slug`
  ).run(
    link.id,
    link.botId,
    link.profileId,
    link.code,
    link.name,
    link.slug || null,
    link.createdAt,
  );
}

export function deleteSourceLink(id: string): void {
  getDb().prepare("DELETE FROM telegram_source_links WHERE id = ?").run(id);
}

export type SourceLinkStats = {
  /** Quantos leads deram /start por este código. */
  starts: number;
  /** PIX gerados por leads dessa origem. */
  pixGenerated: number;
  pixPaid: number;
  /** Faturamento pago atribuído ao código, em centavos. */
  paidCents: number;
};

/**
 * Desempenho por código de origem, em DUAS consultas agregadas para o perfil
 * inteiro (e não uma por link) — a tela lista todos os códigos de uma vez.
 *
 * Os `/start` vêm de telegram_leads e o dinheiro de transactions: são as mesmas
 * tabelas que o Funil de Vendas já usa, então os números batem com aquela tela.
 */
export function sourceLinkStats(profileId: string): Map<string, SourceLinkStats> {
  const db = getDb();
  const out = new Map<string, SourceLinkStats>();
  const ensure = (code: string) => {
    let s = out.get(code);
    if (!s) {
      s = { starts: 0, pixGenerated: 0, pixPaid: 0, paidCents: 0 };
      out.set(code, s);
    }
    return s;
  };

  const leads = db
    .prepare(
      `SELECT source_code AS code, COUNT(*) AS c
         FROM telegram_leads
        WHERE profile_id = ? AND source_code IS NOT NULL AND source_code <> ''
        GROUP BY source_code`,
    )
    .all(profileId) as { code: string; c: number }[];
  for (const r of leads) ensure(r.code).starts = r.c;

  const tx = db
    .prepare(
      `SELECT source_code AS code,
              COUNT(*) AS gerados,
              SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS pagos,
              SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END) AS cents
         FROM transactions
        WHERE profile_id = ? AND source_code IS NOT NULL AND source_code <> ''
        GROUP BY source_code`,
    )
    .all(profileId) as { code: string; gerados: number; pagos: number; cents: number }[];
  for (const r of tx) {
    const s = ensure(r.code);
    s.pixGenerated = r.gerados;
    s.pixPaid = r.pagos || 0;
    s.paidCents = r.cents || 0;
  }

  return out;
}

// ---- Leads (Downsell Remarketing) ----
export type TelegramLead = {
  id: string; // bot_id + chat_id
  profileId: string;
  chatId: string;
  lastInteractionAt: number;
  downsellStepIndex: number;
  createdAt: number;
  /** Código do deep-link que trouxe o lead (t.me/bot?start=CODIGO). */
  sourceCode?: string;
};

export function upsertTelegramLead(lead: TelegramLead): void {
  // O código de origem só é gravado na PRIMEIRA vez: se o mesmo lead voltar a
  // dar /start por outro link, a atribuição continua sendo do que o trouxe.
  getDb().prepare(
    `INSERT INTO telegram_leads (id, profile_id, chat_id, last_interaction_at, downsell_step_index, created_at, source_code)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_interaction_at = excluded.last_interaction_at,
       downsell_step_index = excluded.downsell_step_index,
       source_code = COALESCE(telegram_leads.source_code, excluded.source_code)`
  ).run(
    lead.id, lead.profileId, lead.chatId, lead.lastInteractionAt,
    lead.downsellStepIndex, lead.createdAt, lead.sourceCode || null,
  );
}

export function getTelegramLead(id: string): TelegramLead | null {
  const row = getDb().prepare("SELECT * FROM telegram_leads WHERE id = ?").get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    chatId: row.chat_id,
    lastInteractionAt: row.last_interaction_at,
    downsellStepIndex: row.downsell_step_index,
    createdAt: row.created_at,
    sourceCode: row.source_code || undefined,
  };
}

/** Contato do Telegram por trás de cada venda: é o que o webhook do gateway
 *  amarra na inscrição, e o que deixa o painel de pagamentos abrir a conversa
 *  com o lead. Consulta em lote — a tela lista centenas de cobranças. */
export function getTelegramContactsByTransactions(
  transactionIds: string[],
): Map<string, { userId: number; username?: string }> {
  const out = new Map<string, { userId: number; username?: string }>();
  if (transactionIds.length === 0) return out;

  // SQLite tem teto de parâmetros por consulta (999 no padrão antigo), então
  // vai em blocos em vez de um IN gigante.
  const CHUNK = 500;
  for (let i = 0; i < transactionIds.length; i += CHUNK) {
    const chunk = transactionIds.slice(i, i + CHUNK);
    const rows = getDb()
      .prepare(
        `SELECT transaction_id, telegram_user_id, telegram_username
           FROM telegram_subscriptions
          WHERE transaction_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk) as {
      transaction_id: string;
      telegram_user_id: number;
      telegram_username: string | null;
    }[];
    for (const r of rows) {
      if (!r.transaction_id) continue;
      out.set(r.transaction_id, {
        userId: r.telegram_user_id,
        username: r.telegram_username || undefined,
      });
    }
  }
  return out;
}

export function listLeadsForDownsell(): TelegramLead[] {
  const rows = getDb().prepare("SELECT * FROM telegram_leads").all() as any[];
  return rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    chatId: r.chat_id,
    lastInteractionAt: r.last_interaction_at,
    downsellStepIndex: r.downsell_step_index,
    createdAt: r.created_at,
  }));
}
