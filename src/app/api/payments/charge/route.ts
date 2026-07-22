import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { activeProvider } from "@/lib/payments";
import { recordTransaction } from "@/lib/transactions";
import { ensureSyncpayWebhookToken } from "@/lib/settings";
import { publicOrigin } from "@/lib/publicOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = activeProvider();
    if (!provider) {
      return NextResponse.json(
        {
          error:
            "Nenhum provedor de pagamento configurado. Ative e informe a chave em Configurações.",
        },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Informe um valor válido." },
        { status: 400 },
      );
    }
    const amountCents = Math.round(amount * 100);
    // Inclui o token — sem ele a SyncPay recebe 401 e a venda nunca é
    // confirmada. E usa a origem PÚBLICA (não req.nextUrl.origin, que atrás de
    // proxy/EasyPanel pode resolver para um host interno inalcançável pela
    // SyncPay — outro motivo do dashboard não receber os pagamentos).
    const token = ensureSyncpayWebhookToken();
    const postbackUrl = `${publicOrigin(req)}/api/webhooks/${provider.key}?token=${encodeURIComponent(token)}`;

    const result = await provider.createPixCharge({
      amountCents,
      description: body.description,
      customer: body.customer,
      postbackUrl,
    });

    const tx = recordTransaction({
      provider: provider.key,
      providerRef: result.providerRef,
      profileId: body.profileId,
      description: body.description,
      customer: body.customer?.name,
      amountCents,
      method: "pix",
      status: result.status,
    });

    return NextResponse.json({
      transaction: tx,
      pixCode: result.pixCode,
      qrCodeBase64: result.qrCodeBase64,
      checkoutUrl: result.checkoutUrl,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
