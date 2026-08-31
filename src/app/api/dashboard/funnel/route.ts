import { NextRequest, NextResponse } from "next/server";
import { receitaPorMoeda } from "@/lib/transactions";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  funnelByProfile,
  funnelMetrics,
  metricasComparadas,
  topPlans,
  trafficSources,
} from "@/lib/salesFunnel";
import { userStatsAll } from "@/lib/telegramUsers";
import { groupTotals } from "@/lib/telegramMonitor";
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
    // Venda em outra moeda, do mesmo período — ver a rota do Dashboard.
    const receitaEstrangeira = receitaPorMoeda(range.since, range.until, profileId);
    return NextResponse.json({
      period,
      // Quando um modelo está selecionado, os cards do topo mostram só ele.
      metricas: profileId ? funnelMetrics(range.since, range.until, profileId) : geral,
      linhas,
      planos: topPlans(range.since, range.until, profileId, 5),
      fontes: trafficSources(range.since, range.until, profileId),
      receitaEstrangeira,
      // Hoje/mês/total NÃO seguem o período escolhido de propósito: o valor
      // deles é justamente comparar a janela curta com a longa.
      comparativo: metricasComparadas(tz, profileId),
      // Base do Telegram: quantos usuários e quantos membros nos grupos. São
      // FOTO DO AGORA — não seguem o período, porque "quantos VIPs eu tenho"
      // não é pergunta sobre a semana passada.
      //
      // Não força `runTelegramGroupMonitor` aqui de propósito: a mesma tela já
      // chama /api/dashboard/group-growth, que força. Forçar nas duas faria
      // duas consultas à API do Telegram por carga de página.
      users: userStatsAll(profileId),
      groups: groupTotals(profileId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
