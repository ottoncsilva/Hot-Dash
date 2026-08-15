import "server-only";
import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  normalizeMenu,
  type MenuEntry,
} from "./navItems";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "./timezone";
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

// ---- Evolution API (WhatsApp) ----
export type EvolutionSettingsPublic = { url?: string; hasKey: boolean };
type EvolutionSettingsStored = { url?: string; apiKeyEnc?: string };

function rawEvolution(): EvolutionSettingsStored {
  return getJson<EvolutionSettingsStored>("evolution", {});
}

export function getEvolutionSettingsPublic(): EvolutionSettingsPublic {
  const s = rawEvolution();
  return {
    url: s.url,
    hasKey: Boolean(s.apiKeyEnc),
  };
}

export function getEvolutionCredentials(): { url: string; apiKey: string } | null {
  const s = rawEvolution();
  if (!s.url || !s.apiKeyEnc) return null;
  try {
    return { url: s.url, apiKey: decryptSecret(s.apiKeyEnc) };
  } catch {
    return null;
  }
}

export function updateEvolutionSettings(patch: { url?: string; apiKey?: string }): EvolutionSettingsPublic {
  const s = rawEvolution();
  if (patch.url !== undefined) s.url = patch.url.trim().replace(/\/+$/, "");
  if (patch.apiKey !== undefined) {
    s.apiKeyEnc = patch.apiKey ? encryptSecret(patch.apiKey) : undefined;
  }
  setJson("evolution", s);
  return getEvolutionSettingsPublic();
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
};

type PaymentSettingsStored = {
  syncpay: {
    enabled: boolean;
    clientId?: string;
    clientSecretEnc?: string;
    webhookShort?: string;
  };
};

function rawPayments(): PaymentSettingsStored {
  return getJson<PaymentSettingsStored>("payments", {
    syncpay: { enabled: false },
  });
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

export function updatePaymentSettings(patch: {
  syncpay?: { enabled?: boolean; clientId?: string; clientSecret?: string };
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
export type AiProvider = "openai" | "gemini" | "grok" | "magnific" | "kling" | "nudenet";

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
export type AiActivity = "mk" | "schedule" | "caption" | "whatsapp";

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
  magnific: AiProviderPublic;
  kling: AiProviderPublic;
  nudenet: AiProviderPublic;
  activityModels: AiActivityModels;
};

type AiProviderStored = { enabled: boolean; apiKeyEnc?: string; model?: string; baseUrl?: string };
type AiSettingsStored = {
  openai?: AiProviderStored;
  gemini?: AiProviderStored;
  grok?: AiProviderStored;
  magnific?: AiProviderStored;
  kling?: AiProviderStored;
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
  magnific: "seedream-v5-pro-edit",
  kling: "kling-v2-6-pro-motion-control",
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
    magnific: build("magnific"),
    kling: build("kling"),
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
  magnific?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  kling?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  nudenet?: { enabled?: boolean; apiKey?: string; baseUrl?: string; model?: string };
  /** Substitui o mapa inteiro de modelos por atividade, quando presente. */
  activityModels?: AiActivityModels;
}): AiSettingsPublic {
  const s = rawAi();
  for (const provider of ["openai", "gemini", "grok", "magnific", "kling", "nudenet"] as const) {
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

