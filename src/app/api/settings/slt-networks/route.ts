import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { createSltNetwork, listSltNetworks } from "@/lib/sltNetworksStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cadastro das redes/origens de tráfego do SLT — ver Configurações → Links da Bio. */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ networks: listSltNetworks() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const label = typeof body.label === "string" ? body.label : "";
    let network;
    try {
      network = createSltNetwork(label);
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao criar.");
    }
    return NextResponse.json({ network }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
