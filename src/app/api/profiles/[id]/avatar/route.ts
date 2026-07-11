import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getProfile, updateProfile } from "@/lib/profiles";
import { cleanMetadata, IMAGE_EXT } from "@/lib/metadata";
import {
  deleteFile,
  fileExists,
  readBuffer,
  saveFile,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
};

// Envia o avatar do perfil (foto limpa de metadados, guardada na VPS).
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const profile = await getProfile(params.id);
    if (!profile?.avatarPath || !(await fileExists(profile.avatarPath))) {
      return NextResponse.json(
        { error: "Sem avatar." },
        { status: 404 },
      );
    }
    const ext = extname(profile.avatarPath).toLowerCase();
    const buf = await readBuffer(profile.avatarPath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=60",
      },
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
        { error: "Envie a imagem como multipart/form-data." },
        { status: 400 },
      );
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Imagem inválida." }, { status: 400 });
    }
    const ext = extname(file.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      return NextResponse.json(
        { error: "O avatar precisa ser uma imagem." },
        { status: 415 },
      );
    }

    // Limpa metadados antes de guardar.
    const cleaned = await cleanMetadata(
      Buffer.from(await file.arrayBuffer()),
      ext,
    );
    const newPath = `profiles/${params.id}/avatar${ext}`;
    await saveFile(newPath, cleaned);

    // Remove o avatar anterior se tinha outra extensão.
    if (profile.avatarPath && profile.avatarPath !== newPath) {
      await deleteFile(profile.avatarPath).catch(() => {});
    }
    const updated = await updateProfile(params.id, { avatarPath: newPath });
    return NextResponse.json({ profile: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
