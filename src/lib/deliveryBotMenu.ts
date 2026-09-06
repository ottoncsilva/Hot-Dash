import "server-only";
import { getDb } from "./db";
import {
  createTarget,
  getTarget,
  listTargets,
  pairTarget,
  targetsByChat,
  unpairChat,
} from "./deliveryTargets";
import {
  authorizeDeliveryChat,
  getDeliveryAccessCode,
  getDeliveryChat,
  removeDeliveryChat,
  setDeliveryChatAlert,
} from "./settings";
import {
  answerTelegramCallback,
  editTelegramMessageText,
  sendTelegramMessage,
} from "./telegramApi";

/**
 * O MENU DO BOT DE ENTREGA — cadastrar um celular tocando em botões.
 *
 * Antes, ligar um aparelho era: abrir o painel, achar a modelo, criar o
 * aparelho, copiar `/vincular ABC123`, mandar para quem está com o celular,
 * essa pessoa colar no Telegram. Seis passos e um código diferente por
 * aparelho — e um erro de digitação devolvia "código não encontrado" sem
 * dizer o que fazer.
 *
 * Aqui o celular manda UMA vez o código de acesso do painel (Configurações →
 * Entrega das postagens) e, a partir daí, escolhe a modelo numa lista e o
 * aparelho noutra. Dá até para criar o aparelho de dentro do Telegram, com o
 * nome de quem está falando.
 *
 * O código de acesso não é burocracia repetida: é a única coisa que separa
 * "o celular da operação" de qualquer pessoa que descubra o @ do bot. Sem
 * ele, um estranho abriria a lista de modelos e apontaria os posts para o
 * próprio Telegram. Por isso ele é pedido uma vez POR CHAT, e não uma vez por
 * aparelho — o custo cai de N para 1 sem abrir a porta.
 *
 * O `/vincular <código>` antigo continua funcionando: quem já tinha o
 * comando colado num bloco de notas não fica na mão, e ele também autoriza o
 * chat (quem tem o código do aparelho tem acesso ao painel).
 */

/** Modelos por página no menu — o teclado do Telegram fica ilegível com mais
 *  de uma dúzia de botões empilhados num celular. */
const POR_PAGINA = 8;

type Botao = { text: string; callback_data: string };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function listarModelos(): { id: string; name: string }[] {
  return getDb()
    .prepare("SELECT id, name FROM profiles ORDER BY name COLLATE NOCASE")
    .all() as { id: string; name: string }[];
}

/** Como a pessoa se chama no Telegram — vira o nome do aparelho criado daqui
 *  e o "quem é este chat" na tela do painel. */
export function nomeDoChat(from: { username?: string; first_name?: string } | undefined): string | undefined {
  if (!from) return undefined;
  return from.username ? `@${from.username}` : from.first_name || undefined;
}

/* ------------------------------------------------------------- as telas */

/** O menu principal, que já diz o que ESTE celular recebe hoje. */
function telaMenu(chatId: string): { texto: string; teclado: Botao[][] } {
  const meus = targetsByChat(chatId);
  const chat = getDeliveryChat(chatId);
  const linhas = meus.map((t) => `• <b>${esc(t.profileName)}</b> — ${esc(t.label)}`);

  const texto = [
    "🤖 <b>Bot de entrega do Hot Dash</b>",
    "",
    meus.length > 0
      ? `Este celular recebe os posts de:\n${linhas.join("\n")}`
      : "Este celular ainda não recebe post nenhum.",
    chat?.alert ? "\n🔔 Este é o aparelho de MONITORAMENTO: acompanha todas as modelos." : "",
    "",
    "O que você quer fazer?",
  ]
    .filter(Boolean)
    .join("\n");

  const teclado: Botao[][] = [
    [{ text: "📱 Receber posts de uma modelo", callback_data: "dm_mod:0" }],
    [
      {
        text: chat?.alert
          ? "🔕 Deixar de ser o aparelho de monitoramento"
          : "🔔 Usar como aparelho de monitoramento",
        callback_data: chat?.alert ? "dm_alert:0" : "dm_alert:1",
      },
    ],
  ];
  if (meus.length > 0) {
    teclado.push([{ text: "🚫 Não receber mais nada aqui", callback_data: "dm_off" }]);
  }
  return { texto, teclado };
}

