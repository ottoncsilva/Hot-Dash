import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Banco de dados SQLite no disco da VPS — a fonte de verdade de todos os
 * dados (perfis, contas, mídia). Fica no mesmo diretório persistente da
 * mídia (MEDIA_STORAGE_DIR). Sem Firebase, sem serviço externo.
 */
const BASE_DIR = resolve(process.env.MEDIA_STORAGE_DIR || "/app/data");
const DB_PATH = process.env.DB_PATH || join(BASE_DIR, "hotdash.db");

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(BASE_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      avatar_path TEXT,
      notes       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id           TEXT PRIMARY KEY,
      profile_id   TEXT NOT NULL,
      network      TEXT NOT NULL,
      username     TEXT NOT NULL,
      url          TEXT,
      login        TEXT,
      password_enc TEXT,
      notes        TEXT,
      created_at   INTEGER NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_profile ON accounts(profile_id);

    CREATE TABLE IF NOT EXISTS media (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL,
      filename    TEXT NOT NULL,
      path        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      mime        TEXT,
      size        INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_profile ON media(profile_id);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id            TEXT PRIMARY KEY,
      provider      TEXT NOT NULL,
      provider_ref  TEXT,
      profile_id    TEXT,
      description   TEXT,
      customer      TEXT,
      amount_cents  INTEGER NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'BRL',
      method        TEXT,
      status        TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);
  `);
}
