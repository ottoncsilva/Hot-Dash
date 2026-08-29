import "server-only";
import { getDb } from "./db";
import {
  getTelegramWebhookInfo,
  setTelegramWebhook,
  UPDATES_NECESSARIOS,
  telegramWebhookSecret,
  diagnosticoDoToken,
} from "./telegramApi";
import { publicOriginSemRequest, webhookOriginProblem } from "./publicOrigin";
import { sendPushEvent } from "./push";

/**
 * VIGIA DO WEBHOOK DOS BOTS DE VENDAS.
 *
 * O bot da operação depende inteiramente de o Telegram conseguir entregar os
 * updates no `/api/webhooks/telegram/<botId>`. Quando esse registro se perde ou
 * quebra, nada avisa: o bot simplesmente para de responder /start e para de
 * aprovar quem pede entrada nas Prévias, e só se descobre pelo prejuízo. Foi
 * exatamente o que aconteceu — "estava funcionando e não está mais".
 *
 * Três coisas quebram o registro, e o vigia trata cada uma:
 *
 *  1. O TOKEN foi trocado por um torto ou revogado. Toda chamada ao Telegram
 *     passa a falhar (404 para token malformado, 401 para revogado) e não há
 *     conserto automático possível — quem tem que colar um token novo é o
 *     operador. Aqui o vigia MANDA UM ALERTA no celular dizendo qual modelo
 *     parou e o que fazer, uma vez por queda (não a cada minuto).
 *  2. A URL registrada não é mais a que vale — o domínio do painel mudou, o
 *     `WEBHOOK_APP_URL` foi corrigido depois, ou alguém registrou o webhook
 *     apontando para um id de bot que não existe mais. O Telegram responde 404
 *     ao chamar a URL velha. Isto o vigia CONSERTA sozinho: re-registra.
 *  3. O registro sumiu (url vazia) porque outro sistema chamou `deleteWebhook`
 *     com o mesmo token. Também é re-registrado sozinho.
 *
 * Roda no ciclo de 1 minuto do `instrumentation.ts`, mas só age de
 * {@link INTERVALO_MS} em {@link INTERVALO_MS} — o objetivo é perceber uma
 * queda em minutos, não martelar a API do Telegram.
 */

/** Espaço entre duas rodadas de checagem. */
const INTERVALO_MS = 5 * 60 * 1000;

/** Chave em `settings` onde fica o retrato da última rodada. */
const CHAVE = "telegram_webhook_watch";

type Estado = {
  /** Quando a última rodada rodou (para respeitar o INTERVALO_MS). */
  ultimaChecagem?: number;
  /**
   * Por bot, o problema que já foi avisado. Existe para o alerta sair UMA vez
   * por queda: enquanto o mesmo problema continuar, não repete; quando o bot
   * volta, a entrada some e uma queda futura volta a avisar.
   */
  avisados?: Record<string, string>;
};

function lerEstado(): Estado {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(CHAVE) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.value) as Estado;
  } catch {
    return {};
  }
}

function gravarEstado(estado: Estado): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(CHAVE, JSON.stringify(estado));
}

type BotVigiado = {
  id: string;
  profile_id: string;
  bot_token: string;
  nome: string | null;
};

/**
 * Verifica (e conserta quando dá) o webhook de cada bot com a operação ligada.
 * Devolve quantos webhooks foram re-registrados nesta rodada.
 *
 * Nunca lança: é uma tarefa de fundo, e um Telegram fora do ar não pode
 * derrubar o ciclo que também faz as postagens saírem.
 */
