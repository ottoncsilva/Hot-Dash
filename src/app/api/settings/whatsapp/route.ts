import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getUazapiSettingsPublic, updateUazapiSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ settings: getUazapiSettingsPublic() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const settings = updateUazapiSettings({
      url: typeof body.url === "string" ? body.url : undefined,
      adminToken: typeof body.adminToken === "string" ? body.adminToken : undefined,
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
