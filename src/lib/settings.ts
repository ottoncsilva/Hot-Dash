import "server-only";
import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  normalizeMenu,
  type MenuEntry,
} from "./navItems";

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
  syncpay: { enabled: boolean; hasSecret: boolean; clientId: string; webhookToken: string };
};

type PaymentSettingsStored = {
  syncpay: { enabled: boolean; clientId?: string; clientSecretEnc?: string; webhookToken?: string };
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
export function ensureSyncpayWebhookToken(): string {
  const s = rawPayments();
  if (!s.syncpay) s.syncpay = { enabled: false };
  if (!s.syncpay.webhookToken) {
    s.syncpay.webhookToken = randomBytes(24).toString("hex");
    setJson("payments", s);
  }
  return s.syncpay.webhookToken;
}

/** Versão segura para enviar ao cliente (o webhookToken vai junto porque o
 *  usuário precisa dele para montar a URL a colar na SyncPay). */
export function getPaymentSettingsPublic(): PaymentSettingsPublic {
  const s = rawPayments();
  return {
    syncpay: {
      enabled: Boolean(s.syncpay?.enabled),
      hasSecret: Boolean(s.syncpay?.clientId && s.syncpay?.clientSecretEnc),
      clientId: s.syncpay?.clientId || "",
      webhookToken: ensureSyncpayWebhookToken(),
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

// ---- Configuração financeira manual (sem integração de plataforma de anúncios) ----
export type FinanceSettings = {
  /** Gastos com anúncios informados manualmente, para o período em análise. */
  adSpendCents: number;
  /** Alíquota de imposto estimada (%), aplicada sobre o faturamento líquido. */
  taxRatePercent: number;
};

export function getFinanceSettings(): FinanceSettings {
  return getJson<FinanceSettings>("finance", { adSpendCents: 0, taxRatePercent: 0 });
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
  };
  setJson("finance", next);
  return next;
}

// ---- IA (OpenAI / Google Gemini) — usada no gerador de legendas e no
// gerador de cronograma. Cada provedor é independente (ativado + chave +
// modelo próprios); qual usar é escolhido na hora de cada atividade, não
// há mais um "provedor ativo" fixo aqui. ----
export type AiProvider = "openai" | "gemini" | "sightengine" | "grok" | "magnific" | "kling" | "nudenet";

export type AiProviderPublic = { enabled: boolean; hasKey: boolean; model: string; baseUrl?: string; apiUser?: string };
export type AiSettingsPublic = { openai: AiProviderPublic; gemini: AiProviderPublic; sightengine: AiProviderPublic; grok: AiProviderPublic; magnific: AiProviderPublic; kling: AiProviderPublic; nudenet: AiProviderPublic; };

type AiProviderStored = { enabled: boolean; apiKeyEnc?: string; model?: string; baseUrl?: string; apiUserEnc?: string };
type AiSettingsStored = { openai?: AiProviderStored; gemini?: AiProviderStored; sightengine?: AiProviderStored; grok?: AiProviderStored; magnific?: AiProviderStored; kling?: AiProviderStored; nudenet?: AiProviderStored; };

export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  sightengine: "nudity-2.0",
  grok: "grok-4.20-0309-reasoning",
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
    ...(provider === "sightengine" && { apiUser: s[provider]?.apiUserEnc ? "(salvo)" : "" })
  });
  return {
    openai: build("openai"),
    gemini: build("gemini"),
    sightengine: build("sightengine"),
    grok: build("grok"),
    magnific: build("magnific"),
    kling: build("kling"),
    nudenet: build("nudenet"),
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
export function getAiCredentials(provider: AiProvider): { apiKey: string; model: string; baseUrl?: string; apiUser?: string } | null {
  const s = rawAi();
  if (provider === "kling" || provider === "magnific") {
    const m = s.magnific;
    if (!m?.enabled || !m.apiKeyEnc) return null;
    try {
      return {
        apiKey: decryptSecret(m.apiKeyEnc),
        model: s[provider]?.model || DEFAULT_AI_MODELS[provider],
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
      model: p.model || DEFAULT_AI_MODELS[provider],
      baseUrl: p.baseUrl || undefined,
      apiUser: p.apiUserEnc ? decryptSecret(p.apiUserEnc) : undefined,
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
  sightengine?: { enabled?: boolean; apiKey?: string; model?: string; apiUser?: string };
  grok?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  magnific?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  kling?: { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string };
  nudenet?: { enabled?: boolean; apiKey?: string; baseUrl?: string; model?: string };
}): AiSettingsPublic {
  const s = rawAi();
  for (const provider of ["openai", "gemini", "sightengine", "grok", "magnific", "kling", "nudenet"] as const) {
    const p = patch[provider];
    if (!p) continue;
    const cur: AiProviderStored = s[provider] || { enabled: false };
    if (p.enabled !== undefined) cur.enabled = p.enabled;
    if (p.model !== undefined) cur.model = p.model.trim();
    if ('baseUrl' in p && p.baseUrl !== undefined) cur.baseUrl = p.baseUrl ? p.baseUrl.trim() : undefined;
    if (p.apiKey !== undefined) {
      cur.apiKeyEnc = p.apiKey ? encryptSecret(p.apiKey) : undefined;
    }
    if ('apiUser' in p && p.apiUser !== undefined) {
      cur.apiUserEnc = p.apiUser ? encryptSecret(p.apiUser) : undefined;
    }
    s[provider] = cur;
  }

  // Sincroniza a ativação do kling com a do magnific
  if (patch.magnific && patch.magnific.enabled !== undefined) {
    if (!s.kling) s.kling = { enabled: false };
    s.kling.enabled = patch.magnific.enabled;
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

