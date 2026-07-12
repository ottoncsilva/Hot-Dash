import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { cleanMetadata, mediaKind } from "@/lib/metadata";
import { getMediaRow, newMediaPath, overwriteMediaFile } from "@/lib/media";
import { saveFile } from "@/lib/storage";
import { getImageDimensions } from "@/lib/imageDimensions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sobrescreve o arquivo de uma mídia existente (botão "Salvar" do editor):
 * mantém id, etiquetas e link público, mas troca o conteúdo pela versão
 * editada. Os metadados são limpos antes de gravar, como em todo upload.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const row = getMediaRow(params.id);
    if (!row) {
      return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Envie o arquivo como multipart/form-data." },
        { status: 400 },
      );
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
    }
    const ext = extname(file.name).toLowerCase();
    const kind = mediaKind(ext);
    if (!kind) {
      return NextResponse.json(
        { error: `Formato não suportado: ${ext || "desconhecido"}.` },
        { status: 415 },
      );
    }

    const cleaned = await cleanMetadata(Buffer.from(await file.arrayBuffer()), ext);
    const { relPath } = newMediaPath(row.profile_id, ext);
    await saveFile(relPath, cleaned);

    const dimensions = kind === "image" ? getImageDimensions(cleaned, ext) : null;
    const item = await overwriteMediaFile({
      id: params.id,
      relPath,
      size: cleaned.length,
      width: dimensions?.width,
      height: dimensions?.height,
    });
    if (!item) {
      return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ media: item });
  } catch (err) {
    return errorResponse(err);
  }
}
