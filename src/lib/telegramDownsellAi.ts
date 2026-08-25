import "server-only";
import { getProfile } from "./profiles";
import { getAiCredentials } from "./settings";
import { callAiRaw } from "./ai";
import type { FunnelStep } from "./telegramCron";
import type { TelegramBotConfig } from "./telegramDb";

/**
 * Motor de geração de mensagens do bot de vendas com IA — persona da modelo
 * (`bioPhysical`/`bioUnique`) + a mensagem real de `/start` pra manter a
 * mesma voz, com dois formatos de uso:
 *   - `gerarMensagemDownsell`: UM passo de uma SEQUÊNCIA (downsell, upsell,
 *     renovação, boas-vindas pós-aprovação) — sabe calibrar pela posição na
 *     escalada de tempo/desconto e pelos passos vizinhos.
 *   - `gerarMensagemAvulsa`: UMA mensagem solta, sem sequência (boas-vindas
 *     do /start, aprovado, telas do PIX).
 * Nasceu só pro Downsell — o nome do arquivo ficou pra trás, mas trocar
 * agora espalharia o diff por todo canto que já importa daqui.
 */

/** Provedores tentados em cadeia — Grok primeiro (mais tolerante com
 * conteúdo adulto direto), caindo pro próximo que estiver configurado. */
const CADEIA_PROVEDORES = ["grok", "openai", "gemini", "openrouter"] as const;

export type TipoFunilDownsell = "geral" | "pix" | "upsell" | "renewal" | "aprovacao";

type ParametrosPrompt = {
  bot: TelegramBotConfig;
  profileId: string;
  tipo: TipoFunilDownsell;
  passos: FunnelStep[];
  indice: number;
};

/** O que muda de framing entre os tipos de sequência — cada um vende (ou não
 * vende) uma coisa diferente, pro lead num estado diferente. */
const FRAMING_TIPO: Record<TipoFunilDownsell, { contexto: string; contaTempoComo: "desde" | "faltam" }> = {
  geral: {
    contexto: "Este funil dispara para um lead que recebeu o /start mas NÃO comprou nada ainda. O foco é reengajar e reapresentar a oferta.",
    contaTempoComo: "desde",
  },
  pix: {
    contexto: "Este funil dispara para um lead que JÁ escolheu um plano e JÁ gerou o PIX, mas ainda não pagou. O foco é lembrar/pressionar pra fechar o pagamento — NÃO reapresente o VIP do zero, ele já sabe o que está comprando.",
    contaTempoComo: "desde",
  },
  upsell: {
    contexto: "Este funil dispara depois que o lead JÁ VIROU ASSINANTE (pagamento confirmado). O foco é oferecer algo A MAIS — um plano maior, um pacote extra, um bônus — pra quem já confia na modelo. NÃO trate como quem nunca comprou, e não repita a apresentação do zero.",
    contaTempoComo: "desde",
  },
  renewal: {
    contexto: "Este funil avisa um assinante ATIVO de que o acesso está prestes a VENCER, incentivando a renovar antes de perder o acesso ao grupo. Não é sobre convencer alguém a comprar pela primeira vez — é sobre não deixar quem já é próximo esfriar o vínculo.",
    contaTempoComo: "faltam",
  },
  aprovacao: {
    contexto: "Este funil dispara logo depois que o lead foi APROVADO para entrar no grupo (prévias ou VIP). NÃO é sobre vender ou dar desconto — é sobre dar as boas-vindas de verdade, mostrar o que ele vai encontrar por ali e puxar ele pra continuar a conversa.",
    contaTempoComo: "desde",
  },
};

