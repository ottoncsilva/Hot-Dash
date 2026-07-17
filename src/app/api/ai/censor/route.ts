import { NextRequest, NextResponse } from "next/server";
import { extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import { detectExplicitRegions } from "@/lib/nudenet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Detecção de partes explícitas por IA (NudeNet).
 *
 * Aceita a imagem de duas formas:
 *  - JSON `{ mediaId, minScore? }` — usa um arquivo já na galeria (editor de foto).
 *  - multipart `file` (+ campo `minScore`) — imagem avulsa (página de censura em lote).
 *
 * Responde com regiões em coordenadas RELATIVAS (0..1):
 *   { regions: [{ part, score, x, y, w, h }], imageWidth, imageHeight }
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);

    const contentType = req.headers.get("content-type") || "";
    let buf: Buffer;
    let filename = "image.jpg";
    let minScore = 0.3;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
      }
      buf = Buffer.from(await file.arrayBuffer());
      filename = file.name || filename;
      const s = Number(form.get("minScore"));
      if (Number.isFinite(s)) minScore = s;
    } else {
      const body = await req.json().catch(() => ({}));
      const mediaId = body?.mediaId;
      if (!mediaId) {
        return NextResponse.json({ error: "Faltando mediaId." }, { status: 400 });
      }
      if (Number.isFinite(Number(body?.minScore))) minScore = Number(body.minScore);

      const db = getDb();
      const media = db
        .prepare("SELECT path FROM media WHERE id = ?")
        .get(mediaId) as { path: string } | undefined;
      if (!media) {
        return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
      }
      const fullPath = join(process.env.MEDIA_STORAGE_DIR || "./data", media.path);
      try {
        buf = await readFile(fullPath);
      } catch {
        return NextResponse.json({ error: "Arquivo físico não encontrado." }, { status: 404 });
      }
      filename = media.path.split("/").pop() || filename;
    }

    const ext = extname(filename).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(ext)) {
      // NudeNet/OpenCV só decodifica imagens; vídeos e afins não passam por aqui.
      return NextResponse.json(
        { error: "A censura por IA só funciona em imagens." },
        { status: 415 },
      );
    }

    const result = await detectExplicitRegions(buf, filename, { minScore });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
