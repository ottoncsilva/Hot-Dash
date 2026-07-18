import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getReusableBlocks, setReusableBlocks, type ReusableBlock } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ blocks: getReusableBlocks() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.blocks)) {
      return NextResponse.json({ error: "Formato inválido." }, { status: 400 });
    }
    const blocks: ReusableBlock[] = body.blocks.map((b: any) => ({
      id: String(b.id || ""),
      name: String(b.name || ""),
      content: String(b.content || ""),
    }));
    setReusableBlocks(blocks);
    return NextResponse.json({ blocks });
  } catch (err) {
    return errorResponse(err);
  }
}
