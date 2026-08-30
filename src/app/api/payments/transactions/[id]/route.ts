import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { deleteTransaction, getTransaction, updateTransaction } from "@/lib/transactions";
import { getRelatorioDaTransacao } from "@/lib/externalSaleReport";
import { listBotsComModelo } from "@/lib/telegramDb";
import { listProfiles } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A cobrança MAIS o que o Canal de Vendas disse sobre ela.
 *
 * A tela de edição precisa dos dois lados juntos: o que está gravado e o que
 * o relatório do bot operado por fora afirma. É isso que transforma "corrigir
 * no escuro" em "conferir e aceitar" — sem o relatório ao lado, o operador
 * teria de ir procurar a mensagem no canal do Telegram para saber o que
 * digitar no campo Produto.
 *
 * `relatorio` vem `null` quando a venda passou pelo checkout do Hot-Dash (não
 * existe relatório externo dela) ou quando ele ainda não chegou no canal.
 *
 * Vai junto a lista de BOTS (com a modelo dona) que a edição usa para atribuir
 * a venda. Ela vem daqui, e não numa carga da página inteira, porque só a
 * janela de edição precisa dela — a tabela do Financeiro carrega centenas de
 * linhas e não usa nada disso.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const transaction = getTransaction(params.id);
    if (!transaction) return NextResponse.json({ error: "Cobrança não encontrada." }, { status: 404 });
    const bots = listBotsComModelo();
    const comBot = new Set(bots.map((b) => b.profileId));
    return NextResponse.json({
      transaction,
      relatorio: getRelatorioDaTransacao(transaction.provider, transaction.providerRef),
      bots,
      // Modelos SEM bot cadastrado. Existem (venda de LTV, lançamento à mão) e
      // sumiriam do alcance se a escolha fosse só de bot — a correção pedida
      // não pode tirar do operador algo que ele já conseguia fazer.
      perfisSemBot: (await listProfiles())
        .filter((p) => !comBot.has(p.id))
        .map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Corrige uma cobrança à mão.
 *
 * Existe porque o que o gateway manda nem sempre bate com o painel dele — uma
 * venda de R$ 19,90 já entrou como R$ 20,70 — e porque numa venda de bot
 * operado por fora ele mal sabe o que foi vendido: produto, método, código de
 * origem e modelo chegam vazios. O líquido não vem daqui: é sempre
 * venda − taxa − split, calculado no servidor.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const cents = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
    };
    /** String vazia CHEGA como decisão ("apagar"); só o que não veio é
     *  ignorado. Por isso o teste é de tipo, não de verdade. */
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    /** Vocabulário fechado: um valor fora dele não é correção, é lixo — e
     *  gravá-lo tiraria a linha de todos os filtros de uma vez. */
    const deLista = (v: unknown, aceitos: string[]) => {
      const s = str(v);
      if (s === undefined) return undefined;
      const limpo = s.trim().toLowerCase();
      if (!limpo) return ""; // esvaziar continua permitido
      return aceitos.includes(limpo) ? limpo : undefined;
    };
    const t = updateTransaction(params.id, {
      amountCents: cents(body.amountCents),
      feeCents: cents(body.feeCents),
      splitCents: cents(body.splitCents),
      customer: str(body.customer),
      botId: str(body.botId),
      profileId: str(body.profileId),
      description: str(body.description),
      method: deLista(body.method, ["pix", "card"]),
      sourceCode: str(body.sourceCode),
      origin: deLista(body.origin, ["bot", "ltv", "painel"]),
    });
    if (!t) return NextResponse.json({ error: "Cobrança não encontrada." }, { status: 404 });
    return NextResponse.json({ transaction: t });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Remove uma cobrança do histórico.
 *
 * O webhook da SyncPay é cadastrado por conta e traz todo tipo de movimento —
 * um saque já entrou como venda uma vez. O filtro do webhook barra os casos
 * conhecidos; isto aqui é a saída manual para o que escapar.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser(req);
    const ok = deleteTransaction(params.id);
    if (!ok) return NextResponse.json({ error: "Cobrança não encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
