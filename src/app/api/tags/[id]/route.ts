import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteTag, getTag, updateTag } from "@/lib/tags";
import { onTagDeleted, onTagRenamed } from "@/lib/googleSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const before = getTag(params.id);
    let tag;
    try {
      tag = updateTag(params.id, { name: body.name, color: body.color });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao salvar.");
    }
    if (!tag) {
      return NextResponse.json(
        { error: "Etiqueta não encontrada." },
        { status: 404 },
      );
    }
    if (before && before.name !== tag.name) {
      await onTagRenamed(before.name, tag.name);
    }
    return NextResponse.json({ tag });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const before = getTag(params.id);
    const ok = deleteTag(params.id);
    if (!ok) {
      return NextResponse.json(
        { error: "Etiqueta não encontrada." },
        { status: 404 },
      );
    }
    if (before) await onTagDeleted(before.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
