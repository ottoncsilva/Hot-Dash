import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getPaymentSettingsPublic, updatePaymentSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ settings: getPaymentSettingsPublic() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const settings = updatePaymentSettings({
      syncpay: body.syncpay,
      stripe: body.stripe,
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
