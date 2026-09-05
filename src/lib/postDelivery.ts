import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { getMediaRow } from "./media";
import { getPost, updatePost } from "./posts";
import { sendPushEvent } from "./push";
import { getAppTimeZone, getDeliveryBotToken } from "./settings";
import {
  editTelegramReplyMarkup,
  sendTelegramMedia,
  sendTelegramMediaGroup,
  sendTelegramMessage,
} from "./telegramApi";
import { partsInTimeZone } from "./timezone";
import { NETWORK_LABELS, type SocialNetwork } from "./types";

/**
 * ENTREGA DA POSTAGEM — o post pronto chega no celular de quem publica, na
 * hora de publicar, com a mídia, a legenda e três botões.
 *
 * O que existia antes era só um aviso (`cronTasks.processReminders`): um push
 * dizendo "não esqueça". Quem ia postar tinha de abrir o painel, achar o post,
 * baixar a mídia e copiar a legenda na mão — e ninguém sabia se o post saiu,
 * porque a única marcação era alguém lembrar de clicar no painel depois.
 *
 * Aqui o pacote vai pronto e a resposta volta: "Postei" grava a HORA REAL da
 * publicação, "Adiar" empurra 30 minutos e reenvia, "Não postei" pinta o post
 * de vermelho no Cronograma. Silêncio por 30 minutos vira cobrança no mesmo
 * chat mais um push para o operador.
 *
 * O aviso antigo continua existindo e não foi mexido: um é o "prepare-se" de
 * 15 minutos antes, o outro é o pacote na hora. Por isso a guarda de "já
 * mandei" é uma coluna própria (`posts.delivered_at`) e não o `posts.reminded`
 * do outro — juntar as duas faria uma cancelar a outra.
 */

/** Quanto tempo depois do horário ainda vale entregar. */
const JANELA_ATRASO_MS = 30 * 60 * 1000;
/** Folga para frente: o tique é de 1 minuto, então o post das 14:00 sai às
 *  14:00 e não às 14:01. */
const JANELA_ADIANTE_MS = 60 * 1000;
/** Silêncio a partir do qual o sistema cobra a confirmação. */
const PRAZO_COBRANCA_MS = 30 * 60 * 1000;
/** Quanto o botão "Adiar" empurra. */
const ADIAR_MS = 30 * 60 * 1000;
/** Teto de itens por álbum no Telegram. */
const ALBUM_MAX = 10;

export type DeliveryAction = "posted" | "snooze" | "failed";

/**
 * Id fixo do bot de entrega, usado só para derivar o secret do webhook
 * (`telegramWebhookSecret`). Ele não tem linha em `telegram_bots` — é um só
 * no painel inteiro —, mas o secret é derivado de um id, então ele tem um.
 */
export const DELIVERY_BOT_ID = "entrega";

type LinhaEntrega = {
  post_id: string;
  scheduled_at: number;
  caption: string | null;
  profile_name: string;
  target_id: string;
  chat_id: string;
  network: string;
  post_type: string;
  username: string | null;
};

/** Escapa para o `parse_mode: HTML` do Telegram. Um "&" ou "<" solto na
 *  legenda faria o Telegram RECUSAR a mensagem inteira — e o post não chegaria
 *  em ninguém. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hhmm(ms: number): string {
  const t = partsInTimeZone(ms, getAppTimeZone());
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

function rotuloRede(network: string): string {
  return NETWORK_LABELS[network as SocialNetwork] || network;
}

/**
 * O texto que chega no celular.
 *
 * A legenda vai dentro de <pre> por um motivo prático: no Telegram esse bloco
 * ganha o botão de copiar, e copiar a legenda é exatamente o que a pessoa vai
 * fazer em seguida. Ela vai numa MENSAGEM à parte das mídias (e não como
 * legenda delas) porque legenda de mídia para em 1024 caracteres, enquanto
 * mensagem vai a 4096 — legenda longa com hashtags estourava o limite menor e
 * o Telegram recusava o envio inteiro.
 */
