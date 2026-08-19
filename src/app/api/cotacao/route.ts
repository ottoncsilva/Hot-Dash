import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getCotacaoUsdBrl } from "@/lib/cotacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cotação do dólar para as telas converterem o custo das gerações em real. */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const cotacao = await getCotacaoUsdBrl();
    return NextResponse.json({ cotacao });
  } catch (err) {
    return errorResponse(err);
  }
}
