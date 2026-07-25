import { NextRequest, NextResponse } from "next/server";
import { ensureSyncpayWebhookToken, isLegacyWebhookEnabled } from "@/lib/settings";
import { processarWebhookSyncPay } from "@/lib/payments/syncpayWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * URL ANTIGA do webhook (`/api/webhooks/syncpay?token=…`).
 *
 * Continua valendo para não interromper o recebimento enquanto a URL curta
 * (`/w/<token>`) não é colada no painel do gateway. Depois da troca, dá para
 * desligá-la em Configurações → Pagamentos, aposentando o token antigo.
 *
 * O processamento em si mora em lib/payments/syncpayWebhook — as duas rotas
 * cuidam só da autenticação.
 */
export async function POST(req: NextRequest) {
  if (!isLegacyWebhookEnabled()) {
    return NextResponse.json({ error: "URL antiga desativada." }, { status: 410 });
  }

  // Aceita o token gerenciado (o que a UI mostra) ou, por retrocompatibilidade,
  // o SESSION_SECRET usado nas versões antigas. Vem em ?token= ou no header.
  const provided =
    req.nextUrl.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
  const expected = ensureSyncpayWebhookToken();
  const legacy = process.env.SESSION_SECRET || "";
  if (!provided || (provided !== expected && !(legacy && provided === legacy))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const res = await processarWebhookSyncPay(body, req.headers.get("event") || "");
  return NextResponse.json(res);
}
