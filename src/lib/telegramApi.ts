import { createHmac } from "node:crypto";
import { absolutePath, readBuffer } from "./storage";
import { getVideoInfo } from "./videoDimensions";

/**
 * Secret determinístico por bot para o header X-Telegram-Bot-Api-Secret-Token.
 * Derivado do SESSION_SECRET + botId (HMAC), então não precisa de coluna nova
 * no banco e é o mesmo na hora de registrar o webhook e de validar cada update.
 * Sanitiza para o conjunto aceito pelo Telegram (A-Z a-z 0-9 _ -).
 */
export function telegramWebhookSecret(botId: string): string {
  const key = process.env.SESSION_SECRET || "hotdash";
  return createHmac("sha256", key).update(`tg-webhook:${botId}`).digest("hex");
}

/**
 * Erro vindo da API do Telegram, com o código HTTP preservado.
 *
 * O código importa porque distingue dois problemas com remédios diferentes, e
 * a mensagem crua do Telegram ("Not Found", "Unauthorized") não distingue nada
 * para quem opera o painel:
 *   • 404 "Not Found"    → o TOKEN não tem o formato `<números>:<chave>` (foi
 *     colado torto, veio junto com o texto do BotFather, ou está vazio). O
 *     caminho `/bot<token>/<método>` nem chega a ser reconhecido como de um bot.
 *   • 401 "Unauthorized" → o token está bem formado, mas foi revogado ou é de
 *     outro bot.
 * Foi verificado contra a api.telegram.org antes de virar código.
 */
export class TelegramApiError extends Error {
  readonly status: number;
  readonly description: string;
  constructor(status: number, description: string) {
    super(`Telegram API: ${description}`);
    this.name = "TelegramApiError";
    this.status = status;
    this.description = description;
  }
}

/**
 * Traduz uma falha de chamada ao Telegram para uma frase que diz o que fazer.
 * Devolve `null` quando o erro não é do Telegram (rede, timeout) — nesse caso
 * quem chama deve tratar como indisponibilidade, não como token ruim.
 */
export function diagnosticoDoToken(err: unknown): string | null {
  if (!(err instanceof TelegramApiError)) return null;
  if (err.status === 404) {
    return (
      "O Telegram não reconheceu o token do bot (404 Not Found), o que quer dizer que ele " +
      "está com o formato errado — deve ser algo como 8123456789:AAE... . Provavelmente veio " +
      "colado junto com o texto do BotFather ou faltou um pedaço. Abra o cadastro da modelo e " +
      "cole o token de novo (BotFather → /mybots → API Token)."
    );
  }
  if (err.status === 401) {
    return (
      "O Telegram recusou o token do bot (401 Unauthorized): ele foi revogado ou é de outro " +
      "bot. Gere um novo no BotFather (/mybots → API Token → Revoke) e cole no cadastro da modelo."
    );
  }
  return null;
}

/**
 * Extrai o token de bot de dentro do que foi colado.
 *
 * O painel aceitava qualquer string não vazia como token, e um token torto
 * derrubava o bot inteiro em silêncio: nada de /start, nada de aprovação de
 * entrada, e na tela só o eco cru "Telegram API: Not Found". Erros comuns que
 * isto conserta: colar a frase inteira do BotFather ("Use this token to access
 * the HTTP API: 8123...:AAE..."), colar com quebra de linha no meio, com o
 * prefixo `bot`, entre aspas, ou com espaço/caractere invisível grudado.
 *
 * Devolve "" quando não há nada com cara de token no meio — e aí quem chama
 * recusa o salvamento em vez de gravar lixo.
 */
