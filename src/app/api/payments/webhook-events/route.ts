import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { listWebhookEvents } from "@/lib/webhookLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Últimos webhooks recebidos do gateway, com o corpo cru. Serve para ver o que
 *  a SyncPay manda de fato em cada tipo de movimento (venda, saque…). */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ events: listWebhookEvents(50) });
  } catch (err) {
    return errorResponse(err);
  }
}
