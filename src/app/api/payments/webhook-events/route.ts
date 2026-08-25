import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { listWebhookEvents } from "@/lib/webhookLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Últimos webhooks recebidos do gateway, com o corpo cru. Serve para ver o que
 *  cada provedor manda de fato em cada tipo de evento. `?provider=stripe`
 *  filtra pra um gateway só — sem isso, a lista mistura todos. */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = req.nextUrl.searchParams.get("provider") || undefined;
    return NextResponse.json({ events: listWebhookEvents(50, provider) });
  } catch (err) {
    return errorResponse(err);
  }
}
