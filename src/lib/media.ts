import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { extname } from "node:path";
import { getDb } from "./db";
import { deleteFile, fileExists, readBuffer, saveFile } from "./storage";
import { extractVideoThumbnail } from "./metadata";
import { getTagsForMedia } from "./tags";
import type { MediaItem, Tag } from "./types";

type MediaRow = {
  id: string;
  profile_id: string;
  filename: string;
  path: string;
  kind: string;
  mime: string | null;
  size: number;
  created_at: number;
  updated_at: number | null;
  edited_from: string | null;
  width: number | null;
  height: number | null;
  public_token: string | null;
  file_created_at: number | null;
};

function toClient(r: MediaRow, tags: Tag[]): MediaItem {
  return {
    id: r.id,
    profileId: r.profile_id,
    filename: r.filename,
    kind: r.kind === "video" ? "video" : "image",
    mime: r.mime || undefined,
    size: r.size,
    createdAt: r.created_at,
    updatedAt: r.updated_at || r.created_at,
    tags,
    editedFrom: r.edited_from || undefined,
    width: r.width || undefined,
    height: r.height || undefined,
    publicToken: r.public_token || undefined,
    fileCreatedAt: r.file_created_at || undefined,
  };
}

export function newMediaPath(profileId: string, ext: string): {
  id: string;
  relPath: string;
} {
  const id = randomUUID();
  return { id, relPath: `profiles/${profileId}/media/${id}${ext.toLowerCase()}` };
}

/** Caminho determinístico da miniatura de um vídeo (primeiro frame, JPEG). */
export function videoThumbRelPath(relPath: string): string {
  return relPath.replace(/\.[^./\\]+$/, ".thumb.jpg");
}

/**
 * Garante que a miniatura (primeiro frame) do vídeo existe no disco,
 * gerando-a sob demanda se necessário — cobre tanto uploads novos (chamado
 * logo após salvar) quanto vídeos enviados antes desse recurso existir
 * (chamado sob demanda na primeira vez que a miniatura é pedida).
 * Nunca lança: falha na geração apenas retorna null (galeria cai no ícone).
 */
export async function ensureVideoThumbnail(relPath: string): Promise<string | null> {
  const thumbPath = videoThumbRelPath(relPath);
  if (await fileExists(thumbPath)) return thumbPath;
  try {
    const buf = await readBuffer(relPath);
    const thumb = await extractVideoThumbnail(buf, extname(relPath));
    await saveFile(thumbPath, thumb);
    return thumbPath;
  } catch {
    return null;
  }
}

/** Caminho determinístico da miniatura de uma IMAGEM (JPEG pequeno, cacheado). */
export function imageThumbRelPath(relPath: string): string {
  return relPath.replace(/\.[^./\\]+$/, ".thumb.jpg");
}

/**
 * Garante que existe uma miniatura pequena (máx. 480px, JPEG) da imagem no
 * disco, gerando-a sob demanda na primeira vez com o sharp. Serve para a
 * galeria não baixar o arquivo em resolução cheia (vários MB) só para mostrar
 * um quadradinho — a causa das miniaturas demorarem a carregar no mobile.
 * Nunca lança: em falha, retorna null (a galeria cai no arquivo original).
 */
export async function ensureImageThumbnail(relPath: string): Promise<string | null> {
  const thumbPath = imageThumbRelPath(relPath);
  if (thumbPath === relPath) return null; // sem extensão reconhecida
  if (await fileExists(thumbPath)) return thumbPath;
  try {
    const sharp = (await import("sharp")).default;
    const buf = await readBuffer(relPath);
    const thumb = await sharp(buf)
      .rotate() // respeita orientação EXIF
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70, mozjpeg: true })
      .toBuffer();
    await saveFile(thumbPath, thumb);
    return thumbPath;
  } catch {
    return null;
  }
}

/**
 * Renderiza (em memória, sem cachear) uma versão MAIOR e mais nítida da imagem,
 * exclusiva para ANÁLISE por IA (visão). A miniatura da galeria (480px, q70) é
 * pequena demais e perde detalhes que a legenda precisa "enxergar" — roupa,
 * pose, expressão, cenário. Aqui usamos até 1024px com qualidade melhor, o que
 * ainda é leve o suficiente para enviar embutido (base64) e deixa o modelo
 * reconhecer a foto de verdade em vez de chutar. Nunca lança: em falha retorna
 * null (o caller cai na miniatura comum ou gera sem imagem).
 */
