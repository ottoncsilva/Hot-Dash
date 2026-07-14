import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getMediaRow } from "@/lib/media";
import { readBuffer } from "@/lib/storage";
import { renderVideoEdit, type BlurRect } from "@/lib/videoEdit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Processa a edição de um vídeo (corte + borrão de região + sobreposições de
 * texto/emoji/pergunta) via ffmpeg e devolve o arquivo mp4 resultante — não
 * grava nada no banco. O cliente salva o resultado através das mesmas rotas
 * usadas pelo editor de fotos ("nova versão" ou "sobrescrever").
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const row = getMediaRow(params.id);
    if (!row || row.kind !== "video") {
      return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Envie os dados como multipart/form-data." },
        { status: 400 },
      );
    }

    const trimStartRaw = form.get("trimStart");
    const trimEndRaw = form.get("trimEnd");
    const trimStart =
      typeof trimStartRaw === "string" && trimStartRaw ? Number(trimStartRaw) : undefined;
    const trimEnd = typeof trimEndRaw === "string" && trimEndRaw ? Number(trimEndRaw) : undefined;
    if (trimStart != null && !Number.isFinite(trimStart)) {
      return NextResponse.json({ error: "Início de corte inválido." }, { status: 400 });
    }
    if (trimEnd != null && !Number.isFinite(trimEnd)) {
      return NextResponse.json({ error: "Fim de corte inválido." }, { status: 400 });
    }
    if (trimStart != null && trimEnd != null && trimEnd <= trimStart) {
      return NextResponse.json(
        { error: "O fim do corte deve ser depois do início." },
        { status: 400 },
      );
    }

    const overlayFile = form.get("overlay");
    const overlayPng =
      overlayFile instanceof File && overlayFile.size > 0
        ? Buffer.from(await overlayFile.arrayBuffer())
        : undefined;

    const blurRectsRaw = form.get("blurRects");
    let blurRects: BlurRect[] | undefined;
    if (typeof blurRectsRaw === "string" && blurRectsRaw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(blurRectsRaw);
      } catch {
        return NextResponse.json({ error: "Áreas de borrão inválidas." }, { status: 400 });
      }
      const isValid =
        Array.isArray(parsed) &&
        parsed.every(
          (r) =>
            r &&
            typeof r.x === "number" &&
            typeof r.y === "number" &&
            typeof r.w === "number" &&
            typeof r.h === "number",
        );
      if (!isValid) {
        return NextResponse.json({ error: "Áreas de borrão inválidas." }, { status: 400 });
      }
      blurRects = parsed as BlurRect[];
    }

    const ext = extname(row.path) || ".mp4";
    const input = await readBuffer(row.path);
    const output = await renderVideoEdit(input, ext, {
      trimStart,
      trimEnd,
      overlayPng,
      blurRects,
    });

    return new NextResponse(new Uint8Array(output), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `inline; filename="edited.mp4"`,
        "Content-Length": String(output.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
