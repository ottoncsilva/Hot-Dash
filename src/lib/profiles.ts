import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { countPostsByProfile } from "./posts";
import { totalPaidCentsByProfile } from "./transactions";
import { listProfileStatuses } from "./profileStatuses";
import type { Profile, SocialAccount, SocialNetwork } from "./types";

type AccountRow = {
  id: string;
  profile_id: string;
  network: string;
  username: string;
  url: string | null;
  login: string | null;
  password_enc: string | null;
  notes: string | null;
  created_at: number;
  sort_order: number;
};
type ProfileRow = {
  id: string;
  name: string;
  avatar_path: string | null;
  notes: string | null;
  status: string;
  created_at: number;
  updated_at: number;
};

function accountToClient(a: AccountRow): SocialAccount {
  return {
    id: a.id,
    network: a.network as SocialNetwork,
    username: a.username,
    url: a.url || undefined,
    login: a.login || undefined,
    hasPassword: Boolean(a.password_enc),
    notes: a.notes || undefined,
  };
}

function loadAccounts(profileId: string): SocialAccount[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM accounts WHERE profile_id = ? ORDER BY sort_order, created_at",
    )
    .all(profileId) as AccountRow[];
  return rows.map(accountToClient);
}

function profileToClient(p: ProfileRow): Profile {
  return {
    id: p.id,
    name: p.name,
    avatarPath: p.avatar_path,
    notes: p.notes || undefined,
    accounts: loadAccounts(p.id),
    status: p.status,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/**
 * Lista completa pra tela de Modelos — inclui contagem de posts e
 * faturamento pago por perfil (não computados em `profileToClient` porque a
 * maioria das chamadas internas, ex. após adicionar uma conta, não precisa
 * desses dois números).
 */
export async function listProfiles(): Promise<Profile[]> {
  const rows = getDb()
    .prepare("SELECT * FROM profiles ORDER BY name COLLATE NOCASE")
    .all() as ProfileRow[];
  return rows.map((row) => {
    const profile = profileToClient(row);
    profile.postCount = countPostsByProfile(profile.id);
    profile.revenuePaidCents = totalPaidCentsByProfile(profile.id);
    return profile;
  });
}

export async function getProfile(id: string): Promise<Profile | null> {
  const row = getDb()
    .prepare("SELECT * FROM profiles WHERE id = ?")
    .get(id) as ProfileRow | undefined;
  return row ? profileToClient(row) : null;
}

export async function createProfile(input: {
  name: string;
  notes?: string;
}): Promise<Profile> {
  const [defaultStatus] = listProfileStatuses();
  if (!defaultStatus) {
    throw new Error("Crie ao menos um status antes de criar um modelo.");
  }
  const now = Date.now();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO profiles (id, name, avatar_path, notes, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(id, input.name.trim(), input.notes?.trim() || "", defaultStatus.id, now, now);
  return (await getProfile(id))!;
}

export async function updateProfile(
  id: string,
  patch: {
    name?: string;
    notes?: string;
    avatarPath?: string | null;
    status?: string;
  },
): Promise<Profile | null> {
  const existing = getDb()
    .prepare("SELECT id FROM profiles WHERE id = ?")
    .get(id);
  if (!existing) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name.trim());
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(patch.notes.trim());
  }
  if (patch.avatarPath !== undefined) {
    sets.push("avatar_path = ?");
    vals.push(patch.avatarPath);
  }
  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id);
  getDb()
    .prepare(`UPDATE profiles SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals);
  return getProfile(id);
}

/** Exclui o perfil (as contas somem por CASCADE). Retorna true se existia. */
export async function deleteProfile(id: string): Promise<boolean> {
  const info = getDb().prepare("DELETE FROM profiles WHERE id = ?").run(id);
  return info.changes > 0;
}

export async function addAccount(
  profileId: string,
  input: {
    network: SocialNetwork;
    username: string;
    url?: string;
    login?: string;
    password?: string;
    notes?: string;
  },
): Promise<Profile | null> {
  const exists = getDb()
    .prepare("SELECT id FROM profiles WHERE id = ?")
    .get(profileId);
  if (!exists) return null;

  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO accounts
        (id, profile_id, network, username, url, login, password_enc, notes, created_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      profileId,
      input.network,
      input.username.trim(),
      input.url?.trim() || null,
      input.login?.trim() || null,
      input.password ? encryptSecret(input.password) : null,
      input.notes?.trim() || null,
      now,
      now,
    );
  getDb()
    .prepare("UPDATE profiles SET updated_at = ? WHERE id = ?")
    .run(now, profileId);
  return getProfile(profileId);
}

export async function updateAccount(
  profileId: string,
  accountId: string,
  input: {
    network?: SocialNetwork;
    username?: string;
    url?: string;
    login?: string;
    /** undefined = mantém; "" = remove a senha; string = nova senha. */
    password?: string;
    notes?: string;
  },
): Promise<Profile | null> {
  const row = getDb()
    .prepare("SELECT id FROM accounts WHERE id = ? AND profile_id = ?")
    .get(accountId, profileId);
  if (!row) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.network !== undefined) {
    sets.push("network = ?");
    vals.push(input.network);
  }
  if (input.username !== undefined) {
    sets.push("username = ?");
    vals.push(input.username.trim());
  }
  if (input.url !== undefined) {
    sets.push("url = ?");
    vals.push(input.url.trim() || null);
  }
  if (input.login !== undefined) {
    sets.push("login = ?");
    vals.push(input.login.trim() || null);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(input.notes.trim() || null);
  }
  if (input.password !== undefined) {
    sets.push("password_enc = ?");
    vals.push(input.password ? encryptSecret(input.password) : null);
  }
  if (sets.length > 0) {
    vals.push(accountId);
    getDb()
      .prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals);
    getDb()
      .prepare("UPDATE profiles SET updated_at = ? WHERE id = ?")
      .run(Date.now(), profileId);
  }
  return getProfile(profileId);
}

export async function deleteAccount(
  profileId: string,
  accountId: string,
): Promise<Profile | null> {
  getDb()
    .prepare("DELETE FROM accounts WHERE id = ? AND profile_id = ?")
    .run(accountId, profileId);
  getDb()
    .prepare("UPDATE profiles SET updated_at = ? WHERE id = ?")
    .run(Date.now(), profileId);
  return getProfile(profileId);
}

export async function revealPassword(
  profileId: string,
  accountId: string,
): Promise<string | null> {
  const row = getDb()
    .prepare(
      "SELECT password_enc FROM accounts WHERE id = ? AND profile_id = ?",
    )
    .get(accountId, profileId) as { password_enc: string | null } | undefined;
  if (!row?.password_enc) return null;
  return decryptSecret(row.password_enc);
}