export function normalizarBotToken(bruto: unknown): string {
  const texto = String(bruto ?? "")
    // Invisíveis que o `trim()` não pega (zero-width, BOM) e que passam
    // despercebidos num copiar-e-colar.
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  if (!texto) return "";
  const m = texto.match(/(\d{5,}):([A-Za-z0-9_-]{20,})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

async function telegramFetch(botToken: string, method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TelegramApiError(res.status, data.description || `Erro HTTP ${res.status}`);
  }
  return data.result;
}

// MIME por extensão. Precisa ser o tipo REAL (não "image/jpg" nem
// "video/mov", que não existem): o Telegram usa o content-type para decidir
// como tratar o arquivo, e um tipo desconhecido cai em anexo genérico.
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
};

async function telegramFormFetch(
  botToken: string,
  method: string,
  chatId: string,
  caption: string | undefined,
  relPath: string,
  fileField: "photo" | "video",
  options: Record<string, unknown> = {}
) {
  const buffer = await readBuffer(relPath);
  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";

  const formData = new FormData();
  formData.append("chat_id", chatId);
  if (caption) {
    formData.append("caption", caption);
    formData.append("parse_mode", "HTML");
  }

  const blob = new Blob([buffer as any], { type: mime });
  formData.append(fileField, blob, `file${ext}`);

  // Repassa o resto das opções (width/height do vídeo, supports_streaming,
  // reply_markup...). Objetos vão como JSON, que é o formato que a API do
  // Telegram espera em multipart.
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    formData.append(
      key,
      typeof value === "object" ? JSON.stringify(value) : String(value),
    );
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TelegramApiError(res.status, data.description || `Erro HTTP ${res.status}`);
  }
  return data.result;
}

/**
 * Tipos de update que o Hot-Dash PRECISA receber. Exportado porque o vigia do
 * webhook compara esta lista com o que o Telegram diz estar registrado — sem
 * isso, um bot registrado por uma versão antiga do sistema ficaria para sempre
 * sem os tipos acrescentados depois, sem ninguém notar.
 */
export const UPDATES_NECESSARIOS = [
  "message",
  // Post de CANAL. O Canal de Vendas costuma ser um canal, e não um grupo —
  // e post de canal NÃO chega como `message`, é um tipo à parte que o
  // Telegram só entrega se estiver listado aqui. Sem ele, o relatório de
  // venda que o sistema de origem publica nunca chegava, mesmo com o bot
  // sendo administrador do canal.
  "channel_post",
  "callback_query",
  "chat_join_request",
  "chat_member",
  "my_chat_member",
] as const;

/**
 * Registra o webhook do bot apontando para o Hot-Dash. Passa `allowed_updates`
 * EXPLÍCITO — o Telegram NÃO entrega por padrão três tipos de que dependemos:
 *   • `chat_join_request` dispara a aprovação automática nos grupos VIP/Prévias;
 *   • `chat_member` avisa quem entrou/saiu dos grupos (monta a lista de
 *     Usuários — um bot não pode consultar os membros de um grupo);
 *   • `my_chat_member` avisa quando alguém bloqueia/desbloqueia o bot, que é o
 *     que tira (e devolve) a pessoa dos disparos de mailing.
 * O `secret_token` (opcional) é devolvido pelo Telegram no header
 * X-Telegram-Bot-Api-Secret-Token de cada update, e o handler do webhook o valida.
 */
export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken?: string,
): Promise<boolean> {
  return telegramFetch(botToken, "setWebhook", {
    url,
    allowed_updates: UPDATES_NECESSARIOS,
    secret_token: secretToken || undefined,
    drop_pending_updates: false,
  });
}

export type TelegramWebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

/** Consulta o estado atual do webhook do bot (para a UI mostrar status). */
export async function getTelegramWebhookInfo(botToken: string): Promise<TelegramWebhookInfo> {
  return telegramFetch(botToken, "getWebhookInfo", {}) as Promise<TelegramWebhookInfo>;
}

/** Remove o webhook do bot (usado se o operador quiser desligar o bot). */
export async function deleteTelegramWebhook(botToken: string): Promise<boolean> {
  return telegramFetch(botToken, "deleteWebhook", { drop_pending_updates: false });
}

