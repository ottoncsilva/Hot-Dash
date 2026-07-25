import "server-only";
import type {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
  ProviderTransactionResult,
} from "./types";

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

type AttemptInfo = {
  path: string;
  method: string;
  httpStatus?: number;
  bodySample?: string;
  error?: string;
};

/** Dígito verificador de CPF sobre os dígitos já existentes. */
function cpfCheckDigit(digits: number[]): number {
  const len = digits.length + 1;
  const sum = digits.reduce((acc, d, i) => acc + d * (len - i), 0);
  const r = (sum * 10) % 11;
  return r === 10 ? 0 : r;
}

/**
 * Gera um CPF sintaticamente VÁLIDO (dígitos verificadores corretos, base
 * aleatória). A compra é 1 clique — o lead NÃO informa CPF —, mas a API da
 * SyncPay exige o campo. Um CPF válido evita recusa por validação de formato
 * (o placeholder 00000000000 falha no dígito verificador em alguns gateways).
 */
function randomValidCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const d1 = cpfCheckDigit(base);
  const d2 = cpfCheckDigit([...base, d1]);
  return [...base, d1, d2].join("");
}

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
      // Se um CPF real vier (checkout externo), usa-o; senão gera um válido —
      // o bot NÃO pede CPF ao lead, mas a API exige o campo.
      let cpf = (input.customer?.document || "").replace(/\D/g, "");
      if (cpf.length !== 11) {
        cpf = randomValidCpf();
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

    /**
     * Consulta o status de UMA transação — "Consulta status da transação" na
     * documentação: GET /api/partner/v1/transaction/{identifier}, onde o
     * identifier é o mesmo devolvido no cash-in (o nosso provider_ref).
     *
     * ATENÇÃO: a resposta traz apenas
     *   { data: { reference_id, currency, amount, transaction_date, status,
     *             description, pix_code } }
     * — NÃO existe `final_amount` aqui. O valor LÍQUIDO só chega no webhook.
     * Ou seja: esta consulta serve para corrigir status e valor cheio das
     * vendas antigas, mas não recupera o líquido delas.
     */
    async getTransaction(providerRef: string): Promise<ProviderTransactionResult> {
      const path = `/api/partner/v1/transaction/${encodeURIComponent(providerRef)}`;
      try {
        const res = await authedFetch(path, { method: "GET" });
        const texto = await res.text().catch(() => "");
        if (!res.ok) {
          return {
            ok: false,
            attempts: [{ path, method: "GET", httpStatus: res.status, bodySample: texto.slice(0, 180) }],
          };
        }
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(texto) as Record<string, unknown>;
        } catch {
          json = null;
        }
        if (!json) {
          return {
            ok: false,
            attempts: [{ path, method: "GET", httpStatus: res.status, bodySample: texto.slice(0, 180) }],
          };
        }
        const d = ((json.data as Record<string, unknown>) || json) as Record<string, unknown>;
        const num = (v: unknown) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0 ? n : undefined;
        };
        const amount = num(d.amount);
        // Tentamos mesmo assim, caso a conta devolva algum campo de líquido.
        const liquido = num(d.final_amount ?? d.net_amount ?? d.liquid_amount);
        const status = typeof d.status === "string" ? d.status : undefined;
        if (amount === undefined && !status) {
          return {
            ok: false,
            attempts: [{ path, method: "GET", httpStatus: res.status, bodySample: texto.slice(0, 180) }],
          };
        }
        const dataTx = typeof d.transaction_date === "string" ? d.transaction_date : undefined;
        return {
          ok: true,
          data: {
            grossCents: amount !== undefined ? Math.round(amount * 100) : undefined,
            netCents: liquido !== undefined ? Math.round(liquido * 100) : undefined,
            status,
            paidAtMs: dataTx ? Date.parse(dataTx) || undefined : undefined,
            raw: d,
          },
        };
      } catch (e) {
        return {
          ok: false,
          attempts: [{ path, method: "GET", error: e instanceof Error ? e.message : "falha de rede" }],
        };
      }
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
