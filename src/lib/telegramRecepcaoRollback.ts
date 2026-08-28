import "server-only";
import { getDb } from "./db";
import { setTelegramWebhook } from "./telegramApi";

/**
 * LIMPEZA DE UMA VEZ SÓ da antiga "recepção de informações" — o meio-termo
 * que deixava o Hot-Dash espiar/repassar o tráfego de um bot operado por
 * outro sistema (o Bobz). Foi REMOVIDA do sistema: um bot em modo "repasse"
 * sem o segredo do webhook de origem configurado fez o Bobz parar de receber
 * QUALQUER coisa, em silêncio, até vendas sumirem do relatório. Agora é
 * binário: ou o Hot-Dash controla o bot inteiro, ou não encosta nele.
 *
 * Este arquivo é o que sobrou, e existe por UM motivo: um bot que ficou em
 * modo "repasse" tem o webhook do Telegram apontando pra CÁ. Só apagar o
 * código deixaria esse bot mudo pra sempre — o Telegram continuaria
 * entregando pro Hot-Dash, que não faz mais nada com isso. Então, antes de
 * esquecer o assunto, devolve o webhook pro endereço de origem.
 *
 * Roda uma vez no boot (ver `instrumentation.ts`), é idempotente e vira um
 * no-op de uma consulta só depois que todo bot já foi limpo — as colunas
 * `passive_ingest_active`/`ingest_mode`/`relay_*` continuam no banco só para
 * esta função poder lê-las (ver `db.ts`); nada mais no sistema as usa.
 *
 * Nunca lança: uma falha ao devolver o webhook de UM bot não pode impedir de
 * limpar os demais (e mesmo o que falhou é limpo do mesmo jeito — ver o
 * comentário dentro do laço). Devolve quantos bots foram limpos.
 */
export async function desligarRecepcaoDeTodosBots(): Promise<number> {
  const db = getDb();
  const bots = db
    .prepare(
      `SELECT id, bot_token, ingest_mode, relay_target_url, relay_target_secret
         FROM telegram_bots
        WHERE passive_ingest_active = 1
          AND bot_token IS NOT NULL AND bot_token <> ''`,
    )
    .all() as {
    id: string;
    bot_token: string;
    ingest_mode: string | null;
    relay_target_url: string | null;
    relay_target_secret: string | null;
  }[];

  let desligados = 0;
  for (const row of bots) {
    try {
      if (row.ingest_mode === "relay" && row.relay_target_url) {
        await setTelegramWebhook(row.bot_token, row.relay_target_url, row.relay_target_secret || undefined);
      }
      // Modo "espiada" nunca mexeu no webhook do Telegram — só limpa abaixo.
    } catch (err) {
      // Mesmo com falha aqui, as colunas são limpas do mesmo jeito (fora do
      // try): deixar o bot marcado como "recepção ligada" não conserta nada
      // — a recepção não existe mais pra religar. Se o webhook não voltou
      // sozinho, fica pro operador religar no sistema de origem; ao menos o
      // log diz qual bot foi.
      console.error(`[hotdash] falha devolvendo o webhook do bot ${row.id} ao limpar a recepção:`, err);
    }
    db.prepare(
      `UPDATE telegram_bots
          SET passive_ingest_active = 0, ingest_mode = NULL, relay_target_url = NULL,
              relay_target_secret = NULL, relay_last_error = NULL, relay_last_error_at = NULL
        WHERE id = ?`,
    ).run(row.id);
    desligados++;
  }
  return desligados;
}
