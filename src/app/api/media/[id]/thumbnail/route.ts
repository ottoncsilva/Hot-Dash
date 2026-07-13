import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { ensureVideoThumbnail, getMediaRow } from "@/lib/media";
import { serveMediaFile } from "@/lib/serveFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Miniatura (primeiro frame) de um vídeo. Gera sob demanda na primeira vez
 * (cobre vídeos enviados antes desse recurso existir) e depois só serve o
 * arquivo já salvo. Sem miniatura para imagens (a própria imagem já serve).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const row = getMediaRow(params.id);
    if (!row || row.kind !== "video") {
      return NextResponse.json({ error: "Miniatura não encontrada." }, { status: 404 });
    }
    const thumbPath = await ensureVideoThumbnail(row.path);
    if (!thumbPath) {
      return NextResponse.json({ error: "Não foi possível gerar a miniatura." }, { status: 404 });
    }
    return serveMediaFile(req, {
      path: thumbPath,
      mime: "image/jpeg",
      filename: `${row.filename}.thumb.jpg`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
