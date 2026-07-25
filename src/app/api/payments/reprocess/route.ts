import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { activeProvider } from "@/lib/payments";
import { applyProviderAmounts, transactionsMissingNet } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pausa entre consultas, para não levar rate-limit do gateway. */
const GAP_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reprocessa as vendas ANTIGAS no gateway para recuperar o valor líquido
 * (`final_amount`), que antes não era gravado.
 *
 * Importante: a API da SyncPay não tem endpoint de LISTAGEM — só consulta
 * individual por id. Então só dá para reprocessar as transações que já estão no
 * nosso banco (temos o provider_ref de cada uma). Vendas que nunca chegaram
 * aqui não podem ser descobertas por este caminho.
 *
 * GET  = prévia: diz quantas seriam reprocessadas, sem alterar nada.
 * POST = executa. Aceita { limit } para processar em lotes.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = activeProvider();
    const pending = transactionsMissingNet("syncpay");
    return NextResponse.json({
      pending: pending.length,
      providerConnected: Boolean(provider),
      supported: Boolean(provider?.getTransaction),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = activeProvider();
    if (!provider) {
      return NextResponse.json(
        { error: "Nenhum provedor de pagamento conectado." },
        { status: 400 },
      );
    }
    if (!provider.getTransaction) {
      return NextResponse.json(
        { error: "Este provedor não permite consultar transações antigas." },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(500, parseInt(body.limit, 10) || 200));

    const pending = transactionsMissingNet("syncpay").slice(0, limit);
    let updated = 0;
    let notFound = 0;
    let failed = 0;
    let firstError: string | null = null;

    for (const t of pending) {
      try {
        const info = await provider.getTransaction(t.providerRef!);
        if (!info) {
          notFound++;
        } else {
          applyProviderAmounts(t.id, info);
          updated++;
        }
      } catch (e) {
        failed++;
        if (!firstError) firstError = e instanceof Error ? e.message : "falha na consulta";
      }
      await sleep(GAP_MS);
    }

    const remaining = transactionsMissingNet("syncpay").length;
    return NextResponse.json({
      ok: true,
      processed: pending.length,
      updated,
      notFound,
      failed,
      remaining,
      firstError,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
