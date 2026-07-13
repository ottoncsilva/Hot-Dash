import "server-only";
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
  syncpay: { enabled: boolean; hasSecret: boolean; clientId: string };
};

type PaymentSettingsStored = {
  syncpay: { enabled: boolean; clientId?: string; clientSecretEnc?: string };
};

function rawPayments(): PaymentSettingsStored {
  return getJson<PaymentSettingsStored>("payments", {
    syncpay: { enabled: false },
  });
}

/** Versão segura (sem segredos) para enviar ao cliente. */
export function getPaymentSettingsPublic(): PaymentSettingsPublic {
  const s = rawPayments();
  return {
    syncpay: {
      enabled: Boolean(s.syncpay?.enabled),
      hasSecret: Boolean(s.syncpay?.clientId && s.syncpay?.clientSecretEnc),
      clientId: s.syncpay?.clientId || "",
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
export type AiProvider = "openai" | "gemini";

export type AiProviderPublic = { enabled: boolean; hasKey: boolean; model: string };
export type AiSettingsPublic = { openai: AiProviderPublic; gemini: AiProviderPublic };

type AiProviderStored = { enabled: boolean; apiKeyEnc?: string; model?: string };
type AiSettingsStored = { openai?: AiProviderStored; gemini?: AiProviderStored };

export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

function rawAi(): AiSettingsStored {
  return getJson<AiSettingsStored>("ai", {});
}

function providerToPublic(p: AiProviderStored | undefined, provider: AiProvider): AiProviderPublic {
  return {
    enabled: Boolean(p?.enabled),
    hasKey: Boolean(p?.apiKeyEnc),
    model: p?.model || DEFAULT_AI_MODELS[provider],
  };
}

export function getAiSettingsPublic(): AiSettingsPublic {
  const s = rawAi();
  return {
    openai: providerToPublic(s.openai, "openai"),
    gemini: providerToPublic(s.gemini, "gemini"),
  };
}

/** Credenciais do provedor pedido, descriptografadas (server-side apenas). */
export function getAiCredentials(provider: AiProvider): { apiKey: string; model: string } | null {
  const s = rawAi();
  const p = provider === "openai" ? s.openai : s.gemini;
  if (!p?.enabled || !p.apiKeyEnc) return null;
  try {
    return { apiKey: decryptSecret(p.apiKeyEnc), model: p.model || DEFAULT_AI_MODELS[provider] };
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
  const p = provider === "openai" ? s.openai : s.gemini;
  if (!p?.apiKeyEnc) return null;
  try {
    return decryptSecret(p.apiKeyEnc);
  } catch {
    return null;
  }
}

export function updateAiSettings(patch: {
  openai?: { enabled?: boolean; apiKey?: string; model?: string };
  gemini?: { enabled?: boolean; apiKey?: string; model?: string };
}): AiSettingsPublic {
  const s = rawAi();
  for (const provider of ["openai", "gemini"] as const) {
    const p = patch[provider];
    if (!p) continue;
    const cur: AiProviderStored = s[provider] || { enabled: false };
    if (p.enabled !== undefined) cur.enabled = p.enabled;
    if (p.model !== undefined) cur.model = p.model.trim();
    if (p.apiKey !== undefined) {
      cur.apiKeyEnc = p.apiKey ? encryptSecret(p.apiKey) : undefined;
    }
    s[provider] = cur;
  }
  setJson("ai", s);
  return getAiSettingsPublic();
}

// ---- Integração Google Sheets ----
export type GoogleSheetsSettingsPublic = {
  enabled: boolean;
  hasCredentials: boolean;
  clientEmail: string;
  shareEmail: string;
};

type GoogleSheetsSettingsStored = {
  enabled: boolean;
  clientEmail?: string;
  privateKeyEnc?: string;
  shareEmail?: string;
};

function rawGoogleSheets(): GoogleSheetsSettingsStored {
  return getJson<GoogleSheetsSettingsStored>("google_sheets", { enabled: false });
}

export function getGoogleSheetsSettingsPublic(): GoogleSheetsSettingsPublic {
  const s = rawGoogleSheets();
  return {
    enabled: Boolean(s.enabled),
    hasCredentials: Boolean(s.clientEmail && s.privateKeyEnc),
    clientEmail: s.clientEmail || "",
    shareEmail: s.shareEmail || "",
  };
}

export function isGoogleSheetsEnabled(): boolean {
  const s = rawGoogleSheets();
  return Boolean(s.enabled && s.clientEmail && s.privateKeyEnc);
}

export function getGoogleSheetsShareEmail(): string | null {
  return rawGoogleSheets().shareEmail || null;
}

/** Credenciais descriptografadas da conta de serviço (uso server-side apenas). */
export function getGoogleSheetsCredentials(): {
  clientEmail: string;
  privateKey: string;
} | null {
  const s = rawGoogleSheets();
  if (!s.clientEmail || !s.privateKeyEnc) return null;
  try {
    return { clientEmail: s.clientEmail, privateKey: decryptSecret(s.privateKeyEnc) };
  } catch {
    return null;
  }
}

/**
 * Aceita tanto o JSON completo baixado do Google Cloud Console (contendo
 * client_email/private_key) quanto os dois campos já separados.
 */
export function updateGoogleSheetsSettings(patch: {
  enabled?: boolean;
  serviceAccountJson?: string;
  shareEmail?: string;
}): GoogleSheetsSettingsPublic {
  const s = rawGoogleSheets();

  if (patch.enabled !== undefined) s.enabled = patch.enabled;
  if (patch.shareEmail !== undefined) s.shareEmail = patch.shareEmail.trim();

  if (patch.serviceAccountJson !== undefined && patch.serviceAccountJson.trim()) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(patch.serviceAccountJson);
    } catch {
      throw new Error("JSON da conta de serviço inválido.");
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "JSON precisa conter os campos client_email e private_key.",
      );
    }
    s.clientEmail = parsed.client_email;
    s.privateKeyEnc = encryptSecret(parsed.private_key);
  }

  setJson("google_sheets", s);
  return getGoogleSheetsSettingsPublic();
}
