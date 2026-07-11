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
  syncpay: { enabled: boolean; hasSecret: boolean };
  stripe: { enabled: boolean; hasSecret: boolean; publishableKey: string };
};

type PaymentSettingsStored = {
  syncpay: { enabled: boolean; apiKeyEnc?: string };
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
      hasSecret: Boolean(s.syncpay?.apiKeyEnc),
    },
    stripe: {
      enabled: Boolean(s.stripe?.enabled),
      hasSecret: Boolean(s.stripe?.secretKeyEnc),
      publishableKey: s.stripe?.publishableKey || "",
    },
  };
}

/** Segredo descriptografado de um provedor (uso server-side apenas). */
export function getProviderSecret(
  provider: PaymentProviderKey,
): string | null {
  const s = rawPayments();
  const enc =
    provider === "syncpay" ? s.syncpay?.apiKeyEnc : s.stripe?.secretKeyEnc;
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

export function updatePaymentSettings(patch: {
  syncpay?: { enabled?: boolean; apiKey?: string };
  stripe?: { enabled?: boolean; secretKey?: string; publishableKey?: string };
}): PaymentSettingsPublic {
  const s = rawPayments();

  if (patch.syncpay) {
    if (patch.syncpay.enabled !== undefined)
      s.syncpay.enabled = patch.syncpay.enabled;
    if (patch.syncpay.apiKey !== undefined) {
      s.syncpay.apiKeyEnc = patch.syncpay.apiKey
        ? encryptSecret(patch.syncpay.apiKey)
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
