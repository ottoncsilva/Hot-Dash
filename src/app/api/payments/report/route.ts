import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getAppTimeZone } from "@/lib/settings";
import { getProfile } from "@/lib/profiles";
import { buildFinanceReport } from "@/lib/financeReport";
import { financeReportToCsv } from "@/lib/financeReportCsv";
import { resolvePeriod } from "@/lib/periodRange";
import { PERIOD_OPTIONS } from "@/lib/periods";
import { partsInTimeZone } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Relatório do Financeiro do período selecionado.
 *
 * `?format=csv` devolve o arquivo para download; sem isso, JSON para a tela.
 * Os dois saem do MESMO `buildFinanceReport`, então a planilha e a tela não
 * podem divergir.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const tz = getAppTimeZone();
    const profileId = req.nextUrl.searchParams.get("profileId") || undefined;
    const { period, range } = resolvePeriod(
      req.nextUrl.searchParams.get("period"),
      req.nextUrl.searchParams.get("from"),
      req.nextUrl.searchParams.get("to"),
      tz,
    );

    const report = buildFinanceReport(range.since, range.until, tz, profileId);

    if (req.nextUrl.searchParams.get("format") !== "csv") {
      return NextResponse.json({ period, ...report });
    }

    const perfil = profileId ? await getProfile(profileId) : null;
    const periodoLabel =
      period === "custom"
        ? `${dia(range.since, tz)} a ${dia(range.until, tz, -1)}`
        : PERIOD_OPTIONS.find((p) => p.key === period)?.label || period;

    const csv = financeReportToCsv(report, tz, {
      periodoLabel,
      modelo: perfil?.name || "Todos os modelos",
    });

    const p = partsInTimeZone(Date.now(), tz);
    const carimbo = `${p.year}-${d2(p.month)}-${d2(p.day)}`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio-financeiro-${carimbo}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function d2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Dia no fuso da operação. `shiftDays` ajusta o fim exclusivo do intervalo. */
function dia(at: number | null, tz: string, shiftDays = 0): string {
  if (at === null) return "—";
  const p = partsInTimeZone(at + shiftDays * 86400000, tz);
  return `${d2(p.day)}/${d2(p.month)}/${p.year}`;
}
