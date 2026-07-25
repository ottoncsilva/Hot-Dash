import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { parseSyncPayExport } from "@/lib/payments/syncpayExport";
import { importProviderRows } from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Importa a EXPORTAÇÃO de transações do painel da SyncPay (PDF ou CSV).
 *
 * É por aqui que o histórico ganha o valor LÍQUIDO: a API não tem listagem e a
 * consulta individual não devolve o `final_amount` — o export é a única fonte.
 * As datas do arquivo estão em UTC e são convertidas para o instante correto.
 *
 * Envie multipart/form-data com o campo `file`. Use `dryRun=1` para ver a
 * prévia sem gravar nada.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Envie o arquivo exportado da SyncPay." }, { status: 400 });
    }
    const dryRun = String(form.get("dryRun") || "") === "1";

    const buf = Buffer.from(await file.arrayBuffer());
    const linhas = parseSyncPayExport(buf, file.name);
    if (linhas.length === 0) {
      return NextResponse.json(
        {
          error:
            "Não consegui ler nenhuma transação nesse arquivo. Exporte de novo em PDF ou CSV pelo painel da SyncPay (Exportação: Transaction).",
        },
        { status: 400 },
      );
    }

    const res = importProviderRows("syncpay", linhas, { dryRun });

    // Totais do arquivo, para conferir com o painel da SyncPay antes de aplicar.
    const pagas = linhas.filter((l) => ["completed", "paid"].includes(l.status));
    const soma = (f: (x: (typeof linhas)[number]) => number) => linhas.reduce((s, l) => s + f(l), 0);
    const somaPagas = (f: (x: (typeof linhas)[number]) => number) => pagas.reduce((s, l) => s + f(l), 0);

    return NextResponse.json({
      ok: true,
      dryRun,
      arquivo: file.name,
      lidas: linhas.length,
      pagas: pagas.length,
      totais: {
        vendaPagas: somaPagas((l) => l.amountCents),
        taxaPagas: somaPagas((l) => l.feeCents),
        liquidoPagas: somaPagas((l) => l.netCents),
        vendaTodas: soma((l) => l.amountCents),
      },
      periodo: {
        de: Math.min(...linhas.map((l) => l.createdAtMs)),
        ate: Math.max(...linhas.map((l) => l.createdAtMs)),
      },
      ...res,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
