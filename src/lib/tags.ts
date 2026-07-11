import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { Tag } from "./types";

type TagRow = { id: string; name: string; color: string; created_at: number };

function toClient(r: TagRow): Tag {
  return { id: r.id, name: r.name, color: r.color, createdAt: r.created_at };
}

export function listTags(): Tag[] {
  const rows = getDb()
    .prepare("SELECT * FROM tags ORDER BY name COLLATE NOCASE")
    .all() as TagRow[];
  return rows.map(toClient);
}

export function getTag(id: string): Tag | null {
  const row = getDb().prepare("SELECT * FROM tags WHERE id = ?").get(id) as
    | TagRow
    | undefined;
  return row ? toClient(row) : null;
}

export function createTag(name: string, color: string): Tag {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Informe o nome da etiqueta.");
  const existing = getDb()
    .prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
    .get(trimmed);
  if (existing) throw new Error("Já existe uma etiqueta com esse nome.");

  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      "INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, trimmed, color, now);
  return { id, name: trimmed, color, createdAt: now };
}

export function updateTag(
  id: string,
  patch: { name?: string; color?: string },
): Tag | null {
  const row = getDb().prepare("SELECT * FROM tags WHERE id = ?").get(id) as
    | TagRow
    | undefined;
  if (!row) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name.trim());
  }
  if (patch.color !== undefined) {
    sets.push("color = ?");
    vals.push(patch.color);
  }
  if (sets.length > 0) {
    vals.push(id);
    getDb()
      .prepare(`UPDATE tags SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals);
  }
  const updated = getDb().prepare("SELECT * FROM tags WHERE id = ?").get(id) as TagRow;
  return toClient(updated);
}

export function deleteTag(id: string): boolean {
  const info = getDb().prepare("DELETE FROM tags WHERE id = ?").run(id);
  return info.changes > 0;
}

/** Adiciona ou remove uma etiqueta de um ou mais itens de mídia. */
export function setMediaTag(
  mediaIds: string[],
  tagId: string,
  action: "add" | "remove",
): void {
  const db = getDb();
  const tag = db.prepare("SELECT id FROM tags WHERE id = ?").get(tagId);
  if (!tag) throw new Error("Etiqueta não encontrada.");

  const stmt =
    action === "add"
      ? db.prepare(
          "INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)",
        )
      : db.prepare(
          "DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?",
        );

  const run = db.transaction((ids: string[]) => {
    for (const mediaId of ids) stmt.run(mediaId, tagId);
  });
  run(mediaIds);
}

export function getTagsForMedia(mediaId: string): Tag[] {
  const rows = getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN media_tags mt ON mt.tag_id = t.id
       WHERE mt.media_id = ?
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(mediaId) as TagRow[];
  return rows.map(toClient);
}
