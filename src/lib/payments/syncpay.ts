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

/** Uma tentativa de leitura do saldo, guardada para diagnóstico. */
export type BalanceAttempt = {
  path: string;
  httpStatus?: number;
  bodySample?: string;
  error?: string;
};

/**
 * Caminho do saldo. É UM só, o do OpenAPI da SyncPay:
 * `GET /api/partner/v1/balance`, bearer do auth-token, `{ "balance": "90.00" }`.
 * Sair tentando caminhos parecidos só gastaria o limite de chamadas — a mesma
 * rota devolve 429 quando é chamada demais.
 */
const BALANCE_PATH = "/api/partner/v1/balance";

/** Chaves de saldo aceitas, das mais específicas para as mais genéricas — para
 *  não confundir com "saldo bloqueado" e afins. */
const CHAVES_SALDO = [
  "balance",
  "saldo",
  "available",
  "available_balance",
  "availablebalance",
  "balance_available",
  "amount",
  "value",
];

/**
 * Procura o saldo em qualquer nível do JSON. É busca em largura: o campo do
 * nível mais raso ganha, e entre os do mesmo nível vale a ordem de
 * `CHAVES_SALDO`. Assim `{"balance":"90.00"}` e `{"data":{"balance":90}}`
 * funcionam sem precisar mapear o formato de cada conta.
 */
function achaSaldo(raiz: unknown): number | null {
  const fila: unknown[] = [raiz];
  let guard = 0;
  while (fila.length > 0 && guard++ < 200) {
    const no = fila.shift();
    if (!no || typeof no !== "object") continue;
    const obj = no as Record<string, unknown>;
    for (const chave of CHAVES_SALDO) {
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase().replace(/[^a-z_]/g, "") !== chave) continue;
        const v = toReais(obj[k]);
        if (v !== null) return v;
      }
    }
    for (const v of Object.values(obj)) if (v && typeof v === "object") fila.push(v);
  }
  return null;
}

/**
 * Converte um valor monetário da API para reais. A SyncPay devolve números
 * como string ("90.00"), e algumas respostas usam o formato brasileiro
 * ("1.234,56") — os dois precisam virar 1234.56.
 */
function toReais(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const limpo = v.replace(/[^\d.,-]/g, "").trim();
  if (!limpo) return null;
  const norm = /,\d{1,2}$/.test(limpo) ? limpo.replace(/\./g, "").replace(",", ".") : limpo.replace(/,/g, "");
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

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
    // Inclui o que a SyncPay respondeu: é ela quem diz se o problema é o
    // client id, o secret ou a conta — sem isso o erro vira adivinhação.
    const corpo = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(
      `SyncPay: autenticação falhou (${res.status})${corpo ? ` · ${corpo}` : ""}`,
    );
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
      // O Next guarda respostas de `fetch` num cache próprio, e um GET repetido
      // (o saldo) voltaria congelado no primeiro valor lido. Aqui a resposta
      // precisa ser sempre a de agora.
      cache: "no-store",
      headers: {
        ...(init.headers || {}),
        // Content-Type só quando há corpo: a requisição documentada do saldo é
        // um GET com o Authorization e mais nada, e declarar corpo JSON onde
        // não existe corpo é o tipo de detalhe que alguns gateways recusam.
        ...(init.body ? { "Content-Type": "application/json" } : {}),
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
     * Saldo do usuário. O caminho documentado é
     * `GET /api/partner/v1/balance` → `{ "balance": "90.00" }`, mas ele não
     * responde em toda conta — por isso tentamos alguns caminhos irmãos e
     * guardamos o que cada um respondeu, para o botão "Testar saldo" das
     * Configurações mostrar o motivo quando nenhum funcionar (antes o card só
     * dizia "indisponível", sem como saber por quê).
     *
     * O valor vem como STRING no exemplo da própria SyncPay, então a leitura
     * aceita número, string ("90.00" e "1.234,56") e o objeto aninhado.
     */
    async getBalance() {
      const { cents, raw } = await consultaSaldo();
      return cents === null ? null : { availableCents: cents, raw };
    },

    async diagnoseBalance() {
      const { cents, attempts } = await consultaSaldo();
      return { cents, attempts };
    },
  };

  /**
   * Lê o saldo, guardando o que o gateway respondeu.
   *
   * O 429 é tratado à parte porque a rota é limitada: nesse caso não existe
   * "saldo zero" nem erro de credencial, é só esperar — e quem chamou deve
   * manter o último valor conhecido em vez de mostrar "indisponível".
   */
  async function consultaSaldo(): Promise<{
    cents: number | null;
    raw?: unknown;
    rateLimited?: boolean;
    attempts: BalanceAttempt[];
  }> {
    const attempts: BalanceAttempt[] = [];

    // O token vem primeiro e é registrado como um passo próprio: quando as
    // credenciais são recusadas, a consulta de saldo nem chega a acontecer, e
    // atribuir o erro à rota do saldo mandaria procurar no lugar errado.
    try {
      await getToken();
    } catch (e) {
      attempts.push({
        path: "/api/partner/v1/auth-token",
        error: `${e instanceof Error ? e.message : "falha ao autenticar"} — confira o Client ID e o Client Secret em app.syncpayments.com.br → Developer API`,
      });
      return { cents: null, attempts };
    }

    try {
      const res = await authedFetch(BALANCE_PATH, { method: "GET" });
      const texto = await res.text();
      const tentativa: BalanceAttempt = {
        path: BALANCE_PATH,
        httpStatus: res.status,
        bodySample: texto.slice(0, 300),
      };
      attempts.push(tentativa);

      if (res.status === 429) {
        tentativa.error = "limite de consultas da SyncPay atingido — tente de novo em instantes";
        return { cents: null, rateLimited: true, attempts };
      }
      if (res.status === 401) {
        tentativa.error = "não autorizado — o client id/secret não tem acesso ao saldo";
        return { cents: null, attempts };
      }
      if (!res.ok) return { cents: null, attempts };

      let data: unknown;
      try {
        data = JSON.parse(texto);
      } catch {
        tentativa.error = "resposta não é JSON";
        return { cents: null, attempts };
      }
      const reais = achaSaldo(data);
      if (reais === null) {
        tentativa.error = "JSON sem campo de saldo reconhecível";
        return { cents: null, attempts };
      }
      // A API devolve em reais; guardamos em centavos.
      return { cents: Math.round(reais * 100), raw: data, attempts };
    } catch (e) {
      attempts.push({
        path: BALANCE_PATH,
        error: e instanceof Error ? e.message : "falha de rede",
      });
      return { cents: null, attempts };
    }
  }
}
