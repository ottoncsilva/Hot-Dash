import "server-only";
import type { ChargeInput, ChargeResult, PaymentProvider } from "./types";

/**
 * Adaptador SyncPay (gateway PIX brasileiro), via REST puro (sem SDK).
 *
 * Fluxo documentado (https://syncpay.apidog.io):
 *  1. POST /api/partner/v1/auth-token  { client_id, client_secret }
 *       -> { access_token, expires_in }  (validade ~1h)
 *  2. POST /v1/gateway/api  (Bearer)  cria a cobrança PIX (cash-in)
 *       -> { idTransaction, paymentCode (copia e cola),
 *            paymentCodeBase64 (QR), status_transaction }
 *  3. A confirmação chega por webhook (postbackUrl) — ver
 *     src/app/api/webhooks/syncpay/route.ts.
 *
 * A base da API é configurável por SYNCPAY_BASE_URL caso a sua conta use
 * outro host. Client ID e Client Secret vêm das Configurações (campos
 * dedicados), com o secret criptografado no banco.
 */
const BASE = process.env.SYNCPAY_BASE_URL || "https://api.syncpayments.com.br";

export function createSyncPay(creds: {
  clientId: string;
  clientSecret: string;
}): PaymentProvider {
  let cachedToken: { token: string; exp: number } | null = null;

  async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.exp > Date.now() + 30_000) {
      return cachedToken.token;
    }
    const res = await fetch(`${BASE}/api/partner/v1/auth-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`SyncPay: autenticação falhou (${res.status}).`);
    }
    const data = (await res.json()) as {
      access_token?: string;
      token?: string;
      expires_in?: number;
    };
    const token = data.access_token || data.token;
    if (!token) throw new Error("SyncPay não retornou token de acesso.");
    cachedToken = {
      token,
      exp: Date.now() + (data.expires_in ? data.expires_in * 1000 : 3_600_000),
    };
    return token;
  }

  async function authedFetch(path: string, init: RequestInit) {
    const token = await getToken();
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return {
    key: "syncpay",

    async createPixCharge(input: ChargeInput): Promise<ChargeResult> {
      const reais = input.amountCents / 100;
      const cpf = (input.customer?.document || "").replace(/\D/g, "");
      const phone = (input.customer?.phone || "").replace(/\D/g, "");
      const days = input.expiresInDays ?? 1;

      const body = {
        ip: input.customer?.ip || "127.0.0.1",
        pix: { expiresInDays: String(days) },
        items: [
          {
            title: input.description || "Venda",
            quantity: 1,
            tangible: false,
            unitPrice: reais,
          },
        ],
        amount: reais,
        customer: {
          name: input.customer?.name || "Cliente",
          email: input.customer?.email || "cliente@exemplo.com",
          phone: phone || "11999999999",
          cpf: cpf || "00000000000",
          externaRef: input.externalRef || "",
          // Endereço é exigido pela API; preenche com dados informados ou
          // um placeholder válido quando o cliente não os fornece.
          address: {
            street: input.customer?.address?.street || "N/A",
            streetNumber: input.customer?.address?.streetNumber || "0",
            complement: input.customer?.address?.complement || "",
            neighborhood: input.customer?.address?.neighborhood || "Centro",
            city: input.customer?.address?.city || "Sao Paulo",
            state: input.customer?.address?.state || "SP",
            zipCode: (input.customer?.address?.zipCode || "01001000").replace(/\D/g, ""),
            country: input.customer?.address?.country || "BR",
          },
        },
        metadata: {
          provider: "hot-dash",
          user_email: input.metadata?.userEmail || "",
          sell_url: input.metadata?.sellUrl || "",
          order_url: input.metadata?.orderUrl || "",
        },
        traceable: true,
        ...(input.postbackUrl ? { postbackUrl: input.postbackUrl } : {}),
      };

      const res = await authedFetch("/v1/gateway/api", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(
          `SyncPay: falha ao criar cobrança (${res.status}) ${
            (data.message as string) || ""
          }`,
        );
      }
      const providerRef = String(
        data.idTransaction || data.id || data.transaction_id || "",
      );
      const pixCode =
        (data.paymentCode as string) ||
        (data.pix_code as string) ||
        (data.qr_code as string) ||
        ((data.pix as Record<string, unknown>)?.qr_code as string);
      return {
        providerRef,
        status: "pending",
        pixCode,
        qrCodeBase64: (data.paymentCodeBase64 as string) || undefined,
        raw: data,
      };
    },

    async getBalance() {
      // Best-effort: a rota de saldo varia por conta; não quebra o painel se falhar.
      try {
        const res = await authedFetch("/api/partner/v1/balance", { method: "GET" });
        if (!res.ok) return null;
        const data = (await res.json()) as Record<string, unknown>;
        const val =
          (data.balance as number) ??
          (data.available as number) ??
          ((data.data as Record<string, unknown>)?.balance as number);
        if (typeof val !== "number") return null;
        // A API devolve em reais; guardamos em centavos.
        return { availableCents: Math.round(val * 100), raw: data };
      } catch {
        return null;
      }
    },
  };
}
