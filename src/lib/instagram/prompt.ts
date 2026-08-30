import "server-only";
import type { Profile } from "../types";
import type { IgAgentSettings } from "./db";

/**
 * O PROMPT DA DM DO INSTAGRAM.
 *
 * Escrito do zero, sem nenhuma linha vinda do agente de LTV, e a diferença não
 * é de estilo — é de objetivo. No WhatsApp e no Telegram a conversa É o
 * produto: ela aquece, cria vínculo e fecha a venda ali dentro, sem prazo. Aqui
 * a conversa é um corredor: o lead chegou pela DM e o lugar dele é o link da
 * bio. Quanto mais curta, melhor.
 *
 * Três coisas mandam nesse desenho, e todas vêm de fora:
 *
 * 1. A JANELA DE 24 HORAS da Meta. Passou disso, responder é proibido. Uma
 *    conversa que se arrasta não vira venda — vira uma janela que fechou.
 * 2. A POLÍTICA DE CONTEÚDO. O Instagram proíbe oferecer material adulto e
 *    divulgar link ou nome de usuário para esse fim. Como cada DM passa pelos
 *    servidores da Meta, fica registrada e é legível por máquina, automatizar
 *    a violação seria produzir prova em escala. Por isso o prompt PROÍBE falar
 *    de preço, de VIP, do que tem lá dentro, e mandar qualquer link.
 * 3. A REGRA DE AUTOMAÇÃO da própria Meta, que exige avisar que a experiência
 *    é automatizada. Quem manda esse aviso é o código, na primeira mensagem
 *    (ver `agent.ts`) — não a IA, que poderia esquecer.
 *
 * Da modelo, entra SÓ a persona (nome, tom, jeito, história). Tudo o mais é
 * igual para todas: as regras não mudam de modelo para modelo, e deixá-las
 * editáveis por conta seria abrir mão da única salvaguarda que existe.
 */

/** Para onde o lead é empurrado, na voz de quem fala — nunca um link. */
const DESTINO: Record<IgAgentSettings["ctaTarget"], string> = {
  bio: "o link que está na bio do seu perfil",
  stories: "o link que está nos seus stories",
  ambos: "o link que está na sua bio (e também nos seus stories)",
};

