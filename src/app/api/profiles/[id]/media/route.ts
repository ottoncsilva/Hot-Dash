import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/uploadLimit";
import { getProfile } from "@/lib/profiles";
import { cleanMetadata, mediaKind } from "@/lib/metadata";
import {
  ensureVideoThumbnail,
  ensureImageThumbnail,
  getOrCreatePublicToken,
  insertMedia,
  listMedia,
  listUsedMediaIds,
  newMediaPath,
} from "@/lib/media";
import { absolutePath, saveFile } from "@/lib/storage";
import { getImageDimensions } from "@/lib/imageDimensions";
import { getVideoInfo } from "@/lib/videoDimensions";
import { addTagsByNameToMedia, copyMediaTags, getTagsForMedia } from "@/lib/tags";
import { nomeDeMidia } from "@/lib/mediaNome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const profile = await getProfile(params.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Perfil não encontrado." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      media: listMedia(params.id),
      usedMediaIds: Array.from(listUsedMediaIds(params.id)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const profile = await getProfile(params.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Perfil não encontrado." },
        { status: 404 },
      );
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
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Arquivo excede o limite de ${MAX_UPLOAD_MB} MB.` },
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

    // Limpa os metadados antes de guardar (privacidade).
    const cleaned = await cleanMetadata(
      Buffer.from(await file.arrayBuffer()),
      ext,
    );
    const { id, relPath } = newMediaPath(params.id, ext);
    await saveFile(relPath, cleaned);

    // Miniatura já gerada no upload para aparecer instantânea na galeria
    // (vídeo: 1º frame; imagem: versão reduzida ~480px). Nunca lança — se
    // falhar, a rota de miniatura tenta de novo sob demanda.
    if (kind === "video") {
      await ensureVideoThumbnail(relPath);
    } else {
      await ensureImageThumbnail(relPath);
    }

    const editedFromRaw = form.get("editedFrom");
    const editedFrom =
      typeof editedFromRaw === "string" && editedFromRaw ? editedFromRaw : undefined;

    const fileCreatedAtRaw = form.get("fileCreatedAt");
    const fileCreatedAt =
      typeof fileCreatedAtRaw === "string" && fileCreatedAtRaw ? parseInt(fileCreatedAtRaw, 10) : undefined;

    // Resolução: imagem sai dos próprios bytes; vídeo vem do ffprobe, já com a
    // rotação aplicada. Antes o vídeo era gravado sem resolução nenhuma.
    const dimensions =
      kind === "image"
        ? getImageDimensions(cleaned, ext)
        : await getVideoInfo(absolutePath(relPath));

    // Mídia OCULTA: insumo de recurso (ex.: o vídeo de referência do Motion
    // Control, que a Magnific busca por link público) — fica gravada com todo
    // o encanamento normal, mas fora da Galeria da modelo.
    const hidden = form.get("hidden") === "1";

    // O nome do aparelho não entra na Galeria — vira
    // `modelo-AAAAMMDD-HHMMSS-0001.ext` (ver `mediaNome.ts`). Pelo mesmo
    // motivo de os metadados serem limpos acima: o nome original não diz nada
    // e ainda pode entregar de onde o arquivo veio.
    const item = insertMedia({
      id,
      profileId: params.id,
      hidden,
      filename: nomeDeMidia({ profileId: params.id, nomeModelo: profile.name, ext }),
      relPath,
      kind,
      mime: file.type || undefined,
      size: cleaned.length,
      editedFrom,
      width: dimensions?.width,
      height: dimensions?.height,
      fileCreatedAt: !isNaN(fileCreatedAt as number) ? fileCreatedAt : undefined,
    });

    // Foto editada herda as etiquetas da original.
    if (editedFrom) {
      copyMediaTags(editedFrom, item.id);
    }

    // Etiquetas automáticas por nome (ex.: "Censurada"), enviadas pelo cliente.
    const tagsRaw = form.get("tags");
    const tagNames =
      typeof tagsRaw === "string" && tagsRaw
        ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
    if (tagNames.length > 0) {
      addTagsByNameToMedia(item.id, tagNames);
    }

    if (editedFrom || tagNames.length > 0) {
      item.tags = getTagsForMedia(item.id);
    }

    getOrCreatePublicToken(item.id);

    return NextResponse.json({ media: item }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
