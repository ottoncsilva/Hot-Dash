import "server-only";
import { getDb } from "./db";
import { getTelegramWebhookInfo, getTelegramUpdatesPeek, setTelegramWebhook, telegramWebhookSecret, TelegramApiError } from "./telegramApi";
import { primeiraVezQueVejoEsteUpdate, setRelayFailure, clearRelayFailure, getBotConfig, saveBotConfig } from "./telegramDb";
import { registrarChegadaTelegram } from "./telegramIngest";
import { publicOriginSemRequest, webhookOriginProblem } from "./publicOrigin";

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
 *
 * AUTO-RECUPERAÇÃO: se um bot em "poll" passar a ter um webhook de verdade
 * (o sistema de origem trocou de mecanismo sozinho, por conta própria), o
 * Telegram passa a recusar `getUpdates` com erro 409 — nesse caso o próprio
 * laço de espiada detecta e vira pro modo "relay" sozinho, sem o operador
 * precisar desligar e religar (ver `tentarVirarRelay`).
 *
 * DESLIGADA por decisão explícita em 27/08 (ver `desligarRecepcaoDeTodosBots`,
 * chamada uma vez no boot em `instrumentation.ts`): um bot em "relay" sem o
 * segredo do webhook de origem configurado fez o sistema de origem (o Bobz)
 * parar de receber QUALQUER coisa — o Hot-Dash tinha assumido o webhook e o
 * repasse estava sendo recusado do outro lado, em silêncio. "Ou usa o
 * Hot-Dash, ou usa o Bobz" — sem meio-termo por enquanto. As funções abaixo
 * continuam aqui (não removidas) porque a ideia em si não está descartada —
 * só ninguém liga automaticamente, e a ação de ligar pela tela está
 * bloqueada (ver `set-passive-ingest` em `api/telegram/route.ts`).
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

type BotEspiado = {
  id: string;
  profile_id: string;
  bot_token: string;
  id_vip: string;
  id_aquecimento: string;
  id_vendas: string | null;
};

/**
 * O bot que estava em "poll" (sem webhook) passou a ter um webhook — o
 * Telegram bloqueia `getUpdates` nesse caso (erro 409, "webhook is active";
 * ver `runTelegramPassiveIngestPoll`). Em vez de deixar a recepção presa
 * nesse erro pra sempre (o operador teria que perceber e desligar/religar
 * manualmente), tenta virar "relay" sozinho: assume o webhook do Telegram e
 * passa a repassar pro endereço que acabou de aparecer. Devolve `true` só
 * quando a troca deu certo — qualquer motivo pra não trocar (base pública
 * não configurada, o webhook novo já é o nosso próprio, falha ao registrar)
 * devolve `false` e quem chama mantém o erro original.
 */
async function tentarVirarRelay(row: BotEspiado): Promise<boolean> {
  let base: string;
  try {
    base = publicOriginSemRequest();
  } catch {
    return false;
  }
  if (webhookOriginProblem(base)) return false;

  const probe = await probeIngestMode(row.bot_token).catch(() => null);
  if (!probe || probe.mode !== "relay" || !probe.targetUrl) return false;

  const nossoUrl = `${base}/api/webhooks/telegram/${row.id}`;
  if (probe.targetUrl === nossoUrl) return false; // já é a gente — nada pra trocar

  const bot = getBotConfig(row.id);
  if (!bot) return false;

  await setTelegramWebhook(row.bot_token, nossoUrl, telegramWebhookSecret(row.id));
  saveBotConfig({ ...bot, passiveIngestActive: true, ingestMode: "relay", relayTargetUrl: probe.targetUrl });
  console.log(
    `[hotdash] recepção do bot ${row.id} virou "relay" sozinha (o sistema de origem passou a ter webhook: ${probe.targetUrl}).`,
  );
  return true;
}

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
      `SELECT id, profile_id, bot_token, id_vip, id_aquecimento, id_vendas
         FROM telegram_bots
        WHERE passive_ingest_active = 1
          AND ingest_mode = 'poll'
          AND operation_active = 0
          AND bot_token IS NOT NULL
          AND bot_token <> ''`,
    )
    .all() as BotEspiado[];

  for (const row of bots) {
    const bot = {
      id: row.id,
      profileId: row.profile_id,
      idVip: row.id_vip,
      idAquecimento: row.id_aquecimento,
      idVendas: row.id_vendas || undefined,
    };
    try {
      const updates = await getTelegramUpdatesPeek(row.bot_token);
      for (const update of updates) {
        if (!primeiraVezQueVejoEsteUpdate(bot.id, update.update_id)) continue;
        registrarChegadaTelegram(bot, update);
      }
      clearRelayFailure(bot.id);
    } catch (err) {
      // 409 = "Conflict: can't use getUpdates method while webhook is
      // active" — o sistema de origem, que não tinha webhook quando a
      // recepção foi ligada, passou a ter um. Em vez de ficar preso nesse
      // erro, tenta virar "relay" sozinho (ver `tentarVirarRelay`).
      if (err instanceof TelegramApiError && err.status === 409) {
        const upgraded = await tentarVirarRelay(row).catch(() => false);
        if (upgraded) {
          clearRelayFailure(bot.id);
          continue;
        }
      }
      // Token recusado, rede instável, Telegram fora do ar — fica no log,
      // sem alarme a cada tentativa (isto tenta de novo sozinho no próximo
      // tick, bem mais cedo que o vigia do webhook).
      console.warn(`[hotdash] recepção (poll) falhou pro bot ${bot.id}:`, err instanceof Error ? err.message : err);
      setRelayFailure(bot.id, err instanceof Error ? err.message : "Falha ao consultar o Telegram.");
    }
  }
}

/**
 * DESLIGA a recepção de TODOS os bots — chamada uma vez no boot (ver
 * `instrumentation.ts`), pra um deploy já bastar, sem depender de ninguém
 * clicar em nada na tela. Pra cada bot em "relay", devolve o webhook pro
 * endereço de origem primeiro — é a parte que importa de verdade; zerar só
 * a flag no banco sem devolver o webhook deixaria o sistema de origem
 * (ex.: o Bobz) sem receber nada, mesmo com a recepção "desligada" aqui.
 * Nunca lança: uma falha ao devolver o webhook de UM bot não pode impedir
 * de zerar a flag dos demais (e mesmo a flag deste é zerada de qualquer
 * jeito — ver o comentário dentro do laço). Devolve quantos bots foram
 * desligados.
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
      // Modo "poll" nunca mexeu no webhook do Telegram — só zera a flag abaixo.
    } catch (err) {
      // Mesmo com falha aqui, a flag é zerada do mesmo jeito (fora do try) —
      // não pode deixar o bot marcado como "recepção ligada" achando que
      // ainda está espiando/repassando quando a decisão foi desligar tudo.
      // Se o webhook não voltou sozinho, fica pro operador religar
      // manualmente no sistema de origem — mas ao menos o log avisa.
      console.error(`[hotdash] falha devolvendo o webhook do bot ${row.id} ao desligar a recepção:`, err);
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
