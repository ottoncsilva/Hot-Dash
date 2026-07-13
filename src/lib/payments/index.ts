import "server-only";
import { getPaymentSettingsPublic, getSyncPayCredentials } from "../settings";
import { createSyncPay } from "./syncpay";
import type { PaymentProvider } from "./types";

export type { ChargeInput, ChargeResult } from "./types";

/**
 * Retorna o provedor ativo (habilitado + com segredo configurado).
 * Retorna null se nada estiver configurado.
 */
export function activeProvider(): PaymentProvider | null {
  const cfg = getPaymentSettingsPublic();

  if (cfg.syncpay.enabled && cfg.syncpay.hasSecret) {
    const creds = getSyncPayCredentials();
    if (creds) return createSyncPay(creds);
  }
  return null;
}