function montarTexto(
  linhas: LinhaEntrega[],
  scheduledAt: number,
  caption: string | null,
): string {
  const contas = linhas.map((l) => {
    const usuario = l.username ? ` @${l.username.replace(/^@/, "")}` : "";
    return `📱 ${esc(rotuloRede(l.network))}${esc(usuario)} · ${esc(l.post_type)}`;
  });
  const cabecalho = [
    `📅 <b>HORA DE POSTAR — ${hhmm(scheduledAt)}</b>`,
    `👤 ${esc(linhas[0].profile_name)}`,
    ...contas,
  ].join("\n");
  const legenda = (caption || "").trim();
  return legenda ? `${cabecalho}\n\n<pre>${esc(legenda)}</pre>` : cabecalho;
}

function teclado(deliveryId: string) {
  return {
    inline_keyboard: [
      [{ text: "✅ Postei", callback_data: `ent_ok:${deliveryId}` }],
      [
        { text: "⏰ Adiar 30 min", callback_data: `ent_snz:${deliveryId}` },
        { text: "❌ Não postei", callback_data: `ent_no:${deliveryId}` },
      ],
    ],
  };
}

/** Manda as mídias (sem legenda e sem botões — eles vão no texto). */
async function enviarMidias(botToken: string, chatId: string, mediaIds: string[]) {
  const caminhos = mediaIds
    .map((id) => getMediaRow(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => r.path);
  for (let i = 0; i < caminhos.length; i += ALBUM_MAX) {
    const lote = caminhos.slice(i, i + ALBUM_MAX);
    if (lote.length === 1) {
      await sendTelegramMedia(botToken, chatId, lote[0]);
    } else {
      await sendTelegramMediaGroup(botToken, chatId, lote);
    }
  }
}

/** O id da mensagem que o Telegram acabou de criar, para editá-la depois. */
function messageIdDe(resultado: unknown): string | undefined {
  const id = (resultado as { message_id?: number } | undefined)?.message_id;
  return id === undefined ? undefined : String(id);
}

/**
 * Entrega os posts que estão na hora e cobra os que ficaram sem resposta.
 *
 * Chamada pelo tique de 1 minuto (`instrumentation.ts`).
 */
export async function runPostDelivery(): Promise<{ enviados: number; cobrados: number }> {
  const botToken = getDeliveryBotToken();
  // Sem bot configurado não há o que fazer — e não é erro: quem não usa a
  // entrega no celular segue com o Cronograma e o push de sempre.
  if (!botToken) return { enviados: 0, cobrados: 0 };

  const enviados = await entregarPendentes(botToken);
  const cobrados = await cobrarSemResposta(botToken);
  return { enviados, cobrados };
}

async function entregarPendentes(botToken: string): Promise<number> {
  const db = getDb();
  const agora = Date.now();

  // A janela é FECHADA dos dois lados. Sem o limite de baixo, todo post
  // atrasado do passado entraria na conta a cada tique — o mesmo erro que já
  // tinha sido corrigido no lembrete (ver `cronTasks.ts`).
  //
  // O post do TELEGRAM fica de fora: ele é publicado sozinho pela automação
  // (`telegramCron`), não tem ninguém para postar na mão.
  //
  // O NOT EXISTS protege o caso do post que vai para DOIS aparelhos: quando um
  // deles adia (o que zera `delivered_at` e faz o post voltar para esta
  // consulta), o outro, que já respondeu, não recebe tudo de novo.
  const linhas = db
    .prepare(
      `SELECT p.id AS post_id, p.scheduled_at, p.caption, pr.name AS profile_name,
              t.id AS target_id, t.chat_id, pn.network, pn.post_type, a.username
         FROM posts p
         JOIN profiles pr        ON pr.id = p.profile_id
         JOIN post_networks pn   ON pn.post_id = p.id
         JOIN accounts a         ON a.id = pn.account_id
         JOIN delivery_targets t ON t.id = a.delivery_target_id
        WHERE p.status = 'scheduled'
          AND p.delivered_at IS NULL
          AND p.scheduled_at <= ?
          AND p.scheduled_at >= ?
          AND pn.network <> 'telegram'
          AND a.active <> 0
          AND t.active <> 0
          AND t.chat_id IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM post_deliveries d
                 WHERE d.post_id = p.id AND d.target_id = t.id
                   AND d.status IN ('confirmed', 'failed')
              )
        ORDER BY p.scheduled_at, p.id`,
    )
    .all(agora + JANELA_ADIANTE_MS, agora - JANELA_ATRASO_MS) as LinhaEntrega[];

  if (linhas.length === 0) return 0;

  // Uma mensagem por (post, aparelho): duas contas do mesmo post no mesmo
  // celular são a MESMA tarefa, e mandar duas vezes só faria a pessoa postar
  // a mesma foto duas vezes.
  const grupos = new Map<string, LinhaEntrega[]>();
  for (const l of linhas) {
    const chave = `${l.post_id}::${l.target_id}`;
    const atual = grupos.get(chave);
    if (atual) atual.push(l);
    else grupos.set(chave, [l]);
  }

  const insert = db.prepare(
    `INSERT INTO post_deliveries (id, post_id, target_id, status, sent_at, message_id, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const marcarEnviado = db.prepare("UPDATE posts SET delivered_at = ? WHERE id = ?");

  let enviados = 0;
  const postsTocados = new Set<string>();

  for (const linhasDoGrupo of grupos.values()) {
    const primeira = linhasDoGrupo[0];
    const deliveryId = randomUUID();
    const post = getPost(primeira.post_id);
    postsTocados.add(primeira.post_id);
    try {
      if (post && post.media.length > 0) {
        await enviarMidias(botToken, primeira.chat_id, post.media.map((m) => m.id));
      }
      const res = await sendTelegramMessage(
        botToken,
        primeira.chat_id,
        montarTexto(linhasDoGrupo, primeira.scheduled_at, primeira.caption),
        { reply_markup: teclado(deliveryId) },
      );
      insert.run(
        deliveryId,
        primeira.post_id,
        primeira.target_id,
        "sent",
        Date.now(),
        messageIdDe(res) || null,
        null,
      );
      enviados++;
    } catch (err) {
      // Uma entrega que falha não pode levar as outras junto: são celulares e
      // modelos diferentes. Fica gravada para aparecer no painel.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[hotdash] entrega do post ${primeira.post_id} para o aparelho ${primeira.target_id} falhou:`,
        err,
      );
      insert.run(
        deliveryId,
        primeira.post_id,
        primeira.target_id,
        "error",
        Date.now(),
        null,
        msg.slice(0, 500),
      );
    }
  }

  // `delivered_at` é do POST, e só é carimbado no fim: se fosse marcado antes
  // do envio, uma queda no meio deixaria o post marcado como entregue sem
  // ninguém ter recebido nada. Vale também para o envio que falhou — a linha
  // de erro é o registro, e repetir a cada minuto entupiria o chat quando o
  // problema for o token do bot.
  for (const postId of postsTocados) marcarEnviado.run(Date.now(), postId);

  return enviados;
}

