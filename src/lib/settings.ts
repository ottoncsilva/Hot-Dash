import "server-only";
import { getDb } from "./db";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  normalizeMenu,
  type MenuEntry,
} from "./navItems";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "./timezone";
import { SPLIT_RULES_PADRAO, type SplitRules } from "./origemVenda";
import {
  normalizeNotificationPrefs,
  type NotificationPrefs,
} from "./notificationTypes";

/** Lê um valor JSON da tabela settings. */
function getJson<T>(key: string, fallback: T): T {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function setJson(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, JSON.stringify(value));
}

// ---- Instagram (app da Meta) ----
/**
 * Credenciais do app da Meta que atende TODAS as modelos.
 *
 * São globais de propósito: o app é um só (modelo self-serve, ver a decisão em
 * `lib/instagram/api.ts`), e as contas do Instagram é que se conectam a ele uma
 * a uma. Guardar isso por modelo criaria N apps para cadastrar e N App Reviews
 * para pedir no dia em que a operação virar Tech Provider.
 *
 * O `verifyToken` NÃO é escolhido por ninguém: nasce sorteado na primeira vez
 * que o app é salvo. Ele é um segredo compartilhado com a Meta — a única coisa
 * que prova, no aperto de mão do webhook, que a chamada veio de lá. Pedir ao
 * operador que "invente uma palavra" produzia senha de operador ("hotdash123")
 * para um campo que ele nunca mais ia digitar, já que quem o repete para a Meta
 * agora é o próprio painel (ver `configurarWebhook`).
 */
export type InstagramAppSettingsPublic = {
  appId: string;
  hasSecret: boolean;
  verifyToken: string;
  /** Base pública do painel, para montar a redirect_uri do OAuth. */
  publicBaseUrl: string;
};

type InstagramAppStored = {
  appId?: string;
  appSecretEnc?: string;
  verifyToken?: string;
  publicBaseUrl?: string;
};

const IG_APP_KEY = "instagram_app";

export function getInstagramAppSettings(): InstagramAppSettingsPublic {
  const s = getJson<InstagramAppStored>(IG_APP_KEY, {});
  return {
    appId: s.appId || "",
    hasSecret: Boolean(s.appSecretEnc),
    verifyToken: s.verifyToken || "",
    publicBaseUrl: (s.publicBaseUrl || "").replace(/\/+$/, ""),
  };
}

/** O segredo em claro — só para o servidor, nunca para o navegador. */
export function getInstagramAppSecret(): string | null {
  const s = getJson<InstagramAppStored>(IG_APP_KEY, {});
  if (!s.appSecretEnc) return null;
  try {
    return decryptSecret(s.appSecretEnc);
  } catch {
    return null;
  }
}

export function updateInstagramAppSettings(patch: {
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  publicBaseUrl?: string;
}): InstagramAppSettingsPublic {
  const s = getJson<InstagramAppStored>(IG_APP_KEY, {});
  if (patch.appId !== undefined) s.appId = patch.appId.trim() || undefined;
  if (patch.verifyToken !== undefined) s.verifyToken = patch.verifyToken.trim() || undefined;
  // Nasce sorteado e nunca mais muda: trocá-lo depois derrubaria o webhook já
  // registrado na Meta, que guarda o valor antigo do outro lado.
  if (!s.verifyToken) s.verifyToken = randomBytes(24).toString("hex");
  if (patch.publicBaseUrl !== undefined) {
    s.publicBaseUrl = patch.publicBaseUrl.trim().replace(/\/+$/, "") || undefined;
  }
  // Segredo só é tocado quando VEM no patch: a tela nunca recebe o valor de
  // volta, então salvar o formulário sem digitá-lo de novo não pode apagá-lo.
  if (patch.appSecret !== undefined) {
    const t = patch.appSecret.trim();
    s.appSecretEnc = t ? encryptSecret(t) : undefined;
  }
  setJson(IG_APP_KEY, s);
  return getInstagramAppSettings();
}

// ---- uazapi (WhatsApp) ----
// Uma conta da uazapi tem um SERVIDOR (https://seunome.uazapi.com) e um
// admintoken. O admintoken cria instâncias; cada instância nasce com um token
// próprio, que é o que autentica todo o resto e fica cifrado junto da conta
// (ver ltv_accounts.session_enc).
export type UazapiSettingsPublic = { url?: string; hasAdminToken: boolean };
type UazapiSettingsStored = { url?: string; adminTokenEnc?: string };

function rawUazapi(): UazapiSettingsStored {
  return getJson<UazapiSettingsStored>("uazapi", {});
}

export function getUazapiSettingsPublic(): UazapiSettingsPublic {
  const s = rawUazapi();
  return { url: s.url, hasAdminToken: Boolean(s.adminTokenEnc) };
}

/** Só a base do servidor — o token de cada instância vem da conta. */
export function getUazapiBaseUrl(): string | null {
  return rawUazapi().url || null;
}

/** O admintoken só serve para criar e apagar instâncias. */
export function getUazapiAdminToken(): string | null {
  const s = rawUazapi();
  if (!s.adminTokenEnc) return null;
  try {
    return decryptSecret(s.adminTokenEnc);
  } catch {
    return null;
  }
}

export function updateUazapiSettings(patch: {
  url?: string;
  adminToken?: string;
}): UazapiSettingsPublic {
  const s = rawUazapi();
  if (patch.url !== undefined) s.url = patch.url.trim().replace(/\/+$/, "");
  if (patch.adminToken !== undefined) {
    s.adminTokenEnc = patch.adminToken ? encryptSecret(patch.adminToken) : undefined;
  }
  setJson("uazapi", s);
  return getUazapiSettingsPublic();
}

