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
/** Piso entre duas consultas de verdade, mesmo com `refresh=1`. A rota de saldo
 *  da SyncPay é limitada (ela responde 429), e abrir/recarregar o Dashboard
 *  várias vezes seguidas derrubaria a consulta justamente por excesso. */
const MIN_MS = 15_000;
let cache: { at: number; cents: number | null } | null = null;

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = activeProvider();
    if (!provider?.getBalance) {
      return NextResponse.json({ connected: false, balanceCents: null, at: null });
    }

    // `diagnose=1`: mostra o que o gateway respondeu em cada caminho tentado.
    // Sem isso, saldo vazio é indistinguível de credencial sem permissão, rota
    // que não existe nessa conta ou resposta num formato inesperado.
    if (req.nextUrl.searchParams.get("diagnose") === "1") {
      if (!provider.diagnoseBalance) {
        return NextResponse.json({ error: "Este provedor não expõe diagnóstico de saldo." });
      }
      const d = await provider.diagnoseBalance();
      return NextResponse.json({ connected: true, ...d });
    }

    const force = req.nextUrl.searchParams.get("refresh") === "1";
    const idade = cache ? Date.now() - cache.at : Infinity;
    if (cache && (idade < MIN_MS || (!force && idade < TTL_MS))) {
      return NextResponse.json({ connected: true, balanceCents: cache.cents, at: cache.at, cached: true });
    }

    // Usa o caminho com diagnóstico quando existe: é a MESMA chamada HTTP, mas
    // volta com o motivo da falha — assim o card não fica só dizendo
    // "indisponível" sem explicar.
    let cents: number | null = null;
    let reason: string | undefined;
    if (provider.diagnoseBalance) {
      const d = await provider.diagnoseBalance().catch(() => null);
      cents = d?.cents ?? null;
      const ultima = d?.attempts?.[d.attempts.length - 1];
      if (cents === null) {
        reason = ultima?.error || (ultima?.httpStatus ? `gateway respondeu ${ultima.httpStatus}` : "sem resposta do gateway");
      }
    } else {
      const bal = await provider.getBalance().catch(() => null);
      cents = bal?.availableCents ?? null;
    }

    if (cents !== null) {
      cache = { at: Date.now(), cents };
      return NextResponse.json({ connected: true, balanceCents: cents, at: cache.at });
    }
    // Consulta falhou: devolve o último valor conhecido, se houver, junto do
    // motivo — quem não tem valor nenhum ainda pelo menos sabe o porquê.
    return NextResponse.json({
      connected: true,
      balanceCents: cache?.cents ?? null,
      at: cache?.at ?? null,
      stale: Boolean(cache),
      reason,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
