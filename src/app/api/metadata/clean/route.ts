import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { cleanMetadata, mediaKind } from "@/lib/metadata";

// Processamento de arquivos exige o runtime Node (spawn de exiftool/ffmpeg).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function maxUploadBytes(): number {
  const mb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "200");
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Envie o arquivo como multipart/form-data." },
      { status: 400 },
    );
  }

  try {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado." },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
    }
    if (file.size > maxUploadBytes()) {
      return NextResponse.json(
        { error: `Arquivo excede o limite de ${maxUploadBytes() / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }

    const ext = extname(file.name).toLowerCase();
    if (!mediaKind(ext)) {
      return NextResponse.json(
        { error: `Formato não suportado: ${ext || "desconhecido"}.` },
        { status: 415 },
      );
    }

    const cleaned = await cleanMetadata(
      Buffer.from(await file.arrayBuffer()),
      ext,
    );
    const baseName = file.name.replace(/\.[^./\\]+$/, "");
    const downloadName = `${baseName}-limpo${ext}`;

    return new NextResponse(new Uint8Array(cleaned), {
      status: 200,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Content-Length": String(cleaned.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro desconhecido no processamento.";
    const status = message.includes("não suportado") ? 415 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