/** A lista de modelos, paginada. */
function telaModelos(pagina: number): { texto: string; teclado: Botao[][] } {
  const modelos = listarModelos();
  if (modelos.length === 0) {
    return {
      texto: "Nenhuma modelo cadastrada no painel ainda.",
      teclado: [[{ text: "‹ Voltar", callback_data: "dm_menu" }]],
    };
  }
  const paginas = Math.max(1, Math.ceil(modelos.length / POR_PAGINA));
  const p = Math.min(Math.max(0, pagina), paginas - 1);
  const fatia = modelos.slice(p * POR_PAGINA, (p + 1) * POR_PAGINA);

  const teclado: Botao[][] = fatia.map((m) => [
    { text: m.name, callback_data: `dm_apar:${m.id}` },
  ]);
  if (paginas > 1) {
    const nav: Botao[] = [];
    if (p > 0) nav.push({ text: "‹ Anteriores", callback_data: `dm_mod:${p - 1}` });
    if (p < paginas - 1) nav.push({ text: "Próximas ›", callback_data: `dm_mod:${p + 1}` });
    teclado.push(nav);
  }
  teclado.push([{ text: "‹ Voltar", callback_data: "dm_menu" }]);

  return {
    texto: `👤 <b>De qual modelo este celular publica?</b>${
      paginas > 1 ? `\n\nPágina ${p + 1} de ${paginas}` : ""
    }`,
    teclado,
  };
}

/** Os aparelhos de uma modelo — mais a opção de criar um aqui mesmo. */
function telaAparelhos(profileId: string, chatId: string): { texto: string; teclado: Botao[][] } {
  const modelo = getDb()
    .prepare("SELECT name FROM profiles WHERE id = ?")
    .get(profileId) as { name: string } | undefined;
  if (!modelo) {
    return {
      texto: "Esta modelo não está mais no painel.",
      teclado: [[{ text: "‹ Voltar", callback_data: "dm_mod:0" }]],
    };
  }
  const aparelhos = listTargets(profileId);
  const teclado: Botao[][] = aparelhos.map((t) => [
    {
      // O selo diz de cara o que aconteceria ao tocar: "✅" é o que já está
      // neste celular, "📵" está noutro (tocar aqui MUDA de celular).
      text: `${t.chatId === chatId ? "✅ " : t.chatId ? "📵 " : ""}${t.label}`,
      callback_data: `dm_bind:${t.id}`,
    },
  ]);
  teclado.push([{ text: "➕ Criar aparelho para este celular", callback_data: `dm_new:${profileId}` }]);
  teclado.push([{ text: "‹ Voltar", callback_data: "dm_mod:0" }]);

  const texto = [
    `👤 <b>${esc(modelo.name)}</b>`,
    "",
    aparelhos.length > 0
      ? "Toque no aparelho que É este celular. Os posts dessa modelo passam a chegar aqui."
      : "Esta modelo ainda não tem aparelho. Crie um para este celular abaixo.",
    aparelhos.some((t) => t.chatId && t.chatId !== chatId)
      ? "\n📵 = já está em outro celular. Tocar traz os posts para cá."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { texto, teclado };
}

/* --------------------------------------------------------- as mensagens */

/**
 * Trata uma mensagem de texto no bot de entrega.
 *
 * Devolve `true` quando a mensagem foi tratada aqui — o webhook não precisa
 * fazer mais nada com ela.
 */
export async function tratarMensagemDoMenu(
  botToken: string,
  chatId: string,
  texto: string,
  quem: string | undefined,
): Promise<boolean> {
  const autorizado = Boolean(getDeliveryChat(chatId));

  // O CÓDIGO DE ACESSO chega como texto solto (a pessoa cola o que está no
  // painel). É conferido antes de qualquer comando: é ele que abre a porta.
  const limpo = texto.trim().toUpperCase();
  if (!autorizado && limpo === getDeliveryAccessCode()) {
    authorizeDeliveryChat(chatId, quem);
    await sendTelegramMessage(botToken, chatId, "✅ Celular autorizado.");
    await mostrarMenu(botToken, chatId);
    return true;
  }

  if (!autorizado) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "👋 Este é o bot de entrega do Hot Dash.\n\n" +
        "Para liberar este celular, mande aqui o <b>código de acesso</b> que aparece " +
        "no painel em <i>Configurações → Entrega das postagens</i>.\n\n" +
        "Depois disso é só escolher a modelo numa lista — sem decorar código nenhum.",
    );
    return true;
  }

  await mostrarMenu(botToken, chatId);
  return true;
}

