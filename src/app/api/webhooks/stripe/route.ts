import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeCredentials } from "@/lib/settings";
import { processarWebhookStripe } from "@/lib/payments/stripeWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook da Stripe — cadastrado UMA VEZ no Dashboard dela (Developers →
 * Webhooks), não por cobrança. NÃO exige login: a autenticidade vem da
 * assinatura HMAC (header `stripe-signature`), verificada sobre o CORPO CRU
 * — por isso `req.text()`, nunca `req.json()` (reserializar mudaria os bytes
 * e derrubaria a assinatura).
 */
export async function POST(req: NextRequest) {
  const creds = getStripeCredentials();
  if (!creds) {
    return NextResponse.json({ error: "Stripe não configurada." }, { status: 400 });
  }

  const raw = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  let event: Stripe.Event;
  try {
    // A verificação não precisa de chamada de API — não usa a secret key,
    // só a webhook secret — então um Stripe sem apiVersion fixa serve aqui.
    const stripe = new Stripe(creds.secretKey);
    event = stripe.webhooks.constructEvent(raw, signature, creds.webhookSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "assinatura inválida";
    return NextResponse.json({ error: `Webhook inválido: ${msg}` }, { status: 400 });
  }

  const res = await processarWebhookStripe(event);
  return NextResponse.json(res);
}
