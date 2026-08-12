import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getMediaRow } from "@/lib/media";
import { serveMediaFile } from "@/lib/serveFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    // `mediaFileUrl` monta `?v=<updatedAt>`: a URL muda quando o arquivo muda,
    // então o cache pode ser longo. Vale principalmente para o visualizador e
    // para os vídeos, que são pesados e hoje voltavam do servidor a cada hora.
    return serveMediaFile(req, row, { immutable: true });
  } catch (err) {
    return errorResponse(err);
  }
}
