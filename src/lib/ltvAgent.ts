import "server-only";
import { callAiChat, type ChatMessage } from "./ai";
import { getDb } from "./db";
import { getAppTimeZone } from "./settings";
import { partsInTimeZone } from "./timezone";
import { getMediaRow, getOrCreatePublicToken } from "./media";
import { publicOriginSemRequest } from "./publicOrigin";
import { activeProvider } from "./payments";
import { recordTransaction } from "./transactions";
import { ensureSyncpayWebhookShortToken } from "./settings";
import * as uazapi from "./uazapi";
import * as chip from "./telegramChip";
import { decryptSecret } from "./crypto";
import {
  comprasDoLead,
  contarEnvio,
  getAccountSession,
  createOrder,
  getAccount,
  getAgent,
  getChat,
  insertMessage,
  listAudios,
  listMessages,
  listProducts,
  podeEnviar,
  setChatState,
  type LtvAccount,
  type LtvAgentSettings,
  type LtvAudio,
  type LtvChat,
  type LtvProduct,
} from "./ltvDb";

/**
 * O motor do LTV: a modelo conversando com o lead e fechando a venda sozinha.
 *
 * Um motor só para os dois canais. O que muda entre WhatsApp e Telegram é
 * apenas o ADAPTADOR de envio — o prompt, as travas de segurança, a cobrança e
 * a entrega são os mesmos. Duas cópias disso divergiriam na primeira correção.
 *
 * A IA roda em Grok, fixo: o LTV é conversa longa e safada, e trocar de
 * provedor no meio muda o jeito da modelo falar — o lead percebe.
 */

const PROVEDOR_IA = "grok" as const;

/* ------------------------------------------------------------- adaptadores */

type Adaptador = {
  texto(t: string): Promise<void>;
  /**
   * Texto que o lead COPIA com um toque — é como o código PIX vai.
   *
   * Botão de verdade não existe aqui: teclado inline é recurso de bot, e uma
   * conta real não consegue anexar. O equivalente nativo é o monoespaçado: no
   * Telegram, tocar num trecho de código copia e mostra "Copiado". No WhatsApp
   * não há esse gesto, então lá vira texto normal — que o lead seleciona e
   * copia como sempre fez.
   */
  codigo(t: string): Promise<void>;
  midia(mediaId: string, legenda: string): Promise<void>;
  audio(audio: LtvAudio): Promise<void>;
  digitando(): Promise<void>;
};

/**
 * O token da instância na uazapi, decifrado. Fica na mesma coluna que guarda a
 * sessão do chip do Telegram: os dois são a credencial da conta, e o canal diz
 * qual é qual.
 */
function tokenDaConta(conta: LtvAccount): string {
  const enc = getAccountSession(conta.id);
  if (!enc) {
    throw new Error("Este número não está conectado à uazapi. Reconecte na tela do LTV.");
  }
  return decryptSecret(enc);
}

/** Link público e opaco do arquivo — é como o WhatsApp e o chip o baixam. */
function urlPublicaDaMidia(mediaId: string): string | null {
  const token = getOrCreatePublicToken(mediaId);
  if (!token) return null;
  return `${publicOriginSemRequest()}/api/public/media/${token}`;
}

/**
 * Quanto tempo a modelo fica "digitando..." antes da mensagem cair.
 *
 * Sai de graça: a uazapi mostra a presença durante o `delay` do próprio envio,
 * então não há uma chamada separada que poderia ficar pendurada se o envio
 * falhasse no meio.
 *
 * O tempo é PROPORCIONAL ao tamanho, porque é isso que denuncia ou disfarça:
 * um textão que aparece instantaneamente não foi digitado por ninguém. ~55ms
 * por caractere é a velocidade de quem digita rápido no celular. O teto de 10
 * segundos existe porque acima disso o lead acha que travou e sai da conversa
 * — a espera longa de verdade é o ritmo humano, que acontece ANTES, em
 * silêncio.
 */
const MS_POR_CARACTERE = 55;
const DIGITANDO_MIN_MS = 800;
const DIGITANDO_MAX_MS = 10_000;

export function tempoDigitando(texto: string): number {
  const bruto = (texto || "").length * MS_POR_CARACTERE;
  return Math.round(Math.min(DIGITANDO_MAX_MS, Math.max(DIGITANDO_MIN_MS, bruto)));
}

