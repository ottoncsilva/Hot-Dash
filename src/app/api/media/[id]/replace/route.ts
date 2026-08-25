import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { errorResponse, recusaSePesado, requireUser } from "@/lib/apiAuth";
import { getUploadLimitMb } from "@/lib/settings";
import { cleanMetadata, cleanMetadataInPlace, mediaKind } from "@/lib/metadata";
import { ensureVideoThumbnail, ensureImageThumbnail, getMediaRow, newMediaPath, overwriteMediaFile } from "@/lib/media";
import { absolutePath, fileSize, saveFile, saveStream } from "@/lib/storage";
import { getImageDimensions } from "@/lib/imageDimensions";
import { getVideoInfo } from "@/lib/videoDimensions";
import { addTagsByNameToMedia, getTagsForMedia } from "@/lib/tags";

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
    // Mesmo teto do upload normal — esta rota não tinha nenhum, então um vídeo
    // editado gigante passava batido pelo cabeçalho antes de virar RAM.
    const maxMb = getUploadLimitMb();
    const maxBytes = maxMb * 1024 * 1024;
    recusaSePesado(req, maxBytes, maxMb);

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
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `Arquivo excede o limite de ${maxMb} MB.` },
        { status: 413 },
      );
    }
    const ext = extname(file.name).toLowerCase();
    const kind = mediaKind(ext);
    if (!kind) {
      return NextResponse.json(
        { error: `Formato não suportado: ${ext || "desconhecido"}.` },
        { status: 415 },
      );
    }

    const { relPath } = newMediaPath(row.profile_id, ext);
    let tamanho: number;
    let dimensions: { width?: number; height?: number } | null;

    if (kind === "video") {
      // Mesmo motivo do upload normal (ver `/api/profiles/[id]/media`): o
      // vídeo editado pode ser tão grande quanto o original, e o caminho
      // antigo (arrayBuffer → cleanMetadata → Buffer) mantinha o arquivo
      // inteiro em RAM duas vezes — derrubava o container.
      await saveStream(relPath, file.stream());
      await cleanMetadataInPlace(absolutePath(relPath), ext);
      tamanho = await fileSize(relPath);
      dimensions = await getVideoInfo(absolutePath(relPath));
      await ensureVideoThumbnail(relPath);
    } else {
      // Imagem é pequena o bastante pra caber em RAM sem risco — mantém o
      // caminho por buffer, que já devolve os bytes prontos pra medir.
      const cleaned = await cleanMetadata(Buffer.from(await file.arrayBuffer()), ext);
      await saveFile(relPath, cleaned);
      tamanho = cleaned.length;
      dimensions = getImageDimensions(cleaned, ext);
      await ensureImageThumbnail(relPath);
    }

    const item = await overwriteMediaFile({
      id: params.id,
      relPath,
      size: tamanho,
      width: dimensions?.width,
      height: dimensions?.height,
    });
    if (!item) {
      return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
    }

    // Etiquetas automáticas por nome (ex.: "Censurada"), enviadas pelo cliente.
    const tagsRaw = form.get("tags");
    const tagNames =
      typeof tagsRaw === "string" && tagsRaw
        ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
    if (tagNames.length > 0) {
      addTagsByNameToMedia(params.id, tagNames);
      item.tags = getTagsForMedia(params.id);
    }

    return NextResponse.json({ media: item });
  } catch (err) {
    return errorResponse(err);
  }
}
