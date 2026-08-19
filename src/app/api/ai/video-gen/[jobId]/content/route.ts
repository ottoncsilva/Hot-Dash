import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { baixarConteudoVideo } from "@/lib/videoGen";
import { baixarConteudoVeo } from "@/lib/googleVideoGen";
import { decodificarJob } from "@/lib/aiMediaOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** O download em si pode ser um vídeo de vários MB — folga generosa. */
export const maxDuration = 180;

/**
 * Faz o proxy dos bytes do vídeo pronto — o navegador nunca fala direto com o
 * OpenRouter (nem com a chave, nem com a URL assinada deles).
 */
export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    await requireUser(req);
    const jobId = params.jobId?.trim();
    if (!jobId) throw new ApiError(400, "Job inválido.");
    const { provedor, id } = decodificarJob(jobId);
    const { bytes, contentType } =
      provedor === "google" ? await baixarConteudoVeo(id) : await baixarConteudoVideo(id);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": contentType } });
  } catch (err) {
    return errorResponse(err);
  }
}
