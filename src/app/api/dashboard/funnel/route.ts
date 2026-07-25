import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { funnelByProfile, funnelMetrics, topPlans } from "@/lib/salesFunnel";
import { getAppTimeZone } from "@/lib/settings";
import { resolvePeriod } from "@/lib/periodRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Funil de vendas: a jornada /start → PIX gerado → pago, por modelo.
 *
 * O período usa o mesmo seletor do Dashboard e do Financeiro (resolvePeriod),
 * então "este mês" quer dizer a mesma coisa nas três telas.
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

    const { linhas, geral } = funnelByProfile(range.since, range.until);
    return NextResponse.json({
      period,
      // Quando um modelo está selecionado, os cards do topo mostram só ele.
      metricas: profileId ? funnelMetrics(range.since, range.until, profileId) : geral,
      linhas,
      planos: topPlans(range.since, range.until, profileId, 5),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
