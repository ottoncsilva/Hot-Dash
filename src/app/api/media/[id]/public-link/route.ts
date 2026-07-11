import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getOrCreatePublicToken } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const token = getOrCreatePublicToken(params.id);
    if (!token) {
      return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ token });
  } catch (err) {
    return errorResponse(err);
  }
}
