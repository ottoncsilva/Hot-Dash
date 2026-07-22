import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { PostNetwork, PostPoll, PostStatus, ScheduledPost } from "./postTypes";
import type { SocialNetwork } from "./types";

type PostRow = {
  id: string;
  profile_id: string;
  scheduled_at: number;
  caption: string | null;
  poll: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  profile_name?: string;
};

function parsePoll(json: string | null): PostPoll | undefined {
  if (!json) return undefined;
  try {
    const v = JSON.parse(json);
    if (v && typeof v.question === "string" && Array.isArray(v.options)) {
      return { question: v.question, options: v.options.filter((o: unknown) => typeof o === "string") };
    }
  } catch {
    /* ignora */
  }
  return undefined;
}

function loadNetworks(postId: string): PostNetwork[] {
  const rows = getDb()
    .prepare(
      `SELECT pn.network, pn.post_type, pn.account_id, a.username AS account_username
       FROM post_networks pn LEFT JOIN accounts a ON a.id = pn.account_id
       WHERE pn.post_id = ? ORDER BY pn.network`,
    )
    .all(postId) as {
    network: string;
    post_type: string;
    account_id: string | null;
    account_username: string | null;
  }[];
  return rows.map((r) => ({
    network: r.network as SocialNetwork,
    postType: r.post_type,
    accountId: r.account_id || undefined,
    accountUsername: r.account_username || undefined,
  }));
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
    poll: parsePoll(r.poll),
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
    "INSERT OR REPLACE INTO post_networks (post_id, network, post_type, account_id) VALUES (?, ?, ?, ?)",
  );
  for (const n of networks) insNet.run(postId, n.network, n.postType, n.accountId || null);
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
  poll?: PostPoll;
  /** 1 = anexa o botão do VIP no envio; 0 = não; undefined = legado (padrão). */
  cta?: boolean;
}): ScheduledPost {
  if (input.networks.length === 0) throw new Error("Selecione ao menos uma rede social.");
  const id = randomUUID();
  const now = Date.now();
  const pollJson =
    input.poll && input.poll.question.trim() && input.poll.options.filter((o) => o.trim()).length >= 2
      ? JSON.stringify({ question: input.poll.question.trim(), options: input.poll.options.map((o) => o.trim()).filter(Boolean) })
      : null;
  const ctaVal = input.cta === undefined ? null : input.cta ? 1 : 0;
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO posts (id, profile_id, scheduled_at, caption, poll, cta, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    ).run(id, input.profileId, input.scheduledAt, input.caption || null, pollJson, ctaVal, now, now);
    writeRelations(id, input.networks, input.mediaIds || []);
  });
  run();
  return getPost(id)!;
}

/** Contagem leve de posts de um perfil (usada na coluna Posts da listagem de Modelos). */
export function countPostsByProfile(profileId: string): number {
  const r = getDb()
    .prepare("SELECT COUNT(*) c FROM posts WHERE profile_id = ?")
    .get(profileId) as { c: number };
  return r.c;
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
