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

/** Autentica e devolve o token de acesso — usado tanto pelo provider quanto pelo teste de conexão. */
export async function fetchSyncPayToken(creds: {
  clientId: string;
  clientSecret: string;
}): Promise<{ token: string; expiresIn?: number }> {
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
  return { token, expiresIn: data.expires_in };
}

/** Testa credenciais sem afetar cache/estado de nenhum provider já instanciado. */
export async function testSyncPayCredentials(creds: {
  clientId: string;
  clientSecret: string;
}): Promise<{ ok: boolean; message?: string }> {
  try {
    await fetchSyncPayToken(creds);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "falha de rede" };
  }
}

export function createSyncPay(creds: {
  clientId: string;
  clientSecret: string;
}): PaymentProvider {
  let cachedToken: { token: string; exp: number } | null = null;

  async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.exp > Date.now() + 30_000) {
      return cachedToken.token;
    }
    const { token, expiresIn } = await fetchSyncPayToken(creds);
    cachedToken = {
      token,
      exp: Date.now() + (expiresIn ? expiresIn * 1000 : 3_600_000),
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
      let cpf = (input.customer?.document || "").replace(/\D/g, "");
      if (cpf.length !== 11) {
        cpf = "00000000000";
      }
      let phone = (input.customer?.phone || "").replace(/\D/g, "");
      if (phone.length < 10 || phone.length > 11) {
        phone = "11999999999";
      }

      const body = {
        amount: reais,
        description: input.description || "Venda",
        webhook_url: input.postbackUrl || "",
        client: {
          name: input.customer?.name || "Cliente",
          cpf,
          email: input.customer?.email || "cliente@exemplo.com",
          phone,
        },
      };

      const res = await authedFetch("/api/partner/v1/cash-in", {
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
      const providerRef = String(data.identifier || "");
      const pixCode = String(data.pix_code || "");
      return {
        providerRef,
        status: "pending",
        pixCode,
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
