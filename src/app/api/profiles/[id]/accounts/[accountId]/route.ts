import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  deleteAccount,
  revealPassword,
  updateAccount,
} from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string; accountId: string } };

// GET com ?reveal=1 descriptografa e retorna a senha da conta (sob demanda).
export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const reveal = req.nextUrl.searchParams.get("reveal");
    if (!reveal) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    const password = await revealPassword(params.id, params.accountId);
    if (password === null) {
      return NextResponse.json(
        { error: "Sem senha guardada para esta conta." },
        { status: 404 },
      );
    }
    return NextResponse.json({ password });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const profile = await updateAccount(params.id, params.accountId, {
      network: body.network,
      username: body.username,
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
    return NextResponse.json({ profile });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    await requireUser(req);
    const profile = await deleteAccount(params.id, params.accountId);
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