// ---- SLT (slt.bio, link na bio) ----
// UMA conta SLT cobre todas as modelos (confirmado com o operador) — por
// isso a chave mora aqui, no mesmo nível do Stripe/SyncPay, e não no
// cadastro de cada modelo. É só LEITURA do lado do SLT (a chave nem permite
// escrever nada lá), e o que ela traz (visualização/clique por página) é
// casado com as vendas pelo `page_slug` — ver `lib/sltSync.ts` e
// `trafficSources`/`sltPageStats` em `lib/salesFunnel.ts`.
export type SltSettingsPublic = {
  hasApiKey: boolean;
  /** Instante do último evento já gravado (epoch ms) — "até onde já
   *  sincronizei", não "quando rodou a última tentativa". */
  lastSyncedAt?: number;
  /** Mensagem do último erro de sincronização, se o mais recente falhou.
   *  Limpo no próximo sucesso. */
  lastSyncError?: string;
};
type SltSettingsStored = {
  apiKeyEnc?: string;
  /** Cursor `since` da API (ISO, devolvido por ela mesma como `next_since`) —
   *  formato dela, não epoch ms, para mandar de volta sem reconverter. */
  sinceCursor?: string;
  lastSyncedAt?: number;
  /** Relógio de quando a API foi CHAMADA por último (sucesso ou falha) —
   *  separado de `lastSyncedAt` porque uma tentativa vazia (nada novo)
   *  ainda precisa segurar o próximo tick por 15 minutos (recomendação da
   *  própria SLT), mesmo sem avançar o cursor. */
  lastPolledAt?: number;
  lastSyncError?: string;
};

function rawSlt(): SltSettingsStored {
  return getJson<SltSettingsStored>("slt", {});
}

export function getSltSettingsPublic(): SltSettingsPublic {
  const s = rawSlt();
  return {
    hasApiKey: Boolean(s.apiKeyEnc),
    lastSyncedAt: s.lastSyncedAt,
    lastSyncError: s.lastSyncError,
  };
}

/** Chave descriptografada (uso server-side apenas, dentro do sync). */
export function getSltApiKey(): string | null {
  const s = rawSlt();
  if (!s.apiKeyEnc) return null;
  try {
    return decryptSecret(s.apiKeyEnc);
  } catch {
    return null;
  }
}

/** Troca a chave. Nova chave zera o cursor — a sincronização recomeça do
 *  que a API tiver disponível agora (últimos 7 dias), não tenta continuar
 *  de onde a chave ANTERIOR tinha parado. */
export function updateSltApiKey(apiKey: string | undefined): SltSettingsPublic {
  const s = rawSlt();
  const trimmed = apiKey?.trim();
  if (trimmed !== undefined) {
    s.apiKeyEnc = trimmed ? encryptSecret(trimmed) : undefined;
    s.sinceCursor = undefined;
    s.lastSyncedAt = undefined;
    s.lastPolledAt = undefined;
    s.lastSyncError = undefined;
    // O catálogo guardado é da conta ANTERIOR — some com ele, senão a tela
    // de Links mostraria páginas que não são desta chave até o próximo tick.
    setJson("slt_catalogue", null);
  }
  setJson("slt", s);
  return getSltSettingsPublic();
}

/**
 * CATÁLOGO da SLT (páginas + links) guardado no banco pelo job de fundo —
 * ver `syncSltCatalogue`. A tela de Links lê daqui, sem tocar na API: o
 * custo em cota passa a ser fixo (uma sincronização a cada 15 min) em vez
 * de depender de quantas telas foram abertas. Chave própria de propósito:
 * gravar isto não reescreve o blob que guarda a chave cifrada.
 */
export type SltCatalogueStored = { pages: unknown[]; links: unknown[]; syncedAt: number };

export function getSltCatalogueStored(): SltCatalogueStored | null {
  const v = getJson<SltCatalogueStored | null>("slt_catalogue", null);
  return v && Array.isArray(v.pages) && Array.isArray(v.links) ? v : null;
}

export function setSltCatalogueStored(v: SltCatalogueStored): void {
  setJson("slt_catalogue", v);
}

export function limparSltCatalogueStored(): void {
  setJson("slt_catalogue", null);
}

/**
 * COTA da API do SLT vista na última resposta (`X-RateLimit-*`). No banco, e
 * não em memória, para o recuo depois de um 429 sobreviver a um deploy — um
 * restart no meio da janela não pode fazer o app voltar a bater na API achando
 * que tem cota.
 */
export type SltCotaStored = { restante: number | null; resetaEm: number | null };

export function getSltCotaStored(): SltCotaStored {
  return getJson<SltCotaStored>("slt_cota", { restante: null, resetaEm: null });
}

export function setSltCotaStored(v: SltCotaStored): void {
  setJson("slt_cota", v);
}

/** Estado interno do cursor — só o job de sincronização usa. */
export function getSltSyncState(): { sinceCursor?: string; lastPolledAt?: number } {
  const s = rawSlt();
  return { sinceCursor: s.sinceCursor, lastPolledAt: s.lastPolledAt };
}

export function setSltSyncState(patch: {
  sinceCursor?: string;
  lastSyncedAt?: number;
  lastPolledAt?: number;
  lastSyncError?: string | null;
}): void {
  const s = rawSlt();
  if (patch.sinceCursor !== undefined) s.sinceCursor = patch.sinceCursor;
  if (patch.lastSyncedAt !== undefined) s.lastSyncedAt = patch.lastSyncedAt;
  if (patch.lastPolledAt !== undefined) s.lastPolledAt = patch.lastPolledAt;
  if (patch.lastSyncError !== undefined) s.lastSyncError = patch.lastSyncError || undefined;
  setJson("slt", s);
}

// ---- Telegram por conta real (chip) ----
// O chip roda DENTRO do painel, então não há endereço nem segredo de serviço
// para configurar. O que sobra é a única coisa que o Telegram exige e ninguém
// pode adivinhar: as credenciais de aplicativo do MTProto, que saem de graça
// em my.telegram.org. São por conta de desenvolvedor, não por chip — um par
// serve para todas as modelos.
export type TelegramAppSettingsPublic = { apiId?: number; hasApiHash: boolean };
type TelegramAppStored = { apiId?: number; apiHashEnc?: string };

function rawTelegramApp(): TelegramAppStored {
  return getJson<TelegramAppStored>("telegram_app", {});
}

export function getTelegramAppSettingsPublic(): TelegramAppSettingsPublic {
  const s = rawTelegramApp();
  return { apiId: s.apiId, hasApiHash: Boolean(s.apiHashEnc) };
}

export function getTelegramAppCredentials(): { apiId: number; apiHash: string } | null {
  const s = rawTelegramApp();
  if (!s.apiId || !s.apiHashEnc) return null;
  try {
    return { apiId: s.apiId, apiHash: decryptSecret(s.apiHashEnc) };
  } catch {
    return null;
  }
}

