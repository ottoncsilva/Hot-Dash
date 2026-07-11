import "server-only";
import type { ChargeInput, ChargeResult, PaymentProvider } from "./types";

/**
 * Adaptador SyncPay (gateway PIX brasileiro).
 *
 * Fluxo: gera um bearer token (validade ~1h) e cria a cobrança PIX.
 * A chave/segredo vem das Configurações (criptografada no banco). A base da
 * API é configurável via SYNCPAY_BASE_URL (padrão abaixo) caso mude.
 *
 * Observação: este adaptador está pronto para uso; ajuste os endpoints à
 * versão da sua conta SyncPay se necessário.
 */
const BASE = process.env.SYNCPAY_BASE_URL || "https://api.syncpayments.com.br";

export function createSyncPay(clientSecret: string): PaymentProvider {
  let cachedToken: { token: string; exp: number } | null = null;

  async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.exp > Date.now() + 30_000) {
      return cachedToken.token;
    }
    // A credencial pode ser "client_id:client_secret" ou apenas um api key.
    const [clientId, secret] = clientSecret.includes(":")
      ? clientSecret.split(":")
      : ["", clientSecret];

    const res = await fetch(`${BASE}/api/partner/v1/auth-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: secret }),
    });
    if (!res.ok) {
      throw new Error(`SyncPay auth falhou (${res.status}).`);
    }
    const data = (await res.json()) as {
      access_token?: string;
      token?: string;
      expires_in?: number;
    };
    const token = data.access_token || data.token;
    if (!token) throw new Error("SyncPay não retornou token.");
    cachedToken = {
      token,
      exp: Date.now() + (data.expires_in ? data.expires_in * 1000 : 3_600_000),
    };
    return token;
  }

  return {
    key: "syncpay",
    async createPixCharge(input: ChargeInput): Promise<ChargeResult> {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/partner/v1/cash-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: input.amountCents / 100,
          payment_method: "pix",
          description: input.description,
          customer: input.customer
            ? {
                name: input.customer.name,
                email: input.customer.email,
                document: input.customer.document,
                phone: input.customer.phone,
              }
            : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(
          `SyncPay: falha ao criar cobrança (${res.status}) ${
            (data.message as string) || ""
          }`,
        );
      }
      return {
        providerRef: String(data.id || data.transaction_id || ""),
        status: "pending",
        pixCode:
          (data.pix_code as string) ||
          (data.qr_code as string) ||
          ((data.pix as Record<string, unknown>)?.qr_code as string),
        raw: data,
      };
    },
  };
}
