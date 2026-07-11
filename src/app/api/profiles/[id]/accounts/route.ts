import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { addAccount } from "@/lib/profiles";
import { NETWORK_LABELS, type SocialNetwork } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const network = String(body.network || "") as SocialNetwork;
    const username = String(body.username || "").trim();

    if (!NETWORK_LABELS[network]) {
      return NextResponse.json(
        { error: "Rede social inválida." },
        { status: 400 },
      );
    }
    if (!username) {
      return NextResponse.json(
        { error: "Informe o usuário/identificador da conta." },
        { status: 400 },
      );
    }

    const profile = await addAccount(params.id, {
      network,
      username,
      url: body.url,
      login: body.login,
      password: body.password,
      notes: body.notes,
    });
    if (!profile) {
      return NextResponse.json(
        { error: "Perfil não encontrado." },
        { status: 404 },
      );
    }
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
