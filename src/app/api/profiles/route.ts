import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { createProfile, listProfiles } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profiles = await listProfiles();
    return NextResponse.json({ profiles });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json(
        { error: "Informe o nome da personagem." },
        { status: 400 },
      );
    }
    const profile = await createProfile({ name, notes: body.notes });
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
