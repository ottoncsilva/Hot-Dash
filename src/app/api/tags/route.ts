import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { createTag, listTags } from "@/lib/tags";
import { onTagCreated } from "@/lib/googleSheets";
import { TAG_COLORS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ tags: listTags() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const color =
      typeof body.color === "string" && body.color
        ? body.color
        : TAG_COLORS[0];
    if (!name) {
      return NextResponse.json(
        { error: "Informe o nome da etiqueta." },
        { status: 400 },
      );
    }
    let tag;
    try {
      tag = createTag(name, color);
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao criar.");
    }
    await onTagCreated(tag);
    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