/** Busca dados do próprio bot (getMe) — usado para validar o token e pegar o @username. */
export async function getTelegramMe(
  botToken: string,
): Promise<{ id: number; username?: string; first_name?: string }> {
  return telegramFetch(botToken, "getMe", {}) as Promise<{
    id: number;
    username?: string;
    first_name?: string;
  }>;
}

/**
 * Quantos membros o grupo tem AGORA. É uma CONSULTA: funciona só com o token,
 * sem precisar do webhook — ou seja, continua respondendo enquanto a operação
 * do bot está desligada e outro sistema é o dono do webhook. Basta o bot ainda
 * ser membro (idealmente admin) do grupo.
 */
export async function getTelegramChatMemberCount(
  botToken: string,
  chatId: string,
): Promise<number> {
  const r = (await telegramFetch(botToken, "getChatMemberCount", { chat_id: chatId })) as number;
  return typeof r === "number" ? r : 0;
}

/**
 * Situação de um usuário (aqui: o próprio bot) dentro de um chat.
 *
 * É o que responde "o bot é admin deste grupo?" — a pergunta que importa,
 * porque sem ser administrador ele não aprova entrada, não gera convite e nem
 * recebe as mensagens do grupo (o modo privacidade do Telegram esconde delas).
 *
 * Funciona só com o token, sem depender do webhook.
 */
export async function getTelegramChatMember(
  botToken: string,
  chatId: string,
  userId: number,
): Promise<{ status?: string; is_member?: boolean } | null> {
  try {
    // `is_member` só vem em `restricted`, e é o que desempata: silenciado pode
    // estar dentro ou fora do canal, e o `status` sozinho não diz qual.
    return (await telegramFetch(botToken, "getChatMember", {
      chat_id: chatId,
      user_id: userId,
    })) as { status?: string; is_member?: boolean };
  } catch {
    return null;
  }
}

/** Dados do chat (título, tipo). Mesma ideia: consulta, não depende do webhook. */
export async function getTelegramChat(
  botToken: string,
  chatId: string,
): Promise<{ id: number; title?: string; type?: string; username?: string; invite_link?: string }> {
  // `invite_link` é o LINK PRIMÁRIO que este bot já tem no chat. Vem de graça
  // aqui e é a forma que a documentação indica para um bot obter o próprio
  // link sem passar pelo exportChatInviteLink — que revogaria o link anterior.
  return (await telegramFetch(botToken, "getChat", { chat_id: chatId })) as {
    id: number;
    title?: string;
    type?: string;
    username?: string;
    invite_link?: string;
  };
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  try {
    return await enviarMensagem(botToken, chatId, text, options);
  } catch (e) {
    // EFEITO DE MENSAGEM só vale em conversa privada, e o Telegram recusa a
    // mensagem inteira quando não vale — um enfeite não pode custar a entrega
    // do link do VIP. Então, se o efeito for o problema, reenvia sem ele.
    const msg = e instanceof Error ? e.message : "";
    if (options.message_effect_id && /effect/i.test(msg)) {
      const { message_effect_id: _ignorado, ...semEfeito } = options;
      return enviarMensagem(botToken, chatId, text, semEfeito);
    }
    throw e;
  }
}

function enviarMensagem(
  botToken: string,
  chatId: string,
  text: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  return telegramFetch(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    // SEM CARD DE PRÉ-VISUALIZAÇÃO. O Telegram monta sozinho um cartão do
    // primeiro link da mensagem — nos posts das Prévias isso virava um bloco
    // com a foto e a bio do bot e um botão "VER BOT" logo abaixo das 3 chamadas
    // do VIP. Ou seja: uma quarta porta, com texto que não é o nosso, brigando
    // justamente com o botão que deveria receber o clique.
    // Vem antes do spread de propósito: quem precisar do card pode reativá-lo
    // passando `link_preview_options` nas opções.
    link_preview_options: { is_disabled: true },
    ...options,
  });
}