export async function runTelegramWebhookWatch(opts?: { force?: boolean }): Promise<number> {
  const estado = lerEstado();
  const agora = Date.now();
  if (!opts?.force && estado.ultimaChecagem && agora - estado.ultimaChecagem < INTERVALO_MS) {
    return 0;
  }

  // Sem base pública não há URL para registrar, e re-registrar com um endereço
  // interno é pior que não mexer: o Telegram recusa e o registro bom se perde.
  let base: string;
  try {
    base = publicOriginSemRequest();
  } catch {
    return 0;
  }
  if (webhookOriginProblem(base)) return 0;

  estado.ultimaChecagem = agora;
  const avisados = estado.avisados || {};

  const bots = getDb()
    .prepare(
      `SELECT b.id, b.profile_id, b.bot_token, p.name AS nome
         FROM telegram_bots b
         LEFT JOIN profiles p ON p.id = b.profile_id
        WHERE b.operation_active = 1
          AND b.bot_token IS NOT NULL
          AND b.bot_token <> ''`,
    )
    .all() as BotVigiado[];

  let reregistrados = 0;

  for (const bot of bots) {
    const esperada = `${base}/api/webhooks/telegram/${bot.id}`;
    const quem = bot.nome || "uma modelo";
    try {
      const info = await getTelegramWebhookInfo(bot.bot_token);
      const urlErrada = !info.url || info.url !== esperada;

      // A LISTA de tipos de update também precisa estar em dia. Um bot
      // registrado por uma versão antiga do sistema fica preso na lista
      // daquela época: quando um tipo novo passa a ser necessário (foi o caso
      // do `channel_post`, sem o qual o relatório publicado no canal de vendas
      // nunca chegava), o webhook continua "certo" pela URL e o dado some em
      // silêncio. Comparar aqui é o que conserta sozinho, sem o operador
      // precisar reconfigurar bot nenhum.
      //
      // Lista VAZIA ou ausente no getWebhookInfo não quer dizer "nenhum": o
      // Telegram devolve assim quando o webhook foi registrado sem
      // `allowed_updates` (o padrão dele, que já cobre quase tudo). Nesse caso
      // re-registramos mesmo assim, para passar a valer a nossa lista
      // explícita — é ela que garante os tipos que o padrão NÃO inclui.
      const registrados = info.allowed_updates || [];
      const faltamTipos =
        registrados.length === 0 || UPDATES_NECESSARIOS.some((t) => !registrados.includes(t));

      // O Telegram guarda o último erro que ele mesmo teve ao nos chamar. Um
      // erro recente COM updates presos significa que a entrega está parada de
      // verdade agora — não é um erro velho de uma queda já resolvida.
      const erroRecente =
        typeof info.last_error_date === "number" &&
        agora - info.last_error_date * 1000 < 15 * 60 * 1000 &&
        (info.pending_update_count || 0) > 0;

      if (urlErrada || erroRecente || faltamTipos) {
        await setTelegramWebhook(bot.bot_token, esperada, telegramWebhookSecret(bot.id));
        reregistrados++;
        console.log(
          `[hotdash] webhook do bot de ${quem} re-registrado (${
            urlErrada
              ? `apontava para ${info.url || "lugar nenhum"}`
              : faltamTipos
                ? "faltavam tipos de update (ex.: post de canal)"
                : "entrega travada"
          }).`,
        );
      }
      // Voltou a funcionar: limpa a marca para uma queda futura avisar de novo.
      delete avisados[bot.id];
    } catch (e) {
      const motivo = diagnosticoDoToken(e);
      if (!motivo) {
        // Não é o token: rede instável, Telegram fora do ar, ou o setWebhook
        // recusou a URL. Fica no log para dar o que investigar, mas não vira
        // alerta no celular — a próxima rodada tenta de novo sozinha.
        console.warn(
          `[hotdash] vigia do webhook não conseguiu checar o bot de ${quem}:`,
          e instanceof Error ? e.message : e,
        );
        continue;
      }

      // Token recusado. Não há conserto automático — avisa o operador, uma vez.
      const marca = motivo.slice(0, 40);
      if (avisados[bot.id] === marca) continue;
      avisados[bot.id] = marca;
      console.error(`[hotdash] token do bot de ${quem} recusado pelo Telegram: ${motivo}`);
      await sendPushEvent(
        "telegramBotDown",
        `Bot de ${quem} fora do ar`,
        "O Telegram recusou o token: ninguém recebe /start nem é aprovado nas Prévias. " +
          "Abra o cadastro da modelo e cole o token de novo.",
        `/dashboard/profiles/${bot.profile_id}`,
      ).catch(() => {});
    }
  }

  estado.avisados = avisados;
  gravarEstado(estado);
  return reregistrados;
}
