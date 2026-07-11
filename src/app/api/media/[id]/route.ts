import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteMedia, getMediaRow } from "@/lib/media";
import { deleteMediaRow } from "@/lib/googleSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const row = getMediaRow(params.id);
    const ok = await deleteMedia(params.id);
    if (!ok) {
      return NextResponse.json(
        { error: "Mídia não encontrada." },
        { status: 404 },
      );
    }
    if (row) await deleteMediaRow(row.profile_id, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
