import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteTransaction, updateTransactionAmounts } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Corrige os valores de uma cobrança.
 *
 * Existe porque o que o gateway manda nem sempre bate com o painel dele — uma
 * venda de R$ 19,90 já entrou como R$ 20,70. O líquido não vem daqui: é sempre
 * venda − taxa − split, calculado no servidor.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const cents = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
    };
    const t = updateTransactionAmounts(params.id, {
      amountCents: cents(body.amountCents),
      feeCents: cents(body.feeCents),
      splitCents: cents(body.splitCents),
      customer: typeof body.customer === "string" ? body.customer : undefined,
    });
    if (!t) return NextResponse.json({ error: "Cobrança não encontrada." }, { status: 404 });
    return NextResponse.json({ transaction: t });
  } catch (err) {
    return errorResponse(err);
  }
}

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
