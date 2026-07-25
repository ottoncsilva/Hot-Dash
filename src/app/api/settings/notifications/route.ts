import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getNotificationPrefs, setNotificationPrefs } from "@/lib/settings";
import { PUSH_EVENTS, type NotificationPrefs } from "@/lib/notificationTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ prefs: getNotificationPrefs() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    // Só aceita chaves conhecidas do catálogo, com valor booleano.
    const patch: Partial<NotificationPrefs> = {};
    for (const e of PUSH_EVENTS) {
      if (typeof body[e.id] === "boolean") patch[e.id] = body[e.id];
    }
    return NextResponse.json({ prefs: setNotificationPrefs(patch) });
  } catch (err) {
    return errorResponse(err);
  }
}
