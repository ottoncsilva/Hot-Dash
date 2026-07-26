import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { periodStatsInRange, revenueSeriesForRange } from "@/lib/transactions";
import { salesFunnel, revenueByProfile } from "@/lib/salesFunnel";
import { getFinanceSettings, getAppTimeZone } from "@/lib/settings";
import { resolvePeriod } from "@/lib/periodRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Painel do bot de vendas para o período escolhido.
 *
 * Os limites de cada período vêm de `resolvePeriod`: calculados no FUSO DA
 * OPERAÇÃO (em produção o servidor roda em UTC, e "hoje" começaria às 21h de
 * Brasília do dia anterior) e compartilhados com o Financeiro, para "esta
 * semana" querer dizer a mesma coisa nas duas telas.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId") || undefined;
    const tz = getAppTimeZone();
    const { period, range } = resolvePeriod(
      req.nextUrl.searchParams.get("period"),
      req.nextUrl.searchParams.get("from"),
      req.nextUrl.searchParams.get("to"),
      tz,
    );
    const { since, until } = range;

    const stats = periodStatsInRange(since, until, profileId);
    const funnel = salesFunnel(since, until, profileId);
    const byProfile = revenueByProfile(since, until);
    const series = revenueSeriesForRange(period, since, until, profileId);
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
      byProfile,
      series,
      netRevenueCents,
      netProfitCents,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
