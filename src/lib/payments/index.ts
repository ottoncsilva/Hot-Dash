import "server-only";
import {
  getPaymentSettingsPublic,
  getStripeCredentials,
  getSyncPayCredentials,
} from "../settings";
import { createStripe } from "./stripe";
import { createSyncPay } from "./syncpay";
import type { PaymentProvider } from "./types";

export type { ChargeInput, ChargeResult } from "./types";

/**
 * Retorna o provedor pedido (habilitado + com segredo configurado).
 * Retorna null se esse provedor não estiver configurado.
 */
export function getProvider(key: "syncpay" | "stripe"): PaymentProvider | null {
  const cfg = getPaymentSettingsPublic();

  if (key === "syncpay") {
    if (cfg.syncpay.enabled && cfg.syncpay.hasSecret) {
      const creds = getSyncPayCredentials();
      if (creds) return createSyncPay(creds);
    }
    return null;
  }

  if (cfg.stripe.enabled && cfg.stripe.hasSecretKey) {
    const creds = getStripeCredentials();
    if (creds) return createStripe(creds);
  }
  return null;
}

/**
 * Atalho para `getProvider("syncpay")` — mantido para os call sites já
 * existentes (financeiro, LTV, PIX do Telegram), todos PIX/BRL.
 */
export function activeProvider(): PaymentProvider | null {
  return getProvider("syncpay");
}
