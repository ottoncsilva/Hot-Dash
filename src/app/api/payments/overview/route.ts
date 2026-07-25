import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getAppTimeZone, getFinanceSettings, getPaymentSettingsPublic } from "@/lib/settings";
import { listTransactionsInRange, periodStatsInRange } from "@/lib/transactions";
import { activeProvider } from "@/lib/payments";
import { resolvePeriod } from "@/lib/periodRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId") || undefined;

    // Mesmo seletor de período do Dashboard. O filtro é aplicado na CONSULTA,
    // não sobre uma lista já cortada — senão "este mês" só enxergaria as
    // últimas cobranças que coubessem no limite.
    const tz = getAppTimeZone();
    const { period, range } = resolvePeriod(
      req.nextUrl.searchParams.get("period"),
      req.nextUrl.searchParams.get("from"),
      req.nextUrl.searchParams.get("to"),
      tz,
    );

    // Saldo do provedor (best-effort; não bloqueia o painel se falhar).
    let balanceCents: number | null = null;
    const provider = activeProvider();
    if (provider?.getBalance) {
      const bal = await provider.getBalance().catch(() => null);
      balanceCents = bal?.availableCents ?? null;
    }

    return NextResponse.json({
      providers: getPaymentSettingsPublic(),
      period,
      periodStats: periodStatsInRange(range.since, range.until, profileId),
      transactions: listTransactionsInRange(range.since, range.until, 500, profileId),
      balanceCents,
      finance: getFinanceSettings(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