export async function renderVisionImageBase64(relPath: string): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const buf = await readBuffer(relPath);
    const out = await sharp(buf)
      .rotate() // respeita orientação EXIF
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return out.toString("base64");
  } catch {
    return null;
  }
}

export function insertMedia(input: {
  id: string;
  profileId: string;
  filename: string;
  relPath: string;
  kind: "image" | "video";
  mime?: string;
  size: number;
  editedFrom?: string;
  width?: number;
  height?: number;
  fileCreatedAt?: number;
}): MediaItem {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO media (id, profile_id, filename, path, kind, mime, size, created_at, updated_at, edited_from, width, height, file_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.profileId,
      input.filename,
      input.relPath,
      input.kind,
      input.mime || null,
      input.size,
      now,
      now,
      input.editedFrom || null,
      input.width || null,
      input.height || null,
      input.fileCreatedAt || null,
    );
  return toClient(
    {
      id: input.id,
      profile_id: input.profileId,
      filename: input.filename,
      path: input.relPath,
      kind: input.kind,
      mime: input.mime || null,
      size: input.size,
      created_at: now,
      updated_at: now,
      edited_from: input.editedFrom || null,
      width: input.width || null,
      height: input.height || null,
      public_token: null,
      file_created_at: input.fileCreatedAt || null,
    },
    [],
  );
}

/**
 * Sobrescreve o conteúdo de uma mídia existente (mesmo id, etiquetas e link
 * público). Grava o novo arquivo, aponta o registro para ele, remove o
 * arquivo antigo e atualiza tamanho/dimensões/updated_at. Usado pelo botão
 * "Salvar" do editor (substitui a imagem atual em vez de criar outra).
 */
export async function overwriteMediaFile(input: {
  id: string;
  relPath: string;
  size: number;
  width?: number;
  height?: number;
}): Promise<MediaItem | null> {
  const row = getMediaRow(input.id);
  if (!row) return null;
  const oldPath = row.path;
  const now = Date.now();
  getDb()
    .prepare(
      "UPDATE media SET path = ?, size = ?, width = ?, height = ?, updated_at = ? WHERE id = ?",
    )
    .run(input.relPath, input.size, input.width || null, input.height || null, now, input.id);
  if (oldPath && oldPath !== input.relPath) {
    await deleteFile(oldPath).catch(() => {});
    await deleteFile(videoThumbRelPath(oldPath)).catch(() => {});
  }
  const updated = getMediaRow(input.id);
  return updated ? toClient(updated, getTagsForMedia(input.id)) : null;
}

export function listMedia(profileId: string): MediaItem[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM media WHERE profile_id = ? ORDER BY created_at DESC",
    )
    .all(profileId) as MediaRow[];
  return rows.map((r) => toClient(r, getTagsForMedia(r.id)));
}

/** Ids de mídia já usados em QUALQUER post (agendado ou postado) deste perfil. */
export function listUsedMediaIds(profileId: string): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT pm.media_id AS id
       FROM post_media pm JOIN posts p ON p.id = pm.post_id
       WHERE p.profile_id = ?`,
    )
    .all(profileId) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export function getMediaRow(id: string): MediaRow | null {
  const row = getDb().prepare("SELECT * FROM media WHERE id = ?").get(id) as
    | MediaRow
    | undefined;
  return row || null;
}

/**
 * Exclui a mídia: remove o arquivo do disco primeiro (falhas reais de I/O
 * propagam o erro, sem fingir sucesso), e só então remove o registro do
 * banco — garante que "excluído" signifique 100% removido do servidor.
 */
export async function deleteMedia(id: string): Promise<boolean> {
  const row = getMediaRow(id);
  if (!row) return false;
  await deleteFile(row.path);
  await deleteFile(videoThumbRelPath(row.path)).catch(() => {});
  getDb().prepare("DELETE FROM media WHERE id = ?").run(id);
  return true;
}

/**
 * Retorna o token público da mídia, gerando um na primeira vez (link
 * estável: chamadas seguintes devolvem o mesmo token). Usado para montar
 * uma URL pública (sem login) consumível por Make/n8n.
 */
export function getOrCreatePublicToken(id: string): string | null {
  const row = getMediaRow(id);
  if (!row) return null;
  if (row.public_token) return row.public_token;
  const token = randomBytes(24).toString("base64url");
  getDb().prepare("UPDATE media SET public_token = ? WHERE id = ?").run(token, id);
  return token;
}

export function getMediaByPublicToken(token: string): MediaRow | null {
  const row = getDb()
    .prepare("SELECT * FROM media WHERE public_token = ?")
    .get(token) as MediaRow | undefined;
  return row || null;
}

export { extname };
