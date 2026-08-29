import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { codigosDeRastreio } from "@/lib/rastreio";
import { getAppTimeZone } from "@/lib/settings";
import { resolvePeriod } from "@/lib/periodRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rastreio → Códigos de rastreio: todo código de deep-link
 * (`t.me/<bot>?start=CODIGO`) do período, agrupado por modelo — mesma estrutura
 * da tela de Links, só que a unidade é o código em vez da página do SLT.
 *
 * Mesmo seletor de período do resto do painel (`resolvePeriod`): comparar um
 * código aqui com o Financeiro ou com o Funil de Vendas só faz sentido se as
 * três telas contarem a mesma janela.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const tz = getAppTimeZone();
    const { period, range } = resolvePeriod(
      req.nextUrl.searchParams.get("period"),
      req.nextUrl.searchParams.get("from"),
      req.nextUrl.searchParams.get("to"),
      tz,
    );

    const linhas = codigosDeRastreio(range.since, range.until);

    // Agrupamento por modelo montado no servidor, como em /api/links — a tela
    // só desenha. "Sem modelo" fica separado e vai por último: é a fila de
    // trabalho (venda que ainda não foi atribuída), não um grupo normal.
    const porModelo = new Map<string, { profileId: string | null; profileName: string; codes: typeof linhas }>();
    for (const l of linhas) {
      const chave = l.profileId || "";
      let g = porModelo.get(chave);
      if (!g) {
        g = { profileId: l.profileId, profileName: l.profileName, codes: [] };
        porModelo.set(chave, g);
      }
      g.codes.push(l);
    }
    const grupos = [...porModelo.values()].sort((a, b) => {
      if (!a.profileId) return 1;
      if (!b.profileId) return -1;
      return a.profileName.localeCompare(b.profileName, "pt-BR");
    });

    return NextResponse.json({ period, groups: grupos });
  } catch (err) {
    return errorResponse(err);
  }
}
