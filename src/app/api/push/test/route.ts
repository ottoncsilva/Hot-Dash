import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { sendPushToAll, countSubscriptions } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dispara uma notificação de teste para todos os aparelhos inscritos — serve
 * para o operador confirmar, na hora, que o alerta de venda vai chegar no
 * celular (sem precisar esperar uma venda de verdade).
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const devices = countSubscriptions();
    if (devices === 0) {
      return NextResponse.json(
        { ok: false, devices: 0, message: "Nenhum aparelho ativado ainda." },
        { status: 400 },
      );
    }
    // Mesmo formato do alerta de verdade (ver `deliverPayment`) — um teste que
    // chega diferente do real não testa nada.
    await sendPushToAll(
      "💠 Venda Aprovada no PIX! R$ 97,00",
      "Teste do Hot Dash - é assim que o alerta de venda vai chegar",
      "/dashboard",
    );
    return NextResponse.json({ ok: true, devices });
  } catch (err) {
    return errorResponse(err);
  }
}
