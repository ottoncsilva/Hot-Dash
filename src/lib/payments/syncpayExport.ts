import "server-only";
import { inflateSync } from "node:zlib";

/**
 * Leitor da EXPORTAÇÃO de transações da SyncPay (o "Exportação: Transaction"
 * do painel dela). Existe porque a API não oferece nem listagem de vendas nem o
 * valor líquido na consulta individual — o export é a única fonte que traz o
 * histórico completo com o líquido.
 *
 * Aceita CSV (preferido, robusto) e o PDF gerado pelo painel.
 *
 * Datas: o export vem em UTC (o próprio "Gerado em" do relatório bate com UTC),
 * então convertemos para instante absoluto tratando o texto como UTC. Quem
 * formata no fuso da operação é a interface.
 */

export type SyncPayExportRow = {
  /** External Id da SyncPay. No PDF vem truncado em 30 caracteres. */
  externalId: string;
  /** Id curto da linha do export (quando presente). */
  exportId?: string;
  /** Valor cheio da venda, em centavos. */
  amountCents: number;
  /** Valor líquido repassado, em centavos. */
  netCents: number;
  /** Taxa = cheio − líquido, em centavos. A coluna "Sync Amount" do export NÃO
   *  é a taxa total (fica fixa em 0,80 mesmo quando o desconto real é 1,55). */
  feeCents: number;
  status: string;
  /** Instante da criação, em ms (o texto do export é interpretado como UTC). */
  createdAtMs: number;
  customer?: string;
  document?: string;
};

/** "dd/mm/aaaa hh:mm:ss" (UTC) -> epoch ms. */
export function parseExportDateUtc(txt: string): number | null {
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(txt || "");
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +(ss || 0));
}

function toCents(v: string | undefined): number | null {
  if (!v) return null;
  const limpo = v.replace(/[^\d.,-]/g, "").trim();
  if (!limpo) return null;
  // Aceita 1.234,56 e 1234.56
  const norm = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(norm);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function montaLinha(campos: Record<string, string>): SyncPayExportRow | null {
  const amountCents = toCents(campos.amount);
  const netCents = toCents(campos.final);
  const createdAtMs = parseExportDateUtc(campos.created || "");
  const externalId = (campos.ext || "").replace(/[^0-9a-zA-Z-]/g, "");
  if (amountCents === null || createdAtMs === null || !externalId) return null;
  const liquido = netCents === null ? amountCents : netCents;
  return {
    externalId,
    exportId: campos.id || undefined,
    amountCents,
    netCents: liquido,
    feeCents: Math.max(0, amountCents - liquido),
    status: (campos.status || "").replace(/\s+/g, "").toLowerCase(),
    createdAtMs,
    customer: campos.nome && campos.nome !== "-" ? campos.nome : undefined,
    document: campos.doc && campos.doc !== "-" ? campos.doc : undefined,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Divide uma linha de CSV respeitando aspas. */
function splitCsv(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else aspas = !aspas;
    } else if (c === sep && !aspas) {
      out.push(atual);
      atual = "";
    } else atual += c;
  }
  out.push(atual);
  return out.map((s) => s.trim());
}

const ALIASES: Record<string, string> = {
  id: "id",
  amount: "amount",
  status: "status",
  "created at": "created",
  createdat: "created",
  "external id": "ext",
  externalid: "ext",
  "final amount": "final",
  finalamount: "final",
  "sync amount": "sync",
  "debtoraccount name": "nome",
  "debtoraccount document": "doc",
};

export function parseSyncPayCsv(texto: string): SyncPayExportRow[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];
  const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ";" : ",";
  const cab = splitCsv(linhas[0], sep).map((h) => ALIASES[h.toLowerCase().trim()] || h.toLowerCase().trim());
  const out: SyncPayExportRow[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const vals = splitCsv(linhas[i], sep);
    const campos: Record<string, string> = {};
    cab.forEach((h, j) => (campos[h] = vals[j] ?? ""));
    const r = montaLinha(campos);
    if (r) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Colunas do PDF, pela posição X do cabeçalho. */
const COLUNAS: [number, string][] = [
  [54.5, "id"], [74.5, "amount"], [108.3, "status"], [139.5, "created"],
  [188.8, "ext"], [249.0, "pix"], [440.8, "final"], [492.1, "sync"],
  [543.9, "nome"], [652.7, "doc"], [744.6, "saldo"],
];

function colunaDe(x: number): string | null {
  let atual: string | null = null;
  for (const [cx, nome] of COLUNAS) if (x >= cx - 3) atual = nome;
  return atual;
}

/**
 * Lê o PDF do painel. O texto vem em operadores `BT x y Td ... [(txt)] TJ ET`
 * e a grade da tabela em segmentos `x y m x y l S`. As linhas horizontais dão
 * o limite EXATO de cada registro — necessário porque uma célula pode quebrar
 * em várias linhas (o nome do cliente, por exemplo) e agrupar por proximidade
 * de Y misturaria registros vizinhos.
 */
export function parseSyncPayPdf(buf: Buffer): SyncPayExportRow[] {
  const bin = buf.toString("latin1");
  const streams: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bin))) {
    try {
      streams.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"));
    } catch {
      /* stream não comprimido ou de imagem: ignora */
    }
  }

  const out: SyncPayExportRow[] = [];
  for (const t of streams) {
    const ys = new Set<number>();
    const reSeg = /([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/g;
    let s: RegExpExecArray | null;
    while ((s = reSeg.exec(t))) {
      if (Math.abs(parseFloat(s[2]) - parseFloat(s[4])) < 0.01) {
        ys.add(Math.round(parseFloat(s[2]) * 10) / 10);
      }
    }
    const limites = [...ys].sort((a, b) => b - a);
    if (limites.length < 3) continue;

    const itens: [number, number, string][] = [];
    const reTxt = /BT ([\d.]+) ([\d.]+) Td \/F\d+ [\d.]+ Tf\s+\[\((.*?)\)\] TJ ET/g;
    let x: RegExpExecArray | null;
    while ((x = reTxt.exec(t))) {
      itens.push([parseFloat(x[1]), parseFloat(x[2]), x[3]]);
    }

    // limites[0] é o topo do cabeçalho; as linhas de dados começam em limites[1].
    for (let i = 1; i < limites.length - 1; i++) {
      const topo = limites[i];
      const base = limites[i + 1];
      const cel: Record<string, [number, number, string][]> = {};
      for (const [ix, iy, txt] of itens) {
        if (iy > base && iy < topo) {
          const c = colunaDe(ix);
          if (c) (cel[c] ||= []).push([-iy, ix, txt]);
        }
      }
      const campos: Record<string, string> = {};
      for (const [c, vs] of Object.entries(cel)) {
        vs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        // Id/External Id/Pix quebram no meio do valor: junta sem espaço.
        const junta = c === "id" || c === "ext" || c === "pix" ? "" : " ";
        campos[c] = vs.map((v) => v[2]).join(junta).trim();
      }
      const r = montaLinha(campos);
      if (r) out.push(r);
    }
  }
  return out;
}

/** Detecta o formato pelo conteúdo e devolve as linhas. */
export function parseSyncPayExport(buf: Buffer, filename = ""): SyncPayExportRow[] {
  const ehPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-" || /\.pdf$/i.test(filename);
  return ehPdf ? parseSyncPayPdf(buf) : parseSyncPayCsv(buf.toString("utf8"));
}
