import { NextRequest, NextResponse } from "next/server";
import { normalizeStatus, recordTransaction, updateStatusByRef } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook da SyncPay (postbackUrl das cobranças). Recebe a confirmação de
 * pagamento e atualiza a transação correspondente no banco. NÃO exige login
 * (é a SyncPay chamando), mas só age sobre transações que já existem no nosso
 * banco (criadas pela cobrança) — a menos que ainda não exista, caso em que
 * registra para não perder a venda.
 *
 * Payload documentado:
 * { "data": { "id", "client": { name, email, document }, "pix_code",
 *   "amount", "final_amount", "currency", "status", "payment_method",
 *   "created_at", "updated_at" } }
 * status: pending | completed | failed | refunded | med
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Aceita tanto { data: {...} } quanto o objeto direto.
    const data = ((body.data as Record<string, unknown>) || body) as Record<
      string,
      unknown
    >;

    const providerRef = String(
      data.id || data.idTransaction || data.transaction_id || "",
    );
    const status = String(data.status || data.status_transaction || "");
    if (!providerRef || !status) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const updated = updateStatusByRef("syncpay", providerRef, status);

    if (!updated) {
      // Venda que ainda não estava registrada (ex.: checkout externo): grava.
      const amount = Number(data.final_amount ?? data.amount ?? 0);
      const client = (data.client as Record<string, unknown>) || {};
      recordTransaction({
        provider: "syncpay",
        providerRef,
        description: "Venda (webhook)",
        customer: (client.name as string) || undefined,
        amountCents: Math.round(amount * 100),
        method: "pix",
        status: normalizeStatus(status),
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    // Sempre 200 para o gateway não reenviar em loop por erro nosso.
    return NextResponse.json({ ok: true });
  }
}