export function updateTelegramAppSettings(patch: {
  apiId?: number;
  apiHash?: string;
}): TelegramAppSettingsPublic {
  const s = rawTelegramApp();
  if (patch.apiId !== undefined) s.apiId = Number(patch.apiId) || undefined;
  if (patch.apiHash !== undefined) {
    s.apiHashEnc = patch.apiHash ? encryptSecret(patch.apiHash) : undefined;
  }
  setJson("telegram_app", s);
  return getTelegramAppSettingsPublic();
}

// ---- Menu ----
export function getMenu(): MenuEntry[] {
  return normalizeMenu(getJson<MenuEntry[]>("menu", []));
}

export function setMenu(menu: MenuEntry[]): MenuEntry[] {
  const normalized = normalizeMenu(menu);
  setJson("menu", normalized);
  return normalized;
}

// ---- Configuração de pagamentos ----
export type PaymentSettingsPublic = {
  syncpay: {
    enabled: boolean;
    hasSecret: boolean;
    clientId: string;
    /** Token da URL do webhook (/w/…), a que se cola no painel do gateway. */
    webhookShort: string;
  };
  stripe: {
    enabled: boolean;
    hasSecretKey: boolean;
    hasWebhookSecret: boolean;
  };
};

type PaymentSettingsStored = {
  syncpay: {
    enabled: boolean;
    clientId?: string;
    clientSecretEnc?: string;
    webhookShort?: string;
  };
  stripe?: {
    enabled: boolean;
    secretKeyEnc?: string;
    webhookSecretEnc?: string;
  };
};

function rawPayments(): PaymentSettingsStored {
  const s = getJson<PaymentSettingsStored>("payments", {
    syncpay: { enabled: false },
  });
  if (!s.stripe) s.stripe = { enabled: false };
  return s;
}

/**
 * Token que autentica o webhook da SyncPay (vai como ?token= na postbackUrl).
 * Gerado uma única vez e guardado; estável entre deploys. Não usa o
 * SESSION_SECRET para não acoplar a autenticação do webhook à sessão.
 */
/**
 * Token do webhook, usado na URL `/w/<token>`.
 *
 * 16 caracteres em base62 dão ~95 bits de entropia — mais do que suficiente
 * para um endpoint que só aceita POST e não devolve nada além de `{ok:true}`.
 * A URL antiga, de 95 caracteres com o token na query, foi aposentada.
 */
export function ensureSyncpayWebhookShortToken(): string {
  const s = rawPayments();
  if (!s.syncpay) s.syncpay = { enabled: false };
  if (!s.syncpay.webhookShort) {
    const alfabeto = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = randomBytes(16);
    s.syncpay.webhookShort = Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
    setJson("payments", s);
  }
  return s.syncpay.webhookShort;
}

/** Versão segura para enviar ao cliente (os tokens vão junto porque o
 *  usuário precisa deles para montar a URL a colar na SyncPay). */
export function getPaymentSettingsPublic(): PaymentSettingsPublic {
  const s = rawPayments();
  return {
    syncpay: {
      enabled: Boolean(s.syncpay?.enabled),
      hasSecret: Boolean(s.syncpay?.clientId && s.syncpay?.clientSecretEnc),
      clientId: s.syncpay?.clientId || "",
      webhookShort: ensureSyncpayWebhookShortToken(),
    },
    stripe: {
      enabled: Boolean(s.stripe?.enabled),
      hasSecretKey: Boolean(s.stripe?.secretKeyEnc),
      hasWebhookSecret: Boolean(s.stripe?.webhookSecretEnc),
    },
  };
}

/** Credenciais descriptografadas da SyncPay (uso server-side apenas). */
export function getSyncPayCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const s = rawPayments();
  if (!s.syncpay?.clientId || !s.syncpay?.clientSecretEnc) return null;
  try {
    return {
      clientId: s.syncpay.clientId,
      clientSecret: decryptSecret(s.syncpay.clientSecretEnc),
    };
  } catch {
    return null;
  }
}

/** Credenciais descriptografadas da Stripe (uso server-side apenas). */
export function getStripeCredentials(): {
  secretKey: string;
  webhookSecret: string;
} | null {
  const s = rawPayments();
  if (!s.stripe?.secretKeyEnc || !s.stripe?.webhookSecretEnc) return null;
  try {
    return {
      secretKey: decryptSecret(s.stripe.secretKeyEnc),
      webhookSecret: decryptSecret(s.stripe.webhookSecretEnc),
    };
  } catch {
    return null;
  }
}

export function updatePaymentSettings(patch: {
  syncpay?: { enabled?: boolean; clientId?: string; clientSecret?: string };
  stripe?: { enabled?: boolean; secretKey?: string; webhookSecret?: string };
}): PaymentSettingsPublic {
  const s = rawPayments();

  if (patch.syncpay) {
    if (patch.syncpay.enabled !== undefined)
      s.syncpay.enabled = patch.syncpay.enabled;
    if (patch.syncpay.clientId !== undefined)
      s.syncpay.clientId = patch.syncpay.clientId.trim();
    if (patch.syncpay.clientSecret !== undefined) {
      s.syncpay.clientSecretEnc = patch.syncpay.clientSecret
        ? encryptSecret(patch.syncpay.clientSecret)
        : undefined;
    }
  }
  if (patch.stripe) {
    if (!s.stripe) s.stripe = { enabled: false };
    if (patch.stripe.enabled !== undefined) s.stripe.enabled = patch.stripe.enabled;
    if (patch.stripe.secretKey !== undefined) {
      s.stripe.secretKeyEnc = patch.stripe.secretKey
        ? encryptSecret(patch.stripe.secretKey)
        : undefined;
    }
    if (patch.stripe.webhookSecret !== undefined) {
      s.stripe.webhookSecretEnc = patch.stripe.webhookSecret
        ? encryptSecret(patch.stripe.webhookSecret)
        : undefined;
    }
  }
  setJson("payments", s);
  return getPaymentSettingsPublic();
}

