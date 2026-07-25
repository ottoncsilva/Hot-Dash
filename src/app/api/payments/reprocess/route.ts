import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { activeProvider } from "@/lib/payments";
import {
  applyProviderAmounts,
  markReprocessed,
  transactionsToReprocess,
} from "@/lib/transactions";
import type { ProviderAttempt } from "@/lib/payments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pausa entre consultas, para não levar rate-limit do gateway. */
const GAP_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reconfere as vendas ANTIGAS direto no gateway.
 *
 * O que ele corrige: STATUS e VALOR CHEIO (útil quando um webhook se perdeu).
 * O que ele NÃO consegue: o valor LÍQUIDO. A consulta documentada
 * ("Consulta status da transação") devolve apenas
 * { reference_id, currency, amount, transaction_date, status, description,
 *   pix_code } — não existe `final_amount` nela. O líquido só chega no webhook,
 * então das vendas antigas ele é irrecuperável por esta via.
 *
 * A API também não tem LISTAGEM — só consulta por id. Logo, só dá para
 * reconferir as vendas que já estão no nosso banco.
 *
 * GET            = prévia: quantas faltam, sem alterar nada.
 * GET ?diagnose=1 = testa UMA venda e devolve exatamente o que o gateway
 *                   respondeu em cada caminho tentado (sem gravar nada).
 * POST           = executa. Aceita { limit } para processar em lotes.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = activeProvider();
    const pending = transactionsToReprocess("syncpay");

    if (req.nextUrl.searchParams.get("diagnose") === "1") {
      if (!provider?.getTransaction) {
        return NextResponse.json({
          diagnose: true,
          error: "Nenhum provedor de pagamento conectado (Configurações → Pagamentos).",
        });
      }
      const alvo = pending[0];
      if (!alvo) {
        return NextResponse.json({ diagnose: true, error: "Nenhuma venda pendente para testar." });
      }
      const r = await provider.getTransaction(alvo.providerRef!);
      return NextResponse.json({
        diagnose: true,
        providerRef: alvo.providerRef,
        ok: r.ok,
        // Em caso de sucesso mostra o que foi lido; em falha, o que cada
        // caminho respondeu — é isso que diz por que não funcionou.
        data: r.ok ? r.data : undefined,
        attempts: r.ok ? undefined : r.attempts,
      });
    }

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

    const pending = transactionsToReprocess("syncpay").slice(0, limit);
    let updated = 0;
    let notFound = 0;
    let failed = 0;
    // Guarda o diagnóstico da PRIMEIRA falha: sem isso o usuário só vê
    // "N sem dados" e não dá para saber o motivo.
    let firstAttempts: ProviderAttempt[] | null = null;
    let firstError: string | null = null;

    for (const t of pending) {
      try {
        const r = await provider.getTransaction(t.providerRef!);
        if (r.ok) {
          applyProviderAmounts(t.id, r.data);
          updated++;
        } else {
          notFound++;
          // O gateway respondeu (só não reconheceu a venda): marca como
          // tentada para não voltar à fila em todo lote.
          markReprocessed(t.id);
          if (!firstAttempts) firstAttempts = r.attempts;
        }
      } catch (e) {
        failed++;
        if (!firstError) firstError = e instanceof Error ? e.message : "falha na consulta";
      }
      await sleep(GAP_MS);
    }

    const remaining = transactionsToReprocess("syncpay").length;
    return NextResponse.json({
      ok: true,
      processed: pending.length,
      updated,
      notFound,
      failed,
      remaining,
      firstError,
      firstAttempts,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
