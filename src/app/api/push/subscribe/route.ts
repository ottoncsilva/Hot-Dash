import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { saveSubscription } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Exige sessão: os alertas carregam valor de venda e nome do cliente,
    // então só quem está logado pode inscrever/remover um aparelho.
    await requireUser(req);
    const body = await req.json();
    if (!body || !body.endpoint) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }
    saveSubscription(body);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
