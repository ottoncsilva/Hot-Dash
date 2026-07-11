import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getPaymentSettingsPublic } from "@/lib/settings";
import { listTransactions, overview } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({
      providers: getPaymentSettingsPublic(),
      overview: overview(),
      transactions: listTransactions(50),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
