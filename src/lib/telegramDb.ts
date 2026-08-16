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
  /** Ids da Galeria escolhidos a dedo para a abertura do /start, em ordem. */
  welcomeMediaIds?: string[];
  /** "album" = tudo numa mensagem; "separate" = uma mensagem por mídia. */
  welcomeMediaMode: "album" | "separate";
  /** Mostra a linha de prova social (números reais) na tela do PIX. */
  pixSocialProof: boolean;
  /** Texto da prova social. Aceita {vendas_hoje} e {assinantes}. */
  pixSocialProofText?: string;
  /** URL pública de um OGG/OPUS enviado como mensagem de voz junto do PIX. */
  pixAudioUrl?: string;
  /** Textos dos botões do PIX. Vazio = padrão. */
  pixBtnCheck?: string;
  pixBtnQr?: string;
  pixBtnCopy?: string;
  /** Resposta do "Verificar Status" quando ainda não consta como pago. */
  pixNotPaidMessage?: string;
  /** Sequência de boas-vindas ao ser aprovado nas Prévias (JSON de passos). */
  previasWelcomeFunnel?: string;
  /** Idem para o VIP. */
  vipWelcomeFunnel?: string;
};

/** Textos padrão da tela de pagamento — os mesmos que antes viviam fixos no
 *  handler do webhook. Ficam aqui para a UI conseguir mostrá-los como
 *  placeholder e oferecer um "restaurar padrão" honesto. */
export const PIX_DEFAULTS = {
  generatingMessage: "⏳ Gerando cobrança PIX...",
  /**
   * Prova social com números REAIS desta modelo — vendas pagas hoje e
   * assinantes ativos, lidos das mesmas tabelas do painel financeiro.
   *
   * De propósito não existe campo para inventar número: prova social fabricada
   * é propaganda enganosa com o cliente do outro lado, e quem responderia por
   * ela seria a operação, não o painel. Quando o número real é zero, a linha
   * simplesmente não é enviada.
   */
  socialProofText: "🔥 {vendas_hoje} pessoa(s) garantiram o acesso hoje.",
  /**
   * A tela do PIX. O `<code>` do copia-e-cola é o que faz o Telegram copiar o
   * código inteiro com UM toque — por isso a instrução "toque na chave acima"
   * só funciona com ele.
   */
  caption:
    `🌟 Você selecionou o seguinte plano:\n\n` +
    `🎁 Plano: <b>{plano}</b>\n` +
    `💰 Valor: <b>{valor}</b>\n\n` +
    `💠 Pagamento via Pix – Copia e Cola (ou QR Code, dependendo do seu banco):\n\n` +
    `<code>{pix_code}</code>\n\n` +
    `👆 Toque na chave PIX acima para copiá-la 💖\n\n` +
    `‼️ Depois de pagar, é só clicar no botão abaixo pra confirmar seu pagamento e liberar seu acesso amor, vem logo tô te esperando 👇✨`,
  /** Textos dos três botões que acompanham o PIX. */
  btnCheck: "Verificar Status do Pagamento",
  btnQr: "Mostrar QR Code",
  btnCopy: "Copiar Chave Pix",
  /** Resposta do "Verificar Status" quando a confirmação ainda não chegou. */
  notPaidMessage:
    "Ainda não identificamos seu pagamento. Se você já pagou, aguarde alguns instantes e tente novamente.",
} as const;

/**
 * Mensagens de partida de um bot NOVO. Antes eram "Bem-vindo" e "Aprovado" —
 * literalmente essas duas palavras, que ninguém deixaria no ar mas que também
 * não avisavam que precisavam ser trocadas.
 *
 * A de aprovação já vem com {link_vip}: sem ele, o cliente paga e não recebe
 * caminho nenhum para o grupo.
 */
