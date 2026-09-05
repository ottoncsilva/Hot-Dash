import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { syncPayFeeCents } from "./payments/syncpayExport";
import { stripCaptionLabels } from "./captionLabels";

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

    -- Eventos de clique/visualização puxados da API do SLT (slt.bio, link na
    -- bio) — ver lib/sltSync.ts. O id é montado NA HORA de gravar (não vem
    -- do SLT) a partir dos campos que juntos identificam o evento; INSERT OR
    -- IGNORE faz do reprocessar a mesma janela (o cursor "since" pode
    -- repetir a borda) um no-op em vez de duplicar linha.
    CREATE TABLE IF NOT EXISTS slt_events (
      id                 TEXT PRIMARY KEY,
      created_at         INTEGER NOT NULL,
      event_type         TEXT NOT NULL,
      page_id            TEXT,
      page_slug          TEXT,
      page_display_name  TEXT,
      link_label         TEXT,
      link_url           TEXT,
      link_platform      TEXT,
      poplink_slug       TEXT,
      referer            TEXT,
      country            TEXT,
      domain             TEXT,
      synced_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slt_events_created ON slt_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_slt_events_page ON slt_events(page_slug);
    -- O índice de page_id NÃO entra aqui: bancos criados antes dessa coluna
    -- existir travariam este bloco inteiro (CREATE INDEX numa coluna que
    -- ainda não existe é erro, não é ignorado). Ele nasce mais abaixo,
    -- depois do ensureColumn que garante a coluna primeiro.

    -- Qual MODELO (e qual REDE — instagram/telegram/tiktok/ads/outro) cada
    -- página do SLT pertence — a API do SLT não sabe nada sobre "perfil"/
    -- modelo, é um conceito só nosso, e nem sobre qual rede a página
    -- representa (o operador organiza uma página por rede, mas isso também
    -- é só convenção dele). Sem essa amarração a tela de Links não teria
    -- como agrupar por modelo; com uma conta SLT só pra várias modelos, o
    -- operador atribui cada página uma vez (ver tela de Links) e o resto
    -- (cliques, views, funil) já sai agrupado sozinho. Os dois campos são
    -- INDEPENDENTES um do outro — dá pra classificar a rede antes de saber
    -- de qual modelo é, ou vice-versa — por isso nenhum dos dois é NOT
    -- NULL: a linha existe assim que QUALQUER um dos dois é definido.
    CREATE TABLE IF NOT EXISTS slt_page_profiles (
      page_id        TEXT PRIMARY KEY,
      profile_id     TEXT REFERENCES profiles(id) ON DELETE CASCADE,
      traffic_source TEXT,
      updated_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slt_page_profiles_profile ON slt_page_profiles(profile_id);

    -- Cadastro das redes/origens de tráfego que "traffic_source" acima pode
    -- guardar — era uma lista fixa no código; virou tabela para o operador
    -- poder adicionar a própria (ver Configuracoes -> Links da Bio). A
    -- "key" é o valor gravado em slt_page_profiles.traffic_source: nasce
    -- junto com a rede e nunca muda depois, para uma renomeação de rótulo
    -- não desamarrar as páginas já classificadas.
    CREATE TABLE IF NOT EXISTS slt_networks (
      id         TEXT PRIMARY KEY,
      key        TEXT NOT NULL UNIQUE,
      label      TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    -- Trava de execução dos crons que têm DOIS caminhos de disparo (o ticker
    -- interno de instrumentation.ts E uma rota HTTP externa) — sem isso, as
    -- duas execuções podiam rodar em paralelo sem saber uma da outra e mandar
    -- a mesma mensagem mais de uma vez. Ver src/lib/cronLock.ts.
    CREATE TABLE IF NOT EXISTS cron_locks (
      key         TEXT PRIMARY KEY,
      running     INTEGER NOT NULL DEFAULT 0,
      started_at  INTEGER
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

    -- RELATÓRIO DE VENDA vindo de fora (ex.: o Bobz, que opera alguns bots
    -- e posta no Canal de Vendas do Telegram um resumo de cada venda —
    -- mesmo formato que o próprio Hot-Dash usa, ver buildSalesReportMessage
    -- em payments/deliverPayment.ts). Guarda o que o relatório diz até o
    -- webhook de pagamento (SyncPay/Stripe) casar pelo provider_ref
    -- ("ID Transação Gateway") — dos dois lados, quem chegar primeiro espera
    -- o outro (ver lib/externalSaleReport.ts).
    CREATE TABLE IF NOT EXISTS external_sale_reports (
      id                 TEXT PRIMARY KEY,
      provider           TEXT NOT NULL,
      provider_ref       TEXT NOT NULL,
      bot_id             TEXT,
      profile_id         TEXT,
      telegram_user_id   INTEGER,
      telegram_username  TEXT,
      plan_name          TEXT,
      raw_text           TEXT,
      created_at         INTEGER NOT NULL,
      UNIQUE (provider, provider_ref)
    );

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
      audience   TEXT NOT NULL,  -- 'previas' | 'vip' | uma rede social ('instagram'...)
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

    -- Histórico DIÁRIO da contagem de membros: uma linha por grupo por dia,
    -- guardando a última medição daquele dia. A variação entre dois dias é o
    -- crescimento líquido do grupo (entrou menos saiu).
    -- Vem da mesma consulta do monitor, então é alimentado mesmo quando outro
    -- sistema opera o bot. Quando o Hot-Dash assumir a operação, os eventos de
    -- entrada/saída passam a existir e o gráfico pode separar um do outro.
    CREATE TABLE IF NOT EXISTS telegram_group_history (
      id           TEXT PRIMARY KEY,   -- bot_id + ":" + kind + ":" + dia
      bot_id       TEXT NOT NULL,
      profile_id   TEXT NOT NULL,
      kind         TEXT NOT NULL,
      day          TEXT NOT NULL,      -- AAAA-MM-DD no fuso da operação
      member_count INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_group_history_dia ON telegram_group_history(profile_id, day);

    -- Entradas e saídas dos grupos, contadas por dia. Separado do histórico
    -- acima porque a fonte é outra: aquele é uma CONSULTA periódica que só
    -- enxerga o total de membros (o saldo do dia, nunca o bruto), este é
    -- alimentado pelos eventos do webhook, que sabem quem entrou e quem saiu.
    CREATE TABLE IF NOT EXISTS telegram_group_events (
      id         TEXT PRIMARY KEY,   -- bot_id + ":" + kind + ":" + dia
      bot_id     TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      kind       TEXT NOT NULL,
      day        TEXT NOT NULL,      -- AAAA-MM-DD no fuso da operação
      joined     INTEGER NOT NULL DEFAULT 0,
      left_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_group_events_dia ON telegram_group_events(profile_id, day);

    -- Índice do funil sobre transactions. O de telegram_subscriptions fica lá
    -- embaixo, junto da tabela: um CREATE INDEX antes do CREATE TABLE quebra o
    -- init inteiro num banco novo (em banco já existente passava despercebido,
    -- porque a tabela já estava criada de uma versão anterior).
    CREATE INDEX IF NOT EXISTS idx_tx_status_created ON transactions(status, created_at);

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
      success_message   TEXT NOT NULL DEFAULT '✅ Pagamento aprovado! Acesse o Canal VIP aqui: {link_vip}',
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

    -- Faz a junção venda → inscrição do "tempo até a compra" ser um seek em vez
    -- de varredura (e também acelera o topPlans).
    CREATE INDEX IF NOT EXISTS idx_tg_subs_tx ON telegram_subscriptions(transaction_id);

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

    -- IDEMPOTÊNCIA DO WEBHOOK: o Telegram REENVIA o mesmo update se a nossa
    -- resposta demorar ou falhar (timeout, deploy no meio, instabilidade de
    -- rede) — sem marcar quem já foi processado, um /start (ou uma compra!)
    -- reprocessado manda a boas-vindas de novo, reinicia o timer do downsell
    -- de novo, e no pior caso (clique de compra reentregue) chega a gerar
    -- cobrança em dobro. update_id é sequencial POR BOT (a doc do Telegram
    -- garante isso), então a chave é o par (bot_id, update_id).
    CREATE TABLE IF NOT EXISTS telegram_webhook_updates (
      bot_id     TEXT NOT NULL,
      update_id  INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (bot_id, update_id)
    );

    -- FILA DA SEQUÊNCIA DE BOAS-VINDAS de quem foi aprovado num grupo.
    --
    -- A aprovação enviava UMA mensagem, na hora. Uma sequência com atrasos
    -- ("agora", "10 min depois", "1h depois") não cabe no handler do webhook,
    -- que precisa responder rápido ao Telegram — então cada aprovação vira uma
    -- linha aqui e o tick de 1 minuto entrega os passos na hora certa.
    --
    -- A coluna step_index é o próximo passo a enviar; a linha é apagada
    -- quando a sequência acaba. A chave inclui o grupo porque a mesma pessoa
    -- pode entrar nas Prévias e depois no VIP, com sequências diferentes.
    CREATE TABLE IF NOT EXISTS telegram_approval_queue (
      bot_id           TEXT NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      grupo            TEXT NOT NULL,   -- 'vip' | 'previas'
      chat_id          TEXT NOT NULL,   -- privado do lead (destino das mensagens)
      approved_at      INTEGER NOT NULL,
      step_index       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bot_id, telegram_user_id, grupo),
      FOREIGN KEY (bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE
    );

    -- CHATS QUE O BOT JÁ VIU. Serve para o botão "Detectar": em vez de o
    -- operador caçar o ID numérico do grupo (-100...) em algum outro app, ele
    -- escolhe da lista de grupos onde o bot está.
    --
    -- Um bot NÃO consegue listar os próprios grupos pela API do Telegram — a
    -- única forma de saber é ver um update vindo de lá. Por isso a tabela é
    -- alimentada pelo webhook, a cada mensagem ou mudança de membro, e o
    -- getUpdates cobre o caso de a operação ainda estar desligada.
    CREATE TABLE IF NOT EXISTS telegram_seen_chats (
      bot_id       TEXT NOT NULL,
      chat_id      TEXT NOT NULL,
      title        TEXT,
      type         TEXT,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (bot_id, chat_id),
      FOREIGN KEY (bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE
    );

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

    -- Fila da geração do Método MK. A rota só ENFILEIRA e responde; quem gera é
    -- o tick de 1 minuto (instrumentation.ts), em lotes pequenos. Sem isso a
    -- geração rodava dentro da requisição e estourava o maxDuration de 300s (são
    -- ~33 chamadas de IA COM IMAGEM por dia gerado nas Prévias e ~22 no VIP),
    -- deixando o cronograma pela metade e sem aviso.
    --
    -- O nome ficou das Prévias, que vieram primeiro; hoje a mesma fila atende os
    -- dois grupos — a coluna audience diz qual (ver generationJobs.ts).
    CREATE TABLE IF NOT EXISTS previas_generation_jobs (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL,
      days        INTEGER NOT NULL,
      status      TEXT NOT NULL,   -- 'pending' | 'processing' | 'done' | 'error'
      slots       TEXT NOT NULL,   -- JSON com o plano inteiro (sem copy)
      total       INTEGER NOT NULL,
      done        INTEGER NOT NULL DEFAULT 0,
      created     INTEGER NOT NULL DEFAULT 0,
      today       INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      ai_error    TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_previas_jobs_status
      ON previas_generation_jobs(status, created_at);

    -- CAIXINHA DE PERGUNTAS: banco de ideias de conteúdo do Instagram, por
    -- modelo. Cada linha é UMA ideia pronta para virar vídeo — a pergunta da
    -- caixinha (ou a frase de duplo sentido) e a sacada de como gravar.
    --
    -- O campo que faz o módulo valer é o "used": o problema de quem posta todo
    -- dia não é ter ideia, é lembrar qual já foi ao ar. Sem essa marca a lista
    -- vira um monte de texto que ninguém confia.
    CREATE TABLE IF NOT EXISTS question_box_items (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL,
      kind        TEXT NOT NULL,   -- 'caixinha' | 'duplo_sentido'
      text        TEXT NOT NULL,   -- a pergunta da caixinha ou a frase
      idea        TEXT,            -- como gravar / a virada do vídeo
      -- Quem escreveu: 'grok' | 'gemini' | 'openai' | 'manual'. Guardado porque
      -- a geração usa os TRÊS de uma vez, e depois de um tempo dá para ver qual
      -- deles rende as ideias que a operação de fato usa.
      provider    TEXT,
      used        INTEGER NOT NULL DEFAULT 0,
      used_at     INTEGER,
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_question_box_profile
      ON question_box_items(profile_id, kind, used, created_at DESC);

    -- ===================================================================
    -- LTV — a modelo conversando com o lead por conta REAL (WhatsApp pela
    -- Evolution, Telegram por chip/MTProto). As tabelas são agnósticas de
    -- canal de propósito: o motor é um só, o que muda é o adaptador de
    -- envio. Substituem as whatsapp_* (migradas em migrarWhatsappParaLtv).
    -- ===================================================================
    CREATE TABLE IF NOT EXISTS ltv_accounts (
      id            TEXT PRIMARY KEY,
      profile_id    TEXT NOT NULL,
      channel       TEXT NOT NULL,              -- 'whatsapp' | 'telegram'
      label         TEXT NOT NULL,              -- "Número 1", "Chip"
      external_ref  TEXT,                       -- telefone conectado (WhatsApp e Telegram)
      -- Id da instância no provedor (uazapi). É por ele que o webhook descobre
      -- de qual conta é o evento; o telefone só aparece depois que conecta,
      -- então não serve como chave.
      provider_ref  TEXT,
      -- Credencial cifrada da conta: a sessão MTProto no Telegram, o token da
      -- instância no WhatsApp. O canal diz qual é qual.
      session_enc   TEXT,
      status        TEXT NOT NULL DEFAULT 'disconnected',
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ltv_accounts_profile
      ON ltv_accounts(profile_id, channel);

    -- No WhatsApp a modelo tem VÁRIOS números; no Telegram é UM chip só. Quem
    -- garante isso é o banco, não só a rota — um segundo chip para a mesma
    -- modelo seria duas IAs falando pela mesma persona.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ltv_accounts_um_chip
      ON ltv_accounts(profile_id) WHERE channel = 'telegram';

    -- A instância da Evolution / o telefone do chip não pode estar em duas
    -- contas ao mesmo tempo: o webhook não saberia para qual entregar.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ltv_accounts_ref
      ON ltv_accounts(channel, external_ref) WHERE external_ref IS NOT NULL;

    CREATE TABLE IF NOT EXISTS ltv_agent_settings (
      account_id       TEXT PRIMARY KEY,
      enabled          INTEGER NOT NULL DEFAULT 0,
      approach         TEXT NOT NULL DEFAULT 'aquecer',  -- 'aquecer' | 'direto'
      persona_name     TEXT,
      tone_tags        TEXT,                             -- JSON: ["safada","dominadora"]
      personality      TEXT,
      mechanism        TEXT,
      limits           TEXT,
      rhythm           TEXT NOT NULL DEFAULT 'humano',   -- 'humano' | 'fixo'
      delay_min_s      INTEGER NOT NULL DEFAULT 20,
      delay_max_s      INTEGER NOT NULL DEFAULT 90,
      daily_limit      INTEGER NOT NULL DEFAULT 80,
      only_reply_first INTEGER NOT NULL DEFAULT 1,
      -- Teto do desconto que a IA pode dar sozinha. 0 = só o preço de tabela.
      max_discount_pct INTEGER NOT NULL DEFAULT 0,
      -- Amostras/prévias: ids da Galeria escolhidos a dedo na tela (JSON,
      -- ex.: ["m1","m2"]). Substituiu a etiqueta "amostra" — a IA sorteia
      -- entre ESTES ids, não mais por nome de etiqueta.
      sample_media_ids TEXT,
      FOREIGN KEY (account_id) REFERENCES ltv_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ltv_products (
      id            TEXT PRIMARY KEY,
      account_id    TEXT NOT NULL,
      name          TEXT NOT NULL,
      price_cents   INTEGER NOT NULL,
      description   TEXT,
      delivery_kind TEXT NOT NULL DEFAULT 'media',  -- 'media' | 'videocall'
      extra_message TEXT,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES ltv_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ltv_products_conta
      ON ltv_products(account_id, sort_order);

    -- A ordem importa: é a sequência em que o cliente recebe os arquivos
    -- depois de pagar (a tela deixa arrastar e marcar o 1º).
    CREATE TABLE IF NOT EXISTS ltv_product_media (
      product_id TEXT NOT NULL,
      media_id   TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, media_id),
      FOREIGN KEY (product_id) REFERENCES ltv_products(id) ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    -- Áudio com a voz REAL da modelo. Tabela própria porque media.kind só
    -- conhece 'image' e 'video' — e o que decide qual áudio mandar é o
    -- CONTEXTO ("saudação", "provocação"), que a mídia comum não tem.
    CREATE TABLE IF NOT EXISTS ltv_audios (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      filename   TEXT NOT NULL,
      path       TEXT NOT NULL,
      mime       TEXT,
      size       INTEGER NOT NULL DEFAULT 0,
      context    TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES ltv_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ltv_audios_conta ON ltv_audios(account_id);

    CREATE TABLE IF NOT EXISTS ltv_chats (
      id                  TEXT PRIMARY KEY,
      account_id          TEXT NOT NULL,
      peer_ref            TEXT NOT NULL,   -- remoteJid (WhatsApp) / user id (Telegram)
      peer_name           TEXT,
      -- Só Telegram: o access_hash do lead. O GramJS resolve o usuário pelo
      -- cache de entidades, e esse cache NÃO sobrevive a um restart do
      -- serviço — sem guardar aqui, todo deploy deixaria o chip sem conseguir
      -- responder ninguém até o lead falar de novo.
      peer_access_hash    TEXT,
      state               TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'paused'
      spent_cents         INTEGER NOT NULL DEFAULT 0,
      last_interaction_at INTEGER NOT NULL,
      created_at          INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES ltv_accounts(id) ON DELETE CASCADE,
      UNIQUE(account_id, peer_ref)
    );

    CREATE INDEX IF NOT EXISTS idx_ltv_chats_conta
      ON ltv_chats(account_id, last_interaction_at DESC);

    CREATE TABLE IF NOT EXISTS ltv_messages (
      id         TEXT PRIMARY KEY,
      chat_id    TEXT NOT NULL,
      role       TEXT NOT NULL,   -- 'user' | 'assistant'
      content    TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'text',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES ltv_chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ltv_messages_chat
      ON ltv_messages(chat_id, created_at);

    -- A costura da venda: o webhook da SyncPay acha o pedido pela transação e
    -- entrega o conteúdo. A coluna source separa o que a IA cobrou do que foi
    -- lançado na mão pelo "+ Venda" do Chat ao vivo.
    CREATE TABLE IF NOT EXISTS ltv_orders (
      id             TEXT PRIMARY KEY,
      chat_id        TEXT NOT NULL,
      product_id     TEXT,
      transaction_id TEXT,
      amount_cents   INTEGER NOT NULL,
      -- Quanto o produto valia na tabela quando a venda foi feita. O preço do
      -- produto muda com o tempo; sem isto não dá para saber depois se o
      -- desconto foi de 10% ou de 50%.
      list_price_cents INTEGER,
      status         TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'paid' | 'canceled'
      source         TEXT NOT NULL DEFAULT 'ia',       -- 'ia' | 'manual'
      delivered_at   INTEGER,
      created_at     INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES ltv_chats(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES ltv_products(id) ON DELETE SET NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ltv_orders_tx ON ltv_orders(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_ltv_orders_chat ON ltv_orders(chat_id, status);

    -- Contador do limite diário por conta (a proteção que segura o chip vivo).
    CREATE TABLE IF NOT EXISTS ltv_daily_usage (
      account_id TEXT NOT NULL,
      dia        TEXT NOT NULL,   -- 'AAAA-MM-DD' no fuso do painel
      sent       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, dia),
      FOREIGN KEY (account_id) REFERENCES ltv_accounts(id) ON DELETE CASCADE
    );

    -- ================================================================
    -- INSTAGRAM — estrutura PRÓPRIA, separada do LTV de propósito.
    --
    -- Parece o LTV e não é: lá a conversa existe para aquecer e vender no
    -- próprio chat, sem prazo. Aqui o canal é topo de funil, a conversa é
    -- curta e o destino é o link da bio — e, principalmente, a Meta impõe uma
    -- JANELA DE 24 HORAS a partir da última mensagem do lead, depois da qual
    -- responder é proibido. Esse relógio não existe no WhatsApp nem no
    -- Telegram, e enfiá-lo nas tabelas ltv_* contaminaria os dois canais que
    -- hoje funcionam com um conceito que não é deles.
    -- ================================================================

    -- Uma conta do Instagram conectada. Uma modelo pode ter várias (é comum:
    -- a principal, a de backup, a de nicho) — por isso profile_id não é único.
    -- ig_user_id é: a mesma conta não pode ser conectada a duas modelos, o que
    -- deixaria dois agentes respondendo a mesma DM.
    CREATE TABLE IF NOT EXISTS ig_accounts (
      id               TEXT PRIMARY KEY,
      profile_id       TEXT NOT NULL,
      ig_user_id       TEXT NOT NULL UNIQUE,   -- id da conta profissional na Meta
      username         TEXT,
      -- Token de usuário do Instagram, cifrado. Dura 60 dias e MORRE se não
      -- for renovado nesse prazo (ver runInstagramTokenRefresh).
      token_enc        TEXT,
      token_expires_at INTEGER,
      status           TEXT NOT NULL DEFAULT 'disconnected', -- connected|expired|error
      status_detail    TEXT,
      active           INTEGER NOT NULL DEFAULT 1,
      connected_at     INTEGER,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ig_accounts_profile ON ig_accounts(profile_id);

    -- Ajustes do agente POR CONTA. Curto de propósito: as instruções de
    -- conversa são as mesmas para todas as modelos (ver lib/instagram/prompt.ts)
    -- e a persona vem do cadastro da modelo. O que sobra aqui é operação.
    CREATE TABLE IF NOT EXISTS ig_agent_settings (
      account_id   TEXT PRIMARY KEY,
      enabled      INTEGER NOT NULL DEFAULT 0,
      -- Para onde empurrar o lead: 'bio', 'stories' ou 'ambos'. Nunca um link
      -- no texto — só a instrução de onde ele está.
      cta_target   TEXT NOT NULL DEFAULT 'bio',
      delay_min_s  INTEGER NOT NULL DEFAULT 4,
      delay_max_s  INTEGER NOT NULL DEFAULT 15,
      daily_limit  INTEGER NOT NULL DEFAULT 200,
      -- Quantas respostas a IA dá numa conversa antes de parar. O canal não é
      -- para aquecer: passou disso e o lead não foi para o link, insistir só
      -- gasta janela e chama atenção.
      max_turns    INTEGER NOT NULL DEFAULT 6,
      extra_notes  TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ig_chats (
      id                  TEXT PRIMARY KEY,
      account_id          TEXT NOT NULL,
      peer_ref            TEXT NOT NULL,   -- IGSID do lead, com escopo NESTA conta
      peer_name           TEXT,
      peer_username       TEXT,
      state               TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'paused'
      -- O RELÓGIO DA META: última mensagem recebida DO LEAD. É dele que saem
      -- as 24 horas em que se pode responder — separado de last_interaction_at,
      -- que anda também quando somos nós que falamos e não estende janela
      -- nenhuma.
      last_inbound_at     INTEGER NOT NULL,
      last_interaction_at INTEGER NOT NULL,
      -- Quantas respostas a IA já deu nesta conversa (ver max_turns).
      turns               INTEGER NOT NULL DEFAULT 0,
      -- Já mandou o lead para a bio/stories ao menos uma vez.
      cta_sent            INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE,
      UNIQUE(account_id, peer_ref)
    );

    CREATE INDEX IF NOT EXISTS idx_ig_chats_conta
      ON ig_chats(account_id, last_interaction_at DESC);

    CREATE TABLE IF NOT EXISTS ig_messages (
      id         TEXT PRIMARY KEY,
      chat_id    TEXT NOT NULL,
      role       TEXT NOT NULL,   -- 'user' | 'assistant'
      content    TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'text',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES ig_chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ig_messages_chat
      ON ig_messages(chat_id, created_at);

    -- IDEMPOTÊNCIA: a Meta REENVIA o evento se a nossa resposta demorar ou
    -- falhar. Sem isto, a mesma DM viraria duas respostas — que no Instagram
    -- não é só feio, é comportamento de robô no canal mais vigiado dos três.
    CREATE TABLE IF NOT EXISTS ig_seen_messages (
      mid        TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ig_daily_usage (
      account_id TEXT NOT NULL,
      dia        TEXT NOT NULL,   -- 'AAAA-MM-DD' no fuso do painel
      sent       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, dia),
      FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE
    );

    -- APARELHO DE ENTREGA: o celular que recebe o post pronto (mídia +
    -- legenda) na hora de publicar, pelo bot de entrega do Telegram.
    --
    -- É por MODELO porque é ela quem opera os celulares, e cada conta de rede
    -- social (accounts.delivery_target_id) escolhe qual deles recebe — duas
    -- contas de Instagram da mesma modelo podem rodar em aparelhos diferentes.
    --
    -- chat_id só existe depois do PAREAMENTO: a API do Telegram não deixa um
    -- bot mandar mensagem para quem nunca falou com ele, então o aparelho
    -- precisa mandar /vincular <pair_code> primeiro. Enquanto isso não
    -- acontece o aparelho está cadastrado mas não recebe nada.
    CREATE TABLE IF NOT EXISTS delivery_targets (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL,
      label       TEXT NOT NULL,
      chat_id     TEXT,
      -- Quem parear se identifica; guardar o @ ajuda a conferir que o vínculo
      -- caiu no celular certo (o chat_id numérico não diz nada a ninguém).
      chat_name   TEXT,
      pair_code   TEXT,
      paired_at   INTEGER,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_targets_profile
      ON delivery_targets(profile_id);

    -- O código de vínculo tem que ser único no painel inteiro: quem digita
    -- /vincular ABC123 no Telegram não informa de qual modelo é o aparelho.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_targets_pair
      ON delivery_targets(pair_code) WHERE pair_code IS NOT NULL;

    -- Um ENVIO do pacote de postagem para um aparelho. É esta linha que o
    -- botão do Telegram devolve (o callback_data carrega o id daqui), e é
    -- ela que sabe se a confirmação já veio.
    --
    -- Tabela própria, e não colunas em posts, porque o mesmo post pode ir
    -- para DOIS aparelhos (duas contas em celulares diferentes) e cada um
    -- responde no seu tempo.
    CREATE TABLE IF NOT EXISTS post_deliveries (
      id           TEXT PRIMARY KEY,
      post_id      TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      -- sent | confirmed | snoozed | failed | error
      status       TEXT NOT NULL DEFAULT 'sent',
      sent_at      INTEGER NOT NULL,
      -- Id da mensagem no Telegram: é por ele que o teclado é trocado pelo
      -- resultado ("✅ Postado às 14:07") depois da resposta, o que impede o
      -- segundo clique numa mensagem que já foi respondida.
      message_id   TEXT,
      answered_at  INTEGER,
      snooze_count INTEGER NOT NULL DEFAULT 0,
      nudged_at    INTEGER,
      error        TEXT,
      FOREIGN KEY (post_id)   REFERENCES posts(id)            ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES delivery_targets(id) ON DELETE CASCADE
    );

    -- O ESPELHO do post no chat de quem acompanha tudo (ver
    -- postDelivery.espelharParaAlerta). Guardamos a mensagem enviada para
    -- poder SELÁ-LA depois: quando alguém confirma no celular, o alerta que
    -- estava lá em cima recebe um "✅ CONFIRMADO" na frente, em vez de
    -- continuar dizendo para sempre que o post está por sair.
    --
    -- O TEXTO vai junto de propósito. Reeditar exige remontar a mensagem
    -- inteira, e remontá-la a partir do post no momento da resposta traria o
    -- post de HOJE — que pode já ter sido editado. O que foi enviado é o que
    -- tem de continuar aparecendo; só o selo é novo.
    CREATE TABLE IF NOT EXISTS post_alerts (
      id         TEXT PRIMARY KEY,
      post_id    TEXT NOT NULL,
      chat_id    TEXT NOT NULL,
      message_id TEXT,
      text       TEXT NOT NULL,
      sent_at    INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_post_alerts_post
      ON post_alerts(post_id);

    CREATE INDEX IF NOT EXISTS idx_post_deliveries_post
      ON post_deliveries(post_id);
    CREATE INDEX IF NOT EXISTS idx_post_deliveries_aberta
      ON post_deliveries(status, sent_at);
  `);

  // Migrações incrementais (adiciona colunas que ainda não existem em bancos já criados).
  ensureColumn(d, "media", "edited_from", "TEXT");
  ensureColumn(d, "media", "width", "INTEGER");
  ensureColumn(d, "media", "height", "INTEGER");
  ensureColumn(d, "media", "public_token", "TEXT");
  ensureColumn(d, "media", "updated_at", "INTEGER");
  ensureColumn(d, "media", "file_created_at", "INTEGER");
  // Mídia OCULTA da Galeria: arquivos que só existem para alimentar um
  // recurso (o vídeo de referência do Motion Control, que a API externa
  // precisa buscar por URL pública). Guardar aqui reaproveita gravação,
  // limpeza de metadados e token público sem sujar a galeria da modelo.
  ensureColumn(d, "media", "hidden", "INTEGER NOT NULL DEFAULT 0");

  // ENTREGA DA POSTAGEM (ver `lib/postDelivery.ts`).
  // Aparelho que recebe o post desta conta. Vazio = a conta não entra na
  // entrega automática (o operador continua vendo o post no Cronograma).
  ensureColumn(d, "accounts", "delivery_target_id", "TEXT");
  // Hora REAL da publicação, que volta do botão "Postei" no celular — não
  // confundir com `scheduled_at`, que é a hora combinada. É a diferença
  // entre as duas que o card do Cronograma mostra.
  ensureColumn(d, "posts", "posted_at", "INTEGER");
  // Quando o pacote (mídia + legenda) saiu para o aparelho. É a guarda de
  // "já mandei este" do motor de entrega.
  //
  // NÃO reaproveita `posts.reminded`: aquele é do push de 15 minutos antes
  // (`cronTasks.ts`), que continua existindo e tem outra janela — juntar os
  // dois faria um cancelar o outro.
  ensureColumn(d, "posts", "delivered_at", "INTEGER");
  // Quando o ESPELHO do post saiu para os chats de alerta (o Telegram de quem
  // toca a operação, que recebe cópia de todas as modelos).
  //
  // Coluna própria e não `delivered_at`: o alerta cobre também o post cuja
  // conta não tem aparelho nenhum — aquele nunca entra na entrega e deixaria
  // `delivered_at` nulo para sempre, fazendo o alerta se repetir a cada
  // minuto durante a janela inteira.
  ensureColumn(d, "posts", "alerted_at", "INTEGER");
  // VIRALIZOU: uma caixinha já usada que rendeu nas redes. Fica marcada para
  // ser reaproveitada meses depois — é o oposto de "usada", que serve para
  // NÃO repetir. Só faz sentido em item já usado (ver `questionBox.ts`).
  ensureColumn(d, "question_box_items", "viral", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "question_box_items", "viral_at", "INTEGER");
  // Conta ATIVA no cronograma. Conta velha não se apaga — some do mundo junto
  // com o histórico e as senhas guardadas —, então ela se desliga: para de ser
  // oferecida para posts NOVOS e continua no cadastro. O que já estava agendado
  // para ela fica no calendário, marcado (ver a tela de Cronograma).
  // A CONTA em que a mídia saiu, quando o destino é rede social. Fica NULL nos
  // dois grupos do Telegram, onde o grupo já É o destino.
  //
  // É o que permite contar separado: a mesma foto pode ter saído 3x no VIP, 2x
  // no @insta_um e 1x no @insta_dois, e cada número desses é uma pergunta
  // diferente. Sem a coluna, duas contas de Instagram da mesma modelo virariam
  // um balde só.
  ensureColumn(d, "media_post_log", "account_id", "TEXT");
  ensureColumn(d, "accounts", "active", "INTEGER NOT NULL DEFAULT 1");
  // ESPELHO: conta de Facebook/Threads que só repete o que sai numa conta de
  // Instagram desta mesma modelo. Aponta para o `accounts.id` do Instagram.
  //
  // O vínculo é informativo, de propósito: o post do cronograma continua sendo
  // um post de INSTAGRAM, e o espelho não vira destino próprio. Quem replica é
  // o app do Instagram, não este painel — inventar uma linha de destino aqui
  // faria o calendário afirmar um envio que o sistema nunca fez.
  ensureColumn(d, "accounts", "linked_account_id", "TEXT");
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
  // A venda LIQUIDADA, quando o gateway converte de moeda: um cartão cobrado em
  // dólar é depositado em real, e o extrato da Stripe traz os dois lados.
  // `amount_cents`/`currency` continuam sendo o que o CLIENTE pagou (US$ 19,90);
  // estas guardam o que de fato caiu na conta (R$ 101,28). Sem elas, a venda ou
  // ficava fora do faturamento (que só soma real) ou entrava com o número
  // errado — e nenhum dos dois é o que aconteceu.
  //
  // Taxa, split e líquido já são gravados na moeda de LIQUIDAÇÃO, que é como o
  // gateway cobra: numa venda em real as duas moedas são a mesma e nada disto
  // muda.
  ensureColumn(d, "transactions", "settled_amount_cents", "INTEGER");
  ensureColumn(d, "transactions", "settled_currency", "TEXT");
  // A SyncPay separa o desconto em TAXA (fixa, R$ 0,80) e SPLIT (repasse a
  // terceiros) — é assim que o "Resumo Financeiro" do painel dela mostra:
  // entrada − taxas − split = você recebe. Guardamos os dois para a conta
  // fechar linha a linha.
  ensureColumn(d, "transactions", "fee_cents", "INTEGER");
  ensureColumn(d, "transactions", "split_cents", "INTEGER");
  ensureColumn(d, "profiles", "bio_vip_link", "TEXT");
  // LINK DO VIP DESCOBERTO SOZINHO (ver lib/vipLink.ts) e de onde ele veio.
  // Fica separado do `bio_vip_link` de propósito: o campo do operador continua
  // mandando, e a tela precisa saber distinguir o que ela achou do que foi
  // escrito à mão. Vazio = ainda não foi descoberto.
  ensureColumn(d, "profiles", "vip_link_auto", "TEXT");
  ensureColumn(d, "profiles", "vip_link_auto_source", "TEXT");
  // Link de SAÍDA do VIP (WhatsApp particular) + texto do botão. Usado nos posts
  // do canal VIP marcados para levar o link, para puxar o lead pro WhatsApp (LTV).
  ensureColumn(d, "profiles", "bio_whatsapp_link", "TEXT");
  ensureColumn(d, "profiles", "bio_whatsapp_button", "TEXT");
  // Mesmo papel do WhatsApp acima, no Telegram: o post do VIP pode puxar o lead
  // para a conversa privada da modelo no PRÓPRIO Telegram, sem tirar ele do app.
  // Cada geração escolhe UM destino — WhatsApp ou Telegram, nunca os dois.
  ensureColumn(d, "profiles", "bio_telegram_link", "TEXT");
  ensureColumn(d, "profiles", "bio_telegram_button", "TEXT");
  // GERADORES DE IMAGEM E VÍDEO: o que é da MODELO fica no perfil dela, não na
  // tela. As referências (rosto/corpo) são escolhidas uma vez e valem para toda
  // geração seguinte — reescolher a mesma coisa a cada imagem era o trabalho
  // repetido que essas colunas eliminam. Os prompts começam vazios e caem no
  // texto padrão do código; preenchidos, valem no lugar dele, porque cada
  // modelo tem o seu jeito (aparência fixa, cenário, voz) que não cabe num
  // texto único para todas.
  ensureColumn(d, "profiles", "imagegen_reference_ids", "TEXT");
  ensureColumn(d, "profiles", "imagegen_prompt_base", "TEXT");
  ensureColumn(d, "profiles", "videogen_prompt_base", "TEXT");
  // Prompt que instrui a IA de TEXTO a fundir a caixinha de perguntas com o
  // roteiro base acima e devolver o prompt final do vídeo — é um prompt sobre
  // outro prompt, por isso vive separado do roteiro.
  ensureColumn(d, "profiles", "videogen_prompt_controle", "TEXT");
  // A fila de geração nasceu só das Prévias. `audience` diz de qual grupo é o
  // job ('previas' | 'vip') e `params` guarda o que o VIP precisa lembrar entre
  // um lote e outro (destino do convite e o link já resolvido). Jobs antigos
  // continuam válidos: sem a coluna, todos eram das Prévias.
  ensureColumn(d, "previas_generation_jobs", "audience", "TEXT NOT NULL DEFAULT 'previas'");
  ensureColumn(d, "previas_generation_jobs", "params", "TEXT");
  // Quantos posts do job saíram com o TEXTO DE RESERVA em vez da legenda da IA.
  // Sem esse número o painel dizia "30 posts gerados" sem distinguir o que a IA
  // escreveu do que era frase enlatada.
  ensureColumn(d, "previas_generation_jobs", "reserve_count", "INTEGER NOT NULL DEFAULT 0");
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
  // Regra de APROVAÇÃO AUTOMÁTICA por grupo, antes fixa no código do webhook:
  //   subscribers = só entra quem tem assinatura ativa (o padrão do VIP);
  //   all         = aprova todo pedido (o padrão das Prévias, grupo gratuito);
  //   manual      = o bot não decide — o pedido fica na fila do Telegram para
  //                 o admin resolver na mão.
  // Os defaults reproduzem exatamente o comportamento anterior, então quem já
  // usava o bot não vê mudança nenhuma até mexer na tela.
  ensureColumn(d, "telegram_bots", "vip_approval_mode", "TEXT NOT NULL DEFAULT 'subscribers'");
  ensureColumn(d, "telegram_bots", "previas_approval_mode", "TEXT NOT NULL DEFAULT 'all'");
  // TELA DE PAGAMENTO: os textos que o lead vê entre clicar no plano e pagar
  // estavam fixos no código do webhook — a parte do funil que mais merece ser
  // escrita na voz da modelo era justamente a única que não dava para editar.
  // NULL = usa o padrão de sempre, então nada muda para quem já usava.
  ensureColumn(d, "telegram_bots", "pix_generating_message", "TEXT");
  ensureColumn(d, "telegram_bots", "pix_caption", "TEXT");
  // Texto do botão que leva ao VIP na mensagem de pagamento aprovado. Vazio =
  // sem botão, com o link solto no texto (o comportamento anterior).
  ensureColumn(d, "telegram_bots", "success_button_text", "TEXT");
  // MÍDIAS DE ABERTURA escolhidas a dedo (JSON com ids da Galeria, em ordem) e
  // como enviá-las: "album" = um álbum só, "separate" = uma mensagem por mídia.
  // Convivem com welcome_media_tags, que continua sorteando UMA mídia — a lista
  // explícita, quando existe, tem prioridade. Quem já usava etiquetas não vê
  // diferença nenhuma.
  ensureColumn(d, "telegram_bots", "welcome_media_ids", "TEXT");
  ensureColumn(d, "telegram_bots", "welcome_media_mode", "TEXT NOT NULL DEFAULT 'album'");
  // PROVA SOCIAL na tela de pagamento: uma linha extra com números REAIS de
  // vendas desta modelo ({vendas_hoje}, {assinantes}). Desligada por padrão.
  ensureColumn(d, "telegram_bots", "pix_social_proof", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_bots", "pix_social_proof_text", "TEXT");
  // Áudio (URL pública OGG/OPUS) enviado junto do PIX, como mensagem de voz.
  ensureColumn(d, "telegram_bots", "pix_audio_url", "TEXT");
  // Textos dos tres botoes que acompanham o PIX e a resposta do "Verificar
  // Status" quando a confirmacao ainda nao chegou. NULL = usa o padrao.
  ensureColumn(d, "telegram_bots", "pix_btn_check", "TEXT");
  ensureColumn(d, "telegram_bots", "pix_btn_qr", "TEXT");
  ensureColumn(d, "telegram_bots", "pix_btn_copy", "TEXT");
  ensureColumn(d, "telegram_bots", "pix_not_paid_message", "TEXT");
  // Sequência de boas-vindas de quem é APROVADO em cada grupo (JSON de passos,
  // no mesmo formato dos funis). Vazio = cai na mensagem única de sempre
  // (`previews_welcome_message`), então nada muda para quem não mexer na tela.
  ensureColumn(d, "telegram_bots", "previas_welcome_funnel", "TEXT");
  ensureColumn(d, "telegram_bots", "vip_welcome_funnel", "TEXT");
  // Reusar a MENSAGEM DE BOAS-VINDAS do /start ao aprovar alguém no grupo de
  // prévias, em vez de reescrevê-la na sequência. É a mesma conversa: quem
  // entra nas prévias precisa ver a mesma oferta de quem chega pelo /start,
  // e manter as duas em sincronia à mão era garantia de divergirem.
  ensureColumn(d, "telegram_bots", "previas_use_welcome", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_bots", "vip_use_welcome", "INTEGER NOT NULL DEFAULT 0");
  // PREÇO DINÂMICO e CORES DOS BOTÕES por MODELO. Nasceram como configuração
  // global do painel, e isso estava errado: tudo no bot de vendas é decidido
  // modelo a modelo — preço, planos, textos, funis. Duas modelos podem ter
  // paletas e políticas de preço diferentes, e com um valor só uma delas
  // sempre estaria com a configuração da outra.
  ensureColumn(d, "telegram_bots", "dynamic_price_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_bots", "dynamic_price_cents", "INTEGER NOT NULL DEFAULT 9");
  ensureColumn(d, "telegram_bots", "dynamic_price_direction", "TEXT NOT NULL DEFAULT 'random'");
  /** JSON {papel: cor}. NULL = nenhuma cor escolhida ainda. */
  ensureColumn(d, "telegram_bots", "button_styles", "TEXT");
  // Terceiro gatilho da RECUPERAÇÃO: quem gerou PIX e não pagou. É um público
  // diferente do downsell geral — já escolheu o plano e chegou na tela de
  // pagamento, então merece outra conversa (e outro desconto).
  ensureColumn(d, "telegram_bots", "pix_downsell_funnel", "TEXT");
  ensureColumn(d, "telegram_bots", "pix_downsell_enabled", "INTEGER NOT NULL DEFAULT 1");
  // PADRÃO do botão no Downsell de PIX: 'selected' (só o item que o lead já
  // escolheu) ou 'all' (a lista inteira de planos). É só o padrão — cada
  // mensagem pode dizer outra coisa no `planMode` dela. Vazio = 'selected',
  // que era o comportamento fixo antes desta coluna existir.
  ensureColumn(d, "telegram_bots", "pix_downsell_plan_mode", "TEXT");
  ensureColumn(d, "telegram_bots", "downsell_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(d, "telegram_bots", "upsell_enabled", "INTEGER NOT NULL DEFAULT 1");
  // EFEITO DE MENSAGEM (a animação nativa do Telegram) em cada momento do
  // funil. Guarda a chave ("fire", "party"...), não o id numérico da API.
  // NULL = sem efeito, que é como o bot sempre se comportou.
  ensureColumn(d, "telegram_bots", "effect_welcome", "TEXT");
  ensureColumn(d, "telegram_bots", "effect_pix", "TEXT");
  ensureColumn(d, "telegram_bots", "effect_success", "TEXT");
  // ALERTA DE RENOVAÇÃO: avisa quem está VIP de que o acesso está vencendo,
  // com desconto para renovar — a CONTAGEM É REGRESSIVA até `expires_at`, ao
  // contrário do upsell (que conta pra frente desde a última ação). Por isso
  // vive num funil próprio, não dentro do upsell.
  ensureColumn(d, "telegram_bots", "renewal_funnel", "TEXT");
  ensureColumn(d, "telegram_bots", "renewal_enabled", "INTEGER NOT NULL DEFAULT 1");
  // Progresso do funil de PIX gerado, na própria inscrição pendente.
  ensureColumn(d, "telegram_subscriptions", "pix_step_index", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_subscriptions", "last_pix_step_at", "INTEGER");
  // Progresso do alerta de renovação — por assinatura, não por lead: cada
  // compra vence na sua hora, e uma renovação nasce como uma inscrição NOVA
  // (índice zerado de fábrica), então não precisa de reset manual aqui.
  ensureColumn(d, "telegram_subscriptions", "renewal_step_index", "INTEGER NOT NULL DEFAULT 0");
  // O TRACKEAMENTO foi retirado do produto. A tabela sai junto; as colunas
  // `source_code` de leads e transações ficam, porque o Funil de Vendas usa a
  // origem do tráfego e o deep-link continua gravando-a sem custo.
  d.exec("DROP TABLE IF EXISTS telegram_source_links");
  // Planos: tipo (assinatura recorrente vs pacote/compra única) e o entregável
  // (texto/link enviado ao pagar — o "MEU WHATSAPP" dos pacotes/bônus).
  ensureColumn(d, "telegram_plans", "kind", "TEXT NOT NULL DEFAULT 'subscription'");
  ensureColumn(d, "telegram_plans", "deliverable", "TEXT");
  // Ordem em que os planos aparecem no /start. Sem isto a lista saía na ordem
  // que o SQLite devolvesse, e não dava para pôr a oferta principal em cima.
  ensureColumn(d, "telegram_plans", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  // Plano DESLIGADO some dos botões do bot mas continua no painel, com o
  // histórico de vendas — antes, tirar uma oferta do ar exigia apagá-la.
  ensureColumn(d, "telegram_plans", "active", "INTEGER NOT NULL DEFAULT 1");
  // Cor de destaque do botão na lista: "", green, blue, red. Serve para a
  // oferta principal saltar aos olhos no meio das outras.
  ensureColumn(d, "telegram_plans", "highlight", "TEXT");
  // Botões enviados JUNTO com o entregável (JSON [{text,url}]) — é como o
  // "MEU WHATSAPP" chega clicável em vez de um link solto no texto.
  ensureColumn(d, "telegram_plans", "deliverable_buttons", "TEXT");
  // ORDER BUMP: oferta adicional mostrada DEPOIS de o cliente escolher este
  // plano e ANTES de gerar o PIX. Aceitar soma o valor à mesma cobrança — é
  // uma cobrança só, senão o cliente pagaria dois PIX e um deles ficaria em
  // aberto se ele desistisse no meio.
  ensureColumn(d, "telegram_plans", "bump_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_plans", "bump_name", "TEXT");
  ensureColumn(d, "telegram_plans", "bump_price_cents", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_plans", "bump_text", "TEXT");
  ensureColumn(d, "telegram_plans", "bump_accept_text", "TEXT");
  ensureColumn(d, "telegram_plans", "bump_decline_text", "TEXT");
  ensureColumn(d, "telegram_plans", "bump_media_ids", "TEXT");
  ensureColumn(d, "telegram_plans", "bump_audio_url", "TEXT");
  ensureColumn(d, "telegram_plans", "bump_deliverable", "TEXT");
  ensureColumn(d, "telegram_plans", "bump_deliverable_buttons", "TEXT");
  // Preço em USD do MESMO plano — vazio/0 = esse plano não entra no botão
  // "Not from Brazil?" (pagamento internacional via Stripe). É o valor-base
  // único: qualquer conversão pra outra moeda no futuro parte daqui, não
  // ganha um campo novo por moeda.
  ensureColumn(d, "telegram_plans", "price_usd_cents", "INTEGER");
  // Preço em EURO e LIBRA por plano. O bot cobrava todo estrangeiro em
  // dólar; nos cliques reais do SLT a zona do euro é MAIOR que a dos EUA
  // (Portugal sozinho quase iguala os Estados Unidos). Vazio = cai no dólar,
  // então dá para ligar uma moeda num plano por vez sem tirar os outros do
  // cardápio internacional (ver `precoIntl` em `moedaIntl.ts`).
  // `language_code` CRU do Telegram (ex.: "pt-br", "pt", "en-gb", "it") —
  // vem em todo `from` e é o ÚNICO sinal por pessoa que existe para escolher
  // a moeda da cobrança internacional (o Telegram não diz o país). Ver
  // `moedaPorIdioma` em `moedaIntl.ts`.
  ensureColumn(d, "telegram_users", "language_code", "TEXT");
  ensureColumn(d, "telegram_plans", "price_eur_cents", "INTEGER");
  ensureColumn(d, "telegram_plans", "price_gbp_cents", "INTEGER");
  // Idioma escolhido no menu internacional ("en" | "es"; ausente = português,
  // comportamento de sempre). Fica no USUÁRIO, não só na sessão de compra —
  // é o que faz "a partir daí tudo traduzido" valer permanentemente pra
  // aquele lead.
  ensureColumn(d, "telegram_users", "language", "TEXT");
  // Quando o Telegram foi consultado pela última vez sobre a presença DESTA
  // pessoa no canal VIP. Só existe para bot que o Hot-Dash NÃO opera: nele
  // nenhum update chega pelo webhook, `in_vip` nunca mudava sozinho e não
  // havia assinatura nenhuma para dizer quem é VIP — a tela de Usuários
  // mostrava todo mundo como lead. Ver `runTelegramVipMembershipSync`.
  // NULL = nunca conferido, e é por este campo que a rodada escolhe quem
  // conferir primeiro.
  ensureColumn(d, "telegram_users", "vip_checked_at", "INTEGER");
  // Traduções guardadas da mensagem de pagamento aprovado — geradas por IA
  // (botão "Traduzir", mesmo padrão do "Gerar com IA") e cacheadas, nunca
  // traduzidas ao vivo a cada envio.
  ensureColumn(d, "telegram_bots", "success_message_en", "TEXT");
  ensureColumn(d, "telegram_bots", "success_message_es", "TEXT");
  // A inscrição registra se o bump foi comprado: é o que decide se a entrega
  // inclui o entregável extra, e quanto do valor pago foi dele.
  ensureColumn(d, "telegram_subscriptions", "bump_cents", "INTEGER NOT NULL DEFAULT 0");
  // Qual plano/pacote originou a assinatura pendente (resolve duração/entregável
  // na confirmação do pagamento, corrigindo o antigo default de 30 dias).
  ensureColumn(d, "telegram_subscriptions", "plan_id", "TEXT");
  // Enquete do post (JSON {question, options[]}) — post sem mídia, tipo enquete.
  ensureColumn(d, "posts", "poll", "TEXT");
  // CTA por post: 1 = anexa o botão do VIP no envio; 0 = não; NULL = legado
  // (mantém o comportamento antigo). Usado pelo Método MK (só posts de conversão).
  ensureColumn(d, "posts", "cta", "INTEGER");
  // PARA QUAL WhatsApp o post do VIP convida. Guarda a URL RESOLVIDA (wa.me/…),
  // não o id da conta: a legenda já sai com o link gravado dentro dela, então o
  // post precisa ser um retrato — apagar ou editar a conta depois não pode
  // mudar (nem quebrar) o que já foi agendado. NULL = usa o "WhatsApp particular"
  // do cadastro da modelo, que é como funcionava antes deste campo existir.
  ensureColumn(d, "posts", "wa_link", "TEXT");
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
  // GERAÇÃO AUTOMÁTICA (um interruptor por canal). Ligada, o agendador monta
  // sozinho a programação do dia seguinte, uma vez por dia — assim o canal
  // nunca amanhece vazio e as fotos escolhidas são as que estão na galeria
  // HOJE, não as de duas semanas atrás.
  ensureColumn(d, "telegram_autopost_settings", "vip_auto_generate", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_autopost_settings", "warmup_auto_generate", "INTEGER NOT NULL DEFAULT 0");
  // Quando a geração automática de cada canal rodou pela última vez. É o que
  // segura "uma vez por dia" mesmo com o agendador batendo a cada minuto, e o
  // que faz a rotina se recuperar sozinha: servidor fora do ar na hora marcada,
  // ela roda assim que voltar, em vez de pular o dia.
  ensureColumn(d, "telegram_autopost_settings", "vip_auto_generate_at", "INTEGER");
  ensureColumn(d, "telegram_autopost_settings", "warmup_auto_generate_at", "INTEGER");
  // Quando o operador foi avisado, pela última vez, de que a geração automática
  // deste canal está travada. Separado do `_at` acima de propósito: aquele marca
  // SUCESSO, este marca AVISO — e o agendador bate a cada minuto, então sem um
  // marcador próprio o alerta viraria spam de minuto em minuto.
  ensureColumn(d, "telegram_autopost_settings", "vip_auto_generate_warned_at", "INTEGER");
  ensureColumn(d, "telegram_autopost_settings", "warmup_auto_generate_warned_at", "INTEGER");
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
  // Início do funil de Downsell geral — reiniciado a CADA /start (ao
  // contrário de `created_at`, que é o PRIMEIRO /start pra sempre, usado nas
  // métricas de tempo-até-compra do Funil de Vendas e nunca deve mudar). Se
  // o lead some e volta a dar /start dias depois, o funil conta de novo a
  // partir de agora, não do primeiro contato. Nulo = lead de antes desta
  // coluna existir; o código cai pra `created_at` nesse caso.
  ensureColumn(d, "telegram_leads", "downsell_started_at", "INTEGER");
  ensureColumn(d, "transactions", "source_code", "TEXT");
  // De ONDE veio a cobrança: 'bot' (bot de vendas do Telegram), 'ltv' (agente
  // de LTV, no WhatsApp ou no chip do Telegram) ou 'painel' (lançada à mão).
  // Existe para separar os dois funis: o Funil de Vendas mede o bot, e misturar
  // o PIX do LTV nele estragava as duas taxas de conversão — o LTV soma PIX que
  // nunca passou por um /start. Linha antiga fica NULL: não dá para adivinhar a
  // origem, e o comportamento de antes (contar tudo) é o que ela preserva.
  ensureColumn(d, "transactions", "origin", "TEXT");
  // QUAL bot do Telegram gerou a cobrança — com uma conta operando várias
  // modelos, cada uma com seu próprio bot, sem isso o Financeiro não tinha
  // como separar "veio do bot de vendas de qual modelo" de forma direta
  // (profile_id já dá isso hoje, mas indiretamente; este campo existe para
  // a coluna "Bot" da tela e para distinguir venda de bot de venda do
  // LTV/lançada à mão, que ficam sem bot mesmo). Linha antiga fica NULL.
  ensureColumn(d, "transactions", "bot_id", "TEXT");

  // O relatório do Canal de Vendas traz 17 campos; até agora só 5 eram
  // guardados. Os demais são exatamente o que faltava para uma venda de bot
  // operado por fora ficar tão completa quanto uma do próprio Hot-Dash:
  // método e valor (que o gateway às vezes não manda), o código do deep-link
  // que trouxe o lead (é o que faz essa venda aparecer no Funil), o idioma
  // (que decide a moeda), o nome do cliente e o @ do bot — este último é a
  // única pista de QUEM é o bot quando o "ID Bot" não bate com nenhum token
  // cadastrado. Ver `parseSalesReportMessage`.
  ensureColumn(d, "external_sale_reports", "customer_name", "TEXT");
  ensureColumn(d, "external_sale_reports", "bot_username", "TEXT");
  ensureColumn(d, "external_sale_reports", "language", "TEXT");
  ensureColumn(d, "external_sale_reports", "category", "TEXT");
  ensureColumn(d, "external_sale_reports", "duration_label", "TEXT");
  ensureColumn(d, "external_sale_reports", "amount_cents", "INTEGER");
  ensureColumn(d, "external_sale_reports", "currency", "TEXT");
  ensureColumn(d, "external_sale_reports", "method", "TEXT");
  ensureColumn(d, "external_sale_reports", "source_code", "TEXT");
  // Id da transação no sistema de ORIGEM (o "ID Transação Interna" dele) —
  // não é o nosso id nem o do gateway; serve para o operador conferir os dois
  // lados quando precisar reclamar de uma venda com quem opera o bot.
  ensureColumn(d, "external_sale_reports", "external_tx_id", "TEXT");
  // "Origem" no relatório é O PASSO DO FUNIL que fechou a venda ("Downsell 4 ·
  // ...") — só aparece quando foi uma recuperação que converteu. É a única
  // forma de saber, numa venda de bot operado por fora, se ela veio do
  // primeiro contato ou de um resgate.
  ensureColumn(d, "external_sale_reports", "funnel_step", "TEXT");
  // Quanto tempo o lead levou entre a cobrança gerada e o pagamento, em
  // segundos (o relatório escreve "0d 0h 23m 53s").
  ensureColumn(d, "external_sale_reports", "conversion_seconds", "INTEGER");
  // Oferta do MAILING que originou a venda (nome/preço/duração ajustados só
  // para aquele disparo). Quando presente, manda na confirmação do pagamento
  // no lugar do plano original.
  ensureColumn(d, "telegram_subscriptions", "offer_id", "TEXT");
  // Código copia-e-cola do PIX desta cobrança. Guardado porque os botões
  // "Mostrar QR Code" e "Copiar Chave Pix" precisam dele DEPOIS que a mensagem
  // já foi enviada — sem isso o cliente teria de pedir um PIX novo só para ver
  // o QR, gerando cobrança duplicada.
  ensureColumn(d, "telegram_subscriptions", "pix_code", "TEXT");
  // REMOÇÃO DO VIP PENDENTE. Quando o bot não consegue tirar do grupo alguém
  // cujo prazo venceu (o caso real é ele não ser mais admin), a saída fica
  // marcada aqui e o sistema RETENTA sozinho — tirar do VIP é trabalho dele,
  // não do operador. `attempts` cresce a espera entre as tentativas, para não
  // martelar a API a cada minuto; `notified` garante um aviso só, e não um por
  // tentativa.
  ensureColumn(d, "telegram_subscriptions", "removal_pending", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_subscriptions", "removal_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_subscriptions", "last_removal_at", "INTEGER");
  ensureColumn(d, "telegram_subscriptions", "removal_notified", "INTEGER NOT NULL DEFAULT 0");
  // MAILING: mídia ESCOLHIDA a dedo (JSON de ids da Galeria, em ordem) e áudio,
  // como no resto do bot. As etiquetas continuam na coluna antiga, lidas só
  // como legado — ver lib/telegramSend.ts.
  ensureColumn(d, "telegram_mailings", "media_ids", "TEXT");
  ensureColumn(d, "telegram_mailings", "media_mode", "TEXT NOT NULL DEFAULT 'album'");
  ensureColumn(d, "telegram_mailings", "audio_url", "TEXT");
  // CAIXINHA: o tema/persona daquela leva ("massagista morena de 20 anos"). É o
  // que mais muda o resultado, então fica gravado em cada ideia — sem isso a
  // lista mistura personagens e não dá para saber qual pediu o quê.
  ensureColumn(d, "question_box_items", "theme", "TEXT");
  // Duração estimada do vídeo, em segundos. Quem monta o dia de stories precisa
  // saber se a ideia é de 8s ou de 40s antes de gravar — é o que decide quantas
  // cabem na sequência.
  ensureColumn(d, "question_box_items", "seconds", "INTEGER");
  ensureColumn(d, "ltv_agent_settings", "max_discount_pct", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "ltv_agent_settings", "sample_media_ids", "TEXT");
  ensureColumn(d, "ltv_orders", "list_price_cents", "INTEGER");
  ensureColumn(d, "ltv_chats", "peer_access_hash", "TEXT");
  ensureColumn(d, "ltv_accounts", "provider_ref", "TEXT");
  // RETOMAR QUEM SUMIU: quantas vezes já mandamos uma mensagem espontânea
  // pra puxar de volta um lead que parou de responder, SEM ele ter falado
  // de novo — zera sozinho assim que ele responde (ver `insertMessage`).
  // Existe pra ter um teto (`runLtvReengajamento` não insiste pra sempre).
  ensureColumn(d, "ltv_chats", "reengage_count", "INTEGER NOT NULL DEFAULT 0");
  // Liga/desliga da retomada espontânea, por CONTA — desligado por padrão:
  // mandar mensagem sem o lead ter falado primeiro é o tipo de automação
  // que mais derruba conta no WhatsApp/Telegram, então é opt-in consciente
  // (mesmo espírito do "Só responder quem falar primeiro").
  ensureColumn(d, "ltv_agent_settings", "reengage_enabled", "INTEGER NOT NULL DEFAULT 0");
  // Liga/desliga do botão "Not from Brazil?" (checkout internacional via
  // Stripe), independente de haver plano com preço em USD cadastrado — antes
  // só existia o critério implícito (aparece se algum plano tem priceUsdCents),
  // sem controle nem visibilidade nenhuma em Configurações. Padrão LIGADO:
  // preserva o comportamento de sempre pra quem já tinha preço em USD.
  ensureColumn(d, "telegram_bots", "intl_enabled", "INTEGER NOT NULL DEFAULT 1");
  // Por PLANO: entra ou não na venda internacional. Continua exigindo preço em
  // USD cadastrado (isso não muda) — este campo é o CONTROLE A MAIS, pra tirar
  // um plano específico da lista sem apagar o preço dele. Padrão LIGADO:
  // preserva o comportamento de sempre (todo plano com preço em USD entrava).
  ensureColumn(d, "telegram_plans", "intl_available", "INTEGER NOT NULL DEFAULT 1");
  // ASSINATURA STRIPE COM RENOVAÇÃO AUTOMÁTICA (checkout internacional).
  // Só preenchidos quando a compra virou `mode: "subscription"` na Stripe —
  // é a presença de `stripe_subscription_id` que diferencia "essa inscrição
  // se renova sozinha" de "PIX/pagamento avulso", inclusive pro Alerta de
  // Renovação saber quem NÃO precisa mais do aviso manual (telegramCron.ts).
  ensureColumn(d, "telegram_subscriptions", "stripe_subscription_id", "TEXT");
  ensureColumn(d, "telegram_subscriptions", "stripe_customer_id", "TEXT");
  d.exec(
    `CREATE INDEX IF NOT EXISTS idx_tg_subs_stripe_sub ON telegram_subscriptions(stripe_subscription_id)`,
  );
  // PERSONA UNIFICADA: sai do LTV (por conta), passa a morar só no cadastro
  // da modelo. `tone_tags` substitui `bio_personality` (rádio de 3 opções
  // vira chips multi-select, mesma ideia do Tom que já existia só no LTV);
  // `limits` é campo novo, nasce preenchido com um texto genérico (ver
  // `backfillPersonaDoLtv`) em vez de vazio.
  ensureColumn(d, "profiles", "tone_tags", "TEXT");
  ensureColumn(d, "profiles", "limits", "TEXT");
  // MODO INTERNACIONAL BILÍNGUE: com `intl_ask_first` ligado, o /start
  // pergunta Brasil/International ANTES de mostrar qualquer coisa (em vez do
  // botão "Not from Brazil?" no meio do funil). `accept_card_br` é
  // independente — libera um botão a mais pro brasileiro pagar no cartão
  // (Stripe, em BRL) depois da lista de planos em PIX. As mensagens `*_en`/
  // `*_es` são traduções GRAVADAS (mesmo padrão de `success_message_en/es`,
  // que já existem) — populadas sozinhas a cada save do texto em PT (ver
  // `/api/telegram` route), editáveis por cima manualmente.
  ensureColumn(d, "telegram_bots", "intl_ask_first", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_bots", "accept_card_br", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "telegram_bots", "welcome_message_en", "TEXT");
  ensureColumn(d, "telegram_bots", "welcome_message_es", "TEXT");
  ensureColumn(d, "telegram_bots", "success_button_text_en", "TEXT");
  ensureColumn(d, "telegram_bots", "success_button_text_es", "TEXT");
  ensureColumn(d, "telegram_bots", "pix_social_proof_text_en", "TEXT");
  ensureColumn(d, "telegram_bots", "pix_social_proof_text_es", "TEXT");
  // Nome do plano em inglês — usado no teclado do checkout internacional e
  // no downsell quando o lead está em en/es. Vazio cai no nome em PT (mesmo
  // fallback dos outros campos `*_en`).
  ensureColumn(d, "telegram_plans", "name_en", "TEXT");
  // Qual mídia da Galeria virou aquela amostra/áudio enviado — sem isso não dá
  // pra saber quais prévias um lead JÁ viu, e a IA repetia a mesma foto (ver
  // `amostrasEnviadas`/`sortearAmostra` no motor do LTV).
  ensureColumn(d, "ltv_messages", "media_id", "TEXT");
  // Botões do checkout no cartão (Stripe, internacional ou "Aceitar cartão no
  // Brasil"): antes eram texto fixo ("Make payment"/"Pagar", "Check payment
  // status"/"Verificar status") direto no código do webhook. Agora dá pra
  // editar (mesmo padrão *_en/*_es dos campos vizinhos) e pra esconder o
  // botão de verificar status, quando a modelo preferir deixar só o link.
  ensureColumn(d, "telegram_bots", "checkout_generating_message", "TEXT");
  ensureColumn(d, "telegram_bots", "checkout_pay_button_text", "TEXT");
  ensureColumn(d, "telegram_bots", "checkout_pay_button_text_en", "TEXT");
  ensureColumn(d, "telegram_bots", "checkout_pay_button_text_es", "TEXT");
  ensureColumn(d, "telegram_bots", "checkout_check_button_text", "TEXT");
  ensureColumn(d, "telegram_bots", "checkout_check_button_text_en", "TEXT");
  ensureColumn(d, "telegram_bots", "checkout_check_button_text_es", "TEXT");
  ensureColumn(d, "telegram_bots", "checkout_show_check_button", "INTEGER NOT NULL DEFAULT 1");
  // GRUPO DE VENDAS: canal (grupo/canal do Telegram) OPCIONAL, ao lado do
  // VIP e das Prévias, onde o bot dispara um relatório de cada venda
  // aprovada (ver `buildSalesReportMessage` em `lib/payments/deliverPayment.ts`).
  // Ao contrário de `id_vip`/`id_aquecimento`, não é obrigatório: sem ele
  // configurado, o bot simplesmente não manda o relatório — o resto da
  // entrega (acesso do cliente) nunca depende disto.
  ensureColumn(d, "telegram_bots", "id_vendas", "TEXT");
  // Assinatura no cartão vira renovação automática sozinha por padrão
  // (default 1 = liga pra quem já tinha isso acontecendo sem escolher).
  // Desligado, toda cobrança no cartão vira avulsa — mesmo plano de
  // assinatura, o Alerta de Renovação cobra o próximo ciclo na mão.
  ensureColumn(d, "telegram_bots", "accept_card_recurring", "INTEGER NOT NULL DEFAULT 1");
  // ESCOLHA DE MÉTODO ("Você escolheu o plano X — como prefere pagar?"), a
  // tela que entra entre escolher o item e gerar a cobrança. Substitui o botão
  // solto "Prefere pagar no cartão?" que ia depois dos planos e reabria a
  // lista inteira — ver `enviarEscolhaDeMetodo` no webhook do bot.
  ensureColumn(d, "telegram_bots", "payment_choice_message", "TEXT");
  ensureColumn(d, "telegram_bots", "payment_choice_btn_pix", "TEXT");
  ensureColumn(d, "telegram_bots", "payment_choice_btn_card", "TEXT");
  // Pergunta Brasil/International (modo bilíngue, `intl_ask_first`) —
  // mensagem e texto dos 2 botões editáveis, em vez de fixos no código.
  // Vazio cai no texto padrão (ver `enviarPerguntaOrigem` no webhook).
  ensureColumn(d, "telegram_bots", "origin_gate_message", "TEXT");
  ensureColumn(d, "telegram_bots", "origin_gate_btn_br", "TEXT");
  ensureColumn(d, "telegram_bots", "origin_gate_btn_intl", "TEXT");
  // `page_id` (junção estável com `slt_page_profiles`, mais confiável que o
  // slug) entrou depois de `slt_events` já estar em bancos existentes —
  // sem este ensureColumn, quem já tinha a tabela ficava com INSERT
  // quebrado ("has no column named page_id") pra sempre, mesmo com a
  // coluna no CREATE TABLE lá em cima (que só roda pra tabela nova). O
  // índice correspondente também só pode nascer DEPOIS da coluna existir.
  ensureColumn(d, "slt_events", "page_id", "TEXT");
  d.exec(`CREATE INDEX IF NOT EXISTS idx_slt_events_page_id ON slt_events(page_id)`);
  // Sessão do SLT pra cada evento — o mesmo carregamento de página costuma
  // mandar VÁRIOS "page_viewed" (troca de aba, reload do navegador embutido
  // do Instagram/TikTok, pré-visualização de link), e sem isso a contagem
  // somava cada ping como uma visualização nova: bem mais alto que o
  // "Views" que a própria SLT mostra no painel dela. Com a sessão gravada,
  // `sltPageStats`/`sltViewsClicks` contam visualização por SESSÃO única,
  // não por ping — já os cliques continuam por evento (conferido contra
  // `/v1/summary` da SLT: bateu praticamente 1 a 1, sem esse problema).
  ensureColumn(d, "slt_events", "session_id", "TEXT");
  // Id do PopLink (o link curto igpopl.ink, que manda direto para o destino
  // sem passar por página nenhuma). O evento dele já vinha com `poplink_slug`
  // gravado; o id não. Sem ele, casar o clique com o PopLink do catálogo só
  // dava pelo apelido — e apelido o operador renomeia, o que desligaria o
  // histórico do link em silêncio. Com o id, o casamento é exato; o apelido
  // fica de reserva para o que já está gravado sem ele.
  ensureColumn(d, "slt_events", "poplink_id", "TEXT");
  d.exec(`CREATE INDEX IF NOT EXISTS idx_slt_events_poplink ON slt_events(poplink_id)`);
  ensureSltPageProfilesSchema(d);
  ensureDefaultSltNetworks(d);
  ensurePostNetworksAccountId(d);
  ensureDefaultProfileStatuses(d);
  backfillSyncPayAmounts(d);
  backfillMensagensPadrao(d);
  backfillRenewalFunnel(d);
  backfillConfigPorModelo(d);
  backfillTelegramUsers(d);
  backfillMediaPostLog(d);
  migrarWhatsappParaLtv(d);
  marcarOrigemDasCobrancasDoLtv(d);
  backfillPersonaDoLtv(d);
  limparNotaDasLegendasAgendadas(d);

  d.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_media_public_token ON media(public_token) WHERE public_token IS NOT NULL;`,
  );
}

/**
 * Leva o LTV do WhatsApp para as tabelas `ltv_*`, que valem para os dois
 * canais. Roda uma vez só: a partir daí as `whatsapp_*` ficam paradas, e são
 * elas que guardam a operação que já estava no ar — conversa, prompt e
 * instância conectada. Perder isso seria a modelo "esquecendo" os leads.
 *
 * Cada modelo vira uma conta de WhatsApp rotulada "Número 1"; o multi-número
 * nasce daí, adicionando linhas novas. Uma modelo que só tem conversa e nunca
 * conectou instância também ganha a conta (sem `external_ref`) — é o "Número 1
 * · sem número" da tela, e sem ela a conversa dela ficaria órfã.
 */
/**
 * Carimba `origin = 'ltv'` nas cobranças que o agente de LTV já tinha criado
 * antes de a coluna existir.
 *
 * Dá para descobrir com precisão quais são: toda cobrança do LTV nasce junto de
 * um `ltv_orders`, que guarda o `transaction_id`. O resto (bot de vendas e
 * lançamento manual no painel) fica NULL — não há como distinguir um do outro
 * retroativamente, e NULL é justamente o que mantém essas linhas contando no
 * Funil de Vendas como contavam antes.
 *
 * Roda uma vez só; depois disso quem grava a origem é o `recordTransaction`.
 */
function marcarOrigemDasCobrancasDoLtv(d: Database.Database) {
  const MARCA = "ltv_origem_transacoes_v1";
  const jaRodou = d.prepare("SELECT value FROM settings WHERE key = ?").get(MARCA);
  if (jaRodou) return;

  d.prepare(
    `UPDATE transactions
        SET origin = 'ltv'
      WHERE origin IS NULL
        AND id IN (SELECT transaction_id FROM ltv_orders WHERE transaction_id IS NOT NULL)`,
  ).run();

  d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    MARCA,
    String(Date.now()),
  );
}

/**
 * PERSONA UNIFICADA: a persona pra IA (nome, tom, personalidade, mecanismo/
 * história, limites) deixa de ser editada por CONTA de LTV e passa a morar
 * só no cadastro da modelo (`profiles`) — o `ltvAgent.ts` lê de lá a partir
 * de agora (ver `getAgent` em `lib/ltvDb.ts`).
 *
 * Roda UMA VEZ: quando um perfil tem conteúdo nos dois lugares (o
 * cadastro E alguma conta de LTV), o conteúdo do LTV VENCE — na prática é
 * o mais completo, porque nasceu semeado do cadastro (`semearPeloCadastro`,
 * que existia até esta migração) e depois foi enriquecido por cima ali.
 * Perfil com mais de uma conta de LTV divergente: fica com a conta de MAIS
 * conteúdo (soma do tamanho de personalidade+mecanismo+limites) — critério
 * simples e determinístico, não dá pra "mesclar" texto livre.
 *
 * Duplica a conversão santinha/safadinha/explícita → chip de Tom e o texto
 * padrão de Limites em vez de importar de `ltvDb.ts`/`profiles.ts`: mesmo
 * motivo de sempre neste arquivo (evitar import circular com quem chama
 * `getDb()`).
 */
function backfillPersonaDoLtv(d: Database.Database) {
  const MARCA = "persona_migrada_do_ltv_v1";
  const jaRodou = d.prepare("SELECT value FROM settings WHERE key = ?").get(MARCA);
  if (jaRodou) return;

  const LIMITS_PADRAO =
    "## REGRAS INEGOCIÁVEIS E LIMITES ESTRITOS DA IA:\n" +
    "- NUNCA diga, sugira ou deixe transparecer que você é uma Inteligência Artificial, um bot, um assistente virtual, um sistema automatizado ou uma equipe de atendimento.\n" +
    '- NUNCA mencione palavras de sistema como "prompt", "diretrizes", "IA", "modelo de linguagem", "atualização" ou "desenvolvedor".\n' +
    "- A ilusão de realidade deve ser mantida 100% do tempo: para o lead, quem está digitando e enviando as fotos do outro lado da tela é a própria modelo.\n" +
    "- NUNCA marque ou prometa encontros presenciais. Se o lead insistir muito, diga que seu momento agora é curtir a liberdade online e que você é muito seletiva para a vida real.\n" +
    "- NUNCA prometa conteúdos, fetiches ou pacotes que não estão na sua lista oficial de produtos. Trabalhe apenas com o que você tem disponível no catálogo.\n" +
    "- NUNCA implore por vendas ou demonstre desespero financeiro (pedindo dinheiro por emergência, contas a pagar, etc.). Você vende conteúdo por prazer e vaidade, não por necessidade básica.\n" +
    "- NUNCA perca a postura. Mesmo ao dar foras ou cortes, mantenha a educação e a classe.";

  const tomDoAntigo = (bioPersonality: string | null): string[] => {
    if (bioPersonality === "santinha") return ["Santinha"];
    if (bioPersonality === "safadinha") return ["Safada"];
    if (bioPersonality === "explicita") return ["Explícita"];
    return [];
  };

  const perfis = d
    .prepare("SELECT id, bio_physical, bio_unique, bio_personality, tone_tags, limits FROM profiles")
    .all() as {
    id: string;
    bio_physical: string | null;
    bio_unique: string | null;
    bio_personality: string | null;
    tone_tags: string | null;
    limits: string | null;
  }[];

  const contasStmt = d.prepare(
    `SELECT s.personality, s.mechanism, s.tone_tags, s.limits
       FROM ltv_accounts a JOIN ltv_agent_settings s ON s.account_id = a.id
      WHERE a.profile_id = ?`,
  );

  const atualiza = d.prepare(
    "UPDATE profiles SET bio_physical = ?, bio_unique = ?, tone_tags = ?, limits = ? WHERE id = ?",
  );

  for (const p of perfis) {
    const contas = contasStmt.all(p.id) as {
      personality: string | null;
      mechanism: string | null;
      tone_tags: string | null;
      limits: string | null;
    }[];

    let melhor: (typeof contas)[number] | null = null;
    let melhorPontos = 0;
    for (const c of contas) {
      const pontos = (c.personality?.length || 0) + (c.mechanism?.length || 0) + (c.limits?.length || 0);
      if (pontos > melhorPontos) {
        melhorPontos = pontos;
        melhor = c;
      }
    }

    let bioPhysical = p.bio_physical;
    let bioUnique = p.bio_unique;
    let toneTags: string[] = [];
    let limits = p.limits;

    if (melhor) {
      if (melhor.personality?.trim()) bioPhysical = melhor.personality;
      if (melhor.mechanism?.trim()) bioUnique = melhor.mechanism;
      if (melhor.limits?.trim()) limits = melhor.limits;
      try {
        const parsed = JSON.parse(melhor.tone_tags || "[]");
        if (Array.isArray(parsed)) toneTags = parsed.filter((t) => typeof t === "string");
      } catch {
        /* config antiga/corrompida: melhor sem tom do que travar a migração */
      }
    }

    if (toneTags.length === 0) toneTags = tomDoAntigo(p.bio_personality);
    if (!limits || !limits.trim()) limits = LIMITS_PADRAO;

    atualiza.run(bioPhysical, bioUnique, JSON.stringify(toneTags), limits, p.id);
  }

  d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    MARCA,
    String(Date.now()),
  );
}

function migrarWhatsappParaLtv(d: Database.Database) {
  const jaRodou = d
    .prepare("SELECT value FROM settings WHERE key = 'ltv_migracao_whatsapp_v1'")
    .get() as { value: string } | undefined;
  if (jaRodou) return;

  const agora = Date.now();

  // 1) Contas: uma por modelo que tenha instância OU conversa OU configuração.
  d.prepare(
    `INSERT OR IGNORE INTO ltv_accounts
       (id, profile_id, channel, label, external_ref, status, active, created_at, updated_at)
     SELECT 'wa-' || p.id, p.id, 'whatsapp', 'Número 1',
            i.instance_name, COALESCE(i.status, 'disconnected'), 1,
            COALESCE(i.created_at, ?), ?
       FROM profiles p
       LEFT JOIN whatsapp_instances i ON i.profile_id = p.id
      WHERE i.profile_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM whatsapp_chats c WHERE c.profile_id = p.id)
         OR EXISTS (SELECT 1 FROM whatsapp_agent_settings a WHERE a.profile_id = p.id)`,
  ).run(agora, agora);

  // 2) Configuração do agente. O `prompt` cru vira a PERSONALIDADE — é o campo
  //    que o motor novo usa como descrição livre da modelo. Os campos
  //    estruturados (tom, mecanismo, limites) nascem vazios para a pessoa
  //    preencher; o provedor de IA sai de cena porque o LTV roda em Grok.
  d.prepare(
    `INSERT OR IGNORE INTO ltv_agent_settings
       (account_id, enabled, approach, personality)
     SELECT 'wa-' || a.profile_id, 1, 'aquecer', a.prompt
       FROM whatsapp_agent_settings a
      WHERE EXISTS (SELECT 1 FROM ltv_accounts c WHERE c.id = 'wa-' || a.profile_id)`,
  ).run();

  // 3) Conversas e mensagens.
  d.prepare(
    `INSERT OR IGNORE INTO ltv_chats
       (id, account_id, peer_ref, state, last_interaction_at, created_at)
     SELECT c.id, 'wa-' || c.profile_id, c.remote_jid, c.state,
            c.last_interaction_at, c.created_at
       FROM whatsapp_chats c
      WHERE EXISTS (SELECT 1 FROM ltv_accounts a WHERE a.id = 'wa-' || c.profile_id)`,
  ).run();

  d.prepare(
    `INSERT OR IGNORE INTO ltv_messages (id, chat_id, role, content, type, created_at)
     SELECT m.id, m.chat_id, m.role, m.content, COALESCE(m.type, 'text'), m.created_at
       FROM whatsapp_messages m
      WHERE EXISTS (SELECT 1 FROM ltv_chats c WHERE c.id = m.chat_id)`,
  ).run();

  d.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('ltv_migracao_whatsapp_v1', ?)",
  ).run(String(agora));
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
  // "Venda (webhook)". Vira VAZIO, não "Venda SyncPay": a coluna é PRODUTO, e
  // repetir ali o nome do provedor (que já tem coluna própria) ocupava o lugar
  // do nome de verdade. Vazio a tela mostra "—", e o relatório do Canal de
  // Vendas preenche quando chegar (ver `registrarRelatorioExterno`).
  d.prepare("UPDATE transactions SET description = NULL WHERE description = 'Venda (webhook)'").run();
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
/**
 * Troca as mensagens PLACEHOLDER dos bots que já existiam pelos textos padrão.
 *
 * Os bots antigos nasceram com "Bem-vindo" e "Aprovado" — literalmente essas
 * palavras. A de aprovação é a grave: sem {link_vip} e sem texto de botão, o
 * cliente pagava e recebia "Aprovado", sem caminho nenhum para o grupo. Os
 * padrões decentes chegaram depois, mas só valiam para bot NOVO, então quem já
 * estava no ar continuou com o placeholder.
 *
 * A troca só acontece quando o texto é EXATAMENTE o placeholder: qualquer
 * mensagem escrita pelo operador fica intacta.
 */
function backfillMensagensPadrao(d: Database.Database) {
  const BEM_VINDO =
    "Oi meu amor 😈\n\nSeja bem-vindo! Aqui embaixo estão as opções pra você entrar no meu VIP e ver tudo o que eu não posso postar por aí 🔥\n\nEscolhe a sua e vem 👇";
  const APROVADO = "✅ Pagamento aprovado meu amor! Acesse o Canal VIP aqui:\n\n🔗 {link_vip}";
  const BOTAO = "🔒 Acessar Conteúdo";

  d.prepare(
    `UPDATE telegram_bots SET welcome_message = ?
      WHERE TRIM(welcome_message) IN ('Bem-vindo', 'Bem vindo', 'Bem-vindo!', '')`,
  ).run(BEM_VINDO);

  d.prepare(
    `UPDATE telegram_bots SET success_message = ?
      WHERE TRIM(success_message) IN ('Aprovado', 'Aprovado!', '')`,
  ).run(APROVADO);

  // Sem rótulo de botão, o acesso ia só como URL solta no texto. Campo vazio
  // hoje significa "usa o rótulo padrão" (buildAccessMessage sempre monta o
  // botão), então preenchê-lo só torna visível na tela o que já acontece no
  // envio — por isso não faz mal isto rodar de novo a cada inicialização.
  d.prepare(
    `UPDATE telegram_bots SET success_button_text = ?
      WHERE success_button_text IS NULL OR TRIM(success_button_text) = ''`,
  ).run(BOTAO);
}

/**
 * ALERTA DE RENOVAÇÃO — pré-carrega a sequência padrão (1 dia, 18h, 12h, 6h,
 * 1h, 20min e 5min antes de vencer, desconto subindo de 0% a 50%) em toda
 * modelo que já existia antes deste funil nascer, e já liga o alerta.
 *
 * Duplicado de `RENEWAL_DEFAULT_STEPS` (lib/telegramDb.ts) em vez de
 * importado de lá: telegramDb.ts importa `getDb` DESTE arquivo, e o import
 * inverso criaria um ciclo — mesmo motivo pelo qual `backfillMensagensPadrao`
 * acima duplica `MESSAGE_DEFAULTS` em vez de importar.
 *
 * Sem marca de "já rodei" em `settings`: só entra em quem está com o campo
 * VAZIO, e depois da primeira vez ninguém mais fica vazio (bot novo já nasce
 * com a sequência, ver `save-credentials` em app/api/telegram/route.ts) — não
 * faz mal rodar nas inicializações seguintes, mesmo espírito do botão de
 * acesso logo acima.
 */
function backfillRenewalFunnel(d: Database.Database) {
  const PASSOS = JSON.stringify([
    {
      delayMinutes: 1440,
      discountPercent: 0,
      text: "Oi {nome} 😘 Passando pra avisar que seu VIP vence AMANHÃ. Não queria te perder logo agora que a gente tava se conhecendo... dá uma olhada nos planos e renova pra continuar aqui comigo 💕",
    },
    {
      delayMinutes: 1080,
      discountPercent: 0,
      text: "{nome}, faltam só 18 horinhas pro seu acesso vencer 👀 Ainda dá tempo de renovar tranquilo, sem correria. Não some não 🥺",
    },
    {
      delayMinutes: 720,
      discountPercent: 20,
      text: "Amor, seu VIP vence em 12 horas! 🔥 Separei 20% de desconto só pra você renovar agora e continuar vendo tudo que eu posto. Corre que é por tempo limitado 😈",
    },
    {
      delayMinutes: 360,
      discountPercent: 30,
      text: "{nome}, faltam só 6 horas e seu acesso cai fora 😱 Consegui liberar 30% de desconto pra você não perder — não vou fazer isso sempre viu, aproveita agora",
    },
    {
      delayMinutes: 60,
      discountPercent: 30,
      text: "ÚLTIMA HORA, {nome}! ⏰ Em breve você perde o acesso a tudo que eu posto aqui. Ainda dá tempo de renovar com 30% off, não deixa acabar assim 🥵",
    },
    {
      delayMinutes: 20,
      discountPercent: 40,
      text: "{nome}, faltam só 20 minutinhos e seu VIP vence 😰 Subi o desconto pra 40% AGORA, é a sua última chance antes de sair do grupo. Corre comigo 🔥",
    },
    {
      delayMinutes: 5,
      discountPercent: 50,
      text: "ÚLTIMOS 5 MINUTOS!!! 🚨 {nome}, não perde tudo por bobeira — renova AGORA com 50% de desconto, o maior que eu dou. Depois que vencer não tem mais volta 💔",
    },
  ]);

  d.prepare(
    `UPDATE telegram_bots SET renewal_funnel = ?, renewal_enabled = 1
      WHERE renewal_funnel IS NULL OR TRIM(renewal_funnel) = ''`,
  ).run(PASSOS);
}

/**
 * Leva o preço dinâmico e as cores dos botões da configuração GLOBAL para o
 * bot de cada modelo.
 *
 * Roda uma vez só (marca `bot_config_por_modelo` em settings). Sem isto, quem
 * já tinha ligado o preço dinâmico ou escolhido cores veria tudo voltar ao
 * padrão depois da atualização — a configuração não sumiria do banco, mas
 * deixaria de ser lida, que na prática é a mesma coisa.
 */
function backfillConfigPorModelo(d: Database.Database) {
  const feito = d.prepare("SELECT value FROM settings WHERE key = ?").get("bot_config_por_modelo");
  if (feito) return;

  const ler = (chave: string) => {
    const row = d.prepare("SELECT value FROM settings WHERE key = ?").get(chave) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  };

  const preco = ler("dynamic_price");
  if (preco && typeof preco === "object") {
    const cents = Number(preco.cents);
    d.prepare(
      `UPDATE telegram_bots SET dynamic_price_enabled = ?, dynamic_price_cents = ?,
              dynamic_price_direction = ?`,
    ).run(
      preco.enabled ? 1 : 0,
      Number.isFinite(cents) && cents >= 1 ? Math.min(Math.floor(cents), 100) : 9,
      preco.direction === "up" || preco.direction === "down" ? preco.direction : "random",
    );
  }

  const cores = ler("button_styles");
  if (cores && typeof cores === "object" && Object.keys(cores).length > 0) {
    d.prepare("UPDATE telegram_bots SET button_styles = ?").run(JSON.stringify(cores));
  }

  d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "bot_config_por_modelo",
    JSON.stringify({ migradoEm: Date.now() }),
  );
}

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
  // 1) Conserta, UMA ÚNICA VEZ, o que a primeira versão desta migração
  //    duplicou. Lá o registro do envio usava id aleatório e o do backfill, id
  //    determinístico: o `INSERT OR IGNORE` não reconhecia que era o MESMO
  //    envio e somava uma linha a cada reinício do servidor.
  //
  //    A limpeza PRECISA ser única. Ela colapsa tudo em uma linha por (post,
  //    mídia, grupo), o que era verdade quando um post só podia sair uma vez —
  //    mas não é: o calendário permite voltar um post publicado para
  //    "agendado" e o autopost o envia de novo. Rodando em todo boot, esta
  //    limpeza apagava justamente esses re-envios legítimos e a galeria voltava
  //    a mostrar ×1 para uma foto que já tinha saído várias vezes.
  const jaLimpou = d
    .prepare("SELECT value FROM settings WHERE key = 'media_post_log_dedup_v1'")
    .get() as { value: string } | undefined;
  if (!jaLimpou) {
    d.prepare(
      `DELETE FROM media_post_log
        WHERE post_id IS NOT NULL
          AND rowid NOT IN (
            SELECT MIN(rowid) FROM media_post_log
             WHERE post_id IS NOT NULL
             GROUP BY post_id, media_id, audience)`,
    ).run();
    d.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('media_post_log_dedup_v1', ?)",
    ).run(String(Date.now()));
  }

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
 * Semeia o cadastro de redes de tráfego do SLT com as opções que já
 * existiam como lista fixa no código (mesmas "key", para toda página já
 * classificada continuar valendo sem reatribuir nada) — o operador adiciona
 * o resto pela tela (Configurações → Links da Bio). Só roda se a tabela
 * estiver vazia (idempotente); "INSERT OR IGNORE" cobre também o caso de
 * rodar duas vezes antes da primeira leitura confirmar `c > 0`.
 */
function ensureDefaultSltNetworks(d: Database.Database) {
  const { c } = d.prepare("SELECT COUNT(*) c FROM slt_networks").get() as { c: number };
  if (c > 0) return;
  const now = Date.now();
  const insert = d.prepare(
    "INSERT OR IGNORE INTO slt_networks (id, key, label, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const padrao: [string, string][] = [
    ["instagram", "Instagram"],
    ["facebook", "Facebook"],
    ["telegram", "Telegram"],
    ["tiktok", "TikTok"],
    ["ads", "Anúncios"],
    ["outro", "Outro"],
  ];
  padrao.forEach(([key, label], i) => insert.run(randomUUID(), key, label, i, now));
}

/**
 * Bancos criados antes de `traffic_source` existir têm `profile_id NOT
 * NULL` — constraint que o SQLite também não relaxa com `ALTER TABLE` (só
 * adiciona coluna). Recria a tabela preservando as linhas existentes, com
 * `traffic_source` vazio nelas. Idempotente: só roda se a coluna ainda não
 * existir.
 */
function ensureSltPageProfilesSchema(d: Database.Database) {
  const cols = d.prepare(`PRAGMA table_info(slt_page_profiles)`).all() as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === "traffic_source")) return;
  d.exec(`
    CREATE TABLE slt_page_profiles_new (
      page_id        TEXT PRIMARY KEY,
      profile_id     TEXT REFERENCES profiles(id) ON DELETE CASCADE,
      traffic_source TEXT,
      updated_at     INTEGER NOT NULL
    );
    INSERT INTO slt_page_profiles_new (page_id, profile_id, traffic_source, updated_at)
      SELECT page_id, profile_id, NULL, updated_at FROM slt_page_profiles;
    DROP TABLE slt_page_profiles;
    ALTER TABLE slt_page_profiles_new RENAME TO slt_page_profiles;
    CREATE INDEX IF NOT EXISTS idx_slt_page_profiles_profile ON slt_page_profiles(profile_id);
  `);
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

/**
 * Tira a nota da IA das legendas AGENDADAS e ainda não publicadas.
 *
 * O envio já limpa a legenda na saída (`telegramCron`), então nada sujo iria ao
 * ar mesmo sem isto. Esta faxina é pelo CALENDÁRIO: o operador abre a agenda,
 * lê "(Primeira palavra: Vem)" no fim de trinta posts e conclui que a correção
 * não pegou. Ver a agenda igual ao que o grupo vai receber é metade do
 * conserto.
 *
 * Só toca em `status = 'scheduled'`: post já publicado é registro do que foi ao
 * ar, e reescrever isso apagaria a prova do defeito. E só grava a linha em que
 * a limpeza mudou alguma coisa e sobrou texto.
 *
 * Roda uma vez só (marca `legendas_sem_nota` em settings).
 */
function limparNotaDasLegendasAgendadas(d: Database.Database) {
  const feito = d.prepare("SELECT value FROM settings WHERE key = ?").get("legendas_sem_nota");
  if (feito) return;

  const linhas = d
    .prepare(
      `SELECT id, caption FROM posts
        WHERE status = 'scheduled' AND caption IS NOT NULL AND TRIM(caption) <> ''`,
    )
    .all() as { id: string; caption: string }[];

  const gravar = d.prepare("UPDATE posts SET caption = ? WHERE id = ?");
  let mexidas = 0;
  const tudo = d.transaction(() => {
    for (const l of linhas) {
      const limpa = stripCaptionLabels(l.caption).trim();
      if (limpa && limpa !== l.caption) {
        gravar.run(limpa, l.id);
        mexidas++;
      }
    }
    d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "legendas_sem_nota",
      JSON.stringify({ em: Date.now(), postsLimpos: mexidas }),
    );
  });
  tudo();
  if (mexidas > 0) {
    console.log(`[hotdash] legendas agendadas limpas da nota da IA: ${mexidas}`);
  }
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
