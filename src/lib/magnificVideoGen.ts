import "server-only";
import {
  modeloVideo,
  resolucaoVideoValida,
  formatoVideoValido,
  duracaoValida,
  FORMATO_MAGNIFIC,
} from "./aiMediaOptions";
import {
  submeterTarefaMagnific,
  consultarTarefaMagnific,
  baixarArquivoMagnific,
} from "./magnificTasks";
import type { JobVideo, PedidoVideo, StatusVideo } from "./videoGen";

/**
 * GERADOR DE VÍDEO pela Magnific.
 *
 * Como no lado da imagem, quase nada aqui é modelo novo: Seedance 2.0 (Pro,
 * Mini e Fast) e Veo 3.1 são os MESMOS que o painel já gera pela OpenRouter e
 * pelo Google. O único exclusivo é o Kling 2.6 Pro.
 *
 * Expõe as mesmas três funções de videoGen.ts e googleVideoGen.ts
 * (submeter / consultar / baixar), então o cliente reaproveita o laço de
 * espera e a faixa de resultados que já existem. Diferente da imagem, aqui NÃO
 * há laço no servidor: quem repete a consulta é a tela, que já faz isso e
 * sobrevive a fechar a aba.
 */

/**
 * Duas famílias, dois jeitos de dizer a mesma coisa — e é por isso que existe
 * este `switch` em vez de um corpo só:
 *
 * - SEEDANCE: a resolução vai no CAMINHO (`video/seedance-2-pro-1080p`), e o
 *   corpo leva duração e formato.
 * - VEO e KLING: caminho fixo, e tudo vai no corpo.
 */
function familia(slug: string): "seedance" | "veo" | "kling" {
  if (slug.includes("seedance")) return "seedance";
  if (slug.includes("veo")) return "veo";
  return "kling";
}

/** O sufixo de resolução que o Seedance da Magnific usa no caminho. */
function sufixoSeedance(resolucao: string): string {
  return resolucao === "4K" ? "4k" : resolucao.toLowerCase();
}

export async function submeterVideoMagnific(pedido: PedidoVideo): Promise<JobVideo> {
  const modelo = modeloVideo(pedido.modelo);
  const resolucao = resolucaoVideoValida(modelo.id, pedido.resolution);
  const formato = formatoVideoValido(modelo.id, pedido.aspectRatio);
  const duracao = duracaoValida(modelo.id, resolucao, pedido.duration);
  const tipo = familia(modelo.slug);

  const body: Record<string, unknown> = { prompt: pedido.prompt };
  let caminho = modelo.slug;

  if (pedido.firstFrame) {
    // A Magnific aceita base64 ou URL pública neste campo — então o mesmo
    // primeiro frame que os outros geradores recebem serve aqui, sem precisar
    // do app publicado (que é o que o Motion Control exige).
    body.image = pedido.firstFrame;
  }

  if (tipo === "seedance") {
    caminho = `${modelo.slug}-${sufixoSeedance(resolucao)}`;
    body.duration = duracao;
    body.aspect_ratio = FORMATO_MAGNIFIC[formato];
  } else if (tipo === "veo") {
    body.duration = duracao;
    body.resolution = resolucao.toLowerCase();
    body.aspect_ratio = FORMATO_MAGNIFIC[formato];
    body.generate_audio = pedido.generateAudio !== false;
  } else {
    // Kling: só 5 ou 10 segundos, e como STRING. A resolução não é escolhível
    // — o modelo decide —, então o campo simplesmente não vai.
    body.duration = String(duracao);
    body.aspect_ratio = FORMATO_MAGNIFIC[formato];
    body.generate_audio = pedido.generateAudio !== false;
  }

  if (typeof pedido.seed === "number" && Number.isFinite(pedido.seed) && tipo !== "kling") {
    body.seed = Math.round(pedido.seed);
  }

  // O id já volta carimbado com o caminho — é o que permite a rota de
  // acompanhamento consultar sem saber de qual modelo se trata.
  const jobId = await submeterTarefaMagnific(caminho, body);
  return { jobId, status: "pending" };
}

export async function consultarStatusVideoMagnific(jobId: string): Promise<StatusVideo> {
  const t = await consultarTarefaMagnific(jobId);

  if (t.status === "COMPLETED") {
    if (t.gerados.length === 0) {
      return { status: "failed", errorMessage: "A Magnific terminou sem devolver vídeo." };
    }
    // Sem `costUsd`: a Magnific cobra em crédito e não informa o valor.
    return { status: "completed" };
  }
  if (t.status === "FAILED" || t.status === "ERROR") {
    return { status: "failed", errorMessage: t.erro };
  }
  return { status: "in_progress" };
}

export async function baixarConteudoVideoMagnific(
  jobId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const t = await consultarTarefaMagnific(jobId);
  const url = t.gerados[0];
  if (!url) throw new Error("O vídeo ainda não está pronto na Magnific.");
  return baixarArquivoMagnific(url, "video/mp4");
}
