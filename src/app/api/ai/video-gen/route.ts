import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getMediaRow, renderVisionImageBase64 } from "@/lib/media";
import { submeterVideoSeedance, type VideoDuration, type VideoAspectRatio } from "@/lib/videoGen";
import { submeterVideoVeo } from "@/lib/googleVideoGen";
import { submeterVideoMagnific } from "@/lib/magnificVideoGen";
import {
  modeloVideo,
  resolucaoVideoValida,
  formatoVideoValido,
  duracaoValida,
  quantidadeValida,
  codificarJob,
} from "@/lib/aiMediaOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Só SUBMETE o job — não espera terminar. A Video API é assíncrona (pode
 * levar minutos), e o cliente é quem consulta o andamento em
 * /api/ai/video-gen/[jobId], então esta chamada volta rápido.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const prompt = String(body.prompt || "").trim();
    if (!prompt) throw new ApiError(400, "Escreva o prompt do vídeo.");

    // Modelo, resolução, formato e duração andam juntos: o Seedance vai de
    // 480p a 4K com 5 formatos e 4-15s, o Veo faz 720p+ com 2 formatos e
    // só 4/6/8s (e exige 8s em 1080p/4k). A tela já manda coerente, mas a
    // rota não pode confiar nisso.
    const modelo = modeloVideo(body.modelo);
    const resolution = resolucaoVideoValida(modelo.id, body.resolution);
    const aspectRatio = formatoVideoValido(modelo.id, body.aspectRatio) as VideoAspectRatio;
    const duration = duracaoValida(modelo.id, resolution, body.duration) as VideoDuration;
    const quantidade = quantidadeValida(body.quantidade);
    const seed =
      typeof body.seed === "number" && Number.isFinite(body.seed) ? body.seed : undefined;
    // Áudio LIGADO por padrão: só desliga quem pedir explicitamente. Um
    // cliente antigo que não mande o campo continua recebendo vídeo com voz,
    // que é o que a tela oferece hoje.
    const generateAudio = body.generateAudio !== false;
    // Filtro de conteúdo. Ligado a menos que o cliente peça explicitamente para
    // desligar — e o módulo ainda checa se o MODELO aceita o campo antes de
    // mandá-lo, porque nem todos aceitam.
    const filtroSeguranca = body.filtroSeguranca !== false;

    // O first frame chega OU já em base64 (upload direto do operador,
    // redimensionado no navegador) OU como o id de uma mídia da Galeria —
    // nesse segundo caso é aqui que ele vira base64, com a mesma renderização
    // usada para a IA "ver" fotos (até 1024px, JPEG q82).
    let firstFrame: string | undefined;
    const firstFrameBase64 = typeof body.firstFrameBase64 === "string" ? body.firstFrameBase64.trim() : "";
    const firstFrameMediaId = typeof body.firstFrameMediaId === "string" ? body.firstFrameMediaId.trim() : "";
    if (firstFrameBase64) {
      if (!firstFrameBase64.startsWith("data:image/")) throw new ApiError(400, "Primeiro frame inválido.");
      firstFrame = firstFrameBase64;
    } else if (firstFrameMediaId) {
      const row = getMediaRow(firstFrameMediaId);
      if (row) {
        const b64 = await renderVisionImageBase64(row.path);
        if (b64) firstFrame = `data:image/jpeg;base64,${b64}`;
      }
    }

    // A Video API não tem `n`: quantidade vira N jobs. A faixa de resultados
    // já acompanha vários em paralelo. Um que falhe não descarta os aceitos.
    const jobs: { jobId: string; status: string }[] = [];
    let erroParcial = "";
    for (let i = 0; i < quantidade; i++) {
      try {
        const submeter =
          modelo.provedor === "google"
            ? submeterVideoVeo
            : modelo.provedor === "magnific"
              ? submeterVideoMagnific
              : submeterVideoSeedance;
        const job = await submeter({
          prompt,
          firstFrame,
          duration,
          resolution,
          aspectRatio,
          generateAudio,
          filtroSeguranca,
          seed,
          modelo: modelo.id,
        });
        // O id sai daqui já com o prefixo do provedor: é ele que diz às
        // rotas de acompanhamento a quem perguntar.
        jobs.push({ ...job, jobId: codificarJob(modelo.provedor, job.jobId) });
      } catch (e) {
        erroParcial = e instanceof Error ? e.message : "falha";
        break;
      }
    }
    if (jobs.length === 0) throw new ApiError(502, erroParcial || "Nenhum job foi aceito.");

    return NextResponse.json({ jobs, aviso: erroParcial || undefined });
  } catch (err) {
    return errorResponse(err);
  }
}