/**
 * Tira o "relógio" do botão que a pessoa acabou de tocar.
 *
 * Sem esta chamada o Telegram deixa o botão girando por até 30 segundos e
 * depois some com o giro sem dizer nada — quem tocou fica sem saber se o
 * clique valeu e toca de novo. O `text` aparece como um aviso curto no topo
 * da conversa (ou como alerta, com `showAlert`).
 *
 * Nunca lança: é um enfeite de resposta, e derrubar o tratamento do clique
 * por causa dele seria perder a ação que a pessoa pediu de verdade.
 */
export async function answerTelegramCallback(
  botToken: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> {
  try {
    await telegramFetch(botToken, "answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text || undefined,
      show_alert: showAlert,
    });
  } catch {
    /* o clique já foi tratado; o aviso é secundário */
  }
}

/**
 * Troca o TECLADO de uma mensagem já enviada, deixando o texto como está.
 *
 * É o que substitui os botões pelo resultado depois da resposta — sem isso a
 * mensagem antiga continua clicável para sempre e alguém rolando a conversa de
 * ontem marca "não postei" num post que já saiu.
 *
 * Mexe só no teclado, e não no texto (`editMessageText`), de propósito: o
 * texto original tem HTML nosso, e reenviá-lo a partir do que o Telegram
 * devolve no update — que vem sem as marcações — faria o `parse_mode` recusar
 * qualquer legenda que tivesse um "<" ou um "&".
 *
 * `replyMarkup` ausente remove o teclado.
 */
export async function editTelegramReplyMarkup(
  botToken: string,
  chatId: string,
  messageId: string,
  replyMarkup?: unknown,
): Promise<void> {
  await telegramFetch(botToken, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: Number(messageId),
    reply_markup: replyMarkup,
  });
}

/**
 * Reescreve TEXTO e teclado de uma mensagem já enviada.
 *
 * É o que faz o menu do bot de entrega parecer um menu de verdade: tocar em
 * "Vincular aparelho" troca a mesma mensagem pela lista de modelos, em vez de
 * empilhar uma bolha nova a cada toque até a conversa virar um rolo.
 *
 * Diferente de `editTelegramReplyMarkup`, aqui o texto é NOSSO (montado
 * agora), então mandá-lo de volta com `parse_mode` é seguro.
 *
 * Nunca lança: "message is not modified" é a resposta normal de quem tocou
 * duas vezes no mesmo botão, e não pode virar erro no webhook.
 */
