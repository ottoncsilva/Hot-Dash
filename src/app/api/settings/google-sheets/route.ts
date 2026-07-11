import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getGoogleSheetsSettingsPublic, updateGoogleSheetsSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ settings: getGoogleSheetsSettingsPublic() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    let settings;
    try {
      settings = updateGoogleSheetsSettings({
        enabled: body.enabled,
        serviceAccountJson: body.serviceAccountJson,
        shareEmail: body.shareEmail,
      });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao salvar.");
    }
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
