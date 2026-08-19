import "server-only";
import { getAiCredentials } from "./settings";
import { cabecalhosOpenRouter } from "./ai";
import {
  modeloImagem,
  resolucaoImagemValida,
  type ModeloImagemId,
  type ImageResolucao,
} from "./aiMediaOptions";
import { FORMATOS } from "./aiMediaOptions";
import { mensagemDeModeracao } from "./aiMediaErros";

/**
 * GERADOR DE IMAGEM — bytedance-seed/seedream-5-0-pro, via OpenRouter.
 *
 * É uma API DIFERENTE da que o resto do app usa: as outras chamadas do
 * OpenRouter em ai.ts falam com `/chat/completions` (texto); esta fala com
 * `/images` (Images API), formato de pedido e de resposta próprios.
 *
 * O modelo é escolhido na tela entre os do catálogo (Seedream Pro e Lite) —
 * não é o "modelo por atividade" configurável em Configurações, que serve
 * para escolher o modelo de TEXTO de cada tarefa. Aqui a escolha é entre
 * modelos de imagem, que têm parâmetros próprios (resolução, formato, até 14
 * referências) e limites diferentes entre si.
 *
 * Por isso este módulo não deriva do restante de ai.ts: só reaproveita a
 * chave (getAiCredentials) e os cabeçalhos de identificação do OpenRouter
 * (cabecalhosOpenRouter), que são genuinamente comuns aos dois usos.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/images";

/** As resoluções da família; qual delas cada modelo aceita está no catálogo. */
export type ImageResolution = ImageResolucao;

/**
 * Formatos oferecidos — o recorte de aiMediaOptions, mais "auto", que só
 * existe aqui: deixa o modelo herdar o formato da imagem de referência, que
 * é o que se quer ao reproduzir uma composição.
 */
export const ASPECT_RATIOS = ["auto", ...FORMATOS] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Até 14 referências por pedido — é o teto do próprio modelo. */
export const MAX_REFERENCIAS = 14;

export type PedidoImagem = {
  prompt: string;
  /** Qual modelo do catálogo. O slug da API sai daqui, nunca do cliente. */
  modelo?: ModeloImagemId;
  /** Quantas imagens pedir nesta chamada — só onde o modelo aceita `n` > 1. */
  quantidade?: number;
  /**
   * URLs de imagem (https ou `data:` base64), NA ORDEM em que devem ser
   * lidas. Quando há uma "imagem a copiar", ela é sempre a PRIMEIRA desta
   * lista — o prompt padrão da tela é escrito contando com essa ordem
   * ("a primeira referência é a composição a reproduzir").
   */
  referencias: string[];
  resolution?: ImageResolution;
  aspectRatio?: AspectRatio;
  /** Opcional — mesma semente reproduz o mesmo resultado (quando o provedor suportar). */
  seed?: number;
};

export type ImagemGerada = {
  base64: string;
  mediaType: string;
};

export type RespostaImagem = {
  imagens: ImagemGerada[];
  /** Custo em dólares desta chamada, quando o provedor informa. */
  costUsd?: number;
};

/**
 * Traduz o erro da Images API para algo que o operador entende sem abrir o
 * console. Os códigos são os documentados pelo OpenRouter — cada um é uma
 * causa concreta, não "falha genérica".
 */
function mensagemDoErro(status: number, apiMsg: string): string {
  const base = apiMsg ? ` (${apiMsg})` : "";
  switch (status) {
    case 400: {
      const moderacao = mensagemDeModeracao(apiMsg);
      if (moderacao) return moderacao;
      return `Pedido recusado — parâmetro inválido ou conteúdo barrado pela moderação do provedor${base}.`;
    }
    case 401:
      return "Chave do OpenRouter inválida. Confira em Configurações → Conexão com IA.";
    case 402:
      return "Créditos insuficientes na conta do OpenRouter.";
    case 403:
      return `Bloqueado pelo OpenRouter — limite de gasto atingido, chave desativada, ou o modelo não está liberado para esta conta${base}.`;
    case 404:
      return "Nenhum provedor conseguiu atender o Seedream agora. Tente de novo em instantes.";
    case 413:
      return "As imagens de referência somadas são grandes demais para o pedido — remova alguma ou tente novamente.";
    case 429:
      return "Muitos pedidos em sequência — aguarde um instante e tente de novo.";
    case 502:
      return "A geração falhou do lado do provedor (não foi cobrada). Tente de novo.";
    default:
      return `Falha ao gerar a imagem (${status})${base}.`;
  }
}

export async function gerarImagemSeedream(pedido: PedidoImagem): Promise<RespostaImagem> {
  const creds = getAiCredentials("openrouter");
  if (!creds) {
    throw new Error(
      "OpenRouter não está conectado. Ative e cole a chave em Configurações → Conexão com IA.",
    );
  }
  if (pedido.referencias.length > MAX_REFERENCIAS) {
    throw new Error(`No máximo ${MAX_REFERENCIAS} imagens de referência por geração.`);
  }

  const modelo = modeloImagem(pedido.modelo);
  // A quantidade pedida pode passar do que o modelo aceita numa chamada (o
  // Pro trava em 1): aqui pede só o que cabe, e quem chamou repete a chamada
  // para o resto.
  const n = Math.min(modelo.maxN, Math.max(1, Math.round(pedido.quantidade || 1)));

  const body: Record<string, unknown> = {
    model: modelo.slug,
    prompt: pedido.prompt,
    n,
    // Guarda contra par (modelo, resolução) incoerente — o Pro faz 1K/2K e o
    // Lite faz 2K/4K, e a resolução sobrevive à troca de modelo na tela.
    resolution: resolucaoImagemValida(modelo.id, pedido.resolution),
    aspect_ratio: pedido.aspectRatio || "auto",
  };
  if (pedido.referencias.length > 0) {
    body.input_references = pedido.referencias.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  }
  if (typeof pedido.seed === "number" && Number.isFinite(pedido.seed)) {
    body.seed = Math.round(pedido.seed);
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.apiKey}`,
      ...cabecalhosOpenRouter("openrouter"),
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    const msg = typeof err?.message === "string" ? err.message : "";
    throw new Error(mensagemDoErro(res.status, msg));
  }

  // TODAS as imagens, não só a primeira: com `n` > 1 (o Lite faz até 4) ficar
  // com data[0] jogaria fora o que já foi pago.
  const itens = (data.data as { b64_json?: string; media_type?: string }[] | undefined) || [];
  const imagens = itens
    .filter((i) => typeof i?.b64_json === "string" && i.b64_json)
    .map((i) => ({ base64: i.b64_json as string, mediaType: i.media_type || "image/png" }));
  if (imagens.length === 0) {
    throw new Error("O provedor não devolveu imagem nenhuma.");
  }
  const usage = data.usage as { cost?: number } | undefined;

  return { imagens, costUsd: typeof usage?.cost === "number" ? usage.cost : undefined };
}
