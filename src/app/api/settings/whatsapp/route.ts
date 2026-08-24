import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  getTelegramAppSettingsPublic,
  getUazapiSettingsPublic,
  updateTelegramAppSettings,
  updateUazapiSettings,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({
      settings: getUazapiSettingsPublic(),
      telegram: getTelegramAppSettingsPublic(),
    });
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
    // O Telegram por conta real roda dentro do painel; o que ele precisa é só
    // a credencial de aplicativo do MTProto, que é do desenvolvedor.
    const telegram = updateTelegramAppSettings({
      apiId: Number.isFinite(body.apiId) ? Number(body.apiId) : undefined,
      apiHash: typeof body.apiHash === "string" ? body.apiHash : undefined,
    });
    return NextResponse.json({ settings, telegram });
  } catch (err) {
    return errorResponse(err);
  }
}
