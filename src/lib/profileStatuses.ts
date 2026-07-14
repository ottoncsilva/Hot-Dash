import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { ProfileStatusDef } from "./types";

type StatusRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: number;
};

function toClient(r: StatusRow): ProfileStatusDef {
  return { id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order, createdAt: r.created_at };
}

export function listProfileStatuses(): ProfileStatusDef[] {
  const rows = getDb()
    .prepare("SELECT * FROM profile_statuses ORDER BY sort_order, created_at")
    .all() as StatusRow[];
  return rows.map(toClient);
}

export function getProfileStatus(id: string): ProfileStatusDef | null {
  const row = getDb().prepare("SELECT * FROM profile_statuses WHERE id = ?").get(id) as
    | StatusRow
    | undefined;
  return row ? toClient(row) : null;
}

export function createProfileStatus(name: string, color: string): ProfileStatusDef {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Informe o nome do status.");
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM profile_statuses WHERE name = ? COLLATE NOCASE")
    .get(trimmed);
  if (existing) throw new Error("Já existe um status com esse nome.");

  const { maxOrder } = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) maxOrder FROM profile_statuses")
    .get() as { maxOrder: number };

  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO profile_statuses (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, trimmed, color, maxOrder + 1, now);
  return { id, name: trimmed, color, sortOrder: maxOrder + 1, createdAt: now };
}

export function updateProfileStatus(
  id: string,
  patch: { name?: string; color?: string },
): ProfileStatusDef | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM profile_statuses WHERE id = ?").get(id) as
    | StatusRow
    | undefined;
  if (!row) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Informe o nome do status.");
    const dup = db
      .prepare("SELECT id FROM profile_statuses WHERE name = ? COLLATE NOCASE AND id != ?")
      .get(trimmed, id);
    if (dup) throw new Error("Já existe um status com esse nome.");
    sets.push("name = ?");
    vals.push(trimmed);
  }
  if (patch.color !== undefined) {
    sets.push("color = ?");
    vals.push(patch.color);
  }
  if (sets.length > 0) {
    vals.push(id);
    db.prepare(`UPDATE profile_statuses SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }
  const updated = db.prepare("SELECT * FROM profile_statuses WHERE id = ?").get(id) as StatusRow;
  return toClient(updated);
}

/**
 * Exclui um status do catálogo — diferente de Tags, bloqueia (lança erro) se
 * algum perfil ainda estiver usando esse status, já que é um campo
 * obrigatório de 1 perfil (não many-to-many como etiqueta).
 */
export function deleteProfileStatus(id: string): boolean {
  const db = getDb();
  const { c } = db.prepare("SELECT COUNT(*) c FROM profiles WHERE status = ?").get(id) as {
    c: number;
  };
  if (c > 0) {
    throw new Error(
      `Esse status está em uso por ${c} modelo${c > 1 ? "s" : ""}. Troque o status ${c > 1 ? "deles" : "dele"} antes de excluir.`,
    );
  }
  const info = db.prepare("DELETE FROM profile_statuses WHERE id = ?").run(id);
  return info.changes > 0;
}
