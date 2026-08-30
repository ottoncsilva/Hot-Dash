import "server-only";
import { callAiChat } from "../ai";
import { getProfile } from "../profiles";
import { enviarMensagem } from "./api";
import {
  addMessage,
  contarEnvio,
  enviosHoje,
  getAccount,
  getAccountToken,
  getAgentSettings,
  getChat,
  janelaRestanteMs,
  listMessages,
  registrarSaida,
  setAccountStatus,
  type IgChat,
} from "./db";
import { AVISO_AUTOMACAO, montarPromptInstagram, motivoParaNaoEnviar } from "./prompt";

/**
 * O agente da DM do Instagram.
 *
 * Motor PRÓPRIO: não importa nada de `ltvAgent.ts` e nada de lá importa daqui.
 * A tentação de reaproveitar é grande — os dois "recebem mensagem e respondem
 * com IA" — mas o que manda em cada um é diferente demais: aquele aquece sem
 * prazo e vende no chat; este tem 24 horas cronometradas pela Meta, um teto de
 * turnos e uma lista de proibições que, se violada, custa a conta. Um motor só
 * viraria um emaranhado de `if (canal === ...)` no caminho mais sensível dos
 * dois.
 *
 * O provedor é a OpenAI, fixo. Não é configurável de propósito: a atividade
 * `instagram` já escolhe o MODELO em Configurações → Conexão com IA, e trocar
 * o provedor por aqui mudaria, sem aviso, quem lê as proibições de conteúdo.
 */

const PROVEDOR = "openai" as const;

/** Espera humana entre receber e responder, dentro da faixa da conta. */
function esperaMs(minS: number, maxS: number): number {
  const min = Math.max(0, minS);
  const max = Math.max(min, maxS);
  return (min + Math.random() * (max - min)) * 1000;
}

export type ResultadoResposta =
  | { enviou: true; texto: string }
  | { enviou: false; motivo: string };

/**
 * Responde UMA conversa. Nunca lança: é chamada a partir de webhook de
 * produção, e um erro aqui não pode virar 500 para a Meta (que reenviaria o
 * evento em laço).
 */
