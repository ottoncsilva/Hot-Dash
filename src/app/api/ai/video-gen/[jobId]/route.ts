import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { consultarStatusVideo } from "@/lib/videoGen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Um passo de consulta — o cliente é quem repete a chamada até `completed`. */
export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    await requireUser(req);
    const jobId = params.jobId?.trim();
    if (!jobId) throw new ApiError(400, "Job inválido.");
    const status = await consultarStatusVideo(jobId);
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err);
  }
}
