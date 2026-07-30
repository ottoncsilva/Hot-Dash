import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { syncPayFeeCents } from "./payments/syncpayExport";

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

    -- Registro cru dos webhooks do gateway. Existe porque a SyncPay manda por
    -- uma URL só TODO tipo de movimento (venda, saque…) e a documentação
    -- descreve apenas o de venda: sem ver o payload de verdade não dá para
    -- separar um do outro com certeza. Guarda os últimos eventos e o que o
    -- sistema decidiu sobre cada um.
    CREATE TABLE IF NOT EXISTS webhook_events (
      id           TEXT PRIMARY KEY,
      provider     TEXT NOT NULL,
      received_at  INTEGER NOT NULL,
      provider_ref TEXT,
      decision     TEXT NOT NULL,
      body         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_events_at ON webhook_events(received_at DESC);

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

    -- Histórico de PUBLICAÇÃO de cada mídia, por grupo do Telegram: uma linha
    -- por envio que realmente saiu. É o que permite ao Método MK escolher a
    -- mídia menos postada em cada grupo e a galeria mostrar quantas vezes cada
    -- foto já foi ao ar.
    -- Tabela própria, e não uma consulta em posts/post_media, porque o post
    -- pode ser excluído do calendário depois de publicado: o envio aconteceu e
    -- a contagem não pode voltar atrás.
    CREATE TABLE IF NOT EXISTS media_post_log (
      id         TEXT PRIMARY KEY,
      media_id   TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      audience   TEXT NOT NULL,  -- 'previas' | 'vip'
      post_id    TEXT,
      posted_at  INTEGER NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_post_log_media ON media_post_log(media_id, audience);
    CREATE INDEX IF NOT EXISTS idx_media_post_log_profile ON media_post_log(profile_id, audience);

    -- Retrato periódico do bot e dos GRUPOS (VIP e Prévias) tirado por consulta
    -- à API do Telegram (getChat / getChatMemberCount). Existe porque essas
    -- consultas só precisam do TOKEN: continuam funcionando com a operação do
    -- bot desligada, quando o webhook pertence a outro sistema e nenhum update
    -- chega aqui. É o que permite acompanhar o tamanho dos grupos antes do
    -- cutover.
    CREATE TABLE IF NOT EXISTS telegram_group_stats (
      id           TEXT PRIMARY KEY,   -- bot_id + ":" + kind
      bot_id       TEXT NOT NULL,
      profile_id   TEXT NOT NULL,
      kind         TEXT NOT NULL,      -- 'vip' | 'previas'
      chat_id      TEXT NOT NULL,
      title        TEXT,
      member_count INTEGER,
      checked_at   INTEGER NOT NULL,
      error        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_group_stats_profile ON telegram_group_stats(profile_id);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id                TEXT PRIMARY KEY,
      subscription_json TEXT NOT NULL,
      created_at        INTEGER NOT NULL
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

    -- Lista de USUÁRIOS do bot (tela Telegram → Usuários). Reúne num lugar só
    -- quem deu /start no bot e quem entrou nos grupos VIP/Prévias. O Telegram
    -- não deixa um bot listar membros de um grupo: a lista é montada pelos
    -- eventos que chegam no webhook (start, pedido de entrada, entrada/saída,
    -- bloqueio) — por isso ela cresce com o uso, não de uma vez só.
    CREATE TABLE IF NOT EXISTS telegram_users (
      id                  TEXT PRIMARY KEY,  -- bot_id + "_" + telegram_user_id
      bot_id              TEXT NOT NULL,
      profile_id          TEXT NOT NULL,
      telegram_user_id    INTEGER NOT NULL,
      username            TEXT,
      first_name          TEXT,
      last_name           TEXT,
      -- Chat PRIVADO com o bot (só existe depois do /start). Sem ele o Telegram
      -- proíbe o envio: é o que separa quem pode receber mailing de quem não pode.
      chat_id             TEXT,
      can_dm              INTEGER NOT NULL DEFAULT 0,
      blocked             INTEGER NOT NULL DEFAULT 0,
      in_vip              INTEGER NOT NULL DEFAULT 0,
      in_previas          INTEGER NOT NULL DEFAULT 0,
      source              TEXT,
      source_code         TEXT,
      last_interaction_at INTEGER,
      created_at          INTEGER NOT NULL,
      UNIQUE (bot_id, telegram_user_id),
      FOREIGN KEY (bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_telegram_users_bot ON telegram_users(bot_id);

    -- Disparos de mensagem em massa (tela Telegram → Mailing).
    CREATE TABLE IF NOT EXISTS telegram_mailings (
      id                TEXT PRIMARY KEY,
      bot_id            TEXT NOT NULL,
      profile_id        TEXT NOT NULL,
      name              TEXT NOT NULL,
      message           TEXT NOT NULL DEFAULT '',
      audiences         TEXT NOT NULL DEFAULT 'todos', -- lista separada por vírgula
      media_tags        TEXT,
      buttons           TEXT,                          -- JSON [{text,url}]
      schedule_type     TEXT NOT NULL DEFAULT 'once',  -- once|daily|interval|weekdays
      schedule_times    TEXT,                          -- "09:00,18:00"
      schedule_weekdays TEXT,                          -- "1,3,5" (0=domingo)
      interval_hours    INTEGER,
      scheduled_at      INTEGER,                       -- 'once': quando disparar
      status            TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|sending|sent|paused
      last_run_at       INTEGER,
      next_run_at       INTEGER,
      total_recipients  INTEGER NOT NULL DEFAULT 0,
      sent_count        INTEGER NOT NULL DEFAULT 0,
      failed_count      INTEGER NOT NULL DEFAULT 0,
      blocked_count     INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL,
      FOREIGN KEY (bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE
    );

    -- Ofertas do disparo: um plano existente com nome/preço/duração ajustados
    -- SÓ para este mailing (o plano original continua intacto).
    CREATE TABLE IF NOT EXISTS telegram_mailing_offers (
      id            TEXT PRIMARY KEY,
      mailing_id    TEXT NOT NULL,
      plan_id       TEXT,
      name          TEXT NOT NULL,
      price_cents   INTEGER NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 30,
      kind          TEXT NOT NULL DEFAULT 'subscription',
      deliverable   TEXT,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (mailing_id) REFERENCES telegram_mailings(id) ON DELETE CASCADE
    );

    -- Fila de envio: o disparo é gravado inteiro aqui e drenado aos poucos pelo
    -- agendador. É o que dá retomada (um restart no meio não perde o disparo),
    -- limite de velocidade e a contagem real de enviados/falhos/bloqueados.
    CREATE TABLE IF NOT EXISTS telegram_mailing_queue (
      id               TEXT PRIMARY KEY,
      mailing_id       TEXT NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      chat_id          TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending', -- pending|sent|failed|blocked
      error            TEXT,
      created_at       INTEGER NOT NULL,
      sent_at          INTEGER,
      FOREIGN KEY (mailing_id) REFERENCES telegram_mailings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tg_mailing_queue
      ON telegram_mailing_queue(mailing_id, status);

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
  ensureColumn(d, "profiles", "bio_physical", "TEXT");
  ensureColumn(d, "profiles", "bio_unique", "TEXT");
  ensureColumn(d, "profiles", "bio_personality", "TEXT DEFAULT 'safadinha'");
  // Valor LÍQUIDO (o que a SyncPay repassa depois da taxa) e o instante do
  // pagamento. `amount_cents` continua sendo o valor CHEIO (faturamento).
  ensureColumn(d, "transactions", "net_amount_cents", "INTEGER");
  ensureColumn(d, "transactions", "paid_at", "INTEGER");
  // Marca que a venda já foi consultada no gateway (reprocessamento). Sem isso
  // não dá para saber o que já foi tentado: a consulta da SyncPay NÃO devolve o
  // valor líquido, então "ainda sem líquido" nunca serviria como critério de
  // pendência — o lote ficaria reprocessando as mesmas vendas para sempre.
  ensureColumn(d, "transactions", "reprocessed_at", "INTEGER");
  // A SyncPay separa o desconto em TAXA (fixa, R$ 0,80) e SPLIT (repasse a
  // terceiros) — é assim que o "Resumo Financeiro" do painel dela mostra:
  // entrada − taxas − split = você recebe. Guardamos os dois para a conta
  // fechar linha a linha.
  ensureColumn(d, "transactions", "fee_cents", "INTEGER");
  ensureColumn(d, "transactions", "split_cents", "INTEGER");
  ensureColumn(d, "profiles", "bio_vip_link", "TEXT");
  // Link de SAÍDA do VIP (WhatsApp particular) + texto do botão. Usado nos posts
  // do grupo VIP marcados para levar o link, para puxar o lead pro WhatsApp (LTV).
  ensureColumn(d, "profiles", "bio_whatsapp_link", "TEXT");
  ensureColumn(d, "profiles", "bio_whatsapp_button", "TEXT");
  ensureColumn(d, "telegram_bots", "welcome_media_tags", "TEXT");
  ensureColumn(d, "telegram_bots", "downsell_funnel", "TEXT");
  ensureColumn(d, "telegram_bots", "upsell_funnel", "TEXT");
  // Liga/desliga da operação do BOT DE VENDAS (recebe /start, gera PIX, aprova
  // no VIP/Prévias). 0 = desligado (outro sistema segue no controle) — padrão até
  // o operador fazer o cutover. Não afeta a postagem automática, que usa o token
  // direto para enviar e não depende do webhook.
  ensureColumn(d, "telegram_bots", "operation_active", "INTEGER NOT NULL DEFAULT 0");
  // Mensagem enviada ao aprovar um lead no grupo de PRÉVIAS (opcional).
  ensureColumn(d, "telegram_bots", "previews_welcome_message", "TEXT");
  // Planos: tipo (assinatura recorrente vs pacote/compra única) e o entregável
  // (texto/link enviado ao pagar — o "MEU WHATSAPP" dos pacotes/bônus).
  ensureColumn(d, "telegram_plans", "kind", "TEXT NOT NULL DEFAULT 'subscription'");
  ensureColumn(d, "telegram_plans", "deliverable", "TEXT");
  // Qual plano/pacote originou a assinatura pendente (resolve duração/entregável
  // na confirmação do pagamento, corrigindo o antigo default de 30 dias).
  ensureColumn(d, "telegram_subscriptions", "plan_id", "TEXT");
  // Enquete do post (JSON {question, options[]}) — post sem mídia, tipo enquete.
  ensureColumn(d, "posts", "poll", "TEXT");
  // CTA por post: 1 = anexa o botão do VIP no envio; 0 = não; NULL = legado
  // (mantém o comportamento antigo). Usado pelo Método MK (só posts de conversão).
  ensureColumn(d, "posts", "cta", "INTEGER");
  // Semear reação 🔥 automaticamente nos posts de Prévias (social proof).
  ensureColumn(d, "telegram_autopost_settings", "warmup_seed_reaction", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_autopost_settings", "warmup_seed_emoji", "TEXT DEFAULT '🔥'");
  // Prompt editável do gerador "Método MK" (metodologia das prévias).
  ensureColumn(d, "telegram_autopost_settings", "warmup_mk_prompt", "TEXT");
  // "Botões da copy": frases de CTA (1 por linha) anexadas como botão nas Prévias.
  ensureColumn(d, "telegram_autopost_settings", "warmup_cta_buttons", "TEXT");
  ensureColumn(d, "telegram_autopost_settings", "vip_prompt", "TEXT");
  // Frases dos "Botões da copy" do VIP — o convite do VIP aponta para o
  // WhatsApp particular, então a lista é separada da das Prévias.
  ensureColumn(d, "telegram_autopost_settings", "vip_cta_buttons", "TEXT");
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
  ensureColumn(d, "posts", "reminded", "INTEGER NOT NULL DEFAULT 0");
  // Código de divulgação do deep-link do /start (t.me/bot?start=CODIGO). Fica
  // no lead quando ele chega e é copiado para a venda na hora de gerar o PIX —
  // é o que liga faturamento a origem de tráfego.
  ensureColumn(d, "telegram_leads", "source_code", "TEXT");
  ensureColumn(d, "transactions", "source_code", "TEXT");
  // Oferta do MAILING que originou a venda (nome/preço/duração ajustados só
  // para aquele disparo). Quando presente, manda na confirmação do pagamento
  // no lugar do plano original.
  ensureColumn(d, "telegram_subscriptions", "offer_id", "TEXT");
  ensurePostNetworksAccountId(d);
  ensureDefaultProfileStatuses(d);
  backfillSyncPayAmounts(d);
  backfillTelegramUsers(d);
  backfillMediaPostLog(d);

  d.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_media_public_token ON media(public_token) WHERE public_token IS NOT NULL;`,
  );
}

/**
 * Reconstrói a conta das vendas ANTIGAS da SyncPay.
 *
 * O que estava errado no banco: o webhook gravava em `amount_cents` o número
 * que a SyncPay manda na confirmação, e esse número é o LÍQUIDO. Conferindo com
 * a exportação do painel (a fonte oficial), cada venda de R$ 19,90 estava
 * gravada como R$ 19,10 — que é exatamente a coluna "Final Amount" do relatório.
 * O mesmo em todas as outras: 18,90→18,10, 17,91→17,11, 39,90→39,10, 89,90→89,10.
 *
 * Como a taxa da SyncPay é FIXA (R$ 0,80 até R$ 100), a venda cheia se recupera
 * somando a taxa de volta: `venda = líquido + 0,80`. É o que esta migração faz,
 * uma única vez, marcando no `settings` para não rodar de novo (a partir daqui o
 * webhook já grava certo — ver `updateStatusByRef`, que nunca deixa o valor
 * confirmado rebaixar a venda que a cobrança registrou).
 *
 * Ressalva registrada: um punhado de cobranças antigas (até 22/07) tinha também
 * um split de R$ 0,75 da ApexVips, que não dá para deduzir sem o relatório.
 * Nessas, a venda cheia fica R$ 0,75 abaixo da real. Importar a exportação da
 * SyncPay em Configurações → Pagamentos corrige tudo pelos números do painel.
 */
function backfillSyncPayAmounts(d: Database.Database) {
  const MARCA = "migracao_valores_syncpay_v2";
  const feito = d.prepare("SELECT value FROM settings WHERE key = ?").get(MARCA) as
    | { value: string }
    | undefined;

  if (!feito) {
    // Só as vendas do gateway: cobranças de outras origens não seguem esta regra.
    const linhas = d
      .prepare("SELECT id, amount_cents FROM transactions WHERE provider = 'syncpay'")
      .all() as { id: string; amount_cents: number }[];
    const upd = d.prepare(
      `UPDATE transactions
       SET amount_cents = ?, net_amount_cents = ?, fee_cents = ?, split_cents = 0
       WHERE id = ?`,
    );
    const aplicar = d.transaction(() => {
      for (const t of linhas) {
        // O que está gravado é o líquido; a venda cheia é ele mais a taxa.
        const liquido = t.amount_cents;
        const taxa = syncPayFeeCents(liquido);
        upd.run(liquido + taxa, liquido, taxa, t.id);
      }
      d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        MARCA,
        String(Date.now()),
      );
    });
    aplicar();
  }

  // Vendas que entrarem depois desta migração ainda podem chegar sem a taxa
  // separada (webhook sem `final_amount`); aqui elas ganham a taxa da tabela.
  const semTaxa = d
    .prepare(
      `SELECT id, amount_cents, net_amount_cents FROM transactions
       WHERE status = 'paid' AND fee_cents IS NULL`,
    )
    .all() as { id: string; amount_cents: number; net_amount_cents: number | null }[];
  if (semTaxa.length > 0) {
    const upd = d.prepare(
      "UPDATE transactions SET fee_cents = ?, split_cents = ?, net_amount_cents = ? WHERE id = ?",
    );
    const aplicar = d.transaction(() => {
      for (const t of semTaxa) {
        const tabela = syncPayFeeCents(t.amount_cents);
        const temLiquido = t.net_amount_cents !== null && t.net_amount_cents < t.amount_cents;
        const desconto = temLiquido ? t.amount_cents - (t.net_amount_cents as number) : tabela;
        const taxa = Math.min(tabela, desconto);
        upd.run(taxa, Math.max(0, desconto - taxa), t.amount_cents - desconto, t.id);
      }
    });
    aplicar();
  }

  // Hora do pagamento: nas vendas antigas o webhook não guardava `paid_at`, e a
  // coluna "Pago" do Financeiro ficava vazia. A geração do Pix é a melhor
  // aproximação que temos (no PIX o pagamento sai em segundos).
  d.prepare("UPDATE transactions SET paid_at = created_at WHERE status = 'paid' AND paid_at IS NULL").run();

  // As vendas que chegaram só pelo webhook ficavam com o rótulo interno
  // "Venda (webhook)", que não diz nada para quem lê o extrato.
  d.prepare("UPDATE transactions SET description = 'Venda SyncPay' WHERE description = 'Venda (webhook)'").run();
}

/**
 * Semeia a lista de USUÁRIOS do Telegram com quem o sistema já conhece.
 *
 * A tabela nasceu depois da operação já estar rodando, e o Telegram não deixa
 * um bot perguntar "quem são os membros deste grupo" — sem isto a tela de
 * Usuários começaria vazia e só encheria conforme cada pessoa voltasse a
 * interagir. Os dois lugares onde os contatos já estavam guardados são os
 * LEADS (quem deu /start) e as ASSINATURAS (quem gerou PIX/comprou).
 *
 * Roda a cada inicialização de propósito: é um INSERT que ignora conflito, e
 * novas linhas de lead/assinatura criadas por versões antigas do webhook
 * continuam sendo absorvidas sem precisar de marca de "já rodou".
 */
function backfillTelegramUsers(d: Database.Database) {
  const now = Date.now();

  // Leads: o id é "<bot_id>_<user_id>" e, no privado, chat_id === user_id.
  d.prepare(
    `INSERT OR IGNORE INTO telegram_users
       (id, bot_id, profile_id, telegram_user_id, chat_id, can_dm, source, source_code,
        last_interaction_at, created_at)
     SELECT l.id, b.id, l.profile_id, CAST(l.chat_id AS INTEGER), l.chat_id, 1, 'start',
            l.source_code, l.last_interaction_at, l.created_at
       FROM telegram_leads l
       JOIN telegram_bots b ON b.profile_id = l.profile_id
      WHERE CAST(l.chat_id AS INTEGER) > 0`,
  ).run();

  // Assinantes: quem comprou necessariamente falou com o bot no privado.
  d.prepare(
    `INSERT OR IGNORE INTO telegram_users
       (id, bot_id, profile_id, telegram_user_id, username, chat_id, can_dm, source,
        last_interaction_at, created_at)
     SELECT b.id || '_' || s.telegram_user_id, b.id, b.profile_id, s.telegram_user_id,
            s.telegram_username, CAST(s.telegram_user_id AS TEXT), 1, 'compra',
            s.created_at, s.created_at
       FROM telegram_subscriptions s
       JOIN telegram_bots b ON b.id = s.bot_id`,
  ).run();

  // Um @username que só existe na assinatura preenche a lista (o /start antigo
  // não guardava nome nenhum).
  d.prepare(
    `UPDATE telegram_users
        SET username = (
          SELECT s.telegram_username FROM telegram_subscriptions s
           WHERE s.bot_id = telegram_users.bot_id
             AND s.telegram_user_id = telegram_users.telegram_user_id
             AND s.telegram_username IS NOT NULL
           ORDER BY s.created_at DESC LIMIT 1)
      WHERE username IS NULL`,
  ).run();

  d.prepare(
    "UPDATE telegram_users SET created_at = ? WHERE created_at IS NULL OR created_at = 0",
  ).run(now);
}

/**
 * Reconstrói o histórico de publicação das mídias a partir dos posts do
 * Telegram que JÁ FORAM PUBLICADOS, para o contador da galeria e a escolha do
 * Método MK não começarem do zero em um banco que já rodava.
 *
 * O id é determinístico (`post_id:media_id:audience`), então o `INSERT OR
 * IGNORE` faz a deduplicação sozinho e a função pode rodar em todo boot sem
 * inflar a contagem. "Aquecimento" é o rótulo legado de "Prévias".
 */
function backfillMediaPostLog(d: Database.Database) {
  // 1) Conserta o que a primeira versão desta migração duplicou. Lá o registro
  //    do envio usava id aleatório e o do backfill, id determinístico: o
  //    `INSERT OR IGNORE` não reconhecia que era o MESMO envio e somava uma
  //    linha a cada reinício do servidor, inflando a contagem da galeria.
  //    Uma linha por (post, mídia, grupo) é o certo — o mesmo post não sai
  //    duas vezes no mesmo grupo. Mantém a mais antiga (a do envio real, com
  //    o instante correto).
  d.prepare(
    `DELETE FROM media_post_log
      WHERE post_id IS NOT NULL
        AND rowid NOT IN (
          SELECT MIN(rowid) FROM media_post_log
           WHERE post_id IS NOT NULL
           GROUP BY post_id, media_id, audience)`,
  ).run();

  // 2) Reconstrói o histórico dos posts já publicados. `sort_order = 0` porque
  //    é só a primeira mídia que o autopost envia — contar as outras inflaria
  //    um post de várias fotos. O NOT EXISTS garante a ideia de "um envio, uma
  //    linha" mesmo que o id venha de outro caminho.
  d.prepare(
    `INSERT OR IGNORE INTO media_post_log (id, media_id, profile_id, audience, post_id, posted_at)
     SELECT p.id || ':' || pm.media_id || ':' ||
            CASE WHEN pn.post_type = 'VIP' THEN 'vip' ELSE 'previas' END,
            pm.media_id, p.profile_id,
            CASE WHEN pn.post_type = 'VIP' THEN 'vip' ELSE 'previas' END,
            p.id, COALESCE(p.updated_at, p.scheduled_at)
       FROM posts p
       JOIN post_networks pn ON pn.post_id = p.id AND pn.network = 'telegram'
       JOIN post_media pm ON pm.post_id = p.id AND pm.sort_order = 0
      WHERE p.status = 'posted'
        AND pn.post_type IN ('VIP', 'Prévias', 'Aquecimento')
        AND NOT EXISTS (
          SELECT 1 FROM media_post_log l
           WHERE l.post_id = p.id
             AND l.media_id = pm.media_id
             AND l.audience = CASE WHEN pn.post_type = 'VIP' THEN 'vip' ELSE 'previas' END)`,
  ).run();
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