/**
 * Cobra as entregas que ninguém respondeu — uma vez só.
 *
 * A cobrança vai nos dois lugares porque são duas pessoas: no chat do
 * aparelho, para quem tem de postar; e no push, para quem toca a operação e
 * não estaria olhando o Cronograma às 14:30 para descobrir que o post das 14h
 * não saiu.
 */
async function cobrarSemResposta(botToken: string): Promise<number> {
  const db = getDb();
  const limite = Date.now() - PRAZO_COBRANCA_MS;

  const pendentes = db
    .prepare(
      `SELECT d.id, d.post_id, t.chat_id, p.scheduled_at, pr.name AS profile_name
         FROM post_deliveries d
         JOIN delivery_targets t ON t.id = d.target_id
         JOIN posts p            ON p.id = d.post_id
         JOIN profiles pr        ON pr.id = p.profile_id
        WHERE d.status = 'sent'
          AND d.nudged_at IS NULL
          AND d.sent_at <= ?
          AND t.chat_id IS NOT NULL`,
    )
    .all(limite) as {
    id: string;
    post_id: string;
    chat_id: string;
    scheduled_at: number;
    profile_name: string;
  }[];

  if (pendentes.length === 0) return 0;

  const marcar = db.prepare("UPDATE post_deliveries SET nudged_at = ? WHERE id = ?");
  let cobrados = 0;

  for (const p of pendentes) {
    // Marca ANTES de mandar: se o envio falhar, é melhor perder uma cobrança
    // do que repetir a mesma a cada minuto até o chat virar spam.
    marcar.run(Date.now(), p.id);
    const hora = hhmm(p.scheduled_at);
    try {
      await sendTelegramMessage(
        botToken,
        p.chat_id,
        `⏳ O post de <b>${esc(p.profile_name)}</b> das ${hora} ainda não foi confirmado.\n` +
          `Toque em um dos botões da mensagem acima quando puder.`,
      );
    } catch (err) {
      console.error(`[hotdash] cobrança da entrega ${p.id} falhou:`, err);
    }
    await sendPushEvent(
      "postSemConfirmacao",
      `Post não confirmado: ${p.profile_name}`,
      `O post das ${hora} foi entregue no celular e ninguém confirmou.`,
      "/dashboard/schedule",
    );
    cobrados++;
  }

  return cobrados;
}

