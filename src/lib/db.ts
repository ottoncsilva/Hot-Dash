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
      status      TEXT NOT NULL DEFAULT 'configuring',
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

    CREATE TABLE IF NOT EXISTS tags (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      color      TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_tags (
      media_id TEXT NOT NULL,
      tag_id   TEXT NOT NULL,
      PRIMARY KEY (media_id, tag_id),
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_tags_tag ON media_tags(tag_id);

    CREATE TABLE IF NOT EXISTS posts (
      id           TEXT PRIMARY KEY,
      profile_id   TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      caption      TEXT,
      status       TEXT NOT NULL DEFAULT 'scheduled',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_posts_profile ON posts(profile_id);
    CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_at);

    -- Um post pode ser destinado a várias redes, cada uma com seu tipo
    -- (ex.: Instagram/Carrossel + TikTok/Vídeo). account_id aponta pra conta
    -- cadastrada da modelo (accounts.id) — permite 2 linhas da mesma rede
    -- quando a modelo tem 2 contas dela (ex.: 2 Instagram).
    CREATE TABLE IF NOT EXISTS post_networks (
      post_id    TEXT NOT NULL,
      network    TEXT NOT NULL,
      post_type  TEXT NOT NULL,
      account_id TEXT,
      PRIMARY KEY (post_id, network, account_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    -- Mídias do post por REFERÊNCIA à biblioteca (nunca copia o arquivo).
    CREATE TABLE IF NOT EXISTS post_media (
      post_id    TEXT NOT NULL,
      media_id   TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (post_id, media_id),
      FOREIGN KEY (post_id)  REFERENCES posts(id)  ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    -- Programa semanal global (recorrente), reaplicado a cada perfil ao gerar
    -- um cronograma com IA. Não pertence a nenhum perfil específico.
    CREATE TABLE IF NOT EXISTS schedule_template_slots (
      id          TEXT PRIMARY KEY,
      weekday     INTEGER NOT NULL,
      time_start  TEXT NOT NULL,
      time_end    TEXT NOT NULL,
      network     TEXT NOT NULL,
      post_type   TEXT NOT NULL,
      media_kind  TEXT NOT NULL DEFAULT 'any',
      label       TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_schedule_template_weekday
      ON schedule_template_slots(weekday, time_start);

    -- Catálogo editável de status de modelo (Configurações > Status de
    -- modelos). profiles.status guarda o id daqui — sem FOREIGN KEY de
    -- verdade (recriar a tabela profiles só por isso teria risco
    -- desproporcional), validado na camada de aplicação.
    CREATE TABLE IF NOT EXISTS profile_statuses (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_bots (
      id                TEXT PRIMARY KEY,
      profile_id        TEXT NOT NULL UNIQUE,
      bot_token         TEXT NOT NULL,
      bot_username      TEXT,
      id_vip            TEXT NOT NULL,
      id_aquecimento    TEXT NOT NULL,
      id_registro       TEXT,
      support_username  TEXT,
      welcome_message   TEXT NOT NULL,
      welcome_media_tags TEXT,
      success_message   TEXT NOT NULL DEFAULT '✅ Pagamento aprovado! Acesse o Grupo VIP aqui: {link_vip}',
      downsell_funnel   TEXT,
      upsell_funnel     TEXT,
      created_at        INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS telegram_plans (
      id            TEXT PRIMARY KEY,
      bot_id        TEXT NOT NULL,
      name          TEXT NOT NULL,
      price_cents   INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      FOREIGN KEY (bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS telegram_custom_buttons (
      id            TEXT PRIMARY KEY,
      bot_id        TEXT NOT NULL,
      text          TEXT NOT NULL,
      url           TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS telegram_subscriptions (
      id                TEXT PRIMARY KEY,
      bot_id            TEXT NOT NULL,
      transaction_id    TEXT,
      telegram_user_id  INTEGER NOT NULL,
      telegram_username TEXT,
      invite_link       TEXT,
      status            TEXT NOT NULL DEFAULT 'active',
      expires_at        INTEGER NOT NULL,
      last_upsell_at    INTEGER,
      upsell_step_index INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL,
      FOREIGN KEY (bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_autopost_settings (
      profile_id        TEXT PRIMARY KEY,
      enabled           INTEGER NOT NULL DEFAULT 0,
      vip_post_interval INTEGER DEFAULT 12,
      vip_tags          TEXT,
      warmup_post_interval INTEGER DEFAULT 24,
      warmup_tags       TEXT,
      ai_prompt_style   TEXT,
      last_vip_post_at  INTEGER,
      last_warmup_post_at INTEGER,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS telegram_leads (
      id                  TEXT PRIMARY KEY,
      profile_id          TEXT NOT NULL,
      chat_id             TEXT NOT NULL,
      last_interaction_at INTEGER NOT NULL,
      downsell_step_index INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS whatsapp_instances (
      id            TEXT PRIMARY KEY,
      profile_id    TEXT NOT NULL UNIQUE,
      instance_name TEXT NOT NULL UNIQUE,
      status        TEXT NOT NULL DEFAULT 'disconnected',
      token         TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS whatsapp_agent_settings (
      profile_id    TEXT PRIMARY KEY,
      prompt        TEXT,
      enable_media  INTEGER NOT NULL DEFAULT 1,
      enable_billing INTEGER NOT NULL DEFAULT 1,
      ai_provider   TEXT NOT NULL DEFAULT 'grok',
      pix_key       TEXT,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model_prompts (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL UNIQUE,
      prompt      TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS whatsapp_chats (
      id                  TEXT PRIMARY KEY,
      profile_id          TEXT NOT NULL,
      remote_jid          TEXT NOT NULL,
      state               TEXT NOT NULL DEFAULT 'active',
      last_interaction_at INTEGER NOT NULL,
      created_at          INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      UNIQUE(profile_id, remote_jid)
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id         TEXT PRIMARY KEY,
      chat_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      type       TEXT DEFAULT 'text',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES whatsapp_chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_tasks (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL,
      provider    TEXT NOT NULL, -- 'magnific', 'kling'
      type        TEXT NOT NULL, -- 'image', 'video'
      status      TEXT NOT NULL, -- 'pending', 'processing', 'success', 'failed'
      result_url  TEXT,
      error       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat ON whatsapp_messages(chat_id);
  `);

  // Migrações incrementais (adiciona colunas que ainda não existem em bancos já criados).
  ensureColumn(d, "media", "edited_from", "TEXT");
  ensureColumn(d, "media", "width", "INTEGER");
  ensureColumn(d, "media", "height", "INTEGER");
  ensureColumn(d, "media", "public_token", "TEXT");
  ensureColumn(d, "media", "updated_at", "INTEGER");
  ensureColumn(d, "media", "file_created_at", "INTEGER");
  ensureColumn(d, "profiles", "status", "TEXT NOT NULL DEFAULT 'configuring'");
  ensureColumn(d, "telegram_bots", "welcome_media_tags", "TEXT");
  ensureColumn(d, "telegram_bots", "downsell_funnel", "TEXT");
  ensureColumn(d, "telegram_bots", "upsell_funnel", "TEXT");
  ensureColumn(d, "telegram_autopost_settings", "vip_prompt", "TEXT");
  ensureColumn(d, "telegram_autopost_settings", "warmup_prompt", "TEXT");
  ensureColumn(d, "telegram_autopost_settings", "warmup_link", "TEXT");
  ensureColumn(d, "telegram_autopost_settings", "vip_schedule_type", "TEXT DEFAULT 'interval'");
  ensureColumn(d, "telegram_autopost_settings", "vip_fixed_times", "TEXT");
  ensureColumn(d, "telegram_autopost_settings", "warmup_schedule_type", "TEXT DEFAULT 'interval'");
  ensureColumn(d, "telegram_autopost_settings", "warmup_fixed_times", "TEXT");
  ensureColumn(d, "telegram_subscriptions", "last_upsell_at", "INTEGER");
  ensureColumn(d, "telegram_subscriptions", "upsell_step_index", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "whatsapp_agent_settings", "ai_provider", "TEXT NOT NULL DEFAULT 'grok'");
  ensureColumn(d, "whatsapp_agent_settings", "enable_billing", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(d, "whatsapp_agent_settings", "pix_key", "TEXT");
  ensurePostNetworksAccountId(d);
  ensureDefaultProfileStatuses(d);

  d.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_media_public_token ON media(public_token) WHERE public_token IS NOT NULL;`,
  );
}

/**
 * Semeia o catálogo de status com os 3 valores que já existiam como enum
 * fixo (online/configuring/paused) — usando os mesmos ids, todo
 * `profiles.status` já gravado continua válido sem precisar reescrever
 * dado nenhum. Só roda se a tabela estiver vazia (idempotente).
 */
function ensureDefaultProfileStatuses(d: Database.Database) {
  const { c } = d.prepare("SELECT COUNT(*) c FROM profile_statuses").get() as { c: number };
  if (c > 0) return;
  const now = Date.now();
  const insert = d.prepare(
    "INSERT INTO profile_statuses (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run("online", "Online", "#10b981", 0, now);
  insert.run("configuring", "Configurando", "#f59e0b", 1, now);
  insert.run("paused", "Pausado", "#71717a", 2, now);
}

/**
 * Bancos criados antes da coluna `account_id` têm a PK antiga
 * `(post_id, network)`, que o SQLite não altera com `ALTER TABLE` — recria a
 * tabela preservando as linhas existentes (account_id fica NULL nelas,
 * tratado como "sem conta específica" no app). Idempotente: só roda se a
 * coluna ainda não existir.
 */
function ensurePostNetworksAccountId(d: Database.Database) {
  const cols = d.prepare(`PRAGMA table_info(post_networks)`).all() as { name: string }[];
  if (cols.some((c) => c.name === "account_id")) return;
  d.exec(`
    CREATE TABLE post_networks_new (
      post_id    TEXT NOT NULL,
      network    TEXT NOT NULL,
      post_type  TEXT NOT NULL,
      account_id TEXT,
      PRIMARY KEY (post_id, network, account_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    INSERT INTO post_networks_new (post_id, network, post_type, account_id)
      SELECT post_id, network, post_type, NULL FROM post_networks;
    DROP TABLE post_networks;
    ALTER TABLE post_networks_new RENAME TO post_networks;
  `);
}

/** Adiciona uma coluna à tabela se ela ainda não existir (migração idempotente). */
function ensureColumn(
  d: Database.Database,
  table: string,
  column: string,
  decl: string,
) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
