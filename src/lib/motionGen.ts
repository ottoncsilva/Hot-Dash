import "server-only";
import { modeloMotion, type ModeloMotionId, type OrientacaoMotion } from "./aiMediaOptions";
import { submeterTarefaMagnific } from "./magnificTasks";
import type { JobVideo } from "./videoGen";

/**
 * MOTION CONTROL — Kling 2.6, pela API da Magnific (ex-Freepik).
 *
 * Transfere o movimento de um vídeo de referência para a foto de uma pessoa.
 * Não é o mesmo que os geradores de vídeo fazem: eles animam a partir de um
 * primeiro frame, aqui o movimento vem de fora, de um vídeo.
 *
 * Só a SUBMISSÃO mora aqui. O acompanhamento e o download são os mesmos de
 * qualquer tarefa da Magnific — o id carimbado com o caminho basta —, então
 * quem atende é o magnificVideoGen, e o cliente reaproveita o laço de espera
 * e a faixa de resultados que já existem.
 *
 * DIFERENÇA QUE MANDA NO DESENHO: esta API **não aceita base64**. A foto e o
 * vídeo têm que estar em URLs que o servidor da Magnific alcance pela
 * internet — por isso quem chama resolve os links públicos antes (ver a rota
 * em /api/ai/motion) e por isso o app precisa estar publicado.
 */

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

export async function submeterMotion(pedido: PedidoMotion): Promise<JobVideo> {
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

  // O caminho viaja junto do id: a consulta de status precisa dele na URL, e
  // a rota de acompanhamento só recebe um identificador.
  const jobId = await submeterTarefaMagnific(`video/${modelo.slug}`, body);
  return { jobId, status: "pending" };
}
