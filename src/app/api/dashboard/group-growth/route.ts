import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { groupGrowthSeries, runTelegramGroupMonitor } from "@/lib/telegramMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Crescimento diário dos grupos do Telegram (VIP e Prévias).
 *
 * Rota separada de propósito: o Funil já responde por vendas, e esta série vem
 * de outra fonte (consulta à API do Telegram). Manter separado evita mexer no
 * payload do funil — e, principalmente, nada aqui toca no que vem da SyncPay.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId") || undefined;
    const dias = Math.max(2, Math.min(90, parseInt(req.nextUrl.searchParams.get("days") || "14", 10)));

    // Mede agora para o dia de hoje já ter ponto ao abrir a tela. Falha ou
    // demora não derrubam a resposta: cai no histórico que já existe.
    await runTelegramGroupMonitor({ force: true, profileId }).catch(() => {});

    return NextResponse.json({ series: groupGrowthSeries(dias, profileId) });
  } catch (err) {
    return errorResponse(err);
  }
}
