import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteTransaction } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remove uma cobrança do histórico.
 *
 * O webhook da SyncPay é cadastrado por conta e traz todo tipo de movimento —
 * um saque já entrou como venda uma vez. O filtro do webhook barra os casos
 * conhecidos; isto aqui é a saída manual para o que escapar.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const ok = deleteTransaction(params.id);
    if (!ok) return NextResponse.json({ error: "Cobrança não encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
