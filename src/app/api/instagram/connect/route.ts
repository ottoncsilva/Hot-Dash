import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { assinarState, authorizeUrl, redirectUri } from "@/lib/instagram/api";
import { getInstagramAppSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Monta o link que a modelo abre para conectar a conta.
 *
 * Só monta: quem abre é ela, no celular dela, logada no Instagram — por isso a
 * tela copia o link em vez de segui-lo. O `state` assinado (ver
 * `assinarState`) é o que amarra a conexão à modelo certa.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as { profileId?: string };
    const profileId = String(body.profileId || "");
    if (!profileId) throw new ApiError(400, "Informe a modelo.");

    const app = getInstagramAppSettings();
    if (!app.appId || !app.hasSecret) {
      throw new ApiError(400, "Cadastre o App ID e o App Secret da Meta antes de conectar uma conta.");
    }
    if (!app.publicBaseUrl) {
      throw new ApiError(
        400,
        "Cadastre o endereço público do painel — é ele que forma a URL de retorno que a Meta exige.",
      );
    }

    return NextResponse.json({ url: authorizeUrl(assinarState(profileId)), redirectUri: redirectUri() });
  } catch (err) {
    return errorResponse(err);
  }
}
