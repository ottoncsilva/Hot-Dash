import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { createTarget, listTargets } from "@/lib/deliveryTargets";
import { getDeliveryBotSettingsPublic } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aparelhos de entrega de uma modelo — os celulares que recebem os posts. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const bot = getDeliveryBotSettingsPublic();
    return NextResponse.json({
      targets: listTargets(params.id),
      // A tela precisa do @ do bot para dizer ONDE digitar o código — sem
      // ele, o código é um número sem endereço.
      botUsername: bot.botUsername,
      botConfigurado: bot.hasToken,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    try {
      const target = createTarget(params.id, String(body.label || ""));
      return NextResponse.json({ target }, { status: 201 });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao criar o aparelho.");
    }
  } catch (err) {
    return errorResponse(err);
  }
}
