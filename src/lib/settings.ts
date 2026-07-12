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
export type PaymentProviderKey = "syncpay" | "stripe";

export type PaymentSettingsPublic = {
  syncpay: { enabled: boolean; hasSecret: boolean; clientId: string };
  stripe: { enabled: boolean; hasSecret: boolean; publishableKey: string };
};

type PaymentSettingsStored = {
  syncpay: { enabled: boolean; clientId?: string; clientSecretEnc?: string };
  stripe: { enabled: boolean; secretKeyEnc?: string; publishableKey?: string };
};

function rawPayments(): PaymentSettingsStored {
  return getJson<PaymentSettingsStored>("payments", {
    syncpay: { enabled: false },
    stripe: { enabled: false },
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
    stripe: {
      enabled: Boolean(s.stripe?.enabled),
      hasSecret: Boolean(s.stripe?.secretKeyEnc),
      publishableKey: s.stripe?.publishableKey || "",
    },
  };
}

/** Segredo descriptografado da Stripe (uso server-side apenas). */
export function getProviderSecret(
  provider: Extract<PaymentProviderKey, "stripe">,
): string | null {
  const s = rawPayments();
  const enc = provider === "stripe" ? s.stripe?.secretKeyEnc : undefined;
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
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
  stripe?: { enabled?: boolean; secretKey?: string; publishableKey?: string };
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
    if (patch.stripe.enabled !== undefined)
      s.stripe.enabled = patch.stripe.enabled;
    if (patch.stripe.publishableKey !== undefined)
      s.stripe.publishableKey = patch.stripe.publishableKey;
    if (patch.stripe.secretKey !== undefined) {
      s.stripe.secretKeyEnc = patch.stripe.secretKey
        ? encryptSecret(patch.stripe.secretKey)
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
