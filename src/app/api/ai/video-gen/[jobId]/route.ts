import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { consultarStatusVideo } from "@/lib/videoGen";
import { consultarStatusVeo } from "@/lib/googleVideoGen";
import { consultarStatusMotion } from "@/lib/motionGen";
import { decodificarJob } from "@/lib/aiMediaOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Um passo de consulta — o cliente é quem repete a chamada até `completed`. */
export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    await requireUser(req);
    const jobId = params.jobId?.trim();
    if (!jobId) throw new ApiError(400, "Job inválido.");
    // O prefixo do id diz de qual provedor é o job.
    const { provedor, id } = decodificarJob(jobId);
    const status =
      provedor === "google"
        ? await consultarStatusVeo(id)
        : provedor === "magnific"
          ? await consultarStatusMotion(id)
          : await consultarStatusVideo(id);
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err);
  }
}
