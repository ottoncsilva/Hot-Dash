import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getAppTimeZone, getFinanceSettings, getPaymentSettingsPublic } from "@/lib/settings";
import { listTransactionsInRange, periodStatsInRange } from "@/lib/transactions";
import { getProvider } from "@/lib/payments";
import { lerSaldoSyncpay } from "@/lib/payments/saldoSyncpay";
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

    // Saldo dos DOIS provedores (best-effort; nenhum bloqueia o painel se
    // falhar). São contas separadas, com moedas diferentes, e por isso viram
    // dois números na tela em vez de uma soma — centavos de real e de dólar
    // não se somam.
    //
    // Em paralelo: são duas chamadas de rede a provedores independentes, e
    // enfileirá-las dobraria a espera do carregamento da tela à toa.
    const [balanceCents, stripeBalance] = await Promise.all([
      // Pelo MESMO cache do Dashboard (ver `saldoSyncpay.ts`). Aqui a consulta
      // era direta e sem freio nenhum: trocar de período no Financeiro batia
      // na SyncPay a cada clique, e ela responde 429 quando se insiste.
      (async () => (await lerSaldoSyncpay()).balanceCents)(),
      (async () => {
        const stripe = getProvider("stripe");
        if (!stripe?.getBalance) return null;
        return stripe.getBalance().catch(() => null);
      })(),
    ]);

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
      /** Saldo na Stripe: `availableCents` é o DÓLAR, e `outras` traz cada
       *  moeda restante da mesma conta (BRL do cartão no Brasil, EUR/GBP da
       *  cobrança na moeda do lead). `null` = Stripe não conectada. */
      stripeBalance,
      finance: getFinanceSettings(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
