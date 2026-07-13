import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getSyncPayCredentials } from "@/lib/settings";
import { testSyncPayCredentials } from "@/lib/payments/syncpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret : "";

    const creds =
      clientId && clientSecret
        ? { clientId, clientSecret }
        : getSyncPayCredentials();

    if (!creds) {
      return NextResponse.json({ connected: false, message: "Informe Client ID e Client Secret." });
    }

    const result = await testSyncPayCredentials(creds);
    return NextResponse.json({ connected: result.ok, message: result.message });
  } catch (err) {
    return errorResponse(err);
  }
}