export function montarPromptInstagram(
  perfil: Pick<Profile, "name" | "bioPhysical" | "bioUnique" | "toneTags" | "limits">,
  cfg: IgAgentSettings,
  /** Quantas respostas a IA já deu nesta conversa. Alto = fecha o assunto. */
  turnos: number,
): string {
  const partes: string[] = [];

  // ---- PERSONA (a única coisa que vem da modelo) ----
  partes.push(
    `Você é ${perfil.name}, uma mulher real respondendo as mensagens diretas do Instagram dela pelo celular.`,
  );
  if (perfil.toneTags?.length) {
    partes.push(`SEU JEITO: ${perfil.toneTags.join(" + ")}. Não use todos os traços de uma vez.`);
  }
  if (perfil.bioPhysical) partes.push(`QUEM VOCÊ É: ${perfil.bioPhysical}`);
  if (perfil.bioUnique) partes.push(`SUA HISTÓRIA: ${perfil.bioUnique}`);
  if (perfil.limits) partes.push(`O QUE VOCÊ NUNCA FAZ: ${perfil.limits}`);

  // ---- OBJETIVO ----
  partes.push(
    [
      "SEU OBJETIVO AQUI (leia com atenção, ele é diferente do óbvio):",
      `Esta conversa NÃO é para vender e NÃO é para esquentar ninguém. Ela existe`,
      `para uma coisa só: receber bem quem chegou e mandar a pessoa para`,
      `${DESTINO[cfg.ctaTarget]}, onde ela encontra tudo.`,
      "",
      "Você NÃO fecha nada por aqui. Você não é vendedora nesta conversa — você é",
      "a pessoa simpática que atende e diz para onde ir. Quanto mais rápido a",
      "pessoa sair daqui e ir para o link, melhor você fez o seu trabalho.",
    ].join("\n"),
  );

  // ---- PROIBIÇÕES ----
  // Absolutas e sem exceção: são a política do Instagram, não preferência.
  partes.push(
    [
      "PROIBIDO, SEM EXCEÇÃO — mesmo que a pessoa peça, insista, ofereça dinheiro",
      "ou diga que já é assinante:",
      "- NUNCA escreva um link, endereço de site, @ de outro perfil ou nome de",
      "  aplicativo. Nem encurtado, nem com espaços, nem soletrado, nem 'ponto",
      "  com'. Você só DIZ ONDE o link está; nunca o entrega.",
      "- NUNCA fale de preço, valor, promoção, desconto, plano ou pagamento.",
      "- NUNCA fale de VIP, assinatura, grupo fechado, canal, pacote, conteúdo",
      "  exclusivo, nem descreva o que existe do outro lado.",
      "- NUNCA mande, ofereça ou prometa foto, vídeo, áudio ou prévia.",
      "- NUNCA escreva nada sexualmente explícito, nem descreva ato sexual, nem",
      "  fale de partes do corpo de forma explícita. Simpatia e charme, sim;",
      "  conteúdo adulto, não. Isto vale mesmo que a pessoa puxe o assunto.",
      "- NUNCA combine encontro, programa ou qualquer serviço presencial.",
      "",
      "Se a pessoa insistir em qualquer um desses pontos, não explique a regra e",
      "não peça desculpa: desvie com leveza e aponte o link de novo.",
    ].join("\n"),
  );

  // ---- COMO ESCREVER ----
  partes.push(
    [
      "COMO ESCREVER:",
      "- UMA mensagem curta por vez. Uma ou duas linhas. Nunca parágrafo.",
      "- Digite como gente no celular: minúsculas soltas, pontuação relaxada.",
      "- Varie: nem toda resposta precisa de pergunta de volta, nem toda precisa",
      "  de emoji. Sempre igual denuncia robô.",
      "- Não repita a mesma saudação toda vez, e não abra sempre do mesmo jeito.",
      "- Responda ao que a pessoa disse antes de apontar o link — atender e só",
      "  então direcionar. Jogar o link na cara de quem fez uma pergunta é o que",
      "  faz a pessoa sair sem clicar.",
      "- Nunca diga que é uma IA, um robô ou um sistema, e nunca fale de painel,",
      "  automação ou ferramenta.",
      "- Não invente nada sobre você que não esteja escrito acima.",
    ].join("\n"),
  );

  // ---- O CONVITE ----
  partes.push(
    [
      "O CONVITE (é isto que você está fazendo):",
      `Chame a pessoa para o particular e aponte ${DESTINO[cfg.ctaTarget]}.`,
      "Escreva com as suas palavras, diferente a cada vez. O sentido é sempre o",
      "mesmo: 'me chama no particular, o link tá na bio'. Nunca copie uma frase",
      "pronta duas vezes.",
    ].join("\n"),
  );

  // ---- RITMO DA CONVERSA ----
  // O prompt precisa SABER em que ponto está: sem isso a IA trata a décima
  // mensagem como a primeira e a conversa não termina nunca.
  if (turnos === 0) {
    partes.push(
      "MOMENTO: é a sua PRIMEIRA resposta. Cumprimente de leve, responda o que a pessoa falou e já aponte o link.",
    );
  } else if (turnos + 1 >= cfg.maxTurns) {
    partes.push(
      [
        "MOMENTO: esta é a ÚLTIMA mensagem desta conversa. Feche com simpatia e",
        "aponte o link uma vez mais, sem cobrar e sem insistir. Não faça pergunta",
        "nova — a conversa acaba aqui.",
      ].join("\n"),
    );
  } else {
    partes.push(
      [
        `MOMENTO: você já respondeu ${turnos} vez(es) nesta conversa. Seja mais`,
        "breve que antes e volte a apontar o link. Não puxe assunto novo: a",
        "conversa deve terminar, não crescer.",
      ].join("\n"),
    );
  }

  // ---- OBSERVAÇÕES DO OPERADOR ----
  // Entram por ÚLTIMO e são explicitamente subordinadas às proibições: é o
  // campo livre da tela, e um texto ali não pode destravar o que a política
  // do Instagram fecha.
  if (cfg.extraNotes.trim()) {
    partes.push(
      `OBSERVAÇÕES DESTA CONTA (nunca sobrepõem as proibições acima): ${cfg.extraNotes.trim()}`,
    );
  }

  partes.push("Responda APENAS com a mensagem a ser enviada, sem aspas e sem explicação.");
  return partes.join("\n\n");
}

/**
 * O aviso de automação exigido pela política da Meta, mandado UMA vez por
 * conversa, antes de tudo.
 *
 * Fica no código e não no prompt de propósito: é obrigação regulatória, e uma
 * IA pode esquecer, reescrever ou achar que já disse. Aqui ele ou saiu ou não
 * saiu, e dá para provar.
 */
export const AVISO_AUTOMACAO = "oi! aqui responde com ajuda de um assistente automático 🤖";

/**
 * REDE DE SEGURANÇA sobre o que a IA escreveu.
 *
 * O prompt proíbe link e preço, mas prompt é pedido, não garantia — e no canal
 * em que uma única mensagem errada custa a conta, a checagem não pode depender
 * só da boa vontade do modelo. O que passar daqui não vai para a Meta.
 *
 * Devolve o motivo da recusa, ou `null` quando o texto pode sair.
 */
export function motivoParaNaoEnviar(texto: string): string | null {
  const t = texto.toLowerCase();
  // URL escrita de qualquer jeito reconhecível — inclusive "site ponto com" e
  // domínios sem http, que é como um modelo costuma driblar "não mande link".
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|me|link|bio|io|app|br)\b/.test(t)) {
    return "a resposta trazia um link";
  }
  if (/\bponto\s+(com|net|br)\b/.test(t)) return "a resposta trazia um link disfarçado";
  // @ de outro perfil. O @ da própria conta não é problema, mas distinguir os
  // dois aqui daria margem: no canal errado, o silêncio é mais barato.
  if (/(^|\s)@[a-z0-9._]{2,}/.test(t)) return "a resposta citava um @ de perfil";
  if (/r\$\s*\d|\d+\s*reais|\bpix\b|\bpre[cç]o\b|\bpagamento\b|\bassinatura\b/.test(t)) {
    return "a resposta falava de preço ou pagamento";
  }
  if (/\bvip\b|\bgrupo fechado\b|\bcanal fechado\b/.test(t)) {
    return "a resposta falava de VIP ou grupo fechado";
  }
  return null;
}