export const MESSAGE_DEFAULTS = {
  welcome:
    "Oi meu amor 😈\n\nSeja bem-vindo! Aqui embaixo estão as opções pra você entrar no meu VIP e ver tudo o que eu não posso postar por aí 🔥\n\nEscolhe a sua e vem 👇",
  success: "✅ Pagamento aprovado meu amor! Acesse o Grupo VIP aqui:\n\n🔗 {link_vip}",
  successButton: "🔒 Acessar Conteúdo",
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
  /** Dias de acesso. 0 = VITALÍCIO (nunca expira). */
  durationDays: number;
  /** "subscription" = dá acesso VIP por N dias; "package" = compra única. */
  kind: "subscription" | "package";
  /** Conteúdo/link entregue ao pagar (bônus da assinatura ou item do pacote). */
  deliverable?: string;
  /** Posição na lista de botões do /start (menor primeiro). */
  sortOrder: number;
  /** Desligado some dos botões do bot, mas continua no painel com o histórico. */
  active: boolean;
  /** Cor de destaque na lista do painel: "" | green | blue | red. */
  highlight?: string;
  /** Botões enviados junto do entregável. */
  deliverableButtons?: { text: string; url: string }[];
  /** Oferta adicional mostrada antes de gerar o PIX deste plano. */
  bump?: OrderBump;
};

/**
 * ORDER BUMP — a oferta que aparece depois de escolher o plano.
 *
 * Aceitar SOMA o valor à mesma cobrança, em vez de criar uma segunda: dois PIX
 * deixariam um deles em aberto se o cliente desistisse no meio, e o painel
 * mostraria uma venda pendente que nunca fecharia.
 */
export type OrderBump = {
  enabled: boolean;
  name: string;
  priceCents: number;
  /** Aceita {selected_plan_name}, {order_bump_name}, {order_bump_value}, {total_value}. */
  text: string;
  acceptText?: string;
  declineText?: string;
  mediaIds?: string[];
  audioUrl?: string;
  deliverable?: string;
  deliverableButtons?: { text: string; url: string }[];
};

export const BUMP_DEFAULTS = { accept: "Aceitar", decline: "Recusar" } as const;

/**
 * Períodos com nome, no lugar de digitar dias na mão.
 *
 * `days: 0` é o VITALÍCIO: a confirmação do pagamento trata 0 como "não
 * expira", e a rotina de expiração o ignora — é o mesmo caminho que os pacotes
 * de compra única já usavam.
 */
export const PLAN_PERIODS: { key: string; label: string; days: number }[] = [
  { key: "weekly", label: "Semanal", days: 7 },
  { key: "monthly", label: "Mensal", days: 30 },
  { key: "quarterly", label: "Trimestral", days: 90 },
  { key: "semiannual", label: "Semestral", days: 180 },
  { key: "annual", label: "Anual", days: 365 },
  { key: "lifetime", label: "Vitalício", days: 0 },
];

/** Nome do período a partir dos dias (para a lista do painel). */
export function planPeriodLabel(days: number): string {
  if (days <= 0) return "Vitalício";
  const exato = PLAN_PERIODS.find((p) => p.days === days);
  return exato ? exato.label : `${days} dias`;
}

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
  /** Copia-e-cola do PIX, para os botões de QR/copiar funcionarem depois. */
  pixCode?: string;
  /** Quanto do valor pago foi do Order Bump. 0 = o cliente recusou. */
  bumpCents?: number;
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
    welcomeMediaIds: parseIds(row.welcome_media_ids),
    welcomeMediaMode: row.welcome_media_mode === "separate" ? "separate" : "album",
    pixSocialProof: !!row.pix_social_proof,
    pixSocialProofText: row.pix_social_proof_text || undefined,
    pixAudioUrl: row.pix_audio_url || undefined,
    pixBtnCheck: row.pix_btn_check || undefined,
    pixBtnQr: row.pix_btn_qr || undefined,
    pixBtnCopy: row.pix_btn_copy || undefined,
    pixNotPaidMessage: row.pix_not_paid_message || undefined,
    previasWelcomeFunnel: row.previas_welcome_funnel || undefined,
    vipWelcomeFunnel: row.vip_welcome_funnel || undefined,
  };
}

/** JSON de ids da Galeria → lista. Conteúdo corrompido vira lista vazia em vez
 *  de derrubar o carregamento do bot inteiro. */
