import "server-only";
import { getAiCredentials } from "./settings";
import { modeloMotion, type ModeloMotionId, type OrientacaoMotion } from "./aiMediaOptions";
import { mensagemDeModeracao } from "./aiMediaErros";
import type { JobVideo, StatusVideo } from "./videoGen";

/**
 * MOTION CONTROL — Kling 2.6, pela API da Magnific (ex-Freepik).
 *
 * Transfere o movimento de um vídeo de referência para a foto de uma pessoa.
 * Não é o mesmo que os geradores de vídeo fazem: eles animam a partir de um
 * primeiro frame, aqui o movimento vem de fora, de um vídeo.
 *
 * Expõe as MESMAS três funções de videoGen.ts e googleVideoGen.ts
 * (submeter / consultar / baixar) para o cliente reaproveitar o laço de
 * espera e a faixa de resultados que já existem.
 *
 * DIFERENÇA QUE MANDA NO DESENHO: esta API **não aceita base64**. A foto e o
 * vídeo têm que estar em URLs que o servidor da Magnific alcance pela
 * internet — por isso quem chama resolve os links públicos antes (ver a rota
 * em /api/ai/motion) e por isso o app precisa estar publicado.
 */

const BASE = "https://api.magnific.com/v1/ai/video";

export type PedidoMotion = {
  modelo?: ModeloMotionId;
  /** URL PÚBLICA da foto da modelo. */
  imageUrl: string;
  /** URL PÚBLICA do vídeo de onde vem o movimento. */
  videoUrl: string;
  prompt?: string;
  orientacao?: OrientacaoMotion;
  /** 0 a 1 — quanto o prompt manda em relação ao vídeo. */
  cfgScale?: number;
};

function mensagemDoErro(status: number, apiMsg: string): string {
  const moderacao = mensagemDeModeracao(apiMsg);
  if (moderacao) return moderacao;
  const base = apiMsg ? ` (${apiMsg})` : "";
  switch (status) {
    case 400:
      return `Pedido recusado pela Magnific — parâmetro inválido, ou ela não conseguiu baixar a foto/o vídeo pelo link${base}.`;
    case 401:
    case 403:
      return "Chave da Magnific recusada. Confira em Configurações → Conexão com IA.";
    case 404:
      return "Modelo ou tarefa não encontrada na Magnific.";
    case 429:
      return "Muitos pedidos em sequência — aguarde um instante e tente de novo.";
    case 402:
      return "Créditos insuficientes na conta da Magnific.";
    case 500:
    case 503:
      return "A Magnific falhou ao gerar. Tente de novo.";
    default:
      return `Falha ao gerar o motion control (${status})${base}.`;
  }
}

function chaveOuFalha(): string {
  // O slot do kling compartilha a chave do magnific — é assim que as
  // Configurações já guardam desde antes deste módulo existir.
  const creds = getAiCredentials("kling");
  if (!creds) {
    throw new Error(
      "Magnific não está conectada. Ative e cole a chave em Configurações → Conexão com IA.",
    );
  }
  return creds.apiKey;
}

export async function submeterMotion(pedido: PedidoMotion): Promise<JobVideo> {
  const apiKey = chaveOuFalha();
  const modelo = modeloMotion(pedido.modelo);

  const body: Record<string, unknown> = {
    image_url: pedido.imageUrl,
    video_url: pedido.videoUrl,
    character_orientation: pedido.orientacao || "video",
  };
  if (pedido.prompt?.trim()) body.prompt = pedido.prompt.trim().slice(0, 2500);
  if (typeof pedido.cfgScale === "number" && Number.isFinite(pedido.cfgScale)) {
    body.cfg_scale = Math.min(1, Math.max(0, pedido.cfgScale));
  }

  const res = await fetch(`${BASE}/${modelo.slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-magnific-api-key": apiKey },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    const msg =
      (typeof err?.message === "string" && err.message) ||
      (typeof data.message === "string" && data.message) ||
      "";
    throw new Error(mensagemDoErro(res.status, msg));
  }

  // A resposta embrulha o conteúdo em `data`.
  const d = (data.data as Record<string, unknown>) || data;
  const taskId = typeof d.task_id === "string" ? d.task_id : "";
  if (!taskId) throw new Error("A Magnific não devolveu a tarefa.");

  // O slug viaja junto do id porque a consulta de status precisa dele na URL,
  // e a rota de acompanhamento só recebe um identificador.
  return { jobId: `${modelo.id}/${taskId}`, status: "pending" };
}

/** Separa o par modelo/tarefa que `submeterMotion` montou. */
function partes(jobId: string): { slug: string; taskId: string } {
  const i = jobId.indexOf("/");
  const modeloId = i >= 0 ? jobId.slice(0, i) : "";
  const taskId = i >= 0 ? jobId.slice(i + 1) : jobId;
  return { slug: modeloMotion(modeloId).slug, taskId };
}

async function buscarTarefa(jobId: string): Promise<Record<string, unknown>> {
  const apiKey = chaveOuFalha();
  const { slug, taskId } = partes(jobId);

  const res = await fetch(`${BASE}/${slug}/${encodeURIComponent(taskId)}`, {
    headers: { "x-magnific-api-key": apiKey },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new Error(mensagemDoErro(res.status, typeof err?.message === "string" ? err.message : ""));
  }
  return (data.data as Record<string, unknown>) || data;
}

/** A URL do vídeo pronto dentro da tarefa concluída. */
function urlDoVideo(d: Record<string, unknown>): string {
  const gerados = d.generated;
  if (Array.isArray(gerados) && typeof gerados[0] === "string") return gerados[0];
  if (typeof gerados === "string") return gerados;
  return "";
}

export async function consultarStatusMotion(jobId: string): Promise<StatusVideo> {
  const d = await buscarTarefa(jobId);
  const status = String(d.status || "").toUpperCase();

  if (status === "COMPLETED") {
    if (!urlDoVideo(d)) {
      return { status: "failed", errorMessage: "A Magnific terminou sem devolver vídeo." };
    }
    // A Magnific cobra em créditos e não informa o custo aqui — a tela diz
    // isso em vez de mostrar um valor inventado.
    return { status: "completed" };
  }
  if (status === "FAILED" || status === "ERROR") {
    const msg = typeof d.error === "string" ? d.error : undefined;
    return { status: "failed", errorMessage: msg };
  }
  return { status: "in_progress" };
}

export async function baixarConteudoMotion(
  jobId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const d = await buscarTarefa(jobId);
  const url = urlDoVideo(d);
  if (!url) throw new Error("O vídeo ainda não está pronto na Magnific.");

  // A URL do arquivo é pública e temporária; baixar aqui evita que o
  // navegador precise dela — e mantém o mesmo caminho dos outros geradores.
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(mensagemDoErro(res.status, ""));

  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "video/mp4",
  };
}
