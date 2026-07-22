import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { ensureVideoThumbnail, ensureImageThumbnail, getMediaRow } from "@/lib/media";
import { serveMediaFile } from "@/lib/serveFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Miniatura da mídia: primeiro frame (vídeo) ou versão reduzida ~480px
 * (imagem). Gera sob demanda na primeira vez e depois serve o arquivo já
 * cacheado no disco — assim a galeria não baixa o arquivo em resolução cheia
 * (vários MB) só para mostrar um quadradinho. Se a geração falhar, cai para o
 * arquivo original (não quebra a galeria).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const row = getMediaRow(params.id);
    if (!row) {
      return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
    }

    const thumbPath =
      row.kind === "video"
        ? await ensureVideoThumbnail(row.path)
        : await ensureImageThumbnail(row.path);

    // Fallback: sem miniatura (ex.: formato não suportado) serve o original.
    const path = thumbPath || row.path;
    return serveMediaFile(req, {
      path,
      mime: thumbPath ? "image/jpeg" : row.mime || "application/octet-stream",
      filename: `${row.filename}.thumb.jpg`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
