import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getEvolutionSettingsPublic, updateEvolutionSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ settings: getEvolutionSettingsPublic() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const settings = updateEvolutionSettings({
      url: typeof body.url === "string" ? body.url : undefined,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
