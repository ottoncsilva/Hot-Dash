import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { periodStatsInRange, revenueSeriesForDays } from "@/lib/transactions";
import { salesFunnel, topPlansByRevenue, revenueByProfile } from "@/lib/salesFunnel";
import { getFinanceSettings, getAppTimeZone } from "@/lib/settings";
import { startOfDayInTimeZone, addDaysInTimeZone } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS = ["today", "yesterday", "last7", "last30", "all"] as const;
type PeriodKey = (typeof PERIODS)[number];

/**
 * Início/fim (ms) de cada período, com os limites do dia calculados no FUSO DA
 * OPERAÇÃO (Configurações → Geral). Antes usava o fuso local do servidor, que
 * em produção é UTC: "hoje" começava às 21h de Brasília do dia anterior e as
 * vendas da noite apareciam no dia seguinte. "all" não tem limite.
 */
function rangeFor(period: PeriodKey, tz: string): { since: number | null; until: number | null; days: number } {
  const now = Date.now();
  const startOfToday = startOfDayInTimeZone(now, tz);

  switch (period) {
    case "today":
      return { since: startOfToday, until: null, days: 7 };
    case "yesterday":
      return { since: addDaysInTimeZone(startOfToday, -1, tz), until: startOfToday, days: 7 };
    case "last7":
      return { since: addDaysInTimeZone(startOfToday, -6, tz), until: null, days: 7 };
    case "last30":
      return { since: addDaysInTimeZone(startOfToday, -29, tz), until: null, days: 30 };
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

    const tz = getAppTimeZone();
    const { since, until, days } = rangeFor(period, tz);

    const stats = periodStatsInRange(since, until, profileId);
    const funnel = salesFunnel(since, until, profileId);
    const topPlans = topPlansByRevenue(since, until, profileId, 5);
    const byProfile = revenueByProfile(since, until);
    const series = revenueSeriesForDays(days, profileId);
    const finance = getFinanceSettings();
    // Faturamento LÍQUIDO = soma do valor que o gateway repassa (já sem a taxa).
    // Antes este card era "lucro líquido" = faturamento - anúncios, o que
    // misturava custo de mídia com a taxa do gateway.
    const netRevenueCents = stats.paidNetCents;
    const netProfitCents = netRevenueCents - finance.adSpendCents;

    return NextResponse.json({
      period,
      stats,
      funnel,
      topPlans,
      byProfile,
      series,
      netRevenueCents,
      netProfitCents,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
