import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { PostNetwork, PostStatus, ScheduledPost } from "./postTypes";
import type { SocialNetwork } from "./types";

type PostRow = {
  id: string;
  profile_id: string;
  scheduled_at: number;
  caption: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  profile_name?: string;
};

function loadNetworks(postId: string): PostNetwork[] {
  const rows = getDb()
    .prepare("SELECT network, post_type FROM post_networks WHERE post_id = ? ORDER BY network")
    .all(postId) as { network: string; post_type: string }[];
  return rows.map((r) => ({ network: r.network as SocialNetwork, postType: r.post_type }));
}

function loadMedia(postId: string): ScheduledPost["media"] {
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.kind, m.filename, m.updated_at
       FROM post_media pm JOIN media m ON m.id = pm.media_id
       WHERE pm.post_id = ? ORDER BY pm.sort_order`,
    )
    .all(postId) as { id: string; kind: string; filename: string; updated_at: number | null }[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind === "video" ? "video" : "image",
    filename: r.filename,
    updatedAt: r.updated_at || undefined,
  }));
}

function toClient(r: PostRow): ScheduledPost {
  return {
    id: r.id,
    profileId: r.profile_id,
    profileName: r.profile_name,
    networks: loadNetworks(r.id),
    scheduledAt: r.scheduled_at,
    caption: r.caption || undefined,
    status: r.status === "posted" ? "posted" : "scheduled",
    media: loadMedia(r.id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Grava redes e mídias do post. As mídias entram por REFERÊNCIA (ids da
 * biblioteca) — o arquivo nunca é copiado no servidor; excluir o post não
 * apaga a mídia, e excluir a mídia apenas a remove do post (CASCADE).
 */
function writeRelations(postId: string, networks: PostNetwork[], mediaIds: string[]) {
  const db = getDb();
  db.prepare("DELETE FROM post_networks WHERE post_id = ?").run(postId);
  db.prepare("DELETE FROM post_media WHERE post_id = ?").run(postId);
  const insNet = db.prepare(
    "INSERT OR REPLACE INTO post_networks (post_id, network, post_type) VALUES (?, ?, ?)",
  );
  for (const n of networks) insNet.run(postId, n.network, n.postType);
  const insMedia = db.prepare(
    "INSERT OR IGNORE INTO post_media (post_id, media_id, sort_order) VALUES (?, ?, ?)",
  );
  mediaIds.forEach((mid, i) => insMedia.run(postId, mid, i));
}

export function createPost(input: {
  profileId: string;
  networks: PostNetwork[];
  scheduledAt: number;
  caption?: string;
  mediaIds?: string[];
}): ScheduledPost {
  if (input.networks.length === 0) throw new Error("Selecione ao menos uma rede social.");
  const id = randomUUID();
  const now = Date.now();
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO posts (id, profile_id, scheduled_at, caption, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'scheduled', ?, ?)`,
    ).run(id, input.profileId, input.scheduledAt, input.caption || null, now, now);
    writeRelations(id, input.networks, input.mediaIds || []);
  });
  run();
  return getPost(id)!;
}

export function getPost(id: string): ScheduledPost | null {
  const r = getDb()
    .prepare(
      `SELECT p.*, pr.name AS profile_name FROM posts p
       JOIN profiles pr ON pr.id = p.profile_id WHERE p.id = ?`,
    )
    .get(id) as PostRow | undefined;
  return r ? toClient(r) : null;
}

export function listPosts(filter: {
  profileId?: string;
  from?: number;
  to?: number;
  status?: PostStatus;
} = {}): ScheduledPost[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.profileId) {
    clauses.push("p.profile_id = ?");
    params.push(filter.profileId);
  }
  if (filter.from !== undefined) {
    clauses.push("p.scheduled_at >= ?");
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push("p.scheduled_at < ?");
    params.push(filter.to);
  }
  if (filter.status) {
    clauses.push("p.status = ?");
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT p.*, pr.name AS profile_name FROM posts p
       JOIN profiles pr ON pr.id = p.profile_id
       ${where} ORDER BY p.scheduled_at`,
    )
    .all(...params) as PostRow[];
  return rows.map(toClient);
}

export function updatePost(
  id: string,
  patch: {
    profileId?: string;
    networks?: PostNetwork[];
    scheduledAt?: number;
    caption?: string;
    status?: PostStatus;
    mediaIds?: string[];
  },
): ScheduledPost | null {
  const existing = getPost(id);
  if (!existing) return null;
  if (patch.networks && patch.networks.length === 0) {
    throw new Error("Selecione ao menos uma rede social.");
  }
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE posts SET profile_id = ?, scheduled_at = ?, caption = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      patch.profileId ?? existing.profileId,
      patch.scheduledAt ?? existing.scheduledAt,
      patch.caption !== undefined ? patch.caption || null : existing.caption || null,
      patch.status ?? existing.status,
      Date.now(),
      id,
    );
    if (patch.networks || patch.mediaIds) {
      writeRelations(
        id,
        patch.networks ?? existing.networks,
        patch.mediaIds ?? existing.media.map((m) => m.id),
      );
    }
  });
  run();
  return getPost(id);
}

export function deletePost(id: string): boolean {
  const info = getDb().prepare("DELETE FROM posts WHERE id = ?").run(id);
  return info.changes > 0;
}