export async function editTelegramMessageText(
  botToken: string,
  chatId: string,
  messageId: string,
  text: string,
  replyMarkup?: unknown,
): Promise<void> {
  try {
    await telegramFetch(botToken, "editMessageText", {
      chat_id: chatId,
      message_id: Number(messageId),
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: replyMarkup,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/not modified/i.test(msg)) return;
    console.error("[hotdash] não consegui reescrever a mensagem:", err);
  }
}

/**
 * Registra a lista de comandos que aparece no botão "menu" do teclado do
 * Telegram. Sem isso, o único jeito de descobrir o que o bot faz é adivinhar
 * um comando.
 */
export async function setTelegramMyCommands(
  botToken: string,
  comandos: { command: string; description: string }[],
): Promise<void> {
  await telegramFetch(botToken, "setMyCommands", { commands: comandos });
}

export async function sendTelegramMedia(
  botToken: string,
  chatId: string,
  relPath: string,
  caption?: string,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  const isVideo = [".mp4", ".mov", ".mkv", ".webm"].includes(ext);
  if (isVideo) {
    // Sem width/height o Telegram não sabe a forma do vídeo e monta a bolha
    // por conta própria — é o que deixava vídeo em pé sendo exibido achatado
    // nos grupos. O ffprobe lê a resolução JÁ ROTACIONADA do arquivo, então
    // vale para o vídeo do celular gravado deitado. Se a leitura falhar,
    // envia como antes em vez de derrubar a postagem.
    const info = await getVideoInfo(absolutePath(relPath));
    return telegramFormFetch(botToken, "sendVideo", chatId, caption, relPath, "video", {
      ...(info
        ? {
            width: info.width,
            height: info.height,
            ...(info.duration ? { duration: info.duration } : {}),
            supports_streaming: true,
          }
        : {}),
      ...options, // o que o chamador passou explicitamente tem prioridade
    });
  } else {
    return telegramFormFetch(botToken, "sendPhoto", chatId, caption, relPath, "photo", options);
  }
}

/**
 * Envia várias mídias como UM ÁLBUM (sendMediaGroup).
 *
 * Três regras do Telegram que moldam esta função:
 *  • o álbum aceita de 2 a 10 itens — com 1 só, quem chama deve usar
 *    sendTelegramMedia, que é o que o `if` no começo faz;
 *  • a legenda vai no PRIMEIRO item e é ela que aparece embaixo do álbum;
 *  • **sendMediaGroup não aceita reply_markup**. Por isso o /start com álbum
 *    manda os botões numa mensagem separada logo depois — não é escolha
 *    estética, é a única forma de ter álbum e botões.
 *
 * Os arquivos vão por multipart, referenciados por `attach://<campo>`, que é
 * como a API liga cada item do JSON ao seu anexo.
 */
export async function sendTelegramMediaGroup(
  botToken: string,
  chatId: string,
  relPaths: string[],
  caption?: string,
): Promise<unknown> {
  if (relPaths.length === 0) return undefined;
  if (relPaths.length === 1) {
    return sendTelegramMedia(botToken, chatId, relPaths[0], caption);
  }

  const formData = new FormData();
  formData.append("chat_id", chatId);

  const media: Record<string, unknown>[] = [];
  const usados = relPaths.slice(0, 10); // teto do Telegram
  for (let i = 0; i < usados.length; i++) {
    const relPath = usados[i];
    const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
    const isVideo = [".mp4", ".mov", ".mkv", ".webm"].includes(ext);
    const campo = `file${i}`;
    const buffer = await readBuffer(relPath);
    const blob = new Blob([buffer as any], { type: MIME_BY_EXT[ext] || "application/octet-stream" });
    formData.append(campo, blob, `${campo}${ext}`);

    media.push({
      type: isVideo ? "video" : "photo",
      media: `attach://${campo}`,
      ...(i === 0 && caption ? { caption, parse_mode: "HTML" } : {}),
      ...(isVideo ? { supports_streaming: true } : {}),
    });
  }
  formData.append("media", JSON.stringify(media));

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMediaGroup`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TelegramApiError(res.status, data.description || `Erro HTTP ${res.status}`);
  }
  return data.result;
}

/**
 * Envia um áudio como MENSAGEM DE VOZ, a partir de uma URL pública.
 *
 * O Telegram baixa o arquivo sozinho — não precisamos hospedá-lo nem subir
 * bytes. Em compensação a URL tem de ser alcançável da internet, e o formato
 * de voz é OGG/OPUS: outros formatos o Telegram entrega como arquivo comum,
 * sem a bolha de áudio. Nunca lança: um áudio que falha não pode derrubar a
 * entrega do PIX.
 */
export async function sendTelegramVoiceUrl(
  botToken: string,
  chatId: string,
  url: string,
): Promise<boolean> {
  try {
    await telegramFetch(botToken, "sendVoice", { chat_id: chatId, voice: url });
    return true;
  } catch {
    return false;
  }
}

/**
 * Updates ainda na fila do bot (getUpdates), usado só para DESCOBRIR grupos.
 *
 * Chamado SEM `offset` de propósito: assim o Telegram devolve o que está na
 * fila mas não marca nada como entregue — se outro sistema estiver operando o
 * bot, não roubamos os updates dele.
 *
 * Só funciona quando NÃO há webhook registrado; com webhook ativo o Telegram
 * responde com um erro de conflito, e quem chama trata isso.
 */
export async function getTelegramUpdates(botToken: string): Promise<any[]> {
  const r = (await telegramFetch(botToken, "getUpdates", { timeout: 0, limit: 100 })) as any[];
  return Array.isArray(r) ? r : [];
}

/** Envia uma foto a partir de um Buffer em memória (ex.: QR Code do PIX). */
export async function sendTelegramPhotoBuffer(
  botToken: string,
  chatId: string,
  buffer: Buffer,
  caption?: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  if (caption) {
    formData.append("caption", caption);
    formData.append("parse_mode", "HTML");
  }
  if (options.reply_markup) {
    formData.append("reply_markup", JSON.stringify(options.reply_markup));
  }
  const blob = new Blob([new Uint8Array(buffer)], { type: "image/png" });
  formData.append("photo", blob, "pix.png");

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TelegramApiError(res.status, data.description || `Erro HTTP ${res.status}`);
  }
  return data.result;
}

/**
 * Envia uma ENQUETE (poll) nativa do Telegram. Retorna o objeto da mensagem
 * (inclui message_id) para, se quiser, semear uma reação depois.
 */
export async function sendTelegramPoll(
  botToken: string,
  chatId: string,
  question: string,
  options: string[],
  opts: { isAnonymous?: boolean; allowsMultiple?: boolean; reply_markup?: unknown } = {},
): Promise<{ message_id: number } | undefined> {
  // Telegram: pergunta 1–300 chars; 2–10 opções; cada opção 1–100 chars.
  const clean = options.map((o) => o.trim().slice(0, 100)).filter(Boolean).slice(0, 10);
  const q = question.trim().slice(0, 300);
  if (!q) throw new Error("Enquete sem pergunta.");
  if (clean.length < 2) throw new Error("Enquete precisa de ao menos 2 opções.");
  return telegramFetch(botToken, "sendPoll", {
    chat_id: chatId,
    question: q,
    options: clean,
    is_anonymous: opts.isAnonymous !== false,
    allows_multiple_answers: Boolean(opts.allowsMultiple),
    ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
  }) as Promise<{ message_id: number } | undefined>;
}

/**
 * Semeia UMA reação do próprio bot numa mensagem (setMessageReaction, Bot API
 * 7.0+). Não força reações de membros — as do grupo são orgânicas —, mas dá o
 * "primeiro fogo" (social proof). Exige que o grupo tenha reações habilitadas e
 * o bot seja admin. Nunca lança (best-effort).
 */
export async function setTelegramMessageReaction(
  botToken: string,
  chatId: string,
  messageId: number,
  emoji = "🔥",
): Promise<boolean> {
  try {
    await telegramFetch(botToken, "setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
      is_big: false,
    });
    return true;
  } catch {
    return false;
  }
}

/** Cria um link de convite único que exige aprovação de entrada. */
export async function createTelegramInviteLink(
  botToken: string,
  chatId: string,
  name?: string
): Promise<{ invite_link: string }> {
  return telegramFetch(botToken, "createChatInviteLink", {
    chat_id: chatId,
    name,
    creates_join_request: true,
  });
}

export async function approveTelegramJoinRequest(
  botToken: string,
  chatId: string,
  userId: number
): Promise<boolean> {
  return telegramFetch(botToken, "approveChatJoinRequest", {
    chat_id: chatId,
    user_id: userId,
  });
}

export async function declineTelegramJoinRequest(
  botToken: string,
  chatId: string,
  userId: number
): Promise<boolean> {
  return telegramFetch(botToken, "declineChatJoinRequest", {
    chat_id: chatId,
    user_id: userId,
  });
}

export async function banTelegramMember(
  botToken: string,
  chatId: string,
  userId: number
): Promise<boolean> {
  return telegramFetch(botToken, "banChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
}

export async function unbanTelegramMember(
  botToken: string,
  chatId: string,
  userId: number
): Promise<boolean> {
  return telegramFetch(botToken, "unbanChatMember", {
    chat_id: chatId,
    user_id: userId,
    only_if_banned: true,
  });
}