function adaptadorWhatsapp(conta: LtvAccount, peerRef: string): Adaptador {
  const token = tokenDaConta(conta);
  return {
    async texto(t) {
      await uazapi.enviarTexto(token, peerRef, t, { delay: tempoDigitando(t) });
    },
    async codigo(t) {
      // Botão nativo que copia com um toque. Não é o /send/pix-button: aquele
      // recebe uma CHAVE pix e o dinheiro cairia fora da SyncPay, sem
      // conciliação e sem entrega automática.
      await uazapi.enviarBotaoCopiar(
        token,
        peerRef,
        {
          text: "É só tocar no botão que o código copia sozinho 😘",
          rotulo: "Copiar código PIX",
          codigo: t,
          footerText: "Assim que cair eu te mando na hora",
        },
        { delay: DIGITANDO_MIN_MS },
      );
    },
    async midia(mediaId, legenda) {
      const url = urlPublicaDaMidia(mediaId);
      if (!url) throw new Error("Arquivo não encontrado na Galeria.");
      const row = getMediaRow(mediaId);
      await uazapi.enviarMidia(
        token,
        peerRef,
        {
          type: row?.kind === "video" ? "video" : "image",
          file: url,
          text: legenda || undefined,
        },
        { delay: tempoDigitando(legenda) },
      );
    },
    async audio(a) {
      // `ptt` é a mensagem de voz de verdade, com a onda e o play — durante o
      // delay o WhatsApp mostra "Gravando áudio...".
      await uazapi.enviarMidia(
        token,
        peerRef,
        { type: "ptt", file: `${publicOriginSemRequest()}/api/ltv/audios/${a.id}/file` },
        { delay: 3000 },
      );
    },
    async digitando() {
      // Nada a fazer: a presença acompanha o `delay` de cada envio.
    },
  };
}

function adaptadorTelegram(
  conta: LtvAccount,
  peerRef: string,
  acessoDoLead?: string,
): Adaptador {
  return {
    async texto(t) {
      await chip.enviarTexto(conta.id, peerRef, t, acessoDoLead);
    },
    async codigo(t) {
      await chip.enviarTexto(conta.id, peerRef, t, acessoDoLead, { comoCodigo: true });
    },
    async midia(mediaId, legenda) {
      const row = getMediaRow(mediaId);
      if (!row) throw new Error("Arquivo não encontrado na Galeria.");
      await chip.enviarMidia(conta.id, peerRef, {
        filePath: row.path,
        mediaName: row.filename,
        caption: legenda || undefined,
        accessHash: acessoDoLead,
      });
    },
    async audio(a) {
      await chip.enviarMidia(conta.id, peerRef, {
        filePath: a.path,
        mediaName: a.filename,
        voice: true,
        accessHash: acessoDoLead,
      });
    },
    async digitando() {
      await chip.mostrarDigitando(conta.id, peerRef, acessoDoLead);
    },
  };
}

function adaptadorDe(conta: LtvAccount, chat: LtvChat): Adaptador {
  return conta.channel === "telegram"
    ? adaptadorTelegram(conta, chat.peerRef, chat.peerAccessHash)
    : adaptadorWhatsapp(conta, chat.peerRef);
}

/* ------------------------------------------------------------------ prompt */

/**
 * Amostras/prévias VÁLIDAS da conta — ids escolhidos a dedo na tela
 * (`sampleMediaIds`), filtrados contra o que ainda existe de fato na
 * Galeria. Sem o filtro, uma foto apagada depois de escolhida ficaria presa
 * na lista para sempre e a IA tentaria mandar uma mídia que já não existe.
 */
