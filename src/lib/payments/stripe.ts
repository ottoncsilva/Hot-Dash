import "server-only";
import type { ChargeInput, ChargeResult, PaymentProvider } from "./types";

/**
 * Adaptador Stripe via API REST (sem SDK, para manter o bundle enxuto).
 * Cria um PaymentIntent com o método PIX (disponível para contas BR).
 * A secret key vem das Configurações (criptografada no banco).
 */
const BASE = "https://api.stripe.com/v1";

/** Serializa objeto no formato x-www-form-urlencoded aninhado da Stripe. */
function encodeForm(
  obj: Record<string, unknown>,
  prefix = "",
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") {
      parts.push(encodeForm(value as Record<string, unknown>, k));
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

export function createStripe(secretKey: string): PaymentProvider {
  async function call(path: string, body: Record<string, unknown>) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error as Record<string, unknown>)?.message as string;
      throw new Error(`Stripe (${res.status}): ${err || "falha"}`);
    }
    return data;
  }

  return {
    key: "stripe",
    async createPixCharge(input: ChargeInput): Promise<ChargeResult> {
      const data = await call("/payment_intents", {
        amount: input.amountCents,
        currency: "brl",
        "payment_method_types[]": "pix",
        description: input.description,
      });
      return {
        providerRef: String(data.id || ""),
        status: "pending",
        pixCode: undefined,
        checkoutUrl: undefined,
        raw: data,
      };
    },
  };
}