// ---- Fuso horário da operação ----
// O container roda em UTC; sem isto, "hoje" no painel começaria às 21h de
// Brasília do dia anterior. Todo cálculo de dia (vendas, geração de posts) usa
// este fuso.
export function getAppTimeZone(): string {
  const tz = getJson<string>("timezone", DEFAULT_TIME_ZONE);
  return typeof tz === "string" && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

export function setAppTimeZone(tz: string): string {
  const next = isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  setJson("timezone", next);
  return next;
}

// ---- Grupos do Telegram ----

/**
 * Quantos membros de cada grupo NÃO são audiência: você, o bot e outros admins.
 *
 * O `getChatMemberCount` do Telegram conta todo mundo, então o número cru vem
 * sempre alguns acima dos inscritos de verdade — num grupo recém-criado ele
 * mostra "2" com zero público. O desconto é aplicado na LEITURA (ver
 * `telegramMonitor.ts`), nunca na gravação: o banco continua guardando o que a
 * API respondeu, então mudar este número reajusta o histórico inteiro na hora,
 * sem migração.
 *
 * Padrão 2 (você + bot). Quem tem um segundo admin num grupo sobe para 3.
 */
export const MEMBROS_FIXOS_PADRAO = 2;
/** Teto de sanidade: acima disto é erro de digitação, não configuração. */
const MEMBROS_FIXOS_MAX = 50;

export function getFixedGroupMembers(): number {
  const n = getJson<number>("telegram_fixed_members", MEMBROS_FIXOS_PADRAO);
  return normalizeFixedGroupMembers(n);
}

export function setFixedGroupMembers(n: unknown): number {
  const next = normalizeFixedGroupMembers(n);
  setJson("telegram_fixed_members", next);
  return next;
}

function normalizeFixedGroupMembers(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return MEMBROS_FIXOS_PADRAO;
  return Math.min(MEMBROS_FIXOS_MAX, Math.max(0, v));
}

// ---- Tamanho máximo de upload ----
// Vive no banco, e não numa variável de ambiente, porque `NEXT_PUBLIC_*` é
// embutida no BUILD: mudar o número obrigava um redeploy inteiro. A variável
// continua valendo como valor INICIAL de uma instalação nova.
export const UPLOAD_MB_PADRAO = (() => {
  const mb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "500");
  return Number.isFinite(mb) && mb > 0 ? Math.round(mb) : 500;
})();
/** Teto de sanidade. Acima disso o container morre antes de o upload acabar. */
export const UPLOAD_MB_MAX = 2000;
export const UPLOAD_MB_MIN = 1;

export function getUploadLimitMb(): number {
  return normalizeUploadLimit(getJson<number>("upload_limit_mb", UPLOAD_MB_PADRAO));
}

export function setUploadLimitMb(n: unknown): number {
  const next = normalizeUploadLimit(n);
  setJson("upload_limit_mb", next);
  return next;
}

function normalizeUploadLimit(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return UPLOAD_MB_PADRAO;
  return Math.min(UPLOAD_MB_MAX, Math.max(UPLOAD_MB_MIN, v));
}

// ---- Tipos de alerta (push) que o operador quer receber ----
export function getNotificationPrefs(): NotificationPrefs {
  return normalizeNotificationPrefs(getJson<unknown>("notification_prefs", {}));
}

export function setNotificationPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  const next = normalizeNotificationPrefs({ ...getNotificationPrefs(), ...patch });
  setJson("notification_prefs", next);
  return next;
}

// ---- Configuração financeira manual (sem integração de plataforma de anúncios) ----
/**
 * VÍNCULO PELO GRUPO DE VENDAS — liga/desliga a atribuição automática de
 * venda "fria" (SyncPay/Stripe sem passar pelo checkout do Hot-Dash) ao
 * modelo e ao bot certos, lendo o relatório que o sistema de origem (o Bobz)
 * posta no Canal de Vendas. Ver `externalSaleReport.ts`.
 *
 * Nasce LIGADO: já era o comportamento em produção quando o interruptor
 * passou a existir, e nascer desligado calaria a atribuição sem ninguém
 * pedir.
 */
export type VendasExternasSettings = {
  vincularPeloGrupo: boolean;
  /**
   * A TABELA DE REPASSE do parceiro que opera esses bots (hoje o Bobz): um
   * fixo por transação mais um percentual que MUDA conforme o que foi
   * vendido. É o que separa funil de LTV numa venda que o Hot-Dash não
   * operou — ver `origemVenda.ts`.
   *
   * Nasce com a tabela que está valendo em produção (R$ 0,75 + 5% no funil,
   * R$ 0,75 + 20% no LTV), e não zerada: zerada, a classificação sairia
   * desligada de fábrica e ninguém entenderia por que o LTV não aparece.
   * Percentual em zero desliga o critério (ver `origemPeloSplit`).
   */
  splitFixoCents: number;
  splitFunilPercent: number;
  splitLtvPercent: number;
};

const VENDAS_EXTERNAS_PADRAO: VendasExternasSettings = {
  vincularPeloGrupo: true,
  splitFixoCents: SPLIT_RULES_PADRAO.fixoCents,
  splitFunilPercent: SPLIT_RULES_PADRAO.funilPercent,
  splitLtvPercent: SPLIT_RULES_PADRAO.ltvPercent,
};

/** Número guardado, com o padrão valendo quando a chave nem existe — é o caso
 *  de toda instalação que salvou esse bloco antes destes campos existirem. */
function numeroOuPadrao(v: unknown, padrao: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : padrao;
}

export function getVendasExternasSettings(): VendasExternasSettings {
  const bruto = getJson<Partial<VendasExternasSettings>>("vendas_externas", VENDAS_EXTERNAS_PADRAO);
  return {
    vincularPeloGrupo:
      typeof bruto.vincularPeloGrupo === "boolean"
        ? bruto.vincularPeloGrupo
        : VENDAS_EXTERNAS_PADRAO.vincularPeloGrupo,
    splitFixoCents: numeroOuPadrao(bruto.splitFixoCents, VENDAS_EXTERNAS_PADRAO.splitFixoCents),
    splitFunilPercent: numeroOuPadrao(bruto.splitFunilPercent, VENDAS_EXTERNAS_PADRAO.splitFunilPercent),
    splitLtvPercent: numeroOuPadrao(bruto.splitLtvPercent, VENDAS_EXTERNAS_PADRAO.splitLtvPercent),
  };
}

