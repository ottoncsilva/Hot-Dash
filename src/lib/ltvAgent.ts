import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { callAiRaw } from "./ai";
import { getDb } from "./db";
import { getMediaRow, getOrCreatePublicToken } from "./media";
import { publicOriginSemRequest } from "./publicOrigin";
import { activeProvider } from "./payments";
import { recordTransaction } from "./transactions";
import { ensureSyncpayWebhookShortToken } from "./settings";
import { sendEvolutionMedia, sendEvolutionText } from "./evolution";
import * as chip from "./telegramChip";
import {
  contarEnvio,
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

function baseDeMidia(): string {
  return resolve(process.env.MEDIA_STORAGE_DIR || "/app/data");
}

/** Link público e opaco do arquivo — é como o chip do Telegram o baixa. */
function urlPublicaDaMidia(mediaId: string): string | null {
  const token = getOrCreatePublicToken(mediaId);
  if (!token) return null;
  return `${publicOriginSemRequest()}/api/public/media/${token}`;
}

function adaptadorWhatsapp(conta: LtvAccount, peerRef: string): Adaptador {
  const instancia = conta.externalRef;
  if (!instancia) throw new Error("Esta conta de WhatsApp não tem instância conectada.");
  return {
    async texto(t) {
      await sendEvolutionText(instancia, peerRef, t);
    },
    async codigo(t) {
      // O WhatsApp não tem toque-para-copiar; mandar cercado por crases só
      // sujaria o código que o lead vai colar no banco.
      await sendEvolutionText(instancia, peerRef, t);
    },
    async midia(mediaId, legenda) {
      const row = getMediaRow(mediaId);
      if (!row) throw new Error("Arquivo não encontrado na Galeria.");
      const base64 = readFileSync(resolve(baseDeMidia(), row.path)).toString("base64");
      await sendEvolutionMedia(instancia, peerRef, base64, row.mime || "image/jpeg", legenda);
    },
    async audio(a) {
      const base64 = readFileSync(resolve(baseDeMidia(), a.path)).toString("base64");
      await sendEvolutionMedia(instancia, peerRef, base64, a.mime || "audio/ogg", "");
    },
    async digitando() {
      // A Evolution já manda "composing" junto do texto (ver sendEvolutionText).
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
      const url = urlPublicaDaMidia(mediaId);
      if (!url) throw new Error("Arquivo não encontrado na Galeria.");
      const row = getMediaRow(mediaId);
      await chip.enviarMidia(conta.id, peerRef, {
        mediaUrl: url,
        mediaName: row?.filename,
        caption: legenda || undefined,
        accessHash: acessoDoLead,
      });
    },
    async audio(a) {
      const url = `${publicOriginSemRequest()}/api/ltv/audios/${a.id}/file`;
      await chip.enviarMidia(conta.id, peerRef, {
        mediaUrl: url,
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

/** Etiquetas de amostra da modelo — as prévias leves que esquentam o lead. */
function etiquetasDeAmostra(profileId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT t.name
         FROM tags t
         JOIN media_tags mt ON mt.tag_id = t.id
         JOIN media m ON m.id = mt.media_id
        WHERE m.profile_id = ? AND m.kind = 'image' AND COALESCE(m.hidden, 0) = 0`,
    )
    .all(profileId) as { name: string }[];
  return rows.map((r) => r.name);
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
  amostras: string[],
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

  partes.push(
    [
      "FORMATO OBRIGATÓRIO DA RESPOSTA — só JSON, nada fora dele:",
      "{",
      '  "tipo": "texto" | "amostra" | "audio" | "pix",',
      '  "resposta": "o que você diz ao lead",',
      '  "amostra_tag": "quando tipo=amostra, UMA etiqueta exata da lista",',
      '  "audio_contexto": "quando tipo=audio, UM contexto exato da lista",',
      '  "produto": "quando tipo=pix, o NOME EXATO de um produto da lista",',
      '  "desconto_pct": "quando tipo=pix e você combinou desconto, só o número (ex: 20)"',
      "}",
    ].join("\n"),
  );

  partes.push(
    amostras.length
      ? `ETIQUETAS DE AMOSTRA DISPONÍVEIS: [${amostras.join(", ")}]. Use tipo "amostra" para mandar uma prévia e esquentar o lead.`
      : 'VOCÊ NÃO TEM FOTOS CADASTRADAS: nunca use tipo "amostra".',
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

/**
 * Quanto tempo esperar antes de responder. O modo humano varia de verdade
 * dentro da janela; o fixo responde sempre perto do mínimo. Não é enfeite:
 * responder em 2 segundos, sempre, é o padrão que denuncia automação e derruba
 * a conta — no chip do Telegram principalmente.
 */
function esperaMs(agente: LtvAgentSettings): number {
  const min = agente.delayMinS * 1000;
  const max = Math.max(min, agente.delayMaxS * 1000);
  if (agente.rhythm === "fixo") return min;
  return min + Math.random() * (max - min);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ motor */

type Acao = {
  tipo?: string;
  resposta?: string;
  amostra_tag?: string;
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

function acharMidiaPorEtiqueta(profileId: string, etiqueta: string): string | null {
  const db = getDb();
  const row =
    (db
      .prepare(
        `SELECT m.id
           FROM media m
           JOIN media_tags mt ON mt.media_id = m.id
           JOIN tags t ON t.id = mt.tag_id
          WHERE m.profile_id = ? AND m.kind = 'image'
            AND COALESCE(m.hidden, 0) = 0 AND t.name = ?
          ORDER BY RANDOM() LIMIT 1`,
      )
      .get(profileId, etiqueta) as { id: string } | undefined) ||
    // Etiqueta inventada pela IA: manda outra foto em vez de mandar nada.
    (db
      .prepare(
        `SELECT id FROM media
          WHERE profile_id = ? AND kind = 'image' AND COALESCE(hidden, 0) = 0
          ORDER BY RANDOM() LIMIT 1`,
      )
      .get(profileId) as { id: string } | undefined);
  return row?.id || null;
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
  const cobranca = await provider.createPixCharge({
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
 * Responde uma mensagem que acabou de chegar. Chamado pelos dois webhooks
 * (Evolution e chip do Telegram) depois de gravar a mensagem do lead.
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

    const historico = listMessages(chat.id, 20);
    // "Só responder quem falar primeiro": sem nenhuma mensagem do lead, a
    // modelo não abre conversa. É a trava mais eficaz contra bloqueio.
    if (agente.onlyReplyFirst && !historico.some((m) => m.role === "user")) return;

    if (!podeEnviar(conta.id, agente.dailyLimit)) {
      console.warn(`LTV: conta ${conta.label} bateu o limite diário; não vou responder agora.`);
      return;
    }

    const produtos = listProducts(conta.id);
    const audios = listAudios(conta.id);
    const amostras = etiquetasDeAmostra(conta.profileId);

    const mensagens = [
      { role: "system", content: montarPrompt(agente, produtos, audios, amostras) },
      ...historico.map((m) => ({ role: m.role, content: m.content })),
    ];

    const bruto = await callAiRaw(JSON.stringify(mensagens), PROVEDOR_IA, {
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
      const mediaId = acharMidiaPorEtiqueta(conta.profileId, acao.amostra_tag || "");
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
