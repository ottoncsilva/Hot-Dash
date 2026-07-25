import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { activeProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saldo disponível no gateway.
 *
 * Rota própria (em vez de ir junto do painel) porque o saldo NÃO depende do
 * período selecionado: assim trocar entre Hoje/Ontem/7 dias não dispara uma
 * consulta nova à SyncPay a cada clique. Guardamos o último valor por 60s pelo
 * mesmo motivo — e devolvemos o valor em cache se a consulta falhar, para o
 * card não piscar "indisponível" por causa de uma oscilação da API.
 */
const TTL_MS = 60_000;
let cache: { at: number; cents: number | null } | null = null;

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = activeProvider();
    if (!provider?.getBalance) {
      return NextResponse.json({ connected: false, balanceCents: null, at: null });
    }

    const force = req.nextUrl.searchParams.get("refresh") === "1";
    if (!force && cache && Date.now() - cache.at < TTL_MS) {
      return NextResponse.json({ connected: true, balanceCents: cache.cents, at: cache.at, cached: true });
    }

    const bal = await provider.getBalance().catch(() => null);
    if (bal) {
      cache = { at: Date.now(), cents: bal.availableCents };
      return NextResponse.json({ connected: true, balanceCents: bal.availableCents, at: cache.at });
    }
    // Consulta falhou: devolve o último valor conhecido, se houver.
    return NextResponse.json({
      connected: true,
      balanceCents: cache?.cents ?? null,
      at: cache?.at ?? null,
      stale: Boolean(cache),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
