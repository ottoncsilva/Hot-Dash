import "server-only";
import { getDb } from "./db";
import { getTelegramWebhookInfo, getTelegramUpdatesPeek } from "./telegramApi";
import { primeiraVezQueVejoEsteUpdate, setRelayFailure, clearRelayFailure } from "./telegramDb";
import { registrarChegadaTelegram } from "./telegramIngest";

/**
 * RECEPÇÃO DE INFORMAÇÕES — segundo interruptor do bot de vendas,
 * independente de "controle total" (`operationActive`): grava o que dá pra
 * entender do tráfego de um bot que outro sistema continua operando de
 * ponta a ponta (funis, disparos, tudo dele), sem tirar nada da mão de
 * ninguém e sem nunca mandar mensagem nenhuma.
 *
 * Dois modos, decididos sozinhos ao ligar (ver `probeIngestMode`):
 *
 *  • "relay" — o bot tinha um webhook de verdade (outro sistema também usa
 *    webhook). O Hot-Dash assume o registro no Telegram, grava o que
 *    interessa e REPASSA cada update, sem alterar nada, pro endereço que
 *    estava configurado antes (`relayTargetUrl`) — ver `relayForward` e o
 *    uso dela em `api/webhooks/telegram/[botId]/route.ts`.
 *
 *  • "poll" — o bot não tinha webhook nenhum (o outro sistema usa long
 *    polling, `getUpdates`). Não tem pra onde repassar, e registrar um
 *    webhook TIRARIA esse bot da mão do outro sistema sem aviso — pior que
 *    não fazer nada. Em vez disso, o Hot-Dash fica ESPIANDO a mesma fila,
 *    em loop, sem nunca confirmar (`getTelegramUpdatesPeek` — ver o
 *    comentário lá sobre por que isso não rouba nada de ninguém). É
 *    melhor-esforço por natureza: só enxerga o que ainda não foi consumido
 *    pelo outro sistema no instante exato da espiada, então uma fila que
 *    ele processa muito rápido pode nunca aparecer pra nós. Webhook
 *    ("relay") continua sendo o caminho confiável; "poll" é o que sobra
 *    quando não existe outro jeito.
 */

export async function probeIngestMode(
  botToken: string,
): Promise<{ mode: "relay" | "poll"; targetUrl?: string }> {
  const info = await getTelegramWebhookInfo(botToken);
  if (info.url && info.url.trim()) {
    return { mode: "relay", targetUrl: info.url.trim() };
  }
  return { mode: "poll" };
}

/**
 * Repassa o update CRU (mesmo corpo de bytes que o Telegram mandou pra nós)
 * pro endereço de origem — 2 tentativas rápidas, timeout curto em cada uma.
 * Nunca lança: quem chama decide o que fazer com `false` (nesse caso,
 * devolve erro pro Telegram pra ele tentar de novo mais tarde — ver a rota
 * do webhook).
 */
export async function relayForward(targetUrl: string, secret: string | undefined, rawBody: string): Promise<boolean> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}),
        },
        body: rawBody,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      // 2xx/3xx = o sistema de origem recebeu (o Telegram também trata assim).
      if (res.ok) return true;
    } catch {
      clearTimeout(timeoutId);
      // rede/timeout — tenta de novo (só na 1ª volta) ou desiste.
    }
  }
  return false;
}

type BotEspiado = { id: string; profile_id: string; bot_token: string; id_vip: string; id_aquecimento: string };

/**
 * Um tick do modo "poll": espia a fila de cada bot em recepção passiva sem
 * webhook próprio, grava o que aparecer. Roda com intervalo PRÓPRIO (mais
 * curto que o tick geral de 1 minuto — ver `instrumentation.ts`), porque
 * cobertura aqui depende de chegar antes do outro sistema confirmar a fila
 * dele. Nunca lança: uma falha num bot não pode travar os demais nem o
 * resto do agendador.
 */
export async function runTelegramPassiveIngestPoll(): Promise<void> {
  const bots = getDb()
    .prepare(
      `SELECT id, profile_id, bot_token, id_vip, id_aquecimento
         FROM telegram_bots
        WHERE passive_ingest_active = 1
          AND ingest_mode = 'poll'
          AND operation_active = 0
          AND bot_token IS NOT NULL
          AND bot_token <> ''`,
    )
    .all() as BotEspiado[];

  for (const row of bots) {
    const bot = { id: row.id, profileId: row.profile_id, idVip: row.id_vip, idAquecimento: row.id_aquecimento };
    try {
      const updates = await getTelegramUpdatesPeek(row.bot_token);
      for (const update of updates) {
        if (!primeiraVezQueVejoEsteUpdate(bot.id, update.update_id)) continue;
        registrarChegadaTelegram(bot, update);
      }
      clearRelayFailure(bot.id);
    } catch (err) {
      // Token recusado, rede instável, Telegram fora do ar — fica no log,
      // sem alarme a cada tentativa (isto tenta de novo sozinho no próximo
      // tick, bem mais cedo que o vigia do webhook).
      console.warn(`[hotdash] recepção (poll) falhou pro bot ${bot.id}:`, err instanceof Error ? err.message : err);
      setRelayFailure(bot.id, err instanceof Error ? err.message : "Falha ao consultar o Telegram.");
    }
  }
}
