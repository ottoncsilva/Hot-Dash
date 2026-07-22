import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { periodStatsInRange, revenueSeriesForDays } from "@/lib/transactions";
import { salesFunnel, topPlansByRevenue, revenueByProfile } from "@/lib/salesFunnel";
import { getFinanceSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS = ["today", "yesterday", "last7", "last30", "all"] as const;
type PeriodKey = (typeof PERIODS)[number];

/** Início/fim (ms) de cada período, no fuso local do servidor. "all" não tem limite. */
function rangeFor(period: PeriodKey): { since: number | null; until: number | null; days: number } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  switch (period) {
    case "today":
      return { since: startOfToday.getTime(), until: null, days: 7 };
    case "yesterday": {
      const startOfYesterday = new Date(startOfToday);
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      return { since: startOfYesterday.getTime(), until: startOfToday.getTime(), days: 7 };
    }
    case "last7": {
      const since = new Date(startOfToday);
      since.setDate(since.getDate() - 6);
      return { since: since.getTime(), until: null, days: 7 };
    }
    case "last30": {
      const since = new Date(startOfToday);
      since.setDate(since.getDate() - 29);
      return { since: since.getTime(), until: null, days: 30 };
    }
    case "all":
    default:
      return { since: null, until: null, days: 30 };
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId") || undefined;
    const periodParam = req.nextUrl.searchParams.get("period") || "last7";
    const period = (PERIODS as readonly string[]).includes(periodParam)
      ? (periodParam as PeriodKey)
      : "last7";

    const { since, until, days } = rangeFor(period);

    const stats = periodStatsInRange(since, until, profileId);
    const funnel = salesFunnel(since, until, profileId);
    const topPlans = topPlansByRevenue(since, until, profileId, 5);
    const byProfile = revenueByProfile(since, until);
    const series = revenueSeriesForDays(days, profileId);
    const finance = getFinanceSettings();
    const netProfitCents = stats.paidCents - finance.adSpendCents;

    return NextResponse.json({
      period,
      stats,
      funnel,
      topPlans,
      byProfile,
      series,
      netProfitCents,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