function parseIds(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : undefined;
  } catch {
    return undefined;
  }
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
    `INSERT INTO telegram_bots (id, profile_id, bot_token, bot_username, id_vip, id_aquecimento, id_registro, support_username, welcome_message, welcome_media_tags, success_message, downsell_funnel, upsell_funnel, previews_welcome_message, operation_active, vip_approval_mode, previas_approval_mode, pix_generating_message, pix_caption, success_button_text, welcome_media_ids, welcome_media_mode, pix_social_proof, pix_social_proof_text, pix_audio_url, pix_btn_check, pix_btn_qr, pix_btn_copy, pix_not_paid_message, previas_welcome_funnel, vip_welcome_funnel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       success_button_text = excluded.success_button_text,
       welcome_media_ids = excluded.welcome_media_ids,
       welcome_media_mode = excluded.welcome_media_mode,
       pix_social_proof = excluded.pix_social_proof,
       pix_social_proof_text = excluded.pix_social_proof_text,
       pix_audio_url = excluded.pix_audio_url,
       pix_btn_check = excluded.pix_btn_check,
       pix_btn_qr = excluded.pix_btn_qr,
       pix_btn_copy = excluded.pix_btn_copy,
       pix_not_paid_message = excluded.pix_not_paid_message,
       previas_welcome_funnel = excluded.previas_welcome_funnel,
       vip_welcome_funnel = excluded.vip_welcome_funnel`
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
    config.welcomeMediaIds?.length ? JSON.stringify(config.welcomeMediaIds.slice(0, 10)) : null,
    config.welcomeMediaMode === "separate" ? "separate" : "album",
    config.pixSocialProof ? 1 : 0,
    config.pixSocialProofText?.trim() || null,
    config.pixAudioUrl?.trim() || null,
    config.pixBtnCheck?.trim() || null,
    config.pixBtnQr?.trim() || null,
    config.pixBtnCopy?.trim() || null,
    config.pixNotPaidMessage?.trim() || null,
    config.previasWelcomeFunnel?.trim() || null,
    config.vipWelcomeFunnel?.trim() || null,
    now
  );
  return getBotConfig(id)!;
}

export function deleteBotConfig(profileId: string): void {
  getDb().prepare("DELETE FROM telegram_bots WHERE profile_id = ?").run(profileId);
}

/** JSON de botões → lista. Corrompido vira `undefined` em vez de derrubar o
 *  carregamento do bot inteiro. */
function parseButtons(raw: unknown): { text: string; url: string }[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return undefined;
    return v
      .filter((b: any) => b && typeof b.text === "string" && typeof b.url === "string")
      .map((b: any) => ({ text: b.text, url: b.url }));
  } catch {
    return undefined;
  }
}

function toPlan(r: any): TelegramPlan {
  const botoes = parseButtons(r.deliverable_buttons);
  const bumpBotoes = parseButtons(r.bump_deliverable_buttons);
  return {
    id: r.id,
    botId: r.bot_id,
    name: r.name,
    priceCents: r.price_cents,
    bump: {
      enabled: !!r.bump_enabled,
      name: r.bump_name || "",
      priceCents: r.bump_price_cents || 0,
      text: r.bump_text || "",
      acceptText: r.bump_accept_text || undefined,
      declineText: r.bump_decline_text || undefined,
      mediaIds: parseIds(r.bump_media_ids),
      audioUrl: r.bump_audio_url || undefined,
      deliverable: r.bump_deliverable || undefined,
      deliverableButtons: bumpBotoes?.length ? bumpBotoes : undefined,
    },
    durationDays: r.duration_days,
    kind: r.kind === "package" ? "package" : "subscription",
    deliverable: r.deliverable || undefined,
    sortOrder: r.sort_order ?? 0,
    active: r.active === undefined || r.active === null ? true : !!r.active,
    highlight: r.highlight || undefined,
    deliverableButtons: botoes?.length ? botoes : undefined,
  };
}

/** Todos os planos do bot, na ordem escolhida — inclui os desligados, porque o
 *  PAINEL precisa vê-los. Quem monta os botões do bot usa `listActivePlans`. */
export function listPlans(botId: string): TelegramPlan[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_plans WHERE bot_id = ? ORDER BY sort_order, rowid")
    .all(botId) as any[];
  return rows.map(toPlan);
}

/** Só o que o cliente deve ver no /start e nos funis. */
export function listActivePlans(botId: string): TelegramPlan[] {
  return listPlans(botId).filter((p) => p.active);
}

export function getPlan(id: string): TelegramPlan | null {
  const row = getDb().prepare("SELECT * FROM telegram_plans WHERE id = ?").get(id) as any;
  return row ? toPlan(row) : null;
}

