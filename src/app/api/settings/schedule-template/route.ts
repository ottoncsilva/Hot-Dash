import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { listTemplateSlots, replaceTemplateSlots, type TemplateSlotInput } from "@/lib/scheduleTemplate";
import type { SocialNetwork } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ slots: listTemplateSlots() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.slots)) throw new ApiError(400, "Formato inválido.");

    const slots: TemplateSlotInput[] = body.slots.map((s: Record<string, unknown>) => ({
      weekday: Number(s.weekday),
      timeStart: String(s.timeStart || ""),
      timeEnd: String(s.timeEnd || ""),
      network: String(s.network || "") as SocialNetwork,
      postType: String(s.postType || ""),
      mediaKind: s.mediaKind === "image" || s.mediaKind === "video" ? s.mediaKind : "any",
      label: typeof s.label === "string" && s.label ? s.label : undefined,
      sortOrder: 0,
    }));

    let result;
    try {
      result = replaceTemplateSlots(slots);
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao salvar o programa.");
    }
    return NextResponse.json({ slots: result });
  } catch (err) {
    return errorResponse(err);
  }
}
