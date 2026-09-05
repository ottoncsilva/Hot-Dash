import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteTarget, getTarget, resetTarget, updateTarget } from "@/lib/deliveryTargets";
import { enviarTesteParaAparelho } from "@/lib/postDelivery";
import { getProfile } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** O aparelho existe E é desta modelo? Sem esta checagem, um id de outra
 *  modelo editaria/apagaria o aparelho dela pela URL. */
function doPerfil(profileId: string, targetId: string) {
  const alvo = getTarget(targetId);
  if (!alvo || alvo.profileId !== profileId) {
    throw new ApiError(404, "Aparelho não encontrado.");
  }
  return alvo;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; targetId: string } },
) {
  try {
    await requireUser(req);
    doPerfil(params.id, params.targetId);
    const body = await req.json().catch(() => ({}));

    // "Testar envio" e "Gerar novo código" entram por aqui como ações, e não
    // como rotas próprias: são operações sobre ESTE aparelho e nada mais.
    if (body.action === "test") {
      const alvo = getTarget(params.targetId)!;
      if (!alvo.chatId) {
        throw new ApiError(400, "Este aparelho ainda não foi vinculado no Telegram.");
      }
      const perfil = await getProfile(params.id);
      try {
        await enviarTesteParaAparelho(alvo.chatId, perfil?.name || "esta modelo");
      } catch (e) {
        throw new ApiError(400, e instanceof Error ? e.message : "Falha ao enviar o teste.");
      }
      return NextResponse.json({ target: alvo });
    }

    if (body.action === "reset") {
      return NextResponse.json({ target: resetTarget(params.targetId) });
    }

    try {
      const target = updateTarget(params.targetId, {
        label: typeof body.label === "string" ? body.label : undefined,
        active: typeof body.active === "boolean" ? body.active : undefined,
      });
      return NextResponse.json({ target });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao salvar.");
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; targetId: string } },
) {
  try {
    await requireUser(req);
    doPerfil(params.id, params.targetId);
    return NextResponse.json({ ok: deleteTarget(params.targetId) });
  } catch (err) {
    return errorResponse(err);
  }
}