export function savePlan(plan: TelegramPlan): void {
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO telegram_plans (id, bot_id, name, price_cents, duration_days, kind, deliverable, sort_order, active, highlight, deliverable_buttons, bump_enabled, bump_name, bump_price_cents, bump_text, bump_accept_text, bump_decline_text, bump_media_ids, bump_audio_url, bump_deliverable, bump_deliverable_buttons, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       price_cents = excluded.price_cents,
       duration_days = excluded.duration_days,
       kind = excluded.kind,
       deliverable = excluded.deliverable,
       sort_order = excluded.sort_order,
       active = excluded.active,
       highlight = excluded.highlight,
       deliverable_buttons = excluded.deliverable_buttons,
       bump_enabled = excluded.bump_enabled,
       bump_name = excluded.bump_name,
       bump_price_cents = excluded.bump_price_cents,
       bump_text = excluded.bump_text,
       bump_accept_text = excluded.bump_accept_text,
       bump_decline_text = excluded.bump_decline_text,
       bump_media_ids = excluded.bump_media_ids,
       bump_audio_url = excluded.bump_audio_url,
       bump_deliverable = excluded.bump_deliverable,
       bump_deliverable_buttons = excluded.bump_deliverable_buttons`
  ).run(
    plan.id,
    plan.botId,
    plan.name,
    plan.priceCents,
    Math.max(0, Math.round(plan.durationDays) || 0),
    plan.kind || "subscription",
    plan.deliverable || null,
    plan.sortOrder ?? 0,
    plan.active === false ? 0 : 1,
    plan.highlight || null,
    plan.deliverableButtons?.length ? JSON.stringify(plan.deliverableButtons.slice(0, 6)) : null,
    plan.bump?.enabled ? 1 : 0,
    plan.bump?.name?.trim() || null,
    Math.max(0, Math.round(plan.bump?.priceCents || 0)),
    plan.bump?.text?.trim() || null,
    plan.bump?.acceptText?.trim() || null,
    plan.bump?.declineText?.trim() || null,
    plan.bump?.mediaIds?.length ? JSON.stringify(plan.bump.mediaIds.slice(0, 10)) : null,
    plan.bump?.audioUrl?.trim() || null,
    plan.bump?.deliverable?.trim() || null,
    plan.bump?.deliverableButtons?.length
      ? JSON.stringify(plan.bump.deliverableButtons.slice(0, 6))
      : null,
    now,
  );
}

/**
 * Quantas vendas PAGAS cada plano fez e quanto trouxe, em UMA consulta para o
 * bot inteiro — a lista de planos precisa disso para todos de uma vez.
 *
 * Passa por `telegram_subscriptions` (que guarda o plano comprado) e cruza com
 * `transactions` (que guarda o dinheiro e o status). É a mesma origem do painel
 * financeiro, então os números batem com o resto do sistema.
 */
export function planSalesStats(botId: string): Map<string, { count: number; cents: number }> {
  const rows = getDb()
    .prepare(
      `SELECT s.plan_id AS planId, COUNT(*) AS c, SUM(t.amount_cents) AS cents
         FROM telegram_subscriptions s
         JOIN transactions t ON t.id = s.transaction_id
        WHERE s.bot_id = ? AND s.plan_id IS NOT NULL AND t.status = 'paid'
        GROUP BY s.plan_id`,
    )
    .all(botId) as { planId: string; c: number; cents: number | null }[];
  const out = new Map<string, { count: number; cents: number }>();
  for (const r of rows) out.set(r.planId, { count: r.c, cents: r.cents || 0 });
  return out;
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
    pixCode: r.pix_code || undefined,
    bumpCents: r.bump_cents || 0,
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

/** Quantos assinantes ativos o bot tem AGORA (alimenta a prova social real).
 *  `expires_at > 0` exclui os pacotes de compra única, que ficam "active" com
 *  expiração zero e não são assinantes. */
export function countActiveSubscriptions(botId: string): number {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) c FROM telegram_subscriptions
        WHERE bot_id = ? AND status = 'active' AND expires_at > ?`,
    )
    .get(botId, Date.now()) as { c: number };
  return r?.c || 0;
}

export function findSubscriptionByTransaction(transactionId: string): TelegramSubscription | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_subscriptions WHERE transaction_id = ?")
    .get(transactionId) as any;
  return row ? toSubscription(row) : null;
}

