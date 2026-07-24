import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteProfile, getProfile, updateProfile } from "@/lib/profiles";
import { getProfileStatus } from "@/lib/profileStatuses";
import { deleteDir } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const profile = await getProfile(params.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Perfil não encontrado." },
        { status: 404 },
      );
    }
    return NextResponse.json({ profile });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    if (body.status !== undefined && !getProfileStatus(body.status)) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }
    const profile = await updateProfile(params.id, {
      name: body.name,
      notes: body.notes,
      status: body.status,
      bioPhysical: body.bioPhysical,
      bioUnique: body.bioUnique,
      bioPersonality: body.bioPersonality,
      bioVipLink: body.bioVipLink,
      bioWhatsappLink: body.bioWhatsappLink,
      bioWhatsappButton: body.bioWhatsappButton,
    });
    if (!profile) {
      return NextResponse.json(
        { error: "Perfil não encontrado." },
        { status: 404 },
      );
    }
    return NextResponse.json({ profile });
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
    const profile = await getProfile(params.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Perfil não encontrado." },
        { status: 404 },
      );
    }
    // Remove os arquivos do perfil (avatar + mídia) do disco da VPS primeiro:
    // se falhar, o registro no banco é mantido (evita perder o rastro do que
    // ainda precisa ser limpo).
    await deleteDir(`profiles/${params.id}`);
    await deleteProfile(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
