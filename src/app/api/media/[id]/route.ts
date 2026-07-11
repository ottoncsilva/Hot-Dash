import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const ok = await deleteMedia(params.id);
    if (!ok) {
      return NextResponse.json(
        { error: "Mídia não encontrada." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
