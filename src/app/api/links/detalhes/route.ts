import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser, ApiError } from "@/lib/apiAuth";
import { sltPaisesDoAlvo, type AlvoDoDetalhe } from "@/lib/salesFunnel";
import { getAppTimeZone } from "@/lib/settings";
import { resolvePeriod } from "@/lib/periodRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DE ONDE vieram os cliques de UMA página ou de UM PopLink.
 *
 * Rota separada de `/api/links` de propósito: país é detalhe de uma linha só,
 * pedido quando alguém abre o "Detalhes". Embutir a quebra por país de todas
 * as páginas e PopLinks na carga principal multiplicaria o corpo da resposta
 * por quantos países existirem, em toda visita, para uma informação que quase
 * sempre ninguém abre.
 *
 * Não custa nada à SLT: o país já vem gravado em cada evento (`slt_events`) e
 * a leitura é local. O período é o MESMO seletor do resto do painel.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const q = req.nextUrl.searchParams;

    const tipo = q.get("tipo");
    const id = (q.get("id") || "").trim();
    const slug = (q.get("slug") || "").trim();
    if (tipo !== "page" && tipo !== "poplink") throw new ApiError(400, "tipo inválido.");
    if (!id && !slug) throw new ApiError(400, "Informe id ou slug.");

    const { range } = resolvePeriod(q.get("period"), q.get("from"), q.get("to"), getAppTimeZone());
    // Sem um dos dois, a comparação com o outro nunca casa — passar o mesmo
    // valor nos dois não é gambiarra: é dizer "só conheço esta chave".
    const alvo = { tipo, id: id || slug, slug: slug || id } as AlvoDoDetalhe;
    const paises = sltPaisesDoAlvo(alvo, range.since, range.until);

    return NextResponse.json({
      paises,
      views: paises.reduce((s, p) => s + p.views, 0),
      clicks: paises.reduce((s, p) => s + p.clicks, 0),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