function resumoPasso(p: FunnelStep, i: number, tipo: TipoFunilDownsell): string {
  const tempo = p.delayMinutes >= 60 ? `${(p.delayMinutes / 60).toFixed(1)}h` : `${p.delayMinutes}min`;
  const percentual = p.discountPercent || 0;
  const desconto = percentual > 0 ? `${percentual}% de desconto` : "sem desconto";
  const quando =
    FRAMING_TIPO[tipo].contaTempoComo === "faltam"
      ? `dispara quando faltam ${tempo} para vencer`
      : `dispara ${tempo} depois do passo anterior`;
  return `passo ${i + 1}: ${quando}, ${desconto}`;
}

/**
 * Jeitos de ABRIR a mensagem, um por passo (gira pelo índice). Sem isso a
 * IA tende a resolver todo passo com o mesmo cumprimento — "Oi {nome}" em
 * quase toda mensagem da sequência, por exemplo. Cada geração já nasce numa
 * chamada isolada (sem ver o que os outros passos escreveram), então a
 * variedade sai de FORÇAR um ângulo de abertura diferente por posição, não
 * de pedir "varie" em texto solto (que não impede a repetição sozinho).
 */
const DICAS_ABERTURA = [
  "Comece DIRETO no assunto da mensagem — sem 'oi', 'e aí' ou qualquer cumprimento na primeira frase.",
  "Pode chamar o lead pelo nome, mas NÃO na primeira palavra — encaixe {nome} no meio ou no fim de uma frase.",
  "Comece com uma pergunta ou provocação, não com um cumprimento.",
  "Comece reagindo ao tempo que passou (ex.: 'X minutos e você...') em vez de cumprimentar.",
  "Se for chamar o lead por um apelido carinhoso, use um DIFERENTE do óbvio ('amor', 'gato', 'lindo') — ou não use apelido nenhum nesta.",
  "Comece descrevendo o que você está fazendo/sentindo agora, sem se dirigir ao lead na primeira frase.",
];

/**
 * Tira rótulos/preâmbulos que alguns modelos colam antes do texto de
 * verdade (ex.: "**Resposta:**", "Aqui está a mensagem gerada:", um "---"
 * de separador, ou um bloco de código envolvendo tudo) — o prompt já pede
 * pra não fazer isso, mas nem todo provedor obedece sempre, então isto é a
 * segunda linha de defesa. Repete a limpeza até não sobrar preâmbulo/rodapé
 * nenhum, porque às vezes vêm dois empilhados.
 */
