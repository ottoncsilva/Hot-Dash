import "server-only";
import type { FinanceReport, ReportCurveRow } from "./financeReport";
import { partsInTimeZone } from "./timezone";

/**
 * Serializa o relatório em CSV.
 *
 * Duas escolhas que existem para o arquivo abrir CLICANDO, sem assistente de
 * importação, no Excel em português:
 *
 *  • separador `;` — o Excel pt-BR usa o separador de lista do sistema, que no
 *    Brasil é ponto e vírgula. Com vírgula, tudo cai numa coluna só.
 *  • decimal com vírgula + BOM UTF-8 — sem o BOM o Excel lê como Latin-1 e os
 *    acentos viram lixo; com ponto decimal ele trata "19.90" como texto (ou,
 *    pior, como data) e nenhuma soma funciona.
 *
 * O arquivo sai em BLOCOS separados por linha em branco (totais, curva por
 * hora, curva por dia, transações). Cada bloco tem o próprio cabeçalho, para
 * dar para selecionar um e jogar direto numa tabela dinâmica.
 */

const SEP = ";";

/** Escapa um campo: aspas quando tiver separador, aspas ou quebra de linha. */
function campo(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Número em reais com vírgula decimal (o Excel pt-BR soma direto). */
function reais(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Percentual com vírgula decimal; vazio quando não há base para calcular. */
function pct(v: number | null): string {
  return v === null ? "" : (v * 100).toFixed(1).replace(".", ",");
}

/** Data/hora no fuso da operação, em formato que o Excel reconhece. */
function dataHora(at: number | null, tz: string): string {
  if (at === null) return "";
  const p = partsInTimeZone(at, tz);
  const d2 = (n: number) => String(n).padStart(2, "0");
  return `${d2(p.day)}/${d2(p.month)}/${p.year} ${d2(p.hour)}:${d2(p.minute)}`;
}

const STATUS_LABEL: Record<string, string> = {
  paid: "Pago",
  pending: "Aguardando",
  refunded: "Estornado",
  chargeback: "Chargeback",
  canceled: "Cancelado",
};

function linha(cols: (string | number | null | undefined)[]): string {
  return cols.map(campo).join(SEP);
}

function blocoCurva(titulo: string, faixas: ReportCurveRow[], rotulo: string): string[] {
  return [
    titulo,
    linha([
      rotulo,
      "PIX gerados",
      "Valor gerado (R$)",
      "Gerados que foram pagos",
      "Conversão (%)",
      "Pagamentos recebidos",
      "Valor recebido (R$)",
    ]),
    ...faixas.map((f) =>
      linha([
        f.label,
        f.gerados.count,
        reais(f.gerados.cents),
        f.geradosPagos.count,
        pct(f.conversao),
        f.pagos.count,
        reais(f.pagos.cents),
      ]),
    ),
  ];
}

export function financeReportToCsv(
  rel: FinanceReport,
  tz: string,
  contexto: { periodoLabel: string; modelo: string },
): string {
  const t = rel.totals;
  const linhas: string[] = [
    "RELATÓRIO FINANCEIRO",
    linha(["Período", contexto.periodoLabel]),
    linha(["Modelo", contexto.modelo]),
    linha(["Gerado em", dataHora(Date.now(), tz)]),
    "",
    "TOTAIS",
    linha(["Indicador", "Quantidade", "Valor (R$)"]),
    linha(["PIX gerados no período", t.gerados.count, reais(t.gerados.cents)]),
    linha(["…destes, pagos", t.geradosPagos.count, reais(t.geradosPagos.cents)]),
    linha(["Conversão da coorte (%)", pct(t.conversao), ""]),
    "",
    linha(["Pagamentos recebidos no período", t.pagos.count, reais(t.pagos.cents)]),
    linha(["Taxa do gateway", "", reais(t.pagos.feeCents)]),
    linha(["Split", "", reais(t.pagos.splitCents)]),
    linha(["Líquido recebido", "", reais(t.pagos.netCents)]),
    linha(["Ticket médio recebido", "", reais(t.ticketMedioCents)]),
    "",
    // Deixa explícito por que os dois números acima não batem entre si.
    "Observação: \"gerados\" conta pelo instante da GERAÇÃO do PIX e \"recebidos\" pelo instante do PAGAMENTO. Um PIX gerado num dia e pago em outro aparece em dias diferentes — por isso a conversão é calculada só dentro da coorte dos gerados no período.",
    "",
    ...blocoCurva("POR HORÁRIO", rel.byHour, "Hora"),
    "",
    ...blocoCurva("POR DIA DA SEMANA", rel.byWeekday, "Dia"),
    "",
    "TRANSAÇÕES",
    linha([
      "Gerado em",
      "Pago em",
      "Status",
      "Entrou no período por",
      "Cliente",
      "Modelo",
      "Valor (R$)",
      "Taxa (R$)",
      "Split (R$)",
      "Líquido (R$)",
      "Método",
      "Origem",
      "Referência",
    ]),
    ...rel.transactions.map((r) =>
      linha([
        dataHora(r.createdAt, tz),
        dataHora(r.paidAt, tz),
        STATUS_LABEL[r.status] || r.status,
        r.entrouPor,
        r.customer,
        r.profileName,
        reais(r.amountCents),
        reais(r.feeCents),
        reais(r.splitCents),
        reais(r.netAmountCents),
        r.method,
        r.sourceCode,
        r.providerRef,
      ]),
    ),
  ];

  // BOM: sem ele o Excel abre como Latin-1 e os acentos quebram.
  return "﻿" + linhas.join("\r\n") + "\r\n";
}