export function updateVendasExternasSettings(
  patch: Partial<VendasExternasSettings>,
): VendasExternasSettings {
  const cur = getVendasExternasSettings();
  const next: VendasExternasSettings = {
    vincularPeloGrupo:
      patch.vincularPeloGrupo !== undefined ? Boolean(patch.vincularPeloGrupo) : cur.vincularPeloGrupo,
    splitFixoCents: numeroOuPadrao(patch.splitFixoCents, cur.splitFixoCents),
    splitFunilPercent: numeroOuPadrao(patch.splitFunilPercent, cur.splitFunilPercent),
    splitLtvPercent: numeroOuPadrao(patch.splitLtvPercent, cur.splitLtvPercent),
  };
  setJson("vendas_externas", next);
  return next;
}

/** A mesma tabela, no formato que o classificador consome. */
export function getSplitRules(): SplitRules {
  const s = getVendasExternasSettings();
  return {
    fixoCents: s.splitFixoCents,
    funilPercent: s.splitFunilPercent,
    ltvPercent: s.splitLtvPercent,
  };
}

export type FinanceSettings = {
  /** Gastos com anúncios informados manualmente, para o período em análise. */
  adSpendCents: number;
  /** Alíquota de imposto estimada (%), aplicada sobre o faturamento líquido. */
  taxRatePercent: number;
  /** Meta de faturamento do mês. Zero = sem meta, e a barra some da tela em
   *  vez de mostrar um progresso contra nada. */
  monthlyGoalCents: number;
};

export function getFinanceSettings(): FinanceSettings {
  return getJson<FinanceSettings>("finance", {
    adSpendCents: 0,
    taxRatePercent: 0,
    monthlyGoalCents: 0,
  });
}

export function updateFinanceSettings(
  patch: Partial<FinanceSettings>,
): FinanceSettings {
  const cur = getFinanceSettings();
  const next: FinanceSettings = {
    adSpendCents:
      patch.adSpendCents !== undefined
        ? Math.max(0, Math.round(patch.adSpendCents))
        : cur.adSpendCents,
    taxRatePercent:
      patch.taxRatePercent !== undefined
        ? Math.max(0, patch.taxRatePercent)
        : cur.taxRatePercent,
    monthlyGoalCents:
      patch.monthlyGoalCents !== undefined
        ? Math.max(0, Math.round(patch.monthlyGoalCents))
        : cur.monthlyGoalCents,
  };
  setJson("finance", next);
  return next;
}

// ---- IA (OpenAI / Google Gemini) — usada no gerador de legendas e no
// gerador de cronograma. Cada provedor é independente (ativado + chave +
// modelo próprios); qual usar é escolhido na hora de cada atividade, não
// há mais um "provedor ativo" fixo aqui. ----
export type AiProvider =
  | "openai"
  | "gemini"
  | "grok"
  | "openrouter"
  | "magnific"
  | "kling"
  // BytePlus ModelArk — a ByteDance oficial. Seedance e Seedream nascem lá;
  // OpenRouter e Magnific são revenda.
  | "byteplus"
  | "nudenet";

/**
 * As ATIVIDADES que chamam a IA. Existem porque o modelo certo depende do
 * trabalho, e antes havia um modelo só por provedor para tudo.
 *
 * O caso que motivou a separação: um modelo de RACIOCÍNIO cobra o pensamento
 * como saída. Numa conversa do agente de vendas isso pode valer os centavos;
 * para gerar 20 a 35 legendas por dia no Método MK, é desperdício puro — numa
 * medição real, 423,6K tokens de raciocínio produziram 13,1K de texto e
 * responderam por 76% da fatura.
 */
export type AiActivity =
  | "mk"
  | "schedule"
  | "caption"
  | "whatsapp"
  | "caixinha"
  | "videoprompt"
  | "downsell"
  | "instagram";

export const AI_ACTIVITIES: { key: AiActivity; label: string; hint: string }[] = [
  {
    key: "mk",
    label: "Método MK (Prévias e VIP)",
    hint: "Dezenas de legendas por dia, em lote. É o maior volume — e onde raciocínio menos compensa.",
  },
  {
    key: "schedule",
    label: "Gerador de cronograma",
    hint: "Poucas chamadas, mas com resposta longa em JSON.",
  },
  {
    key: "caption",
    label: "Legenda de post manual",
    hint: "Uma por vez, com a imagem junto — precisa de um modelo com visão.",
  },
  {
    key: "whatsapp",
    label: "Agente de vendas (WhatsApp)",
    hint: "Conversa com o cliente. É onde raciocínio tem mais chance de se pagar.",
  },
  {
    key: "caixinha",
    label: "Caixinha de perguntas (Instagram)",
    hint: "Uma leva por vez, nos três provedores ao mesmo tempo — a variedade vem de misturar os modelos.",
  },
  {
    key: "videoprompt",
    label: "Prompt final do Gerador de Vídeo",
    hint: "Lê a foto e a caixinha e escreve o roteiro do vídeo. Precisa de um modelo com visão.",
  },
  {
    key: "instagram",
    label: "DM do Instagram",
    hint: "Conversa curta que só encaminha para o link da bio. Respostas de uma ou duas linhas, sem conteúdo explícito — o modelo mais barato dá conta, e o canal é o mais vigiado dos três.",
  },
  {
    key: "downsell",
    label: "Mensagens de downsell (Recuperação)",
    hint: "Escreve a copy de cada passo do downsell puxando a persona da modelo — conteúdo adulto direto, então Grok costuma sair na frente.",
  },
];

const ACTIVITY_KEYS = new Set<string>(AI_ACTIVITIES.map((a) => a.key));

export type AiProviderPublic = { enabled: boolean; hasKey: boolean; model: string; baseUrl?: string };

/**
 * Modelo por atividade, por provedor. A chave é o par (atividade, provedor)
 * porque uma atividade pode cair em provedores diferentes: os geradores do
 * Método MK tentam Grok → Gemini → OpenAI, e o modelo certo muda com o
 * provedor que atendeu.
 *
 * Ausente ou vazio = usa o modelo padrão daquele provedor, que é o
 * comportamento de antes desta configuração existir.
 */
export type AiActivityModels = Partial<Record<AiActivity, Partial<Record<AiProvider, string>>>>;

export type AiSettingsPublic = {
  openai: AiProviderPublic;
  gemini: AiProviderPublic;
  grok: AiProviderPublic;
  openrouter: AiProviderPublic;
  magnific: AiProviderPublic;
  kling: AiProviderPublic;
  byteplus: AiProviderPublic;
  nudenet: AiProviderPublic;
  activityModels: AiActivityModels;
};

