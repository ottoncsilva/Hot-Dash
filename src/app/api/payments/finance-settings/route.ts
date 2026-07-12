import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getFinanceSettings, updateFinanceSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ finance: getFinanceSettings() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const finance = updateFinanceSettings({
      adSpendCents:
        typeof body.adSpendCents === "number" ? body.adSpendCents : undefined,
      taxRatePercent:
        typeof body.taxRatePercent === "number" ? body.taxRatePercent : undefined,
    });
    return NextResponse.json({ finance });
  } catch (err) {
    return errorResponse(err);
  }
}
