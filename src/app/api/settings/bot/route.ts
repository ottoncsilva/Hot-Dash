import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  getDynamicPrice,
  setDynamicPrice,
  getButtonStyles,
  setButtonStyles,
  BUTTON_ROLES,
  type ButtonStyles,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({
      dynamicPrice: getDynamicPrice(),
      buttonStyles: getButtonStyles(),
      roles: BUTTON_ROLES,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    // Os dois blocos são INDEPENDENTES: cada um tem o seu botão de salvar, e
    // gravar um não pode mexer no outro.
    if (body.dynamicPrice && typeof body.dynamicPrice === "object") {
      setDynamicPrice(body.dynamicPrice);
    }
    if (body.buttonStyles && typeof body.buttonStyles === "object") {
      setButtonStyles(body.buttonStyles as ButtonStyles);
    }

    return NextResponse.json({
      dynamicPrice: getDynamicPrice(),
      buttonStyles: getButtonStyles(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