/* ------------------------------------------------------------- resposta */

export type Entrega = {
  id: string;
  post_id: string;
  target_id: string;
  status: string;
  message_id: string | null;
  answered_at: number | null;
  snooze_count: number;
  chat_id: string | null;
  profile_name: string;
  scheduled_at: number;
  posted_at: number | null;
};

export function getDelivery(id: string): Entrega | null {
  const r = getDb()
    .prepare(
      `SELECT d.id, d.post_id, d.target_id, d.status, d.message_id, d.answered_at,
              d.snooze_count, t.chat_id, pr.name AS profile_name,
              p.scheduled_at, p.posted_at
         FROM post_deliveries d
         JOIN delivery_targets t ON t.id = d.target_id
         JOIN posts p            ON p.id = d.post_id
         JOIN profiles pr        ON pr.id = p.profile_id
        WHERE d.id = ?`,
    )
    .get(id) as Entrega | undefined;
  return r || null;
}

/** O selo que fica no lugar dos três botões depois da resposta. Vira rótulo
 *  de botão, então é texto puro e curto — sem HTML. */
function seloDaResposta(e: Entrega): string {
  if (e.status === "confirmed") {
    return `✅ Postado às ${hhmm(e.posted_at || e.answered_at || Date.now())}`;
  }
  if (e.status === "failed") return "❌ Não foi postado";
  if (e.status === "snoozed") return "⏰ Adiado 30 min — mando de novo";
  return "";
}

/**
 * Aplica o que a pessoa tocou no celular.
 *
 * Uma entrega já respondida NÃO é reaplicada: a mensagem antiga continua na
 * conversa, e alguém rolando o histórico de ontem não pode marcar "não
 * postei" num post que já saiu. Nesse caso devolve o que já valia.
 */
