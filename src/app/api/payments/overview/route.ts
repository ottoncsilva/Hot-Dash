import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getFinanceSettings, getPaymentSettingsPublic } from "@/lib/settings";
import { listTransactions, overview } from "@/lib/transactions";
import { activeProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId") || undefined;

    // Saldo do provedor (best-effort; não bloqueia o painel se falhar).
    let balanceCents: number | null = null;
    const provider = activeProvider();
    if (provider?.getBalance) {
      const bal = await provider.getBalance().catch(() => null);
      balanceCents = bal?.availableCents ?? null;
    }

    return NextResponse.json({
      providers: getPaymentSettingsPublic(),
      overview: overview(profileId),
      transactions: listTransactions(50, profileId),
      balanceCents,
      finance: getFinanceSettings(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
