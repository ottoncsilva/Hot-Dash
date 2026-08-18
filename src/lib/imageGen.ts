import "server-only";
import { getAiCredentials } from "./settings";
import { cabecalhosOpenRouter } from "./ai";

/**
 * GERADOR DE IMAGEM — bytedance-seed/seedream-5-0-pro, via OpenRouter.
 *
 * É uma API DIFERENTE da que o resto do app usa: as outras chamadas do
 * OpenRouter em ai.ts falam com `/chat/completions` (texto); esta fala com
 * `/images` (Images API), formato de pedido e de resposta próprios, e o
 * modelo é FIXO — não é o "modelo por atividade" configurável em
 * Configurações, é sempre o Seedream, porque é ele quem tem os parâmetros
 * (resolução, formato, até 14 imagens de referência) que esta tela usa.
 *
 * Por isso este módulo não deriva do restante de ai.ts: só reaproveita a
 * chave (getAiCredentials) e os cabeçalhos de identificação do OpenRouter
 * (cabecalhosOpenRouter), que são genuinamente comuns aos dois usos.
 */

const MODELO = "bytedance-seed/seedream-5-0-pro";
const ENDPOINT = "https://openrouter.ai/api/v1/images";

export type ImageResolution = "1K" | "2K";

/**
 * Os formatos aceitos pelo modelo, na ordem em que a tela os mostra —
 * populares primeiro. "Auto" deixa o próprio modelo decidir a partir do
 * prompt e das referências, e é o padrão: quem está reproduzindo uma imagem
 * de referência normalmente quer o formato DELA, não um imposto de fora.
 */
export const ASPECT_RATIOS = [
  "auto",
  "1:1",
  "4:5",
  "3:4",
  "9:16",
  "16:9",
  "3:2",
  "2:3",
  "4:3",
  "5:4",
  "1:2",
  "2:1",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "9:21",
  "21:9",
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Até 14 referências por pedido — é o teto do próprio modelo. */
export const MAX_REFERENCIAS = 14;

export type PedidoImagem = {
  prompt: string;
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
    case 400:
      return `Pedido recusado — parâmetro inválido ou conteúdo barrado pela moderação do provedor${base}.`;
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

export async function gerarImagemSeedream(pedido: PedidoImagem): Promise<ImagemGerada> {
  const creds = getAiCredentials("openrouter");
  if (!creds) {
    throw new Error(
      "OpenRouter não está conectado. Ative e cole a chave em Configurações → Conexão com IA.",
    );
  }
  if (pedido.referencias.length > MAX_REFERENCIAS) {
    throw new Error(`No máximo ${MAX_REFERENCIAS} imagens de referência por geração.`);
  }

  const body: Record<string, unknown> = {
    model: MODELO,
    prompt: pedido.prompt,
    n: 1,
    resolution: pedido.resolution || "2K",
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

  const item = (data.data as { b64_json?: string; media_type?: string }[] | undefined)?.[0];
  if (!item?.b64_json) {
    throw new Error("O provedor não devolveu imagem nenhuma.");
  }
  const usage = data.usage as { cost?: number } | undefined;

  return {
    base64: item.b64_json,
    mediaType: item.media_type || "image/png",
    costUsd: typeof usage?.cost === "number" ? usage.cost : undefined,
  };
}
