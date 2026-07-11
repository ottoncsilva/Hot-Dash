import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getTag, setMediaTag } from "@/lib/tags";
import { getMediaRow } from "@/lib/media";
import { updateMediaTagCell } from "@/lib/googleSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const ids: unknown = body.ids;
    const tagId = String(body.tagId || "");
    const action = body.action === "remove" ? "remove" : "add";

    if (!Array.isArray(ids) || ids.length === 0 || !tagId) {
      return NextResponse.json(
        { error: "Informe as mídias e a etiqueta." },
        { status: 400 },
      );
    }
    const mediaIds = ids.filter((id): id is string => typeof id === "string");
    setMediaTag(mediaIds, tagId, action);

    const tag = getTag(tagId);
    if (tag) {
      for (const mediaId of mediaIds) {
        const row = getMediaRow(mediaId);
        if (row) {
          await updateMediaTagCell(row.profile_id, mediaId, tag.name, action === "add");
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
