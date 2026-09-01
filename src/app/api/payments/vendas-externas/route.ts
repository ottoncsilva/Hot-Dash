import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getVendasExternasSettings, updateVendasExternasSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Interruptor do vínculo pelo Canal de Vendas — ver `externalSaleReport.ts` —
 * e a TABELA DE REPASSE do parceiro que opera bots por fora, que é o que
 * separa venda de funil de venda de LTV nessas cobranças (ver
 * `origemVenda.ts`). As duas coisas são o mesmo assunto: o que vem de fora.
 *
 * Fica numa rota própria (e não junto de `finance-settings`) porque não é
 * número financeiro: é comportamento do sistema, e salvar a meta do mês não
 * pode arrastar isto junto sem querer.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ vendasExternas: getVendasExternasSettings() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    // Cada campo só entra quando VEIO no corpo: a tela salva o interruptor e a
    // tabela em momentos diferentes, e um PATCH parcial não pode zerar o que
    // ele nem mencionou.
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
    const vendasExternas = updateVendasExternasSettings({
      vincularPeloGrupo:
        typeof body.vincularPeloGrupo === "boolean" ? body.vincularPeloGrupo : undefined,
      splitFixoCents: num(body.splitFixoCents),
      splitFunilPercent: num(body.splitFunilPercent),
      splitLtvPercent: num(body.splitLtvPercent),
    });
    return NextResponse.json({ vendasExternas });
  } catch (err) {
    return errorResponse(err);
  }
}
