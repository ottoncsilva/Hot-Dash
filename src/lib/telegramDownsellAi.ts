import "server-only";
import { getProfile } from "./profiles";
import { getAiCredentials } from "./settings";
import { callAiRaw } from "./ai";
import type { FunnelStep } from "./telegramCron";
import type { TelegramBotConfig } from "./telegramDb";

/** Provedores tentados em cadeia — Grok primeiro (mais tolerante com
 * conteúdo adulto direto), caindo pro próximo que estiver configurado. */
const CADEIA_PROVEDORES = ["grok", "openai", "gemini", "openrouter"] as const;

export type TipoFunilDownsell = "geral" | "pix";

type ParametrosPrompt = {
  bot: TelegramBotConfig;
  profileId: string;
  tipo: TipoFunilDownsell;
  passos: FunnelStep[];
  indice: number;
};

function resumoPasso(p: FunnelStep, i: number): string {
  const tempo = p.delayMinutes >= 60 ? `${(p.delayMinutes / 60).toFixed(1)}h` : `${p.delayMinutes}min`;
  const percentual = p.discountPercent || 0;
  const desconto = percentual > 0 ? `${percentual}% de desconto` : "sem desconto";
  return `passo ${i + 1}: dispara ${tempo} depois do passo anterior, ${desconto}`;
}

/**
 * Monta o prompt que gera UMA mensagem da sequência de downsell.
 *
 * Reúne a persona da modelo (mesma fonte que o LTV usa pra semear a
 * persona dela — `bioPhysical`/`bioUnique`), a mensagem real de `/start`
 * (pra manter a mesma voz, como continuação da conversa) e a posição desse
 * passo na escalada de urgência/desconto da sequência inteira.
 */
export async function montarPromptDownsell({
  bot,
  profileId,
  tipo,
  passos,
  indice,
}: ParametrosPrompt): Promise<string> {
  const perfil = await getProfile(profileId);
  const nome = perfil?.name || "a modelo";
  const fisico = perfil?.bioPhysical || "";
  const unico = perfil?.bioUnique || "";

  const passoAtual = passos[indice];
  const irmaos = passos.map((p, i) => resumoPasso(p, i)).join("; ");

  const tipoTexto =
    tipo === "pix"
      ? `Este funil dispara para um lead que JÁ escolheu um plano e JÁ gerou o PIX, mas ainda não pagou. O foco é lembrar/pressionar pra fechar o pagamento — NÃO reapresente o VIP do zero, ele já sabe o que está comprando.`
      : `Este funil dispara para um lead que recebeu o /start mas NÃO comprou nada ainda. O foco é reengajar e reapresentar a oferta.`;

  const percentualAtual = passoAtual.discountPercent || 0;
  const descontoTexto =
    percentualAtual > 0
      ? `Este passo tem ${percentualAtual}% de desconto — mencione o desconto naturalmente.`
      : `Este passo NÃO tem desconto — não invente nem cite nenhum percentual.`;

  // O campo de texto do passo pode já trazer um RASCUNHO genérico (o modelo
  // pronto do "Puxar padrão" — mesmo ângulo/piada da etapa, sem persona
  // nenhuma). Quando existe, ele entra como referência de ESTRUTURA pra
  // reescrever, não pra copiar — é o que faz a IA aproveitar a escalada já
  // pensada (a piada do app do banco, a provocação, o teaser de conteúdo)
  // em vez de reinventar do zero a cada clique.
  const rascunho = (passoAtual.text || "").trim();
  const rascunhoTexto = rascunho
    ? `\nRASCUNHO DE REFERÊNCIA PRA ESTE PASSO (é uma ideia genérica de ângulo/piada, sem nenhuma característica de ${nome} — REESCREVA do zero na voz e persona dela, sem copiar frase por frase, adaptando pro jeito dela falar):\n"""\n${rascunho}\n"""\n`
    : "";

  return `Você é a assistente de copywriting de ${nome}, uma modelo de conteúdo adulto. Você está escrevendo UMA mensagem de um funil automático de recuperação de vendas no Telegram — o texto que ela mesma vai enviar ao lead, em primeira pessoa. NUNCA revele que é uma IA, bot ou sistema automático.

PERSONA DA MODELO
Nome: ${nome}
Características físicas: ${fisico || "(não informado)"}
O que a torna única / seu diferencial: ${unico || "(não informado)"}

A PRIMEIRA MENSAGEM que este lead já recebeu (o /start) foi:
"""
${bot.welcomeMessage || "(sem mensagem de boas-vindas cadastrada)"}
"""
Mantenha a MESMA voz, o mesmo nível de safadeza e o mesmo jeito de chamar o lead que aparece ali — esta mensagem é uma CONTINUAÇÃO daquela conversa, não um texto novo e solto.

TIPO DE FUNIL
${tipoTexto}

ESTE PASSO
Passo ${indice + 1} de ${passos.length} da sequência. ${descontoTexto}
${rascunhoTexto}
OS OUTROS PASSOS DA SEQUÊNCIA (só os números, pra você calibrar a escalada e não repetir o mesmo ângulo em dois passos seguidos):
${irmaos}

GATILHOS PERMITIDOS: tempo/oferta limitada, prova social genérica (sem inventar nome próprio de terceiro nem número goldplated), bônus, o próprio desconto configurado.
NUNCA USE: ameaça de negativação, SPC, Serasa, órgão de proteção ao crédito, ou qualquer linguagem que implique consequência legal ou financeira falsa.

REGRAS DE FORMA: português coloquial de brasileiro no WhatsApp/Telegram, mensagem curta (poucas linhas), emojis moderados, sem revelar que é IA/bot/sistema.

Responda SOMENTE com o texto da mensagem, sem aspas, sem explicação.`;
}

/**
 * Tenta gerar a mensagem passando pelos provedores configurados em cadeia
 * (Grok primeiro) até um responder. Lança erro só se NENHUM estiver
 * configurado ou todos falharem.
 */
export async function gerarMensagemDownsell(params: ParametrosPrompt): Promise<string> {
  const prompt = await montarPromptDownsell(params);

  let ultimoErro: unknown = null;
  let algumConfigurado = false;
  for (const provedor of CADEIA_PROVEDORES) {
    if (!getAiCredentials(provedor, "downsell")) continue;
    algumConfigurado = true;
    try {
      const texto = await callAiRaw(prompt, provedor, { maxTokens: 400, activity: "downsell" });
      const limpo = texto.trim().replace(/^["']|["']$/g, "");
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
