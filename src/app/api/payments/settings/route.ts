import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  getPaymentSettingsPublic,
  setLegacyWebhookEnabled,
  updatePaymentSettings,
} from "@/lib/settings";
import { lastPaidTransaction } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({
      settings: getPaymentSettingsPublic(),
      // Diagnóstico: confirma se o webhook da SyncPay está de fato chegando
      // (independe do bot — a SyncPay chama esse endpoint direto).
      lastPaid: lastPaidTransaction(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    // Liga/desliga a URL antiga do webhook (a longa). Depois de colar a curta
    // no painel do gateway, desligar aposenta o token antigo.
    if (typeof body.legacyWebhookEnabled === "boolean") {
      setLegacyWebhookEnabled(body.legacyWebhookEnabled);
    }
    const settings = body.syncpay
      ? updatePaymentSettings({ syncpay: body.syncpay })
      : getPaymentSettingsPublic();
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
