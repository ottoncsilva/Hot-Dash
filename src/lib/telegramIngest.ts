import "server-only";
import type { TelegramBotConfig } from "./telegramDb";
import { recordSeenChat, upsertTelegramLead, abandonPendingSubscriptions } from "./telegramDb";
import { upsertTelegramUser, setTelegramUserGroup, getTelegramUser } from "./telegramUsers";
import { recordGroupMembershipChange } from "./telegramMonitor";
import { registrarRelatorioExterno } from "./externalSaleReport";

/**
 * O que dá pra ENTENDER de um update do Telegram, sem mandar nada de volta —
 * usuário visto, entrada/saída de grupo, `/start` (lead + origem do
 * tráfego). Só roda pra bot com "controle total": um bot operado por fora
 * (Bobz) não manda update nenhum pra cá, de propósito.
 *
 * Nunca lança: é chamada em cima de tráfego de produção de verdade (a venda
 * de alguém), e um erro aqui não pode derrubar nem o funil de quem tem
 * controle total, nem a resposta 200 que o Telegram espera.
 */
export function registrarChegadaTelegram(
  bot: Pick<TelegramBotConfig, "id" | "profileId" | "idVip" | "idAquecimento" | "idVendas">,
  update: any,
): void {
  try {
    // Anota TODO grupo/canal que aparecer, venha por onde vier. É a única
    // forma de o painel saber em que grupos o bot está: a API do Telegram não
    // deixa um bot listar os próprios chats. É o que alimenta o "Detectar".
    for (const c of [
      update?.message?.chat,
      update?.channel_post?.chat,
      update?.my_chat_member?.chat,
      update?.chat_member?.chat,
      update?.chat_join_request?.chat,
    ]) {
      if (c) recordSeenChat(bot.id, c);
    }

    const message = update?.message;
    if (!message) return;
    const { chat, text, from } = message;
    const isStart = typeof text === "string" && text.startsWith("/start");

    // GRUPO DE VENDAS: mensagem de relatório (o Bobz, ou o que for, posta
    // ali um resumo de cada venda — mesmo formato que o próprio Hot-Dash usa
    // pros bots que controla). É o único jeito de casar um pagamento "frio"
    // (SyncPay/Stripe sem passar pelo nosso checkout) com o lead e o bot
    // certos — ver `externalSaleReport.ts`.
    //
    // ESTE bot é o "ouvinte" do grupo; o bot da VENDA é o que vem escrito no
    // relatório ("ID Bot"), e é sobre ele que a trava de bot ativo decide —
    // relatório de bot que o Hot-Dash já opera é ignorado lá dentro, pra não
    // reprocessar a nossa própria saída.
    if (bot.idVendas && String(chat?.id) === bot.idVendas && typeof text === "string") {
      registrarRelatorioExterno(text);
    }

    // Qualquer mensagem no PRIVADO confirma que o bot pode falar com a
    // pessoa — é o que a habilita a receber mailing. Nos GRUPOS, a mensagem
    // serve para reconhecer quem já era membro antes de o painel existir
    // (o Telegram não deixa um bot listar os membros de um grupo).
    if (from && !from.is_bot) {
      const isPrivate = chat?.type === "private";
      const inVipGroup = String(chat?.id) === bot.idVip;
      const inPreviasGroup = String(chat?.id) === bot.idAquecimento;
      if (isPrivate || inVipGroup || inPreviasGroup) {
        upsertTelegramUser({
          botId: bot.id,
          profileId: bot.profileId,
          telegramUserId: from.id,
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name,
          chatId: isPrivate ? String(chat.id) : undefined,
          canDm: isPrivate,
          inVip: inVipGroup ? true : undefined,
          inPrevias: inPreviasGroup ? true : undefined,
          source: isPrivate ? "start" : "grupo",
        });
      }
    }

    // Entradas e saídas dos grupos chegam como mensagem de serviço.
    const joinedGroup =
      String(chat?.id) === bot.idVip ? "vip" : String(chat?.id) === bot.idAquecimento ? "previas" : null;
    if (joinedGroup && Array.isArray(message.new_chat_members)) {
      for (const member of message.new_chat_members) {
        if (member?.is_bot) continue;
        registraMudancaDeGrupo(bot, member.id, joinedGroup, true);
        upsertTelegramUser({
          botId: bot.id,
          profileId: bot.profileId,
          telegramUserId: member.id,
          username: member.username,
          firstName: member.first_name,
          lastName: member.last_name,
          inVip: joinedGroup === "vip" ? true : undefined,
          inPrevias: joinedGroup === "previas" ? true : undefined,
          source: joinedGroup === "vip" ? "vip" : "previas",
        });
      }
    }
    if (joinedGroup && message.left_chat_member && !message.left_chat_member.is_bot) {
      registraMudancaDeGrupo(bot, message.left_chat_member.id, joinedGroup, false);
      setTelegramUserGroup(bot.id, message.left_chat_member.id, joinedGroup, false);
    }

    if (isStart && from) {
      // Deep-link de divulgação: t.me/<bot>?start=CODIGO chega como
      // "/start CODIGO". É o que liga a venda à origem do tráfego.
      const sourceCode = (String(text).slice("/start".length).trim().split(/\s+/)[0] || "")
        .replace(/[^\w-]/g, "")
        .slice(0, 40);
      upsertTelegramLead({
        id: `${bot.id}_${from.id}`,
        profileId: bot.profileId,
        chatId: String(chat.id),
        lastInteractionAt: Date.now(),
        downsellStepIndex: 0,
        createdAt: Date.now(),
        // Reinicia o funil de Downsell geral A CADA /start: se o lead
        // sumiu e voltou dias depois, ele entra de novo do zero — não
        // encontra o funil na metade (ou já acabado) por causa da PRIMEIRA
        // vez que ele deu /start. `createdAt` acima não muda de verdade
        // pra quem já existe (upsertTelegramLead preserva o primeiro
        // /start pras métricas do Funil de Vendas); só este campo conta
        // pro Downsell.
        downsellStartedAt: Date.now(),
        sourceCode: sourceCode || undefined,
      });
      // Qualquer cobrança pendente de uma visita ANTERIOR vira "abandoned"
      // — nunca mais nageia nem bloqueia o Downsell geral (ver o comentário
      // em `abandonPendingSubscriptions`). Sem isto, dar /start de novo com
      // um PIX/cartão pendente na mão fazia os DOIS funis de recuperação
      // rodarem juntos pro mesmo lead.
      abandonPendingSubscriptions(bot.id, from.id);
      // O mesmo código de origem também fica no usuário, para a lista mostrar
      // por qual link cada pessoa chegou.
      if (sourceCode) {
        upsertTelegramUser({
          botId: bot.id,
          profileId: bot.profileId,
          telegramUserId: from.id,
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name,
          chatId: String(chat.id),
          canDm: true,
          source: "start",
          sourceCode,
        });
      }
    }
  } catch (err) {
    console.error(`[hotdash] erro registrando chegada (bot ${bot.id}):`, err);
  }
}

/**
 * Conta a TRANSIÇÃO, não o evento: o Telegram manda a mesma entrada por dois
 * caminhos (a mensagem de serviço `new_chat_members` e o update `chat_member`),
 * e contar os dois dobraria o número. Comparando com o estado que já está
 * guardado, o segundo aviso não muda nada e por isso não conta de novo.
 *
 * Precisa rodar ANTES do upsert que grava o novo estado — depois dele os dois
 * valores já seriam iguais e nenhuma transição seria detectada.
 */
export function registraMudancaDeGrupo(
  bot: { id: string; profileId: string },
  telegramUserId: number,
  kind: "vip" | "previas",
  entrou: boolean,
): void {
  const atual = getTelegramUser(`${bot.id}_${telegramUserId}`);
  const estavaDentro = kind === "vip" ? atual?.inVip === true : atual?.inPrevias === true;
  if (estavaDentro === entrou) return; // nada mudou: aviso repetido
  recordGroupMembershipChange(bot.id, bot.profileId, kind, entrou);
}
