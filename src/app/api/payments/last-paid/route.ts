import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { lastPaidTransaction } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A ÚLTIMA venda paga (qualquer provedor/perfil) — leve o bastante pra ser
 * consultada de tempos em tempos (o Dashboard usa isso pra saber o VALOR
 * exato da venda que acabou de entrar, pro toast "Nova venda confirmada").
 * `/api/dashboard/bot-overview` dá o TOTAL do dia, não a venda individual —
 * por isso esta rota existe separada.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ lastPaid: lastPaidTransaction() });
  } catch (err) {
    return errorResponse(err);
  }
}
