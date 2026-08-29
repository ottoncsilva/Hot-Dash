import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getAppTimeZone, getFinanceSettings, getPaymentSettingsPublic } from "@/lib/settings";
import { listTransactionsInRange, periodStatsInRange } from "@/lib/transactions";
import { activeProvider } from "@/lib/payments";
import { getTelegramContactsByTransactions } from "@/lib/telegramDb";
import { contatosDeRelatoriosExternos } from "@/lib/externalSaleReport";
import { resolvePeriod } from "@/lib/periodRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId") || undefined;

    // Mesmo seletor de período do Dashboard. O filtro é aplicado na CONSULTA,
    // não sobre uma lista já cortada — senão "este mês" só enxergaria as
    // últimas cobranças que coubessem no limite.
    const tz = getAppTimeZone();
    const { period, range } = resolvePeriod(
      req.nextUrl.searchParams.get("period"),
      req.nextUrl.searchParams.get("from"),
      req.nextUrl.searchParams.get("to"),
      tz,
    );

    // Saldo do provedor (best-effort; não bloqueia o painel se falhar).
    let balanceCents: number | null = null;
    const provider = activeProvider();
    if (provider?.getBalance) {
      const bal = await provider.getBalance().catch(() => null);
      balanceCents = bal?.availableCents ?? null;
    }

    // Contato do Telegram de cada venda (quando o webhook amarrou a cobrança a
    // uma inscrição): é o que a tela usa para abrir a conversa com o lead.
    // SEM teto: um limite aqui cortava período longo sem avisar — o extrato
    // do Financeiro precisa ser o registro completo, não uma amostra.
    const transactions = listTransactionsInRange(range.since, range.until, undefined, profileId);
    const contatos = getTelegramContactsByTransactions(transactions.map((t) => t.id));
    // Venda de bot operado por fora não tem inscrição local, então não aparece
    // acima — mas o relatório do Canal de Vendas guarda o mesmo contato. Só
    // COMPLETA as lacunas: onde já existe inscrição, ela continua valendo.
    for (const [txId, contato] of contatosDeRelatoriosExternos(transactions)) {
      if (!contatos.has(txId)) contatos.set(txId, contato);
    }

    return NextResponse.json({
      providers: getPaymentSettingsPublic(),
      period,
      periodStats: periodStatsInRange(range.since, range.until, profileId),
      transactions: transactions.map((t) => {
        const telegram = contatos.get(t.id);
        return telegram ? { ...t, telegram } : t;
      }),
      balanceCents,
      finance: getFinanceSettings(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
