import { NextRequest, NextResponse } from "next/server";
import { ensureSyncpayWebhookShortToken } from "@/lib/settings";
import { processarWebhookSyncPay } from "@/lib/payments/syncpayWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * URL CURTA do webhook: `/w/<token>`.
 *
 * A antiga (`/api/webhooks/syncpay?token=…`) tem 95 caracteres entre caminho e
 * query — ruim de colar e de conferir no painel do gateway. Aqui o token vai no
 * caminho e a URL inteira cabe numa linha.
 *
 * O token é comparado em tempo constante para a resposta não vazar, pelo tempo,
 * quantos caracteres bateram. Só POST existe: um GET não devolve nada.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const esperado = ensureSyncpayWebhookShortToken();
  if (!seguroIgual(params.token || "", esperado)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const res = await processarWebhookSyncPay(body, req.headers.get("event") || "");
  return NextResponse.json(res);
}

function seguroIgual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