/** Manda o menu como mensagem nova (usado nos comandos). */
export async function mostrarMenu(botToken: string, chatId: string): Promise<void> {
  const { texto, teclado } = telaMenu(chatId);
  await sendTelegramMessage(botToken, chatId, texto, {
    reply_markup: { inline_keyboard: teclado },
  });
}

/**
 * Trata um toque nos botões do menu (`dm_*`).
 *
 * Devolve `false` quando o callback não é do menu — aí ele é dos botões de
 * confirmação da entrega e segue o outro caminho no webhook.
 */
export async function tratarCallbackDoMenu(
  botToken: string,
  cb: {
    id: string;
    data: string;
    chatId: string;
    messageId?: string;
    quem?: string;
  },
): Promise<boolean> {
  const [acao, arg] = cb.data.split(":");
  if (!acao.startsWith("dm_")) return false;

  // Um chat que perdeu a autorização (código regerado) não pode continuar
  // navegando na lista de modelos com o menu que já estava aberto na tela.
  if (!getDeliveryChat(cb.chatId)) {
    await answerTelegramCallback(botToken, cb.id, "Este celular não está mais autorizado.", true);
    await sendTelegramMessage(
      botToken,
      cb.chatId,
      "🔒 O código de acesso do painel foi trocado. Mande o código novo aqui para voltar a usar o menu.",
    );
    return true;
  }

  let aviso = "";
  let tela: { texto: string; teclado: Botao[][] };

  switch (acao) {
    case "dm_menu":
      tela = telaMenu(cb.chatId);
      break;

    case "dm_mod":
      tela = telaModelos(Number(arg) || 0);
      break;

    case "dm_apar":
      tela = telaAparelhos(arg, cb.chatId);
      break;

    case "dm_bind": {
      const alvo = getTarget(arg);
      if (!alvo) {
        aviso = "Este aparelho não existe mais.";
        tela = telaMenu(cb.chatId);
        break;
      }
      pairTarget(alvo.id, cb.chatId, cb.quem);
      aviso = `“${alvo.label}” agora é este celular.`;
      tela = telaMenu(cb.chatId);
      break;
    }

    case "dm_new": {
      // O nome sai de quem está falando: o aparelho é criado do celular, e
      // pedir um nome por texto aqui devolveria a conversa de digitação que o
      // menu veio justamente eliminar. O painel renomeia depois.
      const label = cb.quem ? `Celular de ${cb.quem}` : "Celular sem nome";
      try {
        const novo = createTarget(arg, label);
        pairTarget(novo.id, cb.chatId, cb.quem);
        aviso = `Aparelho “${label}” criado e ligado a este celular.`;
      } catch (err) {
        aviso = err instanceof Error ? err.message : "Não consegui criar o aparelho.";
      }
      tela = telaMenu(cb.chatId);
      break;
    }

    case "dm_alert": {
      const ligar = arg === "1";
      setDeliveryChatAlert(cb.chatId, ligar);
      aviso = ligar
        ? "Pronto: este é o aparelho de monitoramento. Recebe todo post de todas as modelos, cada confirmação e a cobrança de quem atrasa."
        : "Monitoramento desligado.";
      tela = telaMenu(cb.chatId);
      break;
    }

    case "dm_off": {
      const quantos = unpairChat(cb.chatId);
      removeDeliveryChat(cb.chatId);
      aviso =
        quantos > 0
          ? `Este celular saiu de ${quantos} aparelho(s).`
          : "Este celular não recebia nada.";
      // Sai também da autorização: "não quero mais nada aqui" inclui o menu.
      // Voltar exige o código de novo, que é o mesmo caminho de quem chega.
      await answerTelegramCallback(botToken, cb.id, aviso, true);
      if (cb.messageId) {
        await editTelegramMessageText(
          botToken,
          cb.chatId,
          cb.messageId,
          "🚫 Este celular não recebe mais nada.\n\nPara voltar, mande o código de acesso do painel.",
        );
      }
      return true;
    }

    default:
      tela = telaMenu(cb.chatId);
  }

  await answerTelegramCallback(botToken, cb.id, aviso || undefined);
  if (cb.messageId) {
    await editTelegramMessageText(botToken, cb.chatId, cb.messageId, tela.texto, {
      inline_keyboard: tela.teclado,
    });
  } else {
    await sendTelegramMessage(botToken, cb.chatId, tela.texto, {
      reply_markup: { inline_keyboard: tela.teclado },
    });
  }
  return true;
}