function limparRespostaIA(bruto: string): string {
  let t = bruto.trim();

  const envolvidoEmCodigo = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (envolvidoEmCodigo) t = envolvidoEmCodigo[1].trim();

  const linhasDeQuadro = [
    /^\*{1,2}resposta\*{0,2}:?\*{0,2}$/i,
    /^\*{1,2}mensagem\*{0,2}:?\*{0,2}$/i,
    /^\*{1,2}texto\*{0,2}:?\*{0,2}$/i,
    // Cobre "Aqui está o texto da mensagem:", "Aqui está a mensagem gerada:",
    // "Segue a mensagem:", "Abaixo está o texto:" — qualquer preâmbulo curto
    // desse formato, não só as duas frases exatas vistas nos exemplos.
    /^(aqui est[áa]|segue|abaixo est[áa]).{0,60}:$/i,
    /^-{3,}$/,
    /^={3,}$/,
  ];
  let mudou = true;
  while (mudou) {
    mudou = false;
    const linhas = t.split("\n");
    while (linhas.length > 0 && (linhas[0].trim() === "" || linhasDeQuadro.some((re) => re.test(linhas[0].trim())))) {
      linhas.shift();
      mudou = true;
    }
    while (
      linhas.length > 0 &&
      (linhas[linhas.length - 1].trim() === "" || linhasDeQuadro.some((re) => re.test(linhas[linhas.length - 1].trim())))
    ) {
      linhas.pop();
      mudou = true;
    }
    t = linhas.join("\n");
  }

  return t.trim().replace(/^["']|["']$/g, "").trim();
}

/** Cabeçalho de persona, comum às duas variações de prompt (sequência e avulsa). */
async function blocoPersona(profileId: string): Promise<{ nome: string; texto: string }> {
  const perfil = await getProfile(profileId);
  const nome = perfil?.name || "a modelo";
  const fisico = perfil?.bioPhysical || "";
  const unico = perfil?.bioUnique || "";
  return {
    nome,
    texto: `PERSONA DA MODELO\nNome: ${nome}\nCaracterísticas físicas: ${fisico || "(não informado)"}\nO que a torna única / seu diferencial: ${unico || "(não informado)"}`,
  };
}

const REGRAS_COMUNS = `REGRAS DE FORMA: português coloquial de brasileiro no WhatsApp/Telegram, mensagem curta (poucas linhas), emojis moderados, sem revelar que é IA/bot/sistema.

Responda SOMENTE com o texto puro da mensagem, exatamente como vai ser enviada no Telegram. NADA além disso: sem rótulo tipo "Resposta:" ou "Aqui está a mensagem:", sem cabeçalho, sem separador (---), sem bloco de código, sem aspas envolvendo tudo, sem explicação antes ou depois. A primeira linha da sua resposta JÁ é a primeira linha da mensagem de verdade.`;

/**
 * Monta o prompt que gera UMA mensagem de UMA sequência (downsell geral,
 * downsell de PIX, upsell, alerta de renovação, boas-vindas pós-aprovação).
 *
 * Reúne a persona da modelo, a mensagem real de `/start` (pra manter a
 * mesma voz, como continuação da conversa) e a posição desse passo na
 * escalada de tempo/desconto da sequência inteira.
 */
export async function montarPromptDownsell({
  bot,
  profileId,
  tipo,
  passos,
  indice,
}: ParametrosPrompt): Promise<string> {
  const { nome, texto: personaTexto } = await blocoPersona(profileId);

  const passoAtual = passos[indice];
  const irmaos = passos.map((p, i) => resumoPasso(p, i, tipo)).join("; ");

  const percentualAtual = passoAtual.discountPercent || 0;
  const descontoTexto =
    percentualAtual > 0
      ? `Este passo tem ${percentualAtual}% de desconto — mencione o desconto naturalmente.`
      : tipo === "aprovacao"
        ? `Este funil não trabalha com desconto — não mencione nenhum.`
        : `Este passo NÃO tem desconto — não invente nem cite nenhum percentual.`;

  // O campo de texto do passo pode já trazer um RASCUNHO genérico (o modelo
  // pronto do "Puxar padrão" — mesmo ângulo/piada da etapa, sem persona
  // nenhuma). Quando existe, ele entra como referência de ESTRUTURA pra
  // reescrever, não pra copiar — é o que faz a IA aproveitar a escalada já
  // pensada em vez de reinventar do zero a cada clique.
  const rascunho = (passoAtual.text || "").trim();
  const rascunhoTexto = rascunho
    ? `\nRASCUNHO DE REFERÊNCIA PRA ESTE PASSO (é uma ideia genérica de ângulo/piada, sem nenhuma característica de ${nome} — REESCREVA do zero na voz e persona dela, sem copiar frase por frase, adaptando pro jeito dela falar):\n"""\n${rascunho}\n"""\n`
    : "";

  const dicaAbertura = DICAS_ABERTURA[indice % DICAS_ABERTURA.length];

  const gatilhos =
    tipo === "aprovacao"
      ? `O OBJETIVO AQUI É ENGAJAR, não vender: puxe assunto, mostre o que ela vai encontrar por ali, convide pra continuar a conversa. NUNCA use ameaça, urgência falsa ou qualquer linguagem que implique consequência legal ou financeira.`
      : `GATILHOS PERMITIDOS: tempo/oferta limitada, prova social genérica (sem inventar nome próprio de terceiro nem número goldplated), bônus, o próprio desconto configurado.\nNUNCA USE: ameaça de negativação, SPC, Serasa, órgão de proteção ao crédito, ou qualquer linguagem que implique consequência legal ou financeira falsa.`;

  return `Você é a assistente de copywriting de ${nome}, uma modelo de conteúdo adulto. Você está escrevendo UMA mensagem de uma sequência automática do bot de vendas no Telegram — o texto que ela mesma vai enviar ao lead, em primeira pessoa. NUNCA revele que é uma IA, bot ou sistema automático.

${personaTexto}

A PRIMEIRA MENSAGEM que este lead já recebeu (o /start) foi:
"""
${bot.welcomeMessage || "(sem mensagem de boas-vindas cadastrada)"}
"""
Mantenha a MESMA voz, o mesmo nível de safadeza e o mesmo jeito de chamar o lead que aparece ali — esta mensagem é uma CONTINUAÇÃO daquela conversa, não um texto novo e solto.

TIPO DE SEQUÊNCIA
${FRAMING_TIPO[tipo].contexto}

ESTE PASSO
Passo ${indice + 1} de ${passos.length} da sequência. ${descontoTexto}
${rascunhoTexto}
OS OUTROS PASSOS DA SEQUÊNCIA (só os números, pra você calibrar a escalada e não repetir o mesmo ângulo em dois passos seguidos):
${irmaos}

${gatilhos}

ABERTURA DESTA MENSAGEM: ${dicaAbertura} Isso existe porque cada passo da sequência é gerado numa chamada separada — sem essa instrução, praticamente toda mensagem sai começando do mesmo jeito (ex.: sempre "Oi {nome}"), e quem recebe percebe o padrão repetido.

${REGRAS_COMUNS}`;
}

/**
 * Tenta gerar o texto passando pelos provedores configurados em cadeia
 * (Grok primeiro) até um responder. Lança erro só se NENHUM estiver
 * configurado ou todos falharem. Usado tanto pela geração de sequência
 * quanto pela avulsa — o prompt já pronto é o único diferencial.
 */
async function tentarGerar(prompt: string): Promise<string> {
  let ultimoErro: unknown = null;
  let algumConfigurado = false;
  for (const provedor of CADEIA_PROVEDORES) {
    if (!getAiCredentials(provedor, "downsell")) continue;
    algumConfigurado = true;
    try {
      const texto = await callAiRaw(prompt, provedor, { maxTokens: 400, activity: "downsell" });
      const limpo = limparRespostaIA(texto);
      if (limpo) return limpo;
    } catch (e) {
      ultimoErro = e;
    }
  }

  if (!algumConfigurado) {
    throw new Error(
      "Nenhuma IA está conectada: ative e cole a chave de API em Configurações → Conexão com IA.",
    );
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error("Não foi possível gerar a mensagem agora.");
}

export async function gerarMensagemDownsell(params: ParametrosPrompt): Promise<string> {
  return tentarGerar(await montarPromptDownsell(params));
}

// ---------------------------------------------------------------------------
// Mensagens AVULSAS — sem sequência: boas-vindas do /start, pagamento
// aprovado, telas do PIX. Cada uma tem um PAPEL fixo (não é texto livre do
// cliente — evita o prompt sair torto por causa de uma descrição vaga).
// ---------------------------------------------------------------------------

export type CampoMensagemAvulsa =
  | "welcome"
  | "success"
  | "pixGenerating"
  | "pixCaption"
  | "pixSocialProof"
  | "pixNotPaid";

const CAMPOS_AVULSOS: Record<CampoMensagemAvulsa, { papel: string; regrasExtra?: string }> = {
  welcome: {
    papel: "a PRIMEIRA mensagem que o lead recebe, assim que dá /start no bot — é a apresentação dela e o convite pra conhecer o conteúdo/VIP. Ninguém viu nada antes dessa.",
  },
  success: {
    papel: "a mensagem enviada assim que o PAGAMENTO É CONFIRMADO — dá as boas-vindas de verdade a quem acabou de assinar o VIP.",
  },
  pixGenerating: {
    papel: "um aviso BEM curto (uma linha), mostrado por poucos segundos enquanto o PIX está sendo gerado, antes do código aparecer na tela.",
    regrasExtra: "Seja BEM curto — é um aviso de carregamento, não uma mensagem de verdade. Uma frase só.",
  },
  pixCaption: {
    papel: "a legenda que acompanha o código PIX na tela de pagamento — o empurrão final pra pessoa pagar o que já escolheu.",
    regrasExtra: "Pode usar as variáveis {plano} e {valor} (o que a pessoa escolheu e quanto vai pagar) — o código PIX em si é anexado à parte, não precisa mencionar.",
  },
  pixSocialProof: {
    papel: "uma linha curta de prova social exibida do lado do código PIX, bem na hora em que a pessoa vai pagar.",
    regrasExtra:
      'PROIBIDO inventar qualquer número ("47 pessoas", "23 vendas hoje") — seria propaganda enganosa nessa tela, a um toque do pagamento. Use SOMENTE as variáveis {vendas_hoje} e {assinantes} (números reais do painel) se quiser citar quantidade; sem elas, fale de prova social sem número nenhum (ex.: confiança, gente satisfeita, sem citar contagem).',
  },
  pixNotPaid: {
    papel: "a mensagem mostrada quando o lead clica em 'verificar status' e o pagamento AINDA não caiu — lembra ele de finalizar.",
  },
};

type ParametrosAvulsa = {
  bot: TelegramBotConfig;
  profileId: string;
  campo: CampoMensagemAvulsa;
  /** Rascunho atual do campo (se houver) — mesma lógica do rascunho de passo:
   * referência de estrutura pra reescrever, não pra copiar. */
  rascunho?: string;
};

export async function montarPromptMensagemAvulsa({
  bot,
  profileId,
  campo,
  rascunho,
}: ParametrosAvulsa): Promise<string> {
  const { nome, texto: personaTexto } = await blocoPersona(profileId);
  const { papel, regrasExtra } = CAMPOS_AVULSOS[campo];

  // A própria mensagem de boas-vindas não tem "conversa anterior" pra
  // continuar — ela É o início. Os outros campos referenciam o /start real
  // pra manter a voz, igual à geração de sequência.
  const contextoConversa =
    campo === "welcome"
      ? ""
      : `\nA PRIMEIRA MENSAGEM que o lead já recebeu (o /start) foi:\n"""\n${bot.welcomeMessage || "(sem mensagem de boas-vindas cadastrada)"}\n"""\nMantenha a MESMA voz e o mesmo jeito de chamar o lead que aparece ali.\n`;

  const rascunhoLimpo = (rascunho || "").trim();
  const rascunhoTexto = rascunhoLimpo
    ? `\nRASCUNHO DE REFERÊNCIA (ideia genérica de estrutura, sem característica nenhuma de ${nome} — REESCREVA na voz e persona dela, sem copiar frase por frase):\n"""\n${rascunhoLimpo}\n"""\n`
    : "";

  return `Você é a assistente de copywriting de ${nome}, uma modelo de conteúdo adulto. Você está escrevendo UMA mensagem do bot de vendas dela no Telegram — o texto que ela mesma vai enviar, em primeira pessoa. NUNCA revele que é uma IA, bot ou sistema automático.

${personaTexto}
${contextoConversa}
CONTEXTO DESTA MENSAGEM
${papel}
${regrasExtra ? regrasExtra + "\n" : ""}${rascunhoTexto}
NUNCA USE: ameaça de negativação, SPC, Serasa, órgão de proteção ao crédito, ou qualquer linguagem que implique consequência legal ou financeira falsa.

${REGRAS_COMUNS}`;
}

export async function gerarMensagemAvulsa(params: ParametrosAvulsa): Promise<string> {
  return tentarGerar(await montarPromptMensagemAvulsa(params));
}