type AiProviderStored = { enabled: boolean; apiKeyEnc?: string; model?: string; baseUrl?: string };
type AiSettingsStored = {
  openai?: AiProviderStored;
  gemini?: AiProviderStored;
  grok?: AiProviderStored;
  openrouter?: AiProviderStored;
  magnific?: AiProviderStored;
  kling?: AiProviderStored;
  byteplus?: AiProviderStored;
  nudenet?: AiProviderStored;
  activityModels?: AiActivityModels;
};

export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  // Só o ponto de partida de quem ativa o Grok sem escolher na lista (a tela
  // carrega os modelos ao vivo da chave). Precisa ser um modelo que exista e
  // aceite imagem, senão a primeira legenda volta 404 de modelo.
  grok: "grok-4",
  // OpenRouter é uma PONTE: a mesma chave alcança modelos de várias casas, e o
  // nome sempre vem com o dono na frente ("openai/gpt-4o", "anthropic/...").
  // O padrão é só o ponto de partida — a tela carrega a lista ao vivo.
  openrouter: "openai/gpt-4o",
  magnific: "seedream-v5-pro-edit",
  kling: "kling-v2-6-pro-motion-control",
  byteplus: "dreamina-seedance-2-5-260628",
  nudenet: "nudenet-detector"
};

function rawAi(): AiSettingsStored {
  return getJson<AiSettingsStored>("ai", {});
}

export function getAiSettingsPublic(): AiSettingsPublic {
  const s = rawAi();
  const build = (provider: AiProvider): AiProviderPublic => ({
    enabled: Boolean(s[provider]?.enabled),
    hasKey: Boolean(s[provider]?.apiKeyEnc),
    model: s[provider]?.model || DEFAULT_AI_MODELS[provider],
    baseUrl: s[provider]?.baseUrl,
  });
  return {
    openai: build("openai"),
    gemini: build("gemini"),
    grok: build("grok"),
    openrouter: build("openrouter"),
    magnific: build("magnific"),
    kling: build("kling"),
    byteplus: build("byteplus"),
    nudenet: build("nudenet"),
    activityModels: s.activityModels || {},
  };
}

/**
 * Configuração do serviço de detecção NudeNet salva na UI (Configurações →
 * Conexão com IA). Requer estar ativado e ter uma URL; o token é opcional.
 * Retorna null quando não configurado — aí o nudenet.ts cai no fallback por
 * variável de ambiente (NUDENET_URL / NUDENET_API_KEY).
 */
export function getNudenetConfig(): { url: string; token?: string } | null {
  const p = rawAi().nudenet;
  if (!p?.enabled) return null;
  const url = (p.baseUrl || "").trim().replace(/\/+$/, "");
  if (!url) return null;
  let token: string | undefined;
  if (p.apiKeyEnc) {
    try {
      token = decryptSecret(p.apiKeyEnc);
    } catch {
      token = undefined;
    }
  }
  return { url, token };
}

/** Credenciais do provedor pedido, descriptografadas (server-side apenas). */
/**
 * Credenciais do provedor. Quando `activity` é informada e existe um modelo
 * escolhido para aquele par (atividade, provedor), ele vence o modelo padrão
 * do provedor — é o que deixa o Método MK rodar num modelo barato enquanto o
 * agente do WhatsApp fica num mais caro, com a mesma chave.
 */
