import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

export const IMAGE_EXT = new Set([
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
export const VIDEO_EXT = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".m4v",
  ".mpg",
  ".mpeg",
]);

export type MediaKind = "image" | "video";

export function mediaKind(ext: string): MediaKind | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  return null;
}

/** Executa um comando e resolve/rejeita conforme o código de saída. */
export function run(cmd: string, args: string[], timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      reject(new Error(`Execução de ${cmd} excedeu o limite de tempo de ${timeoutMs / 1000}s.`));
    }, timeoutMs);

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (killed) return;
      const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      reject(
        new Error(
          enoent
            ? `Ferramenta "${cmd}" não encontrada no servidor (já vem na imagem Docker).`
            : `Falha ao executar ${cmd}: ${err.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve();
      else
        reject(
          new Error(`${cmd} saiu com código ${code}: ${stderr.slice(-500)}`),
        );
    });
  });
}

/**
 * Remove TODOS os metadados de uma imagem (exiftool, sem perda) ou vídeo
 * (ffmpeg, sem recodificar). Trabalha sobre um buffer e devolve o buffer limpo.
 */
export async function cleanMetadata(
  input: Buffer,
  ext: string,
): Promise<Buffer> {
  const kind = mediaKind(ext);
  if (!kind) throw new Error(`Formato não suportado: ${ext || "desconhecido"}.`);

  const workDir = await mkdtemp(join(tmpdir(), "hotdash-meta-"));
  try {
    const inputPath = join(workDir, `in${ext}`);
    await writeFile(inputPath, input);

    if (kind === "image") {
      await run("exiftool", ["-all=", "-overwrite_original", "-P", inputPath]);
      return await readFile(inputPath);
    }

    const outputPath = join(workDir, `out${ext}`);
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
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extrai o primeiro frame de um vídeo como JPEG.
 * Redimensiona para no máximo `maxWidth` px de largura (padrão 480, a capa da
 * galeria), preservando a proporção. A ANÁLISE por IA (visão) pede um valor
 * maior para o modelo enxergar os detalhes do frame.
 */
export async function extractVideoThumbnail(
  input: Buffer,
  ext: string,
  maxWidth = 480,
): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "hotdash-thumb-"));
  try {
    const inputPath = join(workDir, `in${ext}`);
    await writeFile(inputPath, input);
    const outputPath = join(workDir, "thumb.jpg");
    await run("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${maxWidth},iw)':-2`,
      "-q:v",
      maxWidth > 480 ? "2" : "3",
      outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export { extname };
