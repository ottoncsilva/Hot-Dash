import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getProvider } from "@/lib/payments";
import { recordTransaction } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cobrança de TESTE na Stripe — Configurações → Pagamentos, "Testar
 * cobrança". Mesmo caminho de uma venda de verdade (mesmo `createCharge`,
 * mesma transação `pending` pré-criada), só que disparada à mão com um
 * valor qualquer, sem lead nem plano por trás — serve pra confirmar que a
 * chave secreta e o webhook estão mesmo funcionando ponta a ponta antes de
 * ligar o botão pros leads reais.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const provider = getProvider("stripe");
    if (!provider) {
      return NextResponse.json(
        { error: "Stripe não está configurada. Ative e informe a chave secreta acima." },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Informe um valor válido." }, { status: 400 });
    }
    const amountCents = Math.round(amount * 100);

    const result = await provider.createCharge({
      amountCents,
      currency: "USD",
      description: "Teste manual (Configurações → Pagamentos)",
      metadata: { origin: "teste-manual" },
    });

    // Pré-cria a transação PENDENTE, igual a uma venda de verdade: é o que
    // o webhook (`processarWebhookStripe`) procura pelo `providerRef` pra
    // virar "paid" quando o pagamento se completar — sem isso o teste some
    // do painel e só fica visível dentro do próprio dashboard da Stripe.
    const tx = recordTransaction({
      provider: "stripe",
      providerRef: result.providerRef,
      description: "Teste manual (Configurações)",
      amountCents,
      currency: "USD",
      method: "card",
      status: result.status,
      origin: "painel",
    });

    return NextResponse.json({ transaction: tx, checkoutUrl: result.checkoutUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
