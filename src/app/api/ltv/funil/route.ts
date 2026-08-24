import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { ltvFunilMetricas, ltvFunilPorConta, ltvTopProdutos } from "@/lib/ltvFunnel";
import { getAppTimeZone } from "@/lib/settings";
import { resolvePeriod } from "@/lib/periodRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Funil de LTV: conversa → PIX gerado → pago.
 *
 * Usa o MESMO seletor de período do Dashboard, do Financeiro e do Funil de
 * Vendas (`resolvePeriod`), então "este mês" quer dizer a mesma coisa em todas
 * as telas. O que muda em relação ao Funil de Vendas é a base: aqui o lead é a
 * conversa do LTV, não o /start no bot.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const profileId = sp.get("profileId") || undefined;
    const canalBruto = sp.get("channel");
    const channel: "whatsapp" | "telegram" | undefined =
      canalBruto === "whatsapp" || canalBruto === "telegram" ? canalBruto : undefined;

    const { period, range } = resolvePeriod(
      sp.get("period"),
      sp.get("from"),
      sp.get("to"),
      getAppTimeZone(),
    );
    const filtro = { sinceMs: range.since, untilMs: range.until, profileId, channel };

    return NextResponse.json({
      period,
      metricas: ltvFunilMetricas(filtro),
      contas: ltvFunilPorConta(filtro),
      produtos: ltvTopProdutos(filtro, 5),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
