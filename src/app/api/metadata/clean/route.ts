import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

// Processamento de arquivos exige o runtime Node (spawn de exiftool/ffmpeg).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Uploads podem ser grandes (vídeos): sem cache e sem limite artificial do body.
export const maxDuration = 300;

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".tiff",
  ".tif",
  ".gif",
]);
const VIDEO_EXT = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".m4v",
  ".mpg",
  ".mpeg",
]);

function maxUploadBytes(): number {
  const mb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "200");
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

/** Executa um comando e resolve/rejeita conforme o código de saída. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      reject(
        new Error(
          enoent
            ? `Ferramenta "${cmd}" não encontrada no servidor. Verifique se ${cmd} está instalado (já vem na imagem Docker).`
            : `Falha ao executar ${cmd}: ${err.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} saiu com código ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function POST(req: NextRequest) {
  let workDir: string | null = null;

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
        {
          error: `Arquivo excede o limite de ${
            maxUploadBytes() / 1024 / 1024
          } MB.`,
        },
        { status: 413 },
      );
    }

    const ext = extname(file.name).toLowerCase();
    const isImage = IMAGE_EXT.has(ext);
    const isVideo = VIDEO_EXT.has(ext);
    if (!isImage && !isVideo) {
      return NextResponse.json(
        { error: `Formato não suportado: ${ext || "desconhecido"}.` },
        { status: 415 },
      );
    }

    workDir = await mkdtemp(join(tmpdir(), "hotdash-meta-"));
    const inputPath = join(workDir, `in${ext}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, bytes);

    let outputPath: string;

    if (isImage) {
      // exiftool remove TODAS as tags sem recodificar a imagem (sem perda).
      outputPath = inputPath;
      await run("exiftool", [
        "-all=",
        "-overwrite_original",
        "-P",
        inputPath,
      ]);
    } else {
      // ffmpeg copia os streams sem metadados (rápido, sem recodificar).
      outputPath = join(workDir, `out${ext}`);
      const args = [
        "-y",
        "-i",
        inputPath,
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-map",
        "0",
        "-c",
        "copy",
      ];
      if (ext === ".mp4" || ext === ".mov" || ext === ".m4v") {
        args.push("-movflags", "+faststart");
      }
      args.push(outputPath);
      await run("ffmpeg", args);
    }

    const cleaned = await readFile(outputPath);
    const baseName = file.name.replace(/\.[^./\\]+$/, "");
    const downloadName = `${baseName}-limpo${ext}`;

    return new NextResponse(cleaned, {
      status: 200,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          downloadName,
        )}`,
        "Content-Length": String(cleaned.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro desconhecido no processamento.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
