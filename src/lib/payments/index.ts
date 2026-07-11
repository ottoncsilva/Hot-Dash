import "server-only";
import { getPaymentSettingsPublic, getProviderSecret } from "../settings";
import { createSyncPay } from "./syncpay";
import { createStripe } from "./stripe";
import type { PaymentProvider } from "./types";

export type { ChargeInput, ChargeResult } from "./types";

/**
 * Retorna o provedor ativo (habilitado + com segredo configurado),
 * priorizando a SyncPay. Retorna null se nada estiver configurado.
 */
export function activeProvider(): PaymentProvider | null {
  const cfg = getPaymentSettingsPublic();

  if (cfg.syncpay.enabled && cfg.syncpay.hasSecret) {
    const secret = getProviderSecret("syncpay");
    if (secret) return createSyncPay(secret);
  }
  if (cfg.stripe.enabled && cfg.stripe.hasSecret) {
    const secret = getProviderSecret("stripe");
    if (secret) return createStripe(secret);
  }
  return null;
}
