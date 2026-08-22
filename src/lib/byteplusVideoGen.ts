import "server-only";
import { getAiCredentials } from "./settings";
import {
  modeloVideo,
  resolucaoVideoValida,
  formatoVideoValido,
  duracaoValida,
} from "./aiMediaOptions";
import { mensagemDeModeracao } from "./aiMediaErros";
import type { JobVideo, PedidoVideo, StatusVideo } from "./videoGen";

/**
 * GERADOR DE VÍDEO pela BYTEPLUS MODELARK — a ByteDance oficial.
 *
 * Os Seedance nascem aqui. A OpenRouter e a Magnific revendem; esta é a
 * fonte, sem margem de intermediário e com campos que só existem nela:
 * marca d'água, câmera fixa, duração inteligente, e referência de áudio e de
 * vídeo (que nenhum revendedor expõe).
 *
 * Mesmas três funções de videoGen.ts (submeter / consultar / baixar), então o
 * cliente reaproveita o laço de espera e a faixa de resultados.
 *
 * DUAS REGRAS DA CASA QUE MUDAM O DESENHO:
 *
 * 1. A 2.0 e a 2.5 RECUSAM retrato humano real vindo de fora — só aceitam
 *    foto que a própria ModelArk gerou, na mesma conta, sem edição, em 30
 *    dias. A 1.5 Pro não tem a trava. Isso está no catálogo
 *    (`exigeFotoDaPlataforma`) e vira aviso na tela, não bloqueio: gerar a
 *    partir de texto continua valendo em todas.
 *
 * 2. Na 2.5, tarefa COM imagem só aceita `ratio: "adaptive"` — o formato sai
 *    da imagem e mandar outro é erro (`formatoDaImagem` no catálogo).
 */

const BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

function chaveOuFalha(): string {
  const creds = getAiCredentials("byteplus");
  if (!creds) {
    throw new Error(
      "BytePlus não está conectada. Ative e cole a chave em Configurações → Conexão com IA.",
    );
  }
  return creds.apiKey;
}

/** Traduz o erro para algo que o operador entende sem abrir o console. */
function mensagemDoErro(status: number, apiMsg: string): string {
  const moderacao = mensagemDeModeracao(apiMsg);
  if (moderacao) return moderacao;
  // A recusa por rosto tem mensagem própria: é a causa mais provável de um
  // 400 neste painel, e a saída não é óbvia.
  if (/face|portrait|human/i.test(apiMsg)) {
    return (
      "A BytePlus recusou a imagem por conter rosto humano. A Seedance 2.0 e a 2.5 " +
      "só aceitam retrato gerado na própria plataforma. Gere sem imagem, ou use a " +
      "Seedance 1.5 Pro, que não tem essa trava."
    );
  }
  const base = apiMsg ? ` (${apiMsg})` : "";
  switch (status) {
    case 400:
      return `Pedido recusado pela BytePlus — parâmetro inválido ou imagem fora dos limites${base}.`;
    case 401:
    case 403:
      return "Chave da BytePlus recusada. Confira em Configurações → Conexão com IA.";
    case 404:
      return "Modelo ou tarefa não encontrada na BytePlus.";
    case 429:
      return "Muitos pedidos em sequência — aguarde um instante e tente de novo.";
    default:
      return `Falha na BytePlus (${status})${base}.`;
  }
}

type ItemConteudo = Record<string, unknown>;

