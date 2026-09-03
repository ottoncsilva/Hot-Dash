import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { activeProvider } from "@/lib/payments";
import { lerSaldoSyncpay } from "@/lib/payments/saldoSyncpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saldo disponível no gateway.
 *
 * Rota própria (em vez de ir junto do painel) porque o saldo NÃO depende do
 * período selecionado: assim trocar entre Hoje/Ontem/7 dias não dispara uma
 * consulta nova à SyncPay a cada clique.
 *
 * A leitura em si — e os freios dela — moram em `lib/payments/saldoSyncpay.ts`,
 * porque quem pede o saldo deixou de ser só esta rota: uma venda aprovada
 * também manda buscar.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);

    // `diagnose=1`: mostra o que o gateway respondeu em cada caminho tentado.
    // Sem isso, saldo vazio é indistinguível de credencial sem permissão, rota
    // que não existe nessa conta ou resposta num formato inesperado.
    if (req.nextUrl.searchParams.get("diagnose") === "1") {
      const provider = activeProvider();
      if (!provider?.getBalance) {
        return NextResponse.json({ connected: false, balanceCents: null, at: null });
      }
      if (!provider.diagnoseBalance) {
        return NextResponse.json({ error: "Este provedor não expõe diagnóstico de saldo." });
      }
      const d = await provider.diagnoseBalance();
      return NextResponse.json({ connected: true, ...d });
    }

    return NextResponse.json(
      await lerSaldoSyncpay(req.nextUrl.searchParams.get("refresh") === "1"),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
