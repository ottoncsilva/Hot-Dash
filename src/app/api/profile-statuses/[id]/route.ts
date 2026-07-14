import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteProfileStatus, updateProfileStatus } from "@/lib/profileStatuses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    let status;
    try {
      status = updateProfileStatus(params.id, { name: body.name, color: body.color });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao salvar.");
    }
    if (!status) {
      return NextResponse.json({ error: "Status não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ status });
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
    let ok;
    try {
      ok = deleteProfileStatus(params.id);
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao excluir.");
    }
    if (!ok) {
      return NextResponse.json({ error: "Status não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
