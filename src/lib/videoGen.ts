import "server-only";
import { getAiCredentials } from "./settings";
import { cabecalhosOpenRouter } from "./ai";

/**
 * GERADOR DE VÍDEO — bytedance/seedance-2.0, via OpenRouter.
 *
 * Mesma família da Images API (módulo próprio, chave e cabeçalhos
 * reaproveitados de ai.ts, modelo fixo) — mas a Video API é ASSÍNCRONA: o
 * pedido devolve um job (202), que precisa ser consultado até terminar, e só
 * então o vídeo é baixado — não vem embutido na resposta como a imagem.
 * Por isso este módulo expõe três passos, não um só: submeterVideoSeedance,
 * consultarStatusVideo e baixarConteudoVideo.
 */

const MODELO = "bytedance/seedance-2.0";
const ENDPOINT = "https://openrouter.ai/api/v1/videos";

export const DURACOES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type VideoDuration = (typeof DURACOES)[number];

export const RESOLUCOES = ["480p", "720p", "1080p", "4K"] as const;
export type VideoResolution = (typeof RESOLUCOES)[number];

export const FORMATOS_VIDEO = ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"] as const;
export type VideoAspectRatio = (typeof FORMATOS_VIDEO)[number];

export type PedidoVideo = {
  prompt: string;
  /** URL da imagem inicial (https ou `data:` base64) — vira o `first_frame`. Opcional. */
  firstFrame?: string;
  duration?: VideoDuration;
  resolution?: VideoResolution;
  aspectRatio?: VideoAspectRatio;
  generateAudio?: boolean;
  seed?: number;
};

export type JobVideo = {
  jobId: string;
  status: string;
};

export type StatusVideo = {
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired" | string;
  costUsd?: number;
  errorMessage?: string;
};

/** Traduz os erros documentados da Video API para o operador. */
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
      return "Nenhum provedor conseguiu atender o Seedance agora, ou o vídeo já expirou. Tente de novo.";
    case 429:
      return "Muitos pedidos em sequência — aguarde um instante e tente de novo.";
    case 500:
      return "O pedido não pôde ser enviado ao provedor. Tente de novo.";
    case 502:
      return "A geração falhou do lado do provedor (não foi cobrada). Tente de novo.";
    default:
      return `Falha ao gerar o vídeo (${status})${base}.`;
  }
}

function credenciaisOuFalha() {
  const creds = getAiCredentials("openrouter");
  if (!creds) {
    throw new Error(
      "OpenRouter não está conectado. Ative e cole a chave em Configurações → Conexão com IA.",
    );
  }
  return creds;
}

export async function submeterVideoSeedance(pedido: PedidoVideo): Promise<JobVideo> {
  const creds = credenciaisOuFalha();

  const body: Record<string, unknown> = {
    model: MODELO,
    prompt: pedido.prompt,
    duration: pedido.duration || 5,
    resolution: pedido.resolution || "720p",
    aspect_ratio: pedido.aspectRatio || "9:16",
  };
  if (pedido.firstFrame) {
    body.frame_images = [
      { type: "image_url", image_url: { url: pedido.firstFrame }, frame_type: "first_frame" },
    ];
  }
  if (pedido.generateAudio) body.generate_audio = true;
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

  const jobId = typeof data.id === "string" ? data.id : "";
  if (!jobId) throw new Error("O provedor não devolveu um job de vídeo.");

  return { jobId, status: typeof data.status === "string" ? data.status : "pending" };
}

export async function consultarStatusVideo(jobId: string): Promise<StatusVideo> {
  const creds = credenciaisOuFalha();

  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${creds.apiKey}`, ...cabecalhosOpenRouter("openrouter") },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    const msg = typeof err?.message === "string" ? err.message : "";
    throw new Error(mensagemDoErro(res.status, msg));
  }

  const usage = data.usage as { cost?: number } | undefined;
  const err = data.error as Record<string, unknown> | undefined;

  return {
    status: typeof data.status === "string" ? data.status : "pending",
    costUsd: typeof usage?.cost === "number" ? usage.cost : undefined,
    errorMessage: typeof err?.message === "string" ? err.message : undefined,
  };
}

export async function baixarConteudoVideo(jobId: string): Promise<{ bytes: Buffer; contentType: string }> {
  const creds = credenciaisOuFalha();

  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(jobId)}/content`, {
    headers: { Authorization: `Bearer ${creds.apiKey}`, ...cabecalhosOpenRouter("openrouter") },
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const err = data.error as Record<string, unknown> | undefined;
    const msg = typeof err?.message === "string" ? err.message : "";
    throw new Error(mensagemDoErro(res.status, msg));
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "video/mp4";
  return { bytes, contentType };
}
