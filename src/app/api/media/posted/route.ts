import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { listMedia } from "@/lib/media";
import {
  ehGrupoDoTelegram,
  logManualMediaPost,
  unlogManualMediaPost,
  type MediaDestino,
} from "@/lib/mediaUsage";
import { getProfile } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "JÁ POSTEI ISTO" — a marcação manual do histórico de publicação, feita na
 * Galeria (numa mídia aberta ou numa seleção inteira).
 *
 * Ela existe para o acervo anterior ao painel: centenas de fotos que já foram
 * ao ar e que, para o sistema, eram inéditas — o que fazia o Método MK
 * oferecer primeiro justamente o que o público já tinha visto.
 *
 * Vai por DESTINO, e não num "já postada" solto, porque é assim que o resto
 * do sistema pergunta: o "nunca postada" do Cronograma olha a CONTA, e a fila
 * do Método MK olha o GRUPO. Uma foto pode ter saído no Instagram e nunca no
 * VIP, e um sinal único apagaria essa diferença.
 *
 * Devolve a lista de mídias já atualizada para a Galeria não precisar de uma
 * segunda ida ao servidor logo depois de marcar.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const profileId = String(body.profileId || "");
    const destino = String(body.destino || "") as MediaDestino;
    const accountId = body.accountId ? String(body.accountId) : undefined;
    const remover = body.action === "remove";
    const ids: unknown = body.ids;

    if (!profileId) throw new ApiError(400, "Informe a modelo.");
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ApiError(400, "Informe as mídias.");
    }
    const mediaIds = ids.filter((id): id is string => typeof id === "string");
    if (mediaIds.length === 0) throw new ApiError(400, "Informe as mídias.");

    const perfil = await getProfile(profileId);
    if (!perfil) throw new ApiError(404, "Modelo não encontrada.");

    // O destino é conferido contra o que ESTA modelo tem: um grupo do Telegram
    // ou uma conta dela. Sem isso, um id de conta de outra modelo entraria no
    // histórico desta e apareceria como publicação que nunca houve.
    if (!ehGrupoDoTelegram(destino)) {
      const conta = perfil.accounts.find((a) => a.id === accountId);
      if (!conta) throw new ApiError(400, "Conta não encontrada nesta modelo.");
      if (conta.network !== destino) {
        throw new ApiError(400, "A rede não corresponde à conta.");
      }
    } else if (accountId) {
      throw new ApiError(400, "Grupo do Telegram não tem conta.");
    }

    if (remover) unlogManualMediaPost(mediaIds, profileId, destino, accountId);
    else logManualMediaPost(mediaIds, profileId, destino, accountId);

    return NextResponse.json({ ok: true, media: listMedia(profileId) });
  } catch (err) {
    return errorResponse(err);
  }
}
