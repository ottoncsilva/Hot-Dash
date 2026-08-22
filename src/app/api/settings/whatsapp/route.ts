import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  getEvolutionSettingsPublic,
  getTelegramChipSettingsPublic,
  updateEvolutionSettings,
  updateTelegramChipSettings,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({
      settings: getEvolutionSettingsPublic(),
      chip: getTelegramChipSettingsPublic(),
    });
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
    // Os dois transportes do LTV moram na mesma tela: a Evolution leva o
    // WhatsApp, o microserviço MTProto leva o chip do Telegram.
    const chip = updateTelegramChipSettings({
      url: typeof body.chipUrl === "string" ? body.chipUrl : undefined,
      token: typeof body.chipToken === "string" ? body.chipToken : undefined,
    });
    return NextResponse.json({ settings, chip });
  } catch (err) {
    return errorResponse(err);
  }
}