export async function responderDm(chatId: string): Promise<ResultadoResposta> {
  try {
    const chat = getChat(chatId);
    if (!chat) return { enviou: false, motivo: "conversa não existe mais" };
    if (chat.state === "paused") return { enviou: false, motivo: "conversa assumida pelo operador" };

    const conta = getAccount(chat.accountId);
    if (!conta) return { enviou: false, motivo: "conta não existe mais" };
    if (!conta.active) return { enviou: false, motivo: "conta desativada" };
    if (conta.status !== "connected") return { enviou: false, motivo: `conta ${conta.status}` };

    const cfg = getAgentSettings(conta.id);
    if (!cfg.enabled) return { enviou: false, motivo: "agente desligado nesta conta" };

    // A JANELA DA META, conferida ANTES de gastar uma chamada de IA: fora dela
    // o envio seria recusado de qualquer jeito, e pedir a resposta primeiro só
    // queimaria token para jogar fora.
    if (janelaRestanteMs(chat) <= 0) {
      return { enviou: false, motivo: "fora da janela de 24h da Meta" };
    }

    if (chat.turns >= cfg.maxTurns) {
      return { enviou: false, motivo: `conversa já teve as ${cfg.maxTurns} respostas do limite` };
    }
    if (cfg.dailyLimit > 0 && enviosHoje(conta.id) >= cfg.dailyLimit) {
      return { enviou: false, motivo: "limite diário da conta atingido" };
    }

    const token = getAccountToken(conta.id);
    if (!token) {
      setAccountStatus(conta.id, "error", "Sem token guardado — reconecte a conta.");
      return { enviou: false, motivo: "conta sem token" };
    }

    const perfil = await getProfile(conta.profileId);
    if (!perfil) return { enviou: false, motivo: "modelo não existe mais" };

    // PRIMEIRA RESPOSTA: o aviso de automação sai antes de tudo, exigido pela
    // política da Meta. Vai como mensagem própria para ser inequívoco — e
    // porque colado na resposta ele viraria parte do papo e passaria batido.
    if (chat.turns === 0) {
      await enviarMensagem(conta.igUserId, token, chat.peerRef, AVISO_AUTOMACAO);
      addMessage(chat.id, "assistant", AVISO_AUTOMACAO);
      contarEnvio(conta.id);
    }

    const historico = listMessages(chat.id, 30);
    const prompt = montarPromptInstagram(perfil, cfg, chat.turns);

    await new Promise((r) => setTimeout(r, esperaMs(cfg.delayMinS, cfg.delayMaxS)));

    // A janela é reconferida DEPOIS da espera: numa faixa de atraso larga, com
    // uma mensagem que já chegou perto do limite, ela pode ter fechado no meio.
    const agora = getChat(chat.id);
    if (!agora || janelaRestanteMs(agora) <= 0) {
      return { enviou: false, motivo: "a janela de 24h fechou durante a espera" };
    }
    if (agora.state === "paused") {
      return { enviou: false, motivo: "operador assumiu a conversa durante a espera" };
    }

    const texto = (
      await callAiChat(
        [
          { role: "system", content: prompt },
          ...historico.map((m) => ({ role: m.role, content: m.content })),
        ],
        PROVEDOR,
        { activity: "instagram", maxTokens: 200 },
      )
    )
      .trim()
      // Modelo às vezes devolve a fala entre aspas; sairiam na DM.
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim();

    if (!texto) return { enviou: false, motivo: "a IA devolveu vazio" };

    // A REDE DE SEGURANÇA. O prompt proíbe link e preço, mas prompt é pedido,
    // não garantia — e aqui uma única mensagem errada custa a conta da modelo.
    const proibido = motivoParaNaoEnviar(texto);
    if (proibido) {
      console.warn(`[hotdash] DM do Instagram barrada (${proibido}): ${texto.slice(0, 120)}`);
      return { enviou: false, motivo: `barrada pela checagem: ${proibido}` };
    }

    await enviarMensagem(conta.igUserId, token, chat.peerRef, texto);
    addMessage(chat.id, "assistant", texto);
    contarEnvio(conta.id);
    // "Mandou para a bio" é o que a conversa veio fazer. Reconhecido pelo
    // sentido, não pela frase: o prompt manda variar as palavras de propósito.
    registrarSaida(chat.id, /\bbio\b|\bstories?\b|\blinkzinho\b|\blink\b/i.test(texto));
    return { enviou: true, texto };
  } catch (err) {
    console.error("[hotdash] erro respondendo DM do Instagram:", err);
    return { enviou: false, motivo: err instanceof Error ? err.message : "falha" };
  }
}

/**
 * Envio manual, do painel — a modelo (ou o operador) assumindo a conversa.
 *
 * Passa pela mesma trava de janela, mas NÃO pela checagem de conteúdo: aqui
 * quem escreve é gente, e uma pessoa decidindo mandar um link é uma decisão
 * dela, com consequência que ela entende. A rede de segurança existe para o
 * que a IA escreve sozinha.
 */
export async function enviarPeloPainel(chatId: string, texto: string): Promise<void> {
  const chat = getChat(chatId);
  if (!chat) throw new Error("Conversa não encontrada.");
  const conta = getAccount(chat.accountId);
  if (!conta) throw new Error("Conta não encontrada.");
  const token = getAccountToken(conta.id);
  if (!token) throw new Error("Conta sem token — reconecte.");
  if (janelaRestanteMs(chat) <= 0) {
    throw new Error(
      "Passaram-se mais de 24h desde a última mensagem dela — o Instagram não deixa mais responder nesta conversa.",
    );
  }
  await enviarMensagem(conta.igUserId, token, chat.peerRef, texto);
  addMessage(chat.id, "assistant", texto);
  contarEnvio(conta.id);
  registrarSaida(chat.id, false);
}

/** Quanto tempo ainda dá para responder, em texto curto para a tela. */
export function janelaLegivel(chat: IgChat): string {
  const ms = janelaRestanteMs(chat);
  if (ms <= 0) return "fechada";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
}