export function getAiCredentials(
  provider: AiProvider,
  activity?: AiActivity,
): { apiKey: string; model: string; baseUrl?: string } | null {
  const s = rawAi();
  const override = activity ? s.activityModels?.[activity]?.[provider]?.trim() : undefined;

  if (provider === "kling" || provider === "magnific") {
    const m = s.magnific;
    if (!m?.enabled || !m.apiKeyEnc) return null;
    try {
      return {
        apiKey: decryptSecret(m.apiKeyEnc),
        model: override || s[provider]?.model || DEFAULT_AI_MODELS[provider],
        baseUrl: m.baseUrl || undefined,
      };
    } catch {
      return null;
    }
  }

  const p = s[provider];
  if (!p?.enabled || !p.apiKeyEnc) return null;
  try {
    return {
      apiKey: decryptSecret(p.apiKeyEnc),
      model: override || p.model || DEFAULT_AI_MODELS[provider],
      baseUrl: p.baseUrl || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Chave descriptografada de um provedor independente do checkbox "ativado"
 * — usada só para testar a conexão antes mesmo de ativar/salvar.
 */
export function getAiKeyForTest(provider: AiProvider): string | null {
  const s = rawAi();
  const p = (provider === "kling" || provider === "magnific") ? s.magnific : s[provider];
  if (!p?.apiKeyEnc) return null;
  try {
    return decryptSecret(p.apiKeyEnc);
  } catch {
    return null;
  }
}

export function updateAiSettings(patch: {
  openai?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  gemini?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  grok?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  openrouter?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  magnific?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  kling?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  byteplus?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  nudenet?: { enabled?: boolean; apiKey?: string; baseUrl?: string; model?: string };
  /** Substitui o mapa inteiro de modelos por atividade, quando presente. */
  activityModels?: AiActivityModels;
}): AiSettingsPublic {
  const s = rawAi();
  for (const provider of [
    "openai",
    "gemini",
    "grok",
    "openrouter",
    "magnific",
    "kling",
    "byteplus",
    "nudenet",
  ] as const) {
    const p = patch[provider];
    if (!p) continue;
    const cur: AiProviderStored = s[provider] || { enabled: false };
    if (p.enabled !== undefined) cur.enabled = p.enabled;
    if (p.model !== undefined) cur.model = p.model.trim();
    if ('baseUrl' in p && p.baseUrl !== undefined) cur.baseUrl = p.baseUrl ? p.baseUrl.trim() : undefined;
    if (p.apiKey !== undefined) {
      cur.apiKeyEnc = p.apiKey ? encryptSecret(p.apiKey) : undefined;
    }
    s[provider] = cur;
  }

  // Sincroniza a ativação do kling com a do magnific
  if (patch.magnific && patch.magnific.enabled !== undefined) {
    if (!s.kling) s.kling = { enabled: false };
    s.kling.enabled = patch.magnific.enabled;
  }

  // Modelos por atividade. Só chaves conhecidas entram, e valor em branco
  // REMOVE o override (volta ao padrão do provedor) em vez de gravar "".
  if (patch.activityModels) {
    const limpo: AiActivityModels = {};
    for (const [atividade, porProvedor] of Object.entries(patch.activityModels)) {
      if (!ACTIVITY_KEYS.has(atividade) || !porProvedor) continue;
      const mapa: Partial<Record<AiProvider, string>> = {};
      for (const [provedor, modelo] of Object.entries(porProvedor)) {
        if (!(provedor in DEFAULT_AI_MODELS)) continue;
        const v = typeof modelo === "string" ? modelo.trim() : "";
        if (v) mapa[provedor as AiProvider] = v;
      }
      if (Object.keys(mapa).length > 0) limpo[atividade as AiActivity] = mapa;
    }
    s.activityModels = limpo;
  }

  setJson("ai", s);
  return getAiSettingsPublic();
}

// ---- Blocos Reutilizáveis (Legenda) ----
export type ReusableBlock = {
  id: string;
  name: string;
  content: string;
};

export function getReusableBlocks(): ReusableBlock[] {
  return getJson<ReusableBlock[]>("reusable_blocks", []);
}

export function setReusableBlocks(blocks: ReusableBlock[]): void {
  setJson("reusable_blocks", blocks);
}



// ---- Bot de vendas: preço dinâmico e estilo dos botões ----------------------

/**
 * PREÇO DINÂMICO (variação de centavos por lead).
 *
 * Gera um valor único por cliente somando/subtraindo centavos derivados do ID
 * do Telegram. Como a conta é determinística, o MESMO lead recebe SEMPRE o
 * mesmo valor — o que permite casar um PIX recebido com quem devia pagá-lo,
 * mesmo quando o comprovante não traz mais nada. É o que dificulta o estorno
 * indevido e o "paguei sim" de quem não pagou.
 *
 * `cents` é o teto da variação (1 a 100). `direction`:
 *   up     → sempre soma;
 *   down   → sempre subtrai (nunca abaixo de 1 centavo);
 *   random → o próprio sentido vem do hash, então continua fixo por lead.
 */
export type DynamicPrice = {
  enabled: boolean;
  cents: number;
  direction: "up" | "down" | "random";
};

export const DYNAMIC_PRICE_DEFAULT: DynamicPrice = { enabled: false, cents: 9, direction: "random" };

/** Lê o preço dinâmico de um bot, corrigindo valor fora de faixa. */
export function readDynamicPrice(bot: {
  dynamicPrice?: Partial<DynamicPrice>;
}): DynamicPrice {
  const s = bot.dynamicPrice || {};
  const cents = Number(s.cents);
  return {
    enabled: Boolean(s.enabled),
    cents:
      Number.isFinite(cents) && cents >= 1
        ? Math.min(Math.floor(cents), 100)
        : DYNAMIC_PRICE_DEFAULT.cents,
    direction: s.direction === "up" || s.direction === "down" ? s.direction : "random",
  };
}

/**
 * Aplica a variação ao valor de uma cobrança.
 *
 * A configuração vem do BOT DA MODELO, não do painel: preço é decisão de cada
 * operação, e duas modelos podem ter políticas diferentes.
 *
 * O piso de 1 centavo existe para uma oferta muito barata com variação grande
 * não virar cobrança de R$ 0,00 — que o gateway recusaria.
 */
export function applyDynamicPrice(
  bot: { dynamicPrice?: Partial<DynamicPrice> },
  amountCents: number,
  telegramUserId: number,
): number {
  const cfg = readDynamicPrice(bot);
  if (!cfg.enabled || cfg.cents < 1) return amountCents;

  // Hash simples e estável: só precisa espalhar, não precisa ser seguro.
  let h = 0;
  const chave = String(telegramUserId);
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0;

  const delta = (h % cfg.cents) + 1; // 1..cents, nunca zero (senão não varia)
  const soma =
    cfg.direction === "up" ? true : cfg.direction === "down" ? false : (h >>> 8) % 2 === 0;

  return Math.max(1, soma ? amountCents + delta : amountCents - delta);
}

/**
 * ESTILO DOS BOTÕES (Bot API 9.4, fev/2026).
 *
 * O Telegram aceita `style` no botão inline: "primary" (azul), "success"
 * (verde) e "danger" (vermelho). Apps antigos ignoram o campo e mostram o
 * botão na cor padrão — o texto e a ação seguem funcionando, então não há
 * risco em ligar.
 *
 * Cada PAPEL do fluxo tem o seu, porque a intenção muda: a lista de planos
 * pede destaque, "Copiar Chave Pix" é auxiliar, e o acesso ao VIP depois do
 * pagamento merece o verde. E cada MODELO tem a sua paleta — por isso a
 * escolha mora no bot dela, não numa chave global do painel.
 */
export type ButtonStyle = "" | "primary" | "success" | "danger";
export type ButtonRole =
  | "redirect"
  | "plans"
  | "confirmPurchase"
  | "checkoutPay"
  | "pixCheck"
  | "pixCopy"
  | "pixQr"
  | "bumpAccept"
  | "bumpDecline"
  | "access"
  | "managePortal"
  | "notFromBrazil"
  | "cardBrOffer"
  | "support"
  | "originGate"
  | "language";

/**
 * Cor de partida de cada papel. Aceitar/recusar do Order Bump nascem verde e
 * vermelho porque a leitura é instantânea e universal — mas ficam editáveis,
 * já que a cor certa depende da paleta de cada operação.
 */
const BUTTON_STYLE_DEFAULTS: Partial<Record<ButtonRole, ButtonStyle>> = {
  bumpAccept: "success",
  bumpDecline: "danger",
};

export const BUTTON_ROLES: { key: ButtonRole; label: string; hint: string }[] = [
  { key: "redirect", label: "Botões de redirect", hint: "Links extras (entregável, mailing, botões customizados do /start…) — qualquer botão que só leva pra outro lugar, sem papel próprio na lista abaixo" },
  { key: "plans", label: "Lista de planos", hint: "Botões de escolha de plano (/start, funis, mailing). Um plano com cor própria ignora esta." },
  { key: "confirmPurchase", label: "Confirmar compra", hint: 'Botão "Pagar com Pix", quando houver escolha de método' },
  { key: "checkoutPay", label: "Pagar no checkout (cartão)", hint: 'Botão "Pagar" que abre o link de pagamento no checkout Stripe (internacional ou "pagar no cartão" do Brasil) — depois de já ter escolhido o método' },
  { key: "pixCheck", label: "Verificar pagamento", hint: 'Botão "Verificar Status do Pagamento" (PIX e cartão)' },
  { key: "pixCopy", label: "Copiar chave Pix", hint: "Botão que reenvia só o código" },
  { key: "pixQr", label: "Mostrar QR Code", hint: "Botão que envia a imagem do QR" },
  { key: "bumpAccept", label: "Aceitar bump", hint: "Botão de aceite da oferta adicional" },
  { key: "bumpDecline", label: "Recusar bump", hint: "Botão de recusa da oferta adicional" },
  { key: "access", label: "Acessar conteúdo", hint: "Botão de acesso ao VIP depois do pagamento" },
  { key: "managePortal", label: "Gerenciar assinatura", hint: 'Botões "Gerenciar assinatura" e "Abrir portal" (renovação automática via Stripe)' },
  { key: "notFromBrazil", label: '"Not from Brazil?"', hint: "Botão que abre o menu internacional no meio do funil (/start e Downsell geral)" },
  { key: "cardBrOffer", label: '"Prefere pagar no cartão?"', hint: "Botão do BRASILEIRO que oferece pagar no cartão em vez de Pix — abre a lista de planos em cartão (`acceptCardBr`)" },
  { key: "support", label: "Suporte / Dúvidas", hint: "Botão de contato com o suporte, no /start" },
  { key: "originGate", label: 'Pergunta "Brasil ou International?"', hint: 'Os 2 botões da PRIMEIRA pergunta do /start, quando o modo bilíngue pergunta antes de tudo (`intlAskFirst`)' },
  { key: "language", label: "Escolha de idioma (EN/ES)", hint: 'Os 2 botões "English"/"Español" do menu internacional' },
];

export type ButtonStyles = Partial<Record<ButtonRole, ButtonStyle>>;

/** Descarta papel desconhecido e cor inválida antes de gravar. */
export function sanitizeButtonStyles(v: unknown): ButtonStyles {
  const validos: ButtonStyle[] = ["", "primary", "success", "danger"];
  const chaves = new Set(BUTTON_ROLES.map((r) => r.key as string));
  const limpo: ButtonStyles = {};
  for (const [k, val] of Object.entries((v || {}) as Record<string, unknown>)) {
    if (!chaves.has(k) || !validos.includes(val as ButtonStyle)) continue;
    if (val) limpo[k as ButtonRole] = val as ButtonStyle;
  }
  return limpo;
}

/** Devolve `{ style }` para espalhar no botão, ou nada quando é o padrão. */
export function buttonStyleProps(
  bot: { buttonStyles?: ButtonStyles },
  role: ButtonRole,
): { style?: string } {
  const salvo = (bot.buttonStyles || {})[role];
  const v = salvo !== undefined ? salvo : BUTTON_STYLE_DEFAULTS[role];
  return v ? { style: v } : {};
}

/**
 * Cor do botão de UM plano.
 *
 * A cor escolhida no plano vence a do papel "lista de planos" — é o que
 * permite destacar a oferta principal no meio das outras. Sem cor no plano,
 * cai na cor do papel, que é da modelo.
 *
 * O mapa existe porque a tela fala em verde/azul/vermelho (que é como o
 * operador pensa) e a API do Telegram fala em success/primary/danger.
 */
const CORES_DO_PLANO: Record<string, ButtonStyle> = {
  green: "success",
  blue: "primary",
  red: "danger",
};

export function planButtonStyleProps(
  bot: { buttonStyles?: ButtonStyles },
  highlight?: string,
): { style?: string } {
  const doPlano = highlight ? CORES_DO_PLANO[highlight] : undefined;
  return doPlano ? { style: doPlano } : buttonStyleProps(bot, "plans");
}


/**
 * Acesso genérico à tabela `settings`, para módulos vizinhos que guardam um
 * valorzinho próprio e não merecem tabela nem coluna (ex.: o cache da cotação
 * do dólar). Exposto como objeto para os nomes curtos `ler`/`gravar` não
 * virarem exports genéricos soltos no módulo.
 */
export const configJson = { ler: getJson, gravar: setJson };

/* ------------------------------------------------------------------ *
 * CHAVE DO GOOGLE PARA MÍDIA (Nano Banana e Veo)
 *
 * Os geradores de imagem e vídeo falam com a Gemini API direto, sem
 * intermediário. Por padrão usam a MESMA chave do Gemini que já está em
 * Configurações; um campo opcional sobrescreve, para quem quiser cobrar a
 * mídia noutro projeto do Google — Veo e Nano Banana exigem tier pago, e a
 * chave de texto pode ser de um projeto gratuito.
 *
 * Não vira um item do union `AiProvider` de propósito: aquele tipo carrega
 * modelo por atividade e teste de conexão, que não fazem sentido aqui, e
 * alargá-lo espalharia mudança por meia dúzia de arquivos.
 * ------------------------------------------------------------------ */

const CHAVE_MIDIA_GOOGLE = "googleMediaKey";

type ChaveMidiaGuardada = { apiKeyEnc?: string };

/** Se existe uma chave só de mídia salva (para a tela mostrar o estado). */
export function temChaveMidiaGoogle(): boolean {
  return Boolean(getJson<ChaveMidiaGuardada>(CHAVE_MIDIA_GOOGLE, {}).apiKeyEnc);
}

/** Grava (ou apaga, com string vazia) a chave só de mídia. */
export function setChaveMidiaGoogle(apiKey: string): void {
  const limpa = apiKey.trim();
  setJson(CHAVE_MIDIA_GOOGLE, limpa ? { apiKeyEnc: encryptSecret(limpa) } : {});
}

/**
 * A chave a usar nas chamadas de mídia: a específica quando existe, senão a
 * do Gemini. Devolve null quando nenhuma das duas está disponível.
 */
export function getGoogleMediaKey(): string | null {
  const propria = getJson<ChaveMidiaGuardada>(CHAVE_MIDIA_GOOGLE, {}).apiKeyEnc;
  if (propria) {
    try {
      return decryptSecret(propria);
    } catch {
      // Chave ilegível (mudou o segredo de criptografia): cai na do Gemini
      // em vez de derrubar a geração.
    }
  }
  return getAiCredentials("gemini")?.apiKey || null;
}