export function saveSubscription(sub: TelegramSubscription): void {
  getDb().prepare(
    `INSERT INTO telegram_subscriptions (id, bot_id, transaction_id, plan_id, offer_id, telegram_user_id, telegram_username, invite_link, status, expires_at, last_upsell_at, upsell_step_index, created_at, pix_code, bump_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       expires_at = excluded.expires_at,
       invite_link = excluded.invite_link,
       telegram_username = excluded.telegram_username,
       last_upsell_at = excluded.last_upsell_at,
       upsell_step_index = excluded.upsell_step_index,
       plan_id = excluded.plan_id,
       offer_id = excluded.offer_id,
       pix_code = excluded.pix_code,
       bump_cents = excluded.bump_cents`
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
    sub.createdAt,
    sub.pixCode || null,
    Math.max(0, Math.round(sub.bumpCents || 0)),
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

// ---- Chats que o bot já viu (alimenta o botão "Detectar") ----
export type SeenChat = { chatId: string; title?: string; type?: string; lastSeenAt: number };

/**
 * Anota um chat que apareceu num update. Só GRUPOS e CANAIS interessam — o
 * privado do lead não é candidato a "grupo VIP" e só poluiria a lista.
 *
 * O título é atualizado a cada visita (grupos são renomeados), mas nunca
 * apagado por um update que venha sem ele.
 */
export function recordSeenChat(
  botId: string,
  chat: { id?: number | string; title?: string; type?: string } | undefined,
): void {
  if (!chat?.id || !chat.type || chat.type === "private") return;
  getDb()
    .prepare(
      `INSERT INTO telegram_seen_chats (bot_id, chat_id, title, type, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bot_id, chat_id) DO UPDATE SET
         title = COALESCE(excluded.title, telegram_seen_chats.title),
         type = excluded.type,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(botId, String(chat.id), chat.title || null, chat.type, Date.now());
}

export function listSeenChats(botId: string): SeenChat[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_seen_chats WHERE bot_id = ? ORDER BY last_seen_at DESC")
    .all(botId) as any[];
  return rows.map((r) => ({
    chatId: r.chat_id,
    title: r.title || undefined,
    type: r.type || undefined,
    lastSeenAt: r.last_seen_at,
  }));
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

// ---- Fila da sequência de boas-vindas pós-aprovação ----
export type ApprovalQueueRow = {
  botId: string;
  telegramUserId: number;
  grupo: "vip" | "previas";
  chatId: string;
  approvedAt: number;
  stepIndex: number;
};

/**
 * Põe (ou reinicia) alguém na sequência de boas-vindas de um grupo.
 *
 * `INSERT OR REPLACE` de propósito: se a pessoa sair e entrar de novo, ela
 * recebe a sequência do começo em vez de continuar de onde parou meses atrás.
 */
export function enqueueApproval(row: Omit<ApprovalQueueRow, "stepIndex">): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO telegram_approval_queue
         (bot_id, telegram_user_id, grupo, chat_id, approved_at, step_index)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(row.botId, row.telegramUserId, row.grupo, row.chatId, row.approvedAt);
}

export function listApprovalQueue(): ApprovalQueueRow[] {
  const rows = getDb().prepare("SELECT * FROM telegram_approval_queue").all() as any[];
  return rows.map((r) => ({
    botId: r.bot_id,
    telegramUserId: r.telegram_user_id,
    grupo: r.grupo === "vip" ? "vip" : "previas",
    chatId: r.chat_id,
    approvedAt: r.approved_at,
    stepIndex: r.step_index,
  }));
}

export function advanceApproval(row: ApprovalQueueRow, proximo: number): void {
  getDb()
    .prepare(
      `UPDATE telegram_approval_queue SET step_index = ?
        WHERE bot_id = ? AND telegram_user_id = ? AND grupo = ?`,
    )
    .run(proximo, row.botId, row.telegramUserId, row.grupo);
}

export function dequeueApproval(row: ApprovalQueueRow): void {
  getDb()
    .prepare(
      "DELETE FROM telegram_approval_queue WHERE bot_id = ? AND telegram_user_id = ? AND grupo = ?",
    )
    .run(row.botId, row.telegramUserId, row.grupo);
}
