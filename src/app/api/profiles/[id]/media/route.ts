import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getProfile } from "@/lib/profiles";
import { cleanMetadata, mediaKind } from "@/lib/metadata";
import { insertMedia, listMedia, newMediaPath } from "@/lib/media";
import { saveFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function maxUploadBytes(): number {
  const mb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "200");
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

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
    return NextResponse.json({ media: listMedia(params.id) });
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
    if (file.size > maxUploadBytes()) {
      return NextResponse.json(
        { error: `Arquivo excede o limite de ${maxUploadBytes() / 1024 / 1024} MB.` },
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

    const editedFromRaw = form.get("editedFrom");
    const editedFrom =
      typeof editedFromRaw === "string" && editedFromRaw ? editedFromRaw : undefined;

    const item = insertMedia({
      id,
      profileId: params.id,
      filename: file.name,
      relPath,
      kind,
      mime: file.type || undefined,
      size: cleaned.length,
      editedFrom,
    });
    return NextResponse.json({ media: item }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
