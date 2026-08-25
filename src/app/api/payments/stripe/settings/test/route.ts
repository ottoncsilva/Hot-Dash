import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getStripeCredentials } from "@/lib/settings";
import { testStripeCredentials } from "@/lib/payments/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const secretKey =
      typeof body.secretKey === "string" && body.secretKey.trim()
        ? body.secretKey.trim()
        : getStripeCredentials()?.secretKey;

    if (!secretKey) {
      return NextResponse.json({ connected: false, message: "Informe a Secret Key." });
    }

    const result = await testStripeCredentials(secretKey);
    return NextResponse.json({ connected: result.ok, message: result.message });
  } catch (err) {
    return errorResponse(err);
  }
}
