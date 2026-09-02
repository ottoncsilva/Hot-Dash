import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getVendasExternasSettings, updateVendasExternasSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Interruptor do vínculo pelo Canal de Vendas — ver `externalSaleReport.ts`.
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
    const vendasExternas = updateVendasExternasSettings({
      vincularPeloGrupo:
        typeof body.vincularPeloGrupo === "boolean" ? body.vincularPeloGrupo : undefined,
    });
    return NextResponse.json({ vendasExternas });
  } catch (err) {
    return errorResponse(err);
  }
}
