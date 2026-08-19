import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getMediaRow, renderVisionImageBase64 } from "@/lib/media";
import {
  submeterVideoSeedance,
  DURACOES,
  RESOLUCOES,
  FORMATOS_VIDEO,
  type VideoDuration,
  type VideoResolution,
  type VideoAspectRatio,
} from "@/lib/videoGen";

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

    const duration: VideoDuration = DURACOES.includes(body.duration) ? body.duration : 5;
    const resolution: VideoResolution = RESOLUCOES.includes(body.resolution) ? body.resolution : "720p";
    const aspectRatio: VideoAspectRatio = FORMATOS_VIDEO.includes(body.aspectRatio)
      ? body.aspectRatio
      : "9:16";
    const seed =
      typeof body.seed === "number" && Number.isFinite(body.seed) ? body.seed : undefined;
    const generateAudio = Boolean(body.generateAudio);

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

    const resultado = await submeterVideoSeedance({
      prompt,
      firstFrame,
      duration,
      resolution,
      aspectRatio,
      generateAudio,
      seed,
    });
    return NextResponse.json(resultado);
  } catch (err) {
    return errorResponse(err);
  }
}
