import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { activeProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhooks cadastrados na conta do gateway.
 *
 * Serve para ver QUAL evento está assinado: quem assina `all` recebe também os
 * saques na mesma URL — a origem do saque que entrou no Financeiro como venda.
 * Assinar `cashin` resolve na fonte.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = activeProvider();
    if (!provider?.listWebhooks) {
      return NextResponse.json({ error: "Conecte a SyncPay para listar os webhooks." });
    }
    try {
      return NextResponse.json({ webhooks: await provider.listWebhooks() });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao consultar." });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
