import "server-only";
import { getGoogleMediaKey } from "./settings";
import {
  modeloVideo,
  resolucaoVideoValida,
  formatoVideoValido,
  duracaoValida,
} from "./aiMediaOptions";
import { mensagemDeModeracao } from "./aiMediaErros";
import type { PedidoVideo, JobVideo, StatusVideo } from "./videoGen";

/**
 * GERADOR DE VÍDEO DO GOOGLE — Veo 3.1, pela Gemini API direto.
 *
 * Expõe as MESMAS três funções de videoGen.ts (submeter / consultar /
 * baixar), para as rotas trocarem de módulo pelo provedor do catálogo e o
 * cliente seguir com o mesmo laço de espera.
 *
 * A mecânica assíncrona é outra: em vez de um job com id curto, o Google
 * devolve uma "operação de longa duração" cujo NOME é o identificador
 * (`operations/abc123`, com barra), consultada em /v1beta/{nome} até
 * `done: true`. O vídeo pronto vem como URI, que ainda precisa da chave para
 * ser baixado — por isso o download passa por aqui e não pelo navegador.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function mensagemDoErro(status: number, apiMsg: string): string {
  const moderacao = mensagemDeModeracao(apiMsg);
  if (moderacao) return moderacao;
  const base = apiMsg ? ` (${apiMsg})` : "";
  switch (status) {
    case 400:
      return `Pedido recusado pelo Google — parâmetro inválido ou conteúdo barrado${base}.`;
    case 401:
    case 403:
      return "Chave do Google recusada. Confira em Configurações → Conexão com IA (e veja se o projeto está no plano pago: o Veo exige).";
    case 404:
      return "Modelo ou operação não encontrada no Google — o vídeo pode ter expirado.";
    case 429:
      return "Limite de uso do Google atingido — aguarde um instante e tente de novo.";
    case 500:
    case 503:
      return "O Google falhou ao gerar (não foi cobrado). Tente de novo.";
    default:
      return `Falha ao gerar o vídeo no Google (${status})${base}.`;
  }
}

function chaveOuFalha(): string {
  const apiKey = getGoogleMediaKey();
  if (!apiKey) {
    throw new Error(
      "Google não está conectado. Ative o Gemini (ou cole a chave de mídia) em Configurações → Conexão com IA.",
    );
  }
  return apiKey;
}

function partesDataUrl(url: string): { mime: string; dados: string } | null {
  const m = /^data:([^;,]+)[^,]*,(.*)$/s.exec(url);
  return m ? { mime: m[1], dados: m[2] } : null;
}

export async function submeterVideoVeo(pedido: PedidoVideo): Promise<JobVideo> {
  const apiKey = chaveOuFalha();
  const modelo = modeloVideo(pedido.modelo);
  const resolution = resolucaoVideoValida(modelo.id, pedido.resolution || "720p");

  const instancia: Record<string, unknown> = { prompt: pedido.prompt };
  if (pedido.firstFrame) {
    const partes = partesDataUrl(pedido.firstFrame);
    if (partes) {
      instancia.image = { inlineData: { mimeType: partes.mime, data: partes.dados } };
    }
  }

  const body = {
    instances: [instancia],
    parameters: {
      aspectRatio: formatoVideoValido(modelo.id, pedido.aspectRatio || "9:16"),
      resolution: resolution === "4K" ? "4k" : resolution, // o Google escreve em minúscula
      durationSeconds: String(duracaoValida(modelo.id, resolution, pedido.duration)),
      // Com imagem inicial o Google só aceita `allow_adult`; sem ela, esse
      // valor continua válido e é o que faz sentido aqui.
      personGeneration: "allow_adult",
      numberOfVideos: 1,
    },
  };

  const res = await fetch(`${BASE}/models/${encodeURIComponent(modelo.slug)}:predictLongRunning`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new Error(mensagemDoErro(res.status, typeof err?.message === "string" ? err.message : ""));
  }

  const nome = typeof data.name === "string" ? data.name : "";
  if (!nome) throw new Error("O Google não devolveu a operação do vídeo.");

  return { jobId: nome, status: "pending" };
}

/** Onde o vídeo pronto aparece dentro da operação concluída. */
function uriDoVideo(data: Record<string, unknown>): string {
  const resp = data.response as Record<string, unknown> | undefined;
  const gvr = resp?.generateVideoResponse as Record<string, unknown> | undefined;
  const amostras = (gvr?.generatedSamples as { video?: { uri?: string } }[] | undefined) || [];
  return amostras[0]?.video?.uri || "";
}

export async function consultarStatusVeo(jobId: string): Promise<StatusVideo> {
  const apiKey = chaveOuFalha();

  // O nome da operação já vem no formato `operations/…`; a URL o recebe
  // inteiro, com as barras, então não pode ser codificado como um segmento.
  const res = await fetch(`${BASE}/${jobId}`, { headers: { "x-goog-api-key": apiKey } });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new Error(mensagemDoErro(res.status, typeof err?.message === "string" ? err.message : ""));
  }

  // Enquanto não termina, `done` vem falso ou ausente.
  if (!data.done) return { status: "in_progress" };

  // Terminou com erro declarado dentro da própria operação — a chamada de
  // submissão já tinha dado certo, então não é erro de HTTP.
  const erroOp = data.error as { message?: string } | undefined;
  if (erroOp?.message) return { status: "failed", errorMessage: erroOp.message };

  if (!uriDoVideo(data)) {
    return { status: "failed", errorMessage: "O Google terminou sem devolver vídeo." };
  }
  // O Google não informa custo na operação; vale a estimativa da tela.
  return { status: "completed" };
}

export async function baixarConteudoVeo(jobId: string): Promise<{ bytes: Buffer; contentType: string }> {
  const apiKey = chaveOuFalha();

  const opRes = await fetch(`${BASE}/${jobId}`, { headers: { "x-goog-api-key": apiKey } });
  const op = (await opRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!opRes.ok) {
    const err = op.error as Record<string, unknown> | undefined;
    throw new Error(mensagemDoErro(opRes.status, typeof err?.message === "string" ? err.message : ""));
  }

  const uri = uriDoVideo(op);
  if (!uri) throw new Error("O vídeo ainda não está pronto no Google.");

  // A URI do arquivo também exige a chave — por isso o download é feito aqui
  // e repassado, em vez de entregue ao navegador.
  const res = await fetch(uri, { headers: { "x-goog-api-key": apiKey }, redirect: "follow" });
  if (!res.ok) throw new Error(mensagemDoErro(res.status, ""));

  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "video/mp4",
  };
}
