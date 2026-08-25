import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saldo disponível na Stripe (em USD). Rota própria, separada da de saldo da
 * SyncPay: a API da Stripe é bem mais direta (sem os múltiplos caminhos e
 * limite de taxa que a consulta da SyncPay precisa contornar), então não
 * precisa do mesmo cache/diagnóstico — uma consulta simples basta.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = getProvider("stripe");
    if (!provider?.getBalance) {
      return NextResponse.json({ connected: false, availableCents: null, pendingCents: null });
    }
    const bal = await provider.getBalance().catch(() => null);
    if (!bal) {
      return NextResponse.json({
        connected: false,
        availableCents: null,
        pendingCents: null,
        error: "Não foi possível consultar o saldo agora.",
      });
    }
    return NextResponse.json({
      connected: true,
      availableCents: bal.availableCents,
      pendingCents: bal.pendingCents ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
