import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
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

/**
 * Grava um arquivo que chega em FLUXO, sem passar pela memória.
 *
 * É o caminho dos uploads grandes. `saveFile` recebe um Buffer, o que obriga o
 * arquivo inteiro a existir na RAM — com meio giga de vídeo isso somava várias
 * cópias e derrubava o container antes de o upload terminar. Aqui os bytes vão
 * do corpo da requisição direto para o disco.
 */
export async function saveStream(
  relPath: string,
  data: ReadableStream<Uint8Array>,
): Promise<number> {
  const full = safeResolve(relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await pipeline(Readable.fromWeb(data as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(full));
  const s = await stat(full);
  return s.size;
}

/** Move um arquivo que já está no disco para dentro do armazenamento. */
export async function moveIntoStorage(origemAbs: string, relPath: string): Promise<number> {
  const full = safeResolve(relPath);
  await mkdir(join(full, ".."), { recursive: true });
  try {
    await rename(origemAbs, full);
  } catch {
    // `rename` falha entre sistemas de arquivos diferentes (/tmp e o volume):
    // aí é copiar em fluxo e apagar a origem.
    await pipeline(createReadStream(origemAbs), createWriteStream(full));
    await rm(origemAbs, { force: true });
  }
  const s = await stat(full);
  return s.size;
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

/** Tamanho + data de modificação numa consulta só — é o par que forma o ETag
 *  do arquivo servido (ver serveFile), evitando um segundo `stat`. */
export async function fileStat(relPath: string): Promise<{ size: number; mtimeMs: number }> {
  const s = await stat(safeResolve(relPath));
  return { size: s.size, mtimeMs: s.mtimeMs };
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
