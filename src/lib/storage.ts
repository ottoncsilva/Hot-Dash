import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/**
 * Armazenamento de arquivos no disco da VPS.
 *
 * O diretório base vem de MEDIA_STORAGE_DIR (padrão: /app/data). No EasyPanel,
 * monte um VOLUME PERSISTENTE nesse caminho — senão a mídia se perde a cada
 * deploy. Os arquivos ficam organizados em subpastas por categoria.
 */
const BASE_DIR = resolve(process.env.MEDIA_STORAGE_DIR || "/app/data");

/** Garante que o caminho resolvido está dentro do diretório base (anti path traversal). */
function safeResolve(...parts: string[]): string {
  const full = resolve(BASE_DIR, ...parts);
  if (full !== BASE_DIR && !full.startsWith(BASE_DIR + sep)) {
    throw new Error("Caminho de arquivo inválido.");
  }
  return full;
}

export async function saveFile(
  relPath: string,
  data: Buffer,
): Promise<void> {
  const full = safeResolve(relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, data);
}

export function absolutePath(relPath: string): string {
  return safeResolve(relPath);
}

export async function fileExists(relPath: string): Promise<boolean> {
  try {
    await stat(safeResolve(relPath));
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(relPath: string): Promise<number> {
  const s = await stat(safeResolve(relPath));
  return s.size;
}

export function readStream(relPath: string): NodeJS.ReadableStream {
  return createReadStream(safeResolve(relPath));
}

export async function readBuffer(relPath: string): Promise<Buffer> {
  return readFile(safeResolve(relPath));
}

export async function deleteFile(relPath: string): Promise<void> {
  await rm(safeResolve(relPath), { force: true });
}

/** Remove uma pasta inteira (ex.: todos os arquivos de um perfil). */
export async function deleteDir(relPath: string): Promise<void> {
  await rm(safeResolve(relPath), { recursive: true, force: true });
}
