import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { createOrder, getAccount, getChat } from "@/lib/ltvDb";
import { etiquetarComoPago } from "@/lib/ltvAgent";
import { recordTransaction } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O "+ Venda" do Chat ao vivo: registra na mão o que foi pago FORA do PIX
 * automático (o lead mandou pix direto para a chave, pagou por outro caminho).
 * Sem isso o LTV do lead ficaria menor do que ele realmente é, e é justamente
 * esse número que decide quanto vale insistir com ele.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const chat = getChat(String(body.chatId || ""));
    if (!chat) throw new ApiError(404, "Conversa não encontrada.");

    const valor = Number(body.amount);
    if (!Number.isFinite(valor) || valor <= 0) throw new ApiError(400, "Informe um valor válido.");
    const amountCents = Math.round(valor * 100);

    const conta = getAccount(chat.accountId);
    const descricao = String(body.description || "").trim() || "Venda no LTV";

    // Entra no faturamento também: uma venda que não aparece no Financeiro é
    // uma venda que ninguém confere no fim do mês.
    const tx = recordTransaction({
      provider: "manual",
      providerRef: `ltv-manual-${chat.id}-${Date.now()}`,
      profileId: conta?.profileId,
      description: descricao,
      customer: chat.peerName,
      amountCents,
      method: "pix",
      status: "paid",
    });


    const pedido = createOrder({
      chatId: chat.id,
      transactionId: tx.id,
      amountCents,
      source: "manual",
      status: "paid",
    });

    // Venda lançada na mão também é venda: o lead precisa aparecer como pago
    // no WhatsApp da modelo igual a quem pagou pelo PIX automático.
    if (conta) await etiquetarComoPago(conta, chat.peerRef);

    return NextResponse.json({ order: pedido });
  } catch (err) {
    return errorResponse(err);
  }
}
