import "server-only";
import { getAiCredentials } from "./settings";
import { cabecalhosOpenRouter } from "./ai";
import {
  FORMATOS,
  VIDEO_DURACOES,
  VIDEO_RESOLUCOES,
  modeloVideo,
  resolucaoVideoValida,
  type ModeloVideoId,
} from "./aiMediaOptions";
import { mensagemDeModeracao } from "./aiMediaErros";

/**
 * GERADOR DE VÍDEO — família Seedance 2.0, via OpenRouter.
 *
 * Mesma família da Images API (módulo próprio, chave e cabeçalhos
 * reaproveitados de ai.ts) — mas a Video API é ASSÍNCRONA: o
 * pedido devolve um job (202), que precisa ser consultado até terminar, e só
 * então o vídeo é baixado — não vem embutido na resposta como a imagem.
 * Por isso este módulo expõe três passos, não um só: submeterVideoSeedance,
 * consultarStatusVideo e baixarConteudoVideo.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/videos";

export const DURACOES = VIDEO_DURACOES;
export type VideoDuration = (typeof DURACOES)[number];

export const RESOLUCOES = VIDEO_RESOLUCOES;
export type VideoResolution = (typeof RESOLUCOES)[number];

export const FORMATOS_VIDEO = FORMATOS;
export type VideoAspectRatio = (typeof FORMATOS_VIDEO)[number];

export type PedidoVideo = {
  prompt: string;
  /** Qual modelo do catálogo. O slug da API sai daqui, nunca do cliente. */
  modelo?: ModeloVideoId;
  /** URL da imagem inicial (https ou `data:` base64) — vira o `first_frame`. Opcional. */
  firstFrame?: string;
  duration?: VideoDuration;
  resolution?: VideoResolution;
  aspectRatio?: VideoAspectRatio;
  generateAudio?: boolean;
  seed?: number;
  /**
   * O filtro de conteúdo do provedor. Só a Magnific expõe isso, e só em alguns
   * modelos (ver `aceitaFiltroSeguranca` no catálogo) — nos outros o campo é
   * ignorado. `undefined` e `true` são a mesma coisa: filtro ligado, que é o
   * padrão da API.
   */
  filtroSeguranca?: boolean;
  /** Último frame — o vídeo faz a transição do primeiro para este. */
  lastFrame?: string;
  /**
   * Imagens de referência: guiam personagem e estilo sem fixar quadro. Na
   * OpenRouter são EXCLUSIVAS com o primeiro frame (ver `referencias` no
   * catálogo); na Magnific combinam.
   */
  referencias?: string[];
  /**
   * Marca d'água de IA no canto do vídeo. Só a BytePlus expõe, e lá o padrão
   * da plataforma é LIGADO — o painel manda desligado a menos que peçam.
   */
  marcaDagua?: boolean;
  /** Câmera fixa (tripé). Só a BytePlus expõe. */
  cameraFixa?: boolean;
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
      return "Nenhum provedor conseguiu atender esse modelo agora, ou o vídeo já expirou. Tente de novo.";
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

  const modelo = modeloVideo(pedido.modelo);
  const body: Record<string, unknown> = {
    model: modelo.slug,
    prompt: pedido.prompt,
    duration: pedido.duration || 5,
    // Guarda contra par (modelo, resolução) incoerente: o 2.0 vai até 4K, o
    // Mini e o Fast param no 720p, e a resolução sobrevive à troca de modelo.
    resolution: resolucaoVideoValida(modelo.id, pedido.resolution || "720p"),
    aspect_ratio: pedido.aspectRatio || "9:16",
  };
  // FRAMES E REFERÊNCIAS SÃO EXCLUSIVOS AQUI.
  //
  // A documentação da OpenRouter: "if both fields are provided, `frame_images`
  // takes precedence and the request is treated as image-to-video". Ou seja,
  // mandar os dois faz as referências serem descartadas SEM AVISO. Em vez de
  // deixar o operador pagar por uma geração que ignorou metade do que ele
  // escolheu, mandamos um ou outro — e a tela já diz qual vai valer.
  const quadros: Record<string, unknown>[] = [];
  if (pedido.firstFrame) {
    quadros.push({
      type: "image_url",
      image_url: { url: pedido.firstFrame },
      frame_type: "first_frame",
    });
  }
  if (pedido.lastFrame && modelo.aceitaUltimoFrame) {
    quadros.push({
      type: "image_url",
      image_url: { url: pedido.lastFrame },
      frame_type: "last_frame",
    });
  }
  if (quadros.length > 0) {
    body.frame_images = quadros;
  } else if (pedido.referencias?.length && modelo.referencias) {
    body.input_references = pedido.referencias
      .slice(0, modelo.referencias.max)
      .map((url) => ({ type: "image_url", image_url: { url } }));
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
