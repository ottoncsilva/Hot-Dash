import "server-only";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { getDb } from "./db";
import { deleteFile } from "./storage";
import type { MediaItem } from "./types";

type MediaRow = {
  id: string;
  profile_id: string;
  filename: string;
  path: string;
  kind: string;
  mime: string | null;
  size: number;
  created_at: number;
};

function toClient(r: MediaRow): MediaItem {
  return {
    id: r.id,
    profileId: r.profile_id,
    filename: r.filename,
    kind: r.kind === "video" ? "video" : "image",
    mime: r.mime || undefined,
    size: r.size,
    createdAt: r.created_at,
  };
}

export function newMediaPath(profileId: string, ext: string): {
  id: string;
  relPath: string;
} {
  const id = randomUUID();
  return { id, relPath: `profiles/${profileId}/media/${id}${ext.toLowerCase()}` };
}

export function insertMedia(input: {
  id: string;
  profileId: string;
  filename: string;
  relPath: string;
  kind: "image" | "video";
  mime?: string;
  size: number;
}): MediaItem {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO media (id, profile_id, filename, path, kind, mime, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  return toClient({
    id: input.id,
    profile_id: input.profileId,
    filename: input.filename,
    path: input.relPath,
    kind: input.kind,
    mime: input.mime || null,
    size: input.size,
    created_at: now,
  });
}

export function listMedia(profileId: string): MediaItem[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM media WHERE profile_id = ? ORDER BY created_at DESC",
    )
    .all(profileId) as MediaRow[];
  return rows.map(toClient);
}

export function getMediaRow(id: string): MediaRow | null {
  const row = getDb().prepare("SELECT * FROM media WHERE id = ?").get(id) as
    | MediaRow
    | undefined;
  return row || null;
}

export async function deleteMedia(id: string): Promise<boolean> {
  const row = getMediaRow(id);
  if (!row) return false;
  getDb().prepare("DELETE FROM media WHERE id = ?").run(id);
  await deleteFile(row.path).catch(() => {});
  return true;
}

export { extname };