export async function submeterVideoByteplus(pedido: PedidoVideo): Promise<JobVideo> {
  const apiKey = chaveOuFalha();
  const modelo = modeloVideo(pedido.modelo);
  const resolucao = resolucaoVideoValida(modelo.id, pedido.resolution);
  const duracao = duracaoValida(modelo.id, resolucao, pedido.duration);

  // O CONTEÚDO é uma lista: o texto primeiro, depois as imagens com o papel
  // de cada uma. É diferente das outras rotas, onde cada coisa é um campo.
  const conteudo: ItemConteudo[] = [{ type: "text", text: pedido.prompt }];
  if (pedido.firstFrame) {
    conteudo.push({
      type: "image_url",
      image_url: { url: pedido.firstFrame },
      role: "first_frame",
    });
  }
  if (pedido.lastFrame && modelo.aceitaUltimoFrame) {
    conteudo.push({
      type: "image_url",
      image_url: { url: pedido.lastFrame },
      role: "last_frame",
    });
  }
  // Referências ("omni reference"): entram sem papel nenhum, e convivem com
  // os quadros — como na Magnific, ao contrário da OpenRouter.
  if (pedido.referencias?.length && modelo.referencias) {
    for (const url of pedido.referencias.slice(0, modelo.referencias.max)) {
      conteudo.push({ type: "image_url", image_url: { url } });
    }
  }

  const body: Record<string, unknown> = {
    model: modelo.slug,
    content: conteudo,
    resolution: resolucao.toLowerCase(), // 480p / 720p / 1080p / 4k
    duration: duracao,
    generate_audio: pedido.generateAudio !== false,
    // A marca d'água vem LIGADA por padrão na plataforma, e um vídeo de venda
    // com selo de IA no canto não serve. O painel manda `false` sempre;
    // quem quiser o selo tem o interruptor na tela.
    watermark: pedido.marcaDagua === true,
  };

  // FORMATO. Na 2.5 com imagem, só `adaptive` é aceito — o formato sai da
  // própria imagem. Mandar 9:16 ali devolve erro.
  const temImagem = Boolean(pedido.firstFrame || pedido.referencias?.length);
  body.ratio =
    modelo.formatoDaImagem && temImagem
      ? "adaptive"
      : formatoVideoValido(modelo.id, pedido.aspectRatio);

  if (typeof pedido.seed === "number" && Number.isFinite(pedido.seed)) {
    body.seed = Math.round(pedido.seed);
  }
  if (pedido.cameraFixa === true) body.camera_fixed = true;

  const res = await fetch(`${BASE}/contents/generations/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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

  const id = typeof data.id === "string" ? data.id : "";
  if (!id) throw new Error("A BytePlus não devolveu a tarefa.");
  return { jobId: id, status: "pending" };
}

async function buscarTarefa(jobId: string): Promise<Record<string, unknown>> {
  const apiKey = chaveOuFalha();
  const res = await fetch(
    `${BASE}/contents/generations/tasks/${encodeURIComponent(jobId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new Error(
      mensagemDoErro(res.status, typeof err?.message === "string" ? err.message : ""),
    );
  }
  return data;
}

/** A URL do vídeo pronto, dentro de `content.video_url`. */
function urlDoVideo(d: Record<string, unknown>): string {
  const c = d.content as Record<string, unknown> | undefined;
  return typeof c?.video_url === "string" ? c.video_url : "";
}

export async function consultarStatusByteplus(jobId: string): Promise<StatusVideo> {
  const d = await buscarTarefa(jobId);
  const status = String(d.status || "").toLowerCase();

  if (status === "succeeded") {
    if (!urlDoVideo(d)) {
      return { status: "failed", errorMessage: "A BytePlus terminou sem devolver vídeo." };
    }
    return { status: "completed" };
  }
  if (status === "failed" || status === "cancelled" || status === "expired") {
    const err = d.error as Record<string, unknown> | undefined;
    return {
      status: "failed",
      errorMessage: typeof err?.message === "string" ? err.message : undefined,
    };
  }
  return { status: "in_progress" };
}

export async function baixarConteudoByteplus(
  jobId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const d = await buscarTarefa(jobId);
  const url = urlDoVideo(d);
  if (!url) throw new Error("O vídeo ainda não está pronto na BytePlus.");

  // A URL vale 24 horas e 100 downloads — baixar aqui, agora, é o que garante
  // que o arquivo chegue à Galeria antes de expirar.
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(mensagemDoErro(res.status, ""));
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "video/mp4",
  };
}