export function applyDeliveryAnswer(
  deliveryId: string,
  acao: DeliveryAction,
): { ok: boolean; aviso: string; resumo: string; entrega: Entrega | null } {
  const e = getDelivery(deliveryId);
  if (!e) {
    return {
      ok: false,
      aviso: "Este post não está mais no painel.",
      resumo: "",
      entrega: null,
    };
  }
  if (e.status !== "sent") {
    return {
      ok: false,
      aviso: "Esta postagem já foi respondida.",
      resumo: seloDaResposta(e),
      entrega: e,
    };
  }

  const db = getDb();
  const agora = Date.now();

  if (acao === "posted") {
    // `updatePost` (e não um UPDATE cru) porque marcar postado também escreve
    // o histórico de publicação da mídia — é ele que alimenta a contagem de
    // "quantas vezes esta foto já foi ao ar" na Galeria.
    updatePost(e.post_id, { status: "posted", postedAt: agora });
    db.prepare(
      "UPDATE post_deliveries SET status = 'confirmed', answered_at = ? WHERE id = ?",
    ).run(agora, deliveryId);
  } else if (acao === "failed") {
    updatePost(e.post_id, { status: "failed" });
    db.prepare(
      "UPDATE post_deliveries SET status = 'failed', answered_at = ? WHERE id = ?",
    ).run(agora, deliveryId);
    void sendPushEvent(
      "postSemConfirmacao",
      `Post não publicado: ${e.profile_name}`,
      `O post das ${hhmm(e.scheduled_at)} foi marcado como “não postei” no celular.`,
      "/dashboard/schedule",
    );
  } else {
    // Adiar conta a partir de AGORA, não do horário original: quem toca o
    // botão está pedindo mais 30 minutos, e um post das 14:00 respondido às
    // 14:25 voltaria em 5 minutos se a conta fosse pelo horário combinado.
    updatePost(e.post_id, { scheduledAt: agora + ADIAR_MS });
    db.prepare("UPDATE posts SET delivered_at = NULL WHERE id = ?").run(e.post_id);
    db.prepare(
      `UPDATE post_deliveries
          SET status = 'snoozed', answered_at = ?, snooze_count = snooze_count + 1
        WHERE id = ?`,
    ).run(agora, deliveryId);
  }

  const depois = getDelivery(deliveryId)!;
  const aviso =
    acao === "posted"
      ? `Registrado às ${hhmm(agora)}.`
      : acao === "failed"
        ? "Marcado como não postado."
        : "Adiado 30 minutos.";
  return { ok: true, aviso, resumo: seloDaResposta(depois), entrega: depois };
}

/**
 * Troca os três botões por um único selo com o resultado.
 *
 * O selo é um botão porque o Telegram não tem texto "morto" num teclado — e
 * ele é útil: tocar nele repete o aviso do que já foi decidido, em vez de
 * deixar a pessoa achando que o toque não funcionou.
 *
 * Nunca lança: a resposta já está gravada, e uma falha ao reescrever a
 * mensagem (rede, mensagem apagada) não pode desfazer isso.
 */
export async function fecharMensagemDaEntrega(
  botToken: string,
  entrega: Entrega,
): Promise<void> {
  if (!entrega.message_id || !entrega.chat_id) return;
  const selo = seloDaResposta(entrega);
  if (!selo) return;
  try {
    await editTelegramReplyMarkup(botToken, entrega.chat_id, entrega.message_id, {
      inline_keyboard: [[{ text: selo, callback_data: `ent_ok:${entrega.id}` }]],
    });
  } catch (err) {
    console.error(`[hotdash] não consegui fechar a mensagem da entrega ${entrega.id}:`, err);
  }
}

/**
 * Mensagem de teste do botão "Testar envio" do cadastro — prova que o
 * aparelho recebe ANTES de o primeiro post depender disso.
 */
export async function enviarTesteParaAparelho(chatId: string, modelo: string): Promise<void> {
  const botToken = getDeliveryBotToken();
  if (!botToken) {
    throw new Error(
      "O bot de entrega não está configurado. Informe o token em Configurações → Entrega das postagens.",
    );
  }
  await sendTelegramMessage(
    botToken,
    chatId,
    `✅ Aparelho ligado ao Hot Dash.\n\nÉ aqui que os posts de <b>${esc(modelo)}</b> vão chegar, na hora de publicar.`,
  );
}
