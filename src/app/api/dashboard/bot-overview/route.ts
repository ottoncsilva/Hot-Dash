import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  periodStatsInRange,
  receitaPorMoeda,
  revenueSeriesForRange,
  revenueByWeekdayAndHour,
} from "@/lib/transactions";
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
    // Quando o público compra (dia da semana / hora) e a base de usuários do
    // Telegram. A base é uma FOTO DO AGORA — não muda com o período: "quantos
    // VIPs eu tenho" não é uma pergunta sobre a semana passada.
    const quando = revenueByWeekdayAndHour(since, until, tz, profileId);
    const finance = getFinanceSettings();

    // Meta do mês. Note o `undefined` no lugar do profileId: a meta é UMA da
    // operação inteira (não existe meta por modelo), então o realizado que ela
    // mede também tem de ser da operação inteira. Filtrar por modelo aqui
    // compararia o faturamento de uma com a meta de todas — a barra ficaria
    // baixa sem motivo. É de propósito; não "conserte" passando profileId.
    const mes = resolvePeriod("thisMonth", null, null, tz).range;
    const metaFeitoCents = periodStatsInRange(mes.since, mes.until).paidCents;
    // Faturamento LÍQUIDO = soma do valor que o gateway repassa (já sem a taxa).
    // Antes este card era "lucro líquido" = faturamento - anúncios, o que
    // misturava custo de mídia com a taxa do gateway.
    const netRevenueCents = stats.paidNetCents;
    // O que foi vendido em OUTRA moeda no mesmo período. Os totais acima são
    // só em real (centavo de dólar não se soma com centavo de real); sem esta
    // lista a venda internacional simplesmente sumiria da tela.
    const receitaEstrangeira = receitaPorMoeda(since, until, profileId);
    const netProfitCents = netRevenueCents - finance.adSpendCents;

    return NextResponse.json({
      period,
      stats,
      funnel,
      byProfile,
      series,
      netRevenueCents,
      receitaEstrangeira,
      netProfitCents,
      metaMensalCents: finance.monthlyGoalCents,
      metaFeitoCents,
      byWeekday: quando.weekday,
      byHour: quando.hour,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