function amostrasValidas(profileId: string, sampleMediaIds: string[]): string[] {
  if (!sampleMediaIds.length) return [];
  const placeholders = sampleMediaIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id FROM media
        WHERE profile_id = ? AND kind = 'image' AND COALESCE(hidden, 0) = 0
          AND id IN (${placeholders})`,
    )
    .all(profileId, ...sampleMediaIds) as { id: string }[];
  return rows.map((r) => r.id);
}

const ABORDAGEM: Record<LtvAgentSettings["approach"], string> = {
  aquecer:
    "ABORDAGEM: AQUECER. Este lead já é assinante e já te conhece. Conversa longa: " +
    "puxa assunto, pergunta da vida dele, sobe o tesão aos poucos. NÃO fale de preço " +
    "nem de pacote antes de ele pedir. Quando ele pedir, aí sim ofereça.",
  direto:
    "ABORDAGEM: DIRETO (tráfego pago). Este lead é FRIO, veio de anúncio e não te " +
    "conhece. Roteiro curto: gancho + pergunta o nome, manda uma amostra, mostra o que " +
    "você tem e puxa o PIX. Fecha em poucas mensagens, sem enrolar.",
};

function montarPrompt(
  agente: LtvAgentSettings,
  produtos: LtvProduct[],
  audios: LtvAudio[],
  temAmostras: boolean,
  compras: { nome: string; cents: number; quando: number }[] = [],
): string {
  const partes: string[] = [];

  partes.push(
    `Você é ${agente.personaName || "a modelo"}, uma mulher real conversando pelo aplicativo de mensagens dela.`,
  );
  if (agente.toneTags.length) {
    partes.push(
      `SEU JEITO: ${agente.toneTags.join(" + ")}. Alterne entre esses traços ao longo da conversa, não use todos de uma vez.`,
    );
  }
  if (agente.personality) partes.push(`QUEM VOCÊ É: ${agente.personality}`);
  if (agente.mechanism) partes.push(`SUA HISTÓRIA (use para criar conexão e vender): ${agente.mechanism}`);
  if (agente.limits) partes.push(`O QUE VOCÊ NUNCA FAZ: ${agente.limits}`);
  partes.push(ABORDAGEM[agente.approach]);

  partes.push(
    [
      "REGRAS DE CONVERSA:",
      "- Mensagens CURTAS, como gente digitando no celular. Nada de parágrafo.",
      "- Nunca diga que é uma IA, um bot ou um sistema, nem fale do painel.",
      "- Não prometa nada que não esteja na lista de produtos.",
    ].join("\n"),
  );

  if (produtos.length) {
    partes.push(
      "SEUS PRODUTOS (só estes existem; o valor é exato):\n" +
        produtos
          .map(
            (p) =>
              `- "${p.name}" — R$ ${(p.priceCents / 100).toFixed(2)}` +
              (p.description ? ` — ${p.description}` : "") +
              (p.deliveryKind === "videocall" ? " (é uma chamada de vídeo)" : ""),
          )
          .join("\n"),
    );
    partes.push(
      agente.maxDiscountPct > 0
        ? [
            `NEGOCIAÇÃO: o desconto é a sua ÚLTIMA CARTADA para não perder a venda — até`,
            `${agente.maxDiscountPct}% do valor do pacote. Comece sempre pelo preço cheio e`,
            "defenda ele. Só baixe quando o lead estiver escapando de verdade: disse que está",
            "caro e travou, ou está indo embora da conversa. Nunca ofereça desconto antes de",
            "ele reclamar do preço, e nunca dê o máximo de cara — desça aos poucos.",
            'Para cobrar com desconto, mande "desconto_pct" (só o número) junto do tipo "pix";',
            "o sistema gera a cobrança já com o valor abatido.",
          ].join(" ")
        : "NEGOCIAÇÃO: o preço é fixo. Você NÃO pode dar desconto — se o lead reclamar, segure o valor e mostre o que ele leva por ele.",
    );
  } else {
    partes.push("VOCÊ AINDA NÃO TEM PRODUTO CADASTRADO: nunca fale de preço nem gere cobrança.");
  }

  // O que ele já pagou. Sem isto a IA reoferece o pacote que o cara comprou na
  // semana passada — a forma mais rápida de queimar um cliente bom — e perde a
  // única deixa boa que existe para subir de degrau.
  if (compras.length) {
    const total = compras.reduce((soma, c) => soma + c.cents, 0);
    partes.push(
      "ELE JÁ COMPROU DE VOCÊ (nunca ofereça de novo o mesmo pacote; trate como cliente, não como lead novo):\n" +
        compras
          .map(
            (c) =>
              `- "${c.nome}" por R$ ${(c.cents / 100).toFixed(2)} em ` +
              new Date(c.quando).toLocaleDateString("pt-BR"),
          )
          .join("\n") +
        `\nTotal já gasto: R$ ${(total / 100).toFixed(2)}.`,
    );
  }

  partes.push(
    [
      "FORMATO OBRIGATÓRIO DA RESPOSTA — só JSON, nada fora dele:",
      "{",
      '  "tipo": "texto" | "amostra" | "audio" | "pix",',
      '  "resposta": "o que você diz ao lead",',
      '  "audio_contexto": "quando tipo=audio, UM contexto exato da lista",',
      '  "produto": "quando tipo=pix, o NOME EXATO de um produto da lista",',
      '  "desconto_pct": "quando tipo=pix e você combinou desconto, só o número (ex: 20)"',
      "}",
    ].join("\n"),
  );

  partes.push(
    temAmostras
      ? 'Você tem FOTOS DE AMOSTRA cadastradas. Use tipo "amostra" para mandar uma prévia e esquentar o lead — o sistema escolhe qual foto mandar, você só decide QUANDO usar esse tipo.'
      : 'VOCÊ NÃO TEM FOTOS DE AMOSTRA CADASTRADAS: nunca use tipo "amostra".',
  );

  const contextos = audios.map((a) => a.context).filter(Boolean);
  partes.push(
    contextos.length
      ? `ÁUDIOS DA SUA VOZ DISPONÍVEIS (contextos): [${contextos.join(", ")}]. Use tipo "audio" quando um áudio couber melhor que texto — é o que mais convence.`
      : 'VOCÊ NÃO TEM ÁUDIOS GRAVADOS: nunca use tipo "audio".',
  );

  partes.push(
    produtos.length
      ? 'Use tipo "pix" SÓ quando o lead já decidiu comprar. O sistema gera a cobrança e manda o código; na "resposta" fale como quem está mandando o PIX, sem inventar código nenhum.'
      : "",
  );

  return partes.filter(Boolean).join("\n\n");
}

/* ------------------------------------------------------------------ ritmo */

/** Sorteia um inteiro no intervalo, com as duas pontas incluídas. */
function entre(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * A que horas é agora, no fuso do painel.
 *
 * Precisa ser a hora de PAREDE do Brasil, não a do servidor: uma VPS em UTC
 * acharia que é de manhã justamente quando é madrugada aqui, e a modelo
 * responderia às 3 da manhã — que é exatamente o que este código evita.
 */
function horaLocal(): number {
  return partsInTimeZone(Date.now(), getAppTimeZone()).hour;
}

/** Depois disso ela dormiu; antes disso ainda não acordou. */
const DORME_AS = 2;
const ACORDA_ENTRE = [7, 8] as const;

/**
 * Quanto tempo esperar antes de responder.
 *
 * O modo HUMANO não tem janela em segundos, de propósito: pessoa de verdade
 * não responde num intervalo fixo. Às vezes ela está com o celular na mão e
 * responde em menos de um minuto; às vezes está fazendo outra coisa e some por
 * meia hora. E de madrugada ela dorme — se a mensagem chega depois das 2h, a
 * resposta só sai quando ela acordar, entre 7 e 8 da manhã.
 *
 * É essa irregularidade que faz a conta parecer gente. Um robô bem configurado
 * responde sempre dentro da mesma faixa, e é isso que denuncia.
 *
 * O modo RÁPIDO FIXO é o oposto e existe para quem quer velocidade: aí sim
 * valem os segundos configurados na tela.
 */
export function esperaMs(agente: LtvAgentSettings, agoraHora = horaLocal()): number {
  if (agente.rhythm === "fixo") {
    const min = Math.max(0, agente.delayMinS) * 1000;
    const max = Math.max(min, agente.delayMaxS * 1000);
    return entre(min, max);
  }

  // Madrugada: dorme até o começo da manhã. O alvo é sorteado dentro da
  // janela de acordar para não sair uma enxurrada de respostas às 7h em ponto.
  if (agoraHora >= DORME_AS && agoraHora < ACORDA_ENTRE[1]) {
    const alvo = entre(ACORDA_ENTRE[0] * 60, ACORDA_ENTRE[1] * 60); // em minutos
    const agoraMin = agoraHora * 60 + new Date().getMinutes();
    const faltam = alvo - agoraMin;
    if (faltam > 0) return faltam * 60 * 1000;
  }

  // Fora da madrugada: a maior parte das respostas é rápida, mas de vez em
  // quando ela some. Os pesos é que criam a irregularidade — uma faixa única
  // daria uma média sempre igual, que é o que se quer evitar. O "sumiu de
  // vez" é RARO (10%) e tem teto de 20 min — 30 min estava deixando o lead
  // esfriar e acontecendo com frequência maior do que a de alguém ocupado.
  const sorte = Math.random();
  if (sorte < 0.55) return entre(20, 90) * 1000; //    mais da metade: quase na hora
  if (sorte < 0.9) return entre(2, 8) * 60 * 1000; //  estava ocupada
  return entre(10, 20) * 60 * 1000; //                 sumiu de vez — raro, e no máximo 20 min
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ motor */

type Acao = {
  tipo?: string;
  resposta?: string;
  audio_contexto?: string;
  produto?: string;
  desconto_pct?: number | string;
};

function parseAcao(bruto: string): Acao {
  const limpo = bruto.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(limpo) as Acao;
  } catch {
    // A IA às vezes escreve uma frase antes do JSON. Melhor pescar o objeto do
    // que perder a resposta inteira e deixar o lead no vácuo.
    const inicio = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (inicio >= 0 && fim > inicio) {
      try {
        return JSON.parse(limpo.slice(inicio, fim + 1)) as Acao;
      } catch {
        /* desiste abaixo */
      }
    }
    return { tipo: "texto", resposta: limpo };
  }
}

/** Sorteia uma amostra entre as escolhidas na tela — cada lead vê uma foto
 *  diferente, para não denunciar o roteiro mandando sempre a mesma prévia. */
function sortearAmostra(sampleMediaIds: string[]): string | null {
  if (!sampleMediaIds.length) return null;
  return sampleMediaIds[Math.floor(Math.random() * sampleMediaIds.length)];
}

/**
 * Quanto cobrar de fato. O desconto que a IA pediu é CORTADO no teto
 * configurado — a IA negocia, mas quem decide o piso é a pessoa que
 * configurou a conta. Sem esse corte, bastaria o lead insistir para o pacote
 * sair por qualquer valor.
 */
function precoComDesconto(
  produto: LtvProduct,
  pedido: number | string | undefined,
  tetoPct: number,
): { cents: number; descontoPct: number } {
  const bruto = Number(String(pedido ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(bruto) || bruto <= 0) {
    return { cents: produto.priceCents, descontoPct: 0 };
  }
  const pct = Math.min(Math.round(bruto), Math.max(0, tetoPct));
  if (pct <= 0) return { cents: produto.priceCents, descontoPct: 0 };
  return {
    cents: Math.max(1, Math.round(produto.priceCents * (1 - pct / 100))),
    descontoPct: pct,
  };
}

/** Gera a cobrança e devolve o texto do copia-e-cola para mandar ao lead. */
async function cobrarPix(
  chat: LtvChat,
  conta: LtvAccount,
  produto: LtvProduct,
  descontoPedido: number | string | undefined,
  tetoDescontoPct: number,
): Promise<string | null> {
  const provider = activeProvider();
  if (!provider) {
    console.error("LTV: PIX pedido sem provedor de pagamento configurado.");
    return null;
  }
  const { cents, descontoPct } = precoComDesconto(produto, descontoPedido, tetoDescontoPct);
  const descricao = descontoPct > 0 ? `${produto.name} (-${descontoPct}%)` : produto.name;

  const postbackUrl = `${publicOriginSemRequest()}/w/${ensureSyncpayWebhookShortToken()}`;
  const cobranca = await provider.createCharge({
    amountCents: cents,
    description: descricao,
    customer: { name: chat.peerName || "Lead do LTV" },
    postbackUrl,
  });
  const tx = recordTransaction({
    provider: provider.key,
    providerRef: cobranca.providerRef,
    profileId: conta.profileId,
    description: descricao,
    customer: chat.peerName,
    amountCents: cents,
    method: "pix",
    status: cobranca.status,
    origin: "ltv",
  });
  createOrder({
    chatId: chat.id,
    productId: produto.id,
    transactionId: tx.id,
    amountCents: cents,
    listPriceCents: produto.priceCents,
    source: "ia",
  });
  return cobranca.pixCode || null;
}

/**
 * Buffer de mensagens: junta uma RAJADA de mensagens do lead numa resposta só.
 *
 * Sem isto, cada mensagem do lead disparava o SEU PRÓPRIO `responderLead` em
 * paralelo — quem manda "oi" "vc tá aí?" "quero comprar" em três toques
 * (comum no celular) gerava três chamadas à IA rodando ao mesmo tempo, cada
 * uma vendo um pedaço diferente do histórico, e as respostas chegavam fora de
 * ordem, repetidas ou se contradizendo. Um humano lê a rajada inteira antes
 * de responder; é isso que o buffer imita.
 *
 * Duas travas, uma por chat:
 *  - DEBOUNCE: cada mensagem nova adia o disparo em `JANELA_BUFFER_MS`. Só quando o
 *    lead FICA CALADO por essa janela é que a IA lê o histórico (já com tudo
 *    que ele mandou) e responde uma vez.
 *  - FILA DE 1: se uma mensagem chegar enquanto uma resposta anterior ainda
 *    está em voo (o `responderLead` pode ficar minutos "esperando" antes de
 *    mandar, de propósito — é o ritmo humano), ela não dispara uma segunda
 *    chamada por cima; só marca que há novidade, e o buffer dispara de novo
 *    assim que a resposta em andamento terminar. Nunca duas em paralelo.
 */
const JANELA_BUFFER_MS = 15_000;

type BufferChat = {
  timer: ReturnType<typeof setTimeout> | null;
  emAndamento: boolean;
  pendenteAoTerminar: boolean;
};
const buffers = new Map<string, BufferChat>();

async function dispararBuffer(chatId: string): Promise<void> {
  const buf = buffers.get(chatId);
  if (!buf) return;
  buf.timer = null;
  buf.emAndamento = true;
  try {
    await responderLead(chatId);
  } finally {
    buf.emAndamento = false;
    // Chegou mensagem nova enquanto a de cima estava em voo: mais uma leva,
    // com a mesma janela de espera — não é urgente ler ela sozinha.
    if (buf.pendenteAoTerminar) {
      buf.pendenteAoTerminar = false;
      buf.timer = setTimeout(() => void dispararBuffer(chatId), JANELA_BUFFER_MS);
    } else {
      buffers.delete(chatId);
    }
  }
}

/**
 * Chamar a cada mensagem NOVA do lead, no lugar de `responderLead` direto —
 * os dois webhooks (Evolution e chip do Telegram) usam este ponto de entrada.
 */
export function agendarResposta(chatId: string): void {
  let buf = buffers.get(chatId);
  if (!buf) {
    buf = { timer: null, emAndamento: false, pendenteAoTerminar: false };
    buffers.set(chatId, buf);
  }
  if (buf.emAndamento) {
    buf.pendenteAoTerminar = true;
    return;
  }
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => void dispararBuffer(chatId), JANELA_BUFFER_MS);
}

/**
 * Responde uma mensagem que acabou de chegar. Chamado pelo buffer acima
 * depois que o lead fica quieto, já com toda a rajada gravada.
 *
 * Nunca lança: um erro aqui é um lead sem resposta, não um webhook com 500 —
 * o provedor reentregaria o evento e a modelo mandaria a mesma coisa de novo.
 */
export async function responderLead(chatId: string): Promise<void> {
  try {
    const chat = getChat(chatId);
    if (!chat) return;
    const conta = getAccount(chat.accountId);
    if (!conta) return;
    const agente = getAgent(conta.id);

    if (!agente.enabled) return;
    // A conversa foi assumida por uma pessoa no Chat ao vivo. A IA cala a boca
    // até religarem — duas vozes no mesmo chat é o pior resultado possível.
    if (chat.state === "paused") return;

    // 200 mensagens, não 20. Guardamos 40 dias de conversa justamente para a
    // IA poder puxar o que foi dito lá atrás; com uma janela de 20 ela
    // esquecia o nome do lead entre uma visita e outra e recomeçava do zero.
    const historico = listMessages(chat.id, 200);
    // "Só responder quem falar primeiro": sem nenhuma mensagem do lead, a
    // modelo não abre conversa. É a trava mais eficaz contra bloqueio.
    if (agente.onlyReplyFirst && !historico.some((m) => m.role === "user")) return;

    if (!podeEnviar(conta.id, agente.dailyLimit)) {
      console.warn(`LTV: conta ${conta.label} bateu o limite diário; não vou responder agora.`);
      return;
    }

    const produtos = listProducts(conta.id);
    const audios = listAudios(conta.id);
    const amostras = amostrasValidas(conta.profileId, agente.sampleMediaIds);
    const compras = comprasDoLead(chat.id);

    // Mensagens de PAPEL DE VERDADE — não mais um JSON.stringify de tudo
    // dentro de uma única mensagem "user". A persona vai como "system", que é
    // a instrução com mais peso pra maioria dos modelos, e o histórico entra
    // como uma conversa de fato (um "user"/"assistant" por vez), do jeito que
    // a API de chat foi desenhada pra ler. Menos tokens gastos com sintaxe
    // (200 mensagens de histórico não carregam mais `{"role":...,"content":`
    // escrito por extenso a cada uma) e mais aderência à persona.
    const mensagens: ChatMessage[] = [
      {
        role: "system",
        content: montarPrompt(agente, produtos, audios, amostras.length > 0, compras),
      },
      ...historico.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    ];

    const bruto = await callAiChat(mensagens, PROVEDOR_IA, {
      maxTokens: 500,
      activity: "whatsapp",
    });
    if (!bruto) return;
    const acao = parseAcao(bruto);
    let texto = (acao.resposta || "").trim();

    const adaptador = adaptadorDe(conta, chat);
    await adaptador.digitando();
    await dormir(esperaMs(agente));

    // Entre o pedido à IA e o envio pode ter passado um minuto. Se nesse tempo
    // uma pessoa assumiu a conversa, a resposta da IA já não deve sair.
    if (getChat(chat.id)?.state === "paused") return;

    let tipo = acao.tipo || "texto";
    if (tipo === "amostra" && !amostras.length) tipo = "texto";
    if (tipo === "audio" && !audios.length) tipo = "texto";
    if (tipo === "pix" && !produtos.length) tipo = "texto";

    if (tipo === "pix") {
      const produto =
        produtos.find((p) => p.name.toLowerCase() === (acao.produto || "").toLowerCase()) ||
        produtos[0];
      // A SyncPay pode estar fora do ar ou recusar a cobrança. Isso não pode
      // virar silêncio: o lead acabou de dizer que quer comprar, e sumir aí é
      // perder a venda que já estava fechada.
      let pixCode: string | null = null;
      try {
        pixCode = await cobrarPix(chat, conta, produto, acao.desconto_pct, agente.maxDiscountPct);
      } catch (e) {
        console.error("LTV: falha gerando a cobrança na SyncPay:", e);
      }
      if (pixCode) {
        if (texto) {
          await adaptador.texto(texto);
          insertMessage({ chatId: chat.id, role: "assistant", content: texto, type: "text" });
          contarEnvio(conta.id);
        }
        // O código vai SOZINHO numa mensagem, em monoespaçado: no Telegram um
        // toque copia. Misturado com a conversa, o lead copiaria junto o "toca
        // aqui pra copiar amor" e o banco recusaria o código.
        await adaptador.codigo(pixCode);
        insertMessage({ chatId: chat.id, role: "assistant", content: pixCode, type: "pix" });
        contarEnvio(conta.id);
        return;
      }
      // Sem cobrança não há o que mandar — mas a IA não inventa código.
      tipo = "texto";
      if (!texto) texto = "Peraí amor, já te mando o pix 😘";
    }

    if (tipo === "amostra") {
      const mediaId = sortearAmostra(amostras);
      if (mediaId) {
        await adaptador.midia(mediaId, texto);
        insertMessage({ chatId: chat.id, role: "assistant", content: texto, type: "imagem" });
        contarEnvio(conta.id);
        return;
      }
      tipo = "texto";
    }

    if (tipo === "audio") {
      const alvo =
        audios.find(
          (a) => a.context.toLowerCase() === (acao.audio_contexto || "").toLowerCase(),
        ) || audios[0];
      if (alvo) {
        await adaptador.audio(alvo);
        insertMessage({
          chatId: chat.id,
          role: "assistant",
          content: texto || `🎤 ${alvo.context || "áudio"}`,
          type: "audio",
        });
        contarEnvio(conta.id);
        return;
      }
      tipo = "texto";
    }

    if (!texto) return;
    await adaptador.texto(texto);
    insertMessage({ chatId: chat.id, role: "assistant", content: texto, type: "text" });
    contarEnvio(conta.id);
  } catch (err) {
    console.error("LTV: erro respondendo o lead:", err);
  }
}

/**
 * Envio feito por uma PESSOA no Chat ao vivo. Pausa a IA no mesmo movimento:
 * é o "desliga sozinho quando você responder por aqui" da tela. Ter que
 * lembrar de desligar antes de digitar é justamente o jeito de acabar com duas
 * vozes no mesmo chat.
 */
export async function enviarPeloPainel(
  chatId: string,
  conteudo: { text?: string; mediaId?: string },
): Promise<void> {
  const chat = getChat(chatId);
  if (!chat) throw new Error("Conversa não encontrada.");
  const conta = getAccount(chat.accountId);
  if (!conta) throw new Error("Conta não encontrada.");

  const adaptador = adaptadorDe(conta, chat);
  if (conteudo.mediaId) {
    await adaptador.midia(conteudo.mediaId, conteudo.text || "");
    insertMessage({
      chatId: chat.id,
      role: "assistant",
      content: conteudo.text || "📸 Mídia enviada pelo painel",
      type: "imagem",
    });
  } else {
    const texto = (conteudo.text || "").trim();
    if (!texto) throw new Error("Escreva a mensagem.");
    await adaptador.texto(texto);
    insertMessage({ chatId: chat.id, role: "assistant", content: texto, type: "text" });
  }
  contarEnvio(conta.id);
  setChatState(chat.id, "paused");
}

/**
 * Marca o lead como PAGO com uma etiqueta no próprio WhatsApp.
 *
 * Serve para quem abre o WhatsApp no celular e precisa saber, de bate-pronto,
 * quem já comprou — sem abrir o painel. A etiqueta é criada na instância na
 * primeira venda e reaproveitada depois.
 *
 * Nunca lança: a venda já está paga e o conteúdo já foi entregue; falhar em
 * colorir uma conversa não pode derrubar nada disso.
 */
const ETIQUETA_PAGO = "Pago";

export async function etiquetarComoPago(conta: LtvAccount, peerRef: string): Promise<void> {
  if (conta.channel !== "whatsapp") return;
  try {
    const token = tokenDaConta(conta);
    const existentes = await uazapi.listarEtiquetas(token);
    const achar = (lista: uazapi.UazapiLabel[]) =>
      lista.find((l) => (l.name || "").trim().toLowerCase() === ETIQUETA_PAGO.toLowerCase());

    let etiqueta = achar(existentes);
    if (!etiqueta) {
      await uazapi.criarEtiqueta(token, ETIQUETA_PAGO);
      // O id definitivo só aparece relendo — a criação não o devolve.
      etiqueta = achar(await uazapi.listarEtiquetas(token));
    }
    const id = etiqueta?.labelid || etiqueta?.id;
    if (!id) {
      console.error('LTV: não consegui descobrir o id da etiqueta "Pago".');
      return;
    }
    await uazapi.marcarChatComEtiqueta(token, peerRef, String(id));
  } catch (e) {
    console.error("LTV: falha etiquetando o lead como pago:", e);
  }
}

/**
 * Entrega o produto quando o PIX cai. Chamado pelo webhook da SyncPay.
 * Manda os arquivos na ORDEM cadastrada — a sequência é escolhida na tela e é
 * parte do que foi vendido.
 */
export async function entregarPedido(orderId: string): Promise<void> {
  const db = getDb();
  const pedido = db.prepare(`SELECT * FROM ltv_orders WHERE id = ?`).get(orderId) as any;
  if (!pedido) return;
  const chat = getChat(pedido.chat_id);
  if (!chat) return;
  const conta = getAccount(chat.accountId);
  if (!conta) return;

  const adaptador = adaptadorDe(conta, chat);
  const produto = pedido.product_id
    ? listProducts(conta.id).find((p) => p.id === pedido.product_id)
    : undefined;

  await etiquetarComoPago(conta, chat.peerRef);

  if (!produto) {
    await adaptador.texto("Pagamento confirmado, amor! Já te mando aqui 😘");
    return;
  }

  if (produto.deliveryKind === "videocall") {
    // Chamada de vídeo não tem arquivo para entregar: quem combina é a pessoa.
    await adaptador.texto(
      produto.extraMessage ||
        "Pagamento confirmado! Me chama aqui que a gente marca a nossa chamada 😈",
    );
    insertMessage({
      chatId: chat.id,
      role: "assistant",
      content: "Pagamento confirmado — chamada de vídeo a combinar.",
      type: "text",
    });
    return;
  }

  for (const mediaId of produto.mediaIds) {
    try {
      await adaptador.midia(mediaId, "");
      // Uma pausa curta entre arquivos: dez envios instantâneos seguidos é
      // exatamente o padrão que o WhatsApp e o Telegram leem como robô.
      await dormir(1500 + Math.random() * 1500);
    } catch (e) {
      console.error(`LTV: falhou ao entregar a mídia ${mediaId}:`, e);
    }
  }

  if (produto.extraMessage) await adaptador.texto(produto.extraMessage);

  insertMessage({
    chatId: chat.id,
    role: "assistant",
    content: `✅ Entregue: ${produto.name}`,
    type: "entrega",
  });
}
