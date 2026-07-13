import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getAiSettingsPublic, updateAiSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ settings: getAiSettingsPublic() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const settings = updateAiSettings({
      provider: body.provider,
      openaiKey: typeof body.openaiKey === "string" ? body.openaiKey : undefined,
      geminiKey: typeof body.geminiKey === "string" ? body.geminiKey : undefined,
      openaiModel: typeof body.openaiModel === "string" ? body.openaiModel : undefined,
      geminiModel: typeof body.geminiModel === "string" ? body.geminiModel : undefined,
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
