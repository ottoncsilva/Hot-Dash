"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { FinanceReport } from "@/lib/financeReport";
import type { PeriodKey } from "@/lib/periods";
import { DEFAULT_PERIOD, isPeriodKey } from "@/lib/periods";
import { useProfile } from "@/context/ProfileContext";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import CurvaSort, {
  ALTURA_TABELA,
  FAIXAS_VISIVEIS,
  ORDEM_OPCOES,
  ordenarFaixas,
  type CurvaOrdem,
} from "@/components/CurvaSort";
import { IconArrowLeft, IconDownload } from "@/components/icons";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

type Data = FinanceReport & {
  period: PeriodKey;
  /** Recorte por extenso, com as datas — o mesmo texto que vai no CSV. */
  periodoLabel: string;
  modelo: string;
  timeZone: string;
  geradoEm: number;
};

function brl(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(v: number | null) {
  if (v === null) return "—";
  return `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function dataHora(at: number | null, tz: string) {
  if (!at) return "—";
  return new Date(at).toLocaleString("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  paid: "pago",
  pending: "gerado",
  refunded: "estornado",
  chargeback: "chargeback",
  canceled: "cancelado",
};

export default function RelatorioFinanceiroPage() {
  // useSearchParams exige limite de Suspense no App Router.
  return (
    <Suspense fallback={<div className="page text-sm text-zinc-600">Carregando…</div>}>
      <RelatorioFinanceiro />
    </Suspense>
  );
}

function RelatorioFinanceiro() {
  // O botão do Financeiro manda o período pela URL, para o relatório abrir já
  // no mesmo recorte que a pessoa estava olhando.
  const sp = useSearchParams();
  const [period, setPeriod] = useState<PeriodState>(() => {
    const p = sp.get("period");
    return {
      period: p && isPeriodKey(p) ? p : DEFAULT_PERIOD,
      from: sp.get("from") || "",
      to: sp.get("to") || "",
    };
  });
  // Modelo vem do menu. O ?profileId= da URL ainda é aceito na entrada,
  // para links antigos continuarem levando ao mesmo recorte.
  const { profileId, setProfileId } = useProfile();
  useEffect(() => {
    const daUrl = sp.get("profileId");
    if (daUrl) setProfileId(daUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [data, setData] = useState<Data | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tz, setTz] = useState(DEFAULT_TIME_ZONE);

  useEffect(() => {
    apiGet<{ timeZone: string }>("/api/settings/general")
      .then((d) => d.timeZone && setTz(d.timeZone))
      .catch(() => {});
  }, []);

  const query = `${periodQuery(period)}${profileId ? `&profileId=${profileId}` : ""}`;

  useEffect(() => {
    setData(null);
    setErro(null);
    apiGet<Data>(`/api/payments/report?${query}`)
      .then(setData)
      .catch(() => setErro("Não foi possível montar o relatório."));
  }, [query]);

  const t = data?.totals;

  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href="/dashboard/payments"
            className="inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white print:hidden"
          >
            <IconArrowLeft size={16} /> Financeiro
          </Link>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Relatório financeiro
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 print:hidden">
            PIX gerados e pagos no período, por horário e dia da semana.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button onClick={() => window.print()} className="btn-ghost text-xs">
            Imprimir
          </button>
          <a href={`/api/payments/report?${query}&format=csv`} className="btn-primary text-xs">
            <IconDownload size={14} /> Baixar CSV
          </a>
        </div>
      </div>

      {/* Identificação do documento — só no papel.
          Na tela o período está no seletor logo abaixo e a modelo está no menu.
          Impressa, a folha não tem nem um nem outro: sem este bloco ela não diz
          de que recorte é, e um relatório financeiro arquivado que não se
          identifica não serve para conferência nenhuma. */}
      <div className="hidden print:block print-bloco mt-3 border-y border-zinc-400 py-2">
        <dl className="grid grid-cols-3 gap-x-6 text-[9pt]">
          <Identificacao rotulo="Modelo" valor={data?.modelo ?? "—"} />
          <Identificacao rotulo="Período" valor={data?.periodoLabel ?? "—"} />
          <Identificacao
            rotulo="Emitido em"
            valor={data ? `${dataHora(data.geradoEm, tz)} (${tz})` : "—"}
          />
        </dl>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-4 print:hidden">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {erro && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {erro}
        </div>
      )}

      {/* Totais. Os dois blocos são recortes DIFERENTES do tempo — a nota
          explica, porque a soma de um não bate com a do outro de propósito. */}
      <p className="eyebrow secao mt-8">totais do período</p>
      {/* `lg:` nunca vale no papel: a folha A4 tem ~717px úteis contra os
          1024px do breakpoint, então os 8 totais imprimiam em 2 colunas e
          comiam quase uma página inteira. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        <Total label="PIX gerados" valor={t ? String(t.gerados.count) : null} sub={t ? brl(t.gerados.cents) : ""} />
        <Total
          label="Destes, pagos"
          valor={t ? String(t.geradosPagos.count) : null}
          sub={t ? brl(t.geradosPagos.cents) : ""}
          accent
        />
        <Total label="Conversão" valor={t ? pct(t.conversao) : null} sub="dos gerados no período" accent />
        <Total
          label="Recebido no período"
          valor={t ? brl(t.pagos.cents) : null}
          sub={t ? `${t.pagos.count} pagamento(s)` : ""}
        />
        <Total label="Taxa do gateway" valor={t ? brl(t.pagos.feeCents) : null} sub="descontada" negativo />
        <Total label="Split" valor={t ? brl(t.pagos.splitCents) : null} sub="repasse a terceiros" negativo />
        <Total label="Líquido recebido" valor={t ? brl(t.pagos.netCents) : null} sub="o que caiu na conta" accent />
        <Total label="Ticket médio" valor={t ? brl(t.ticketMedioCents) : null} sub="por pagamento recebido" />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-600 print:text-[8pt]">
        <b>Gerados</b> conta pela geração do PIX; <b>recebido</b>, pelo pagamento. Um PIX gerado num dia e
        pago em outro cai em dias diferentes — por isso a conversão sai da coorte dos gerados no
        período.
      </p>

      <p className="eyebrow secao mt-8">por horário</p>
      <Curva faixas={data?.byHour} rotulo="Hora" />

      <p className="eyebrow secao mt-8">por dia da semana</p>
      <Curva faixas={data?.byWeekday} rotulo="Dia" />

      <p className="eyebrow secao mt-8">transações ({data?.transactions.length ?? "…"})</p>
      <div className="mt-3 card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          {/* Larguras fixas: sem elas o "Cliente" estica conforme o nome mais
              longo da página e as colunas dançam de uma folha para a outra. */}
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
            <col className="w-[24%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            {/* A origem ("previas-bot") não pode quebrar em duas linhas: cada
                quebra dobra a altura da linha e estica o relatório inteiro. */}
            <col className="w-[22%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2.5 font-medium">Gerado</th>
              <th className="px-3 py-2.5 font-medium">Pago</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Cliente</th>
              <th className="px-3 py-2.5 text-right font-medium">Valor</th>
              <th className="px-3 py-2.5 text-right font-medium">Líquido</th>
              <th className="px-3 py-2.5 font-medium">Origem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {!data ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-600">
                  Carregando…
                </td>
              </tr>
            ) : data.transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-600">
                  Nenhuma transação no período.
                </td>
              </tr>
            ) : (
              data.transactions.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.04]">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-zinc-400">
                    {dataHora(r.createdAt, tz)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-zinc-400">
                    {dataHora(r.paidAt, tz)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-wider ${
                        r.status === "paid" ? "text-emerald-400" : "text-zinc-500"
                      }`}
                    >
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  {/* No papel não há hover para ver o resto do nome: o corte
                      vira perda de informação, então lá ele quebra a linha. */}
                  <td className="max-w-[180px] truncate px-3 py-2 text-zinc-300 print:max-w-none print:overflow-visible print:whitespace-normal print:break-words">
                    {r.customer || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-display font-semibold text-zinc-100">
                    {brl(r.amountCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-400">
                    {brl(r.netAmountCents)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-zinc-600">
                    {r.sourceCode || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Uma linha do cabeçalho impresso: rótulo em cima, valor embaixo. */
function Identificacao({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="eyebrow">{rotulo}</dt>
      <dd className="mt-0.5 font-medium">{valor}</dd>
    </div>
  );
}

function Total({
  label,
  valor,
  sub,
  accent,
  negativo,
}: {
  label: string;
  valor: string | null;
  sub?: string;
  accent?: boolean;
  negativo?: boolean;
}) {
  return (
    <div className="card print-bloco p-4 print:p-2">
      <p className="eyebrow print:text-[7pt]">{label}</p>
      {valor === null ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-white/5" />
      ) : (
        <p
          className={`mt-1.5 font-display text-2xl font-semibold print:mt-0.5 print:text-[14pt] ${
            accent ? "text-emerald-400" : negativo ? "text-amber-400/90" : "text-white"
          }`}
        >
          {valor}
        </p>
      )}
      {sub && <p className="mt-1 text-[11px] text-zinc-600 print:text-[7pt]">{sub}</p>}
    </div>
  );
}

/** Curva do período: gerados, conversão da coorte e recebidos, por faixa. */
function Curva({
  faixas,
  rotulo,
}: {
  faixas?: { key: number; label: string; gerados: { count: number; cents: number }; geradosPagos: { count: number; cents: number }; pagos: { count: number; cents: number }; conversao: number | null }[];
  rotulo: string;
}) {
  const [ordem, setOrdem] = useState<CurvaOrdem>("cron");
  const maxPago = faixas ? Math.max(0, ...faixas.map((f) => f.pagos.cents)) : 0;
  // Ordena pelo RECEBIDO — é o número que a barra representa e o que decide
  // horário. "Pagos gerados" seria a coorte, uma pergunta diferente.
  const ordenadas = faixas ? ordenarFaixas(faixas, ordem, (f) => f.pagos) : undefined;
  // Só a curva de horas (24 faixas) precisa rolar; a de dias tem 7 e cabe.
  const precisaRolar = (faixas?.length ?? 0) > FAIXAS_VISIVEIS;
  return (
    <>
      <div className="mt-3 flex items-center justify-end print:hidden">
        <CurvaSort value={ordem} onChange={setOrdem} />
      </div>
      {/* O papel não mostra o seletor, então precisa dizer em que ordem a
          tabela saiu — impressa fora da ordem do dia e sem aviso, ela engana. */}
      <p className="hidden print:block text-[8pt] text-zinc-600">
        Ordenação: {ORDEM_OPCOES.find((o) => o.value === ordem)?.label}
      </p>
      {/* A rolagem fica no WRAPPER, não no tbody: `display:block` no tbody
          quebraria o alinhamento das colunas com o cabeçalho. O thead gruda no
          topo para o rótulo não sumir ao rolar.
          Só limita quem TEM o que rolar: a tabela de dias já cabe em 7 linhas,
          e limitá-la a uma altura calculada em pixels a cortava por alguns
          pixels de sobra.
          O limite vem por variável CSS, não por `style` inline: inline vence
          classe, e o `print:max-h-none` não conseguia liberar a altura no
          papel — a tabela saía cortada e ainda vazava por cima da seção
          seguinte, deixando o relatório impresso ilegível. */}
      <div
        className={`mt-2 card p-0 print:max-h-none print:overflow-visible ${
          precisaRolar ? "max-h-[var(--alt-curva)] overflow-auto" : "overflow-x-auto"
        }`}
        style={precisaRolar ? ({ "--alt-curva": `${ALTURA_TABELA}px` } as React.CSSProperties) : undefined}
      >
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-ink-900 print:static">
          <tr className="border-b border-white/[0.06] bg-white/[0.02] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <th className="px-3 py-2.5 font-medium">{rotulo}</th>
            <th className="px-3 py-2.5 text-right font-medium">PIX gerados</th>
            <th className="px-3 py-2.5 text-right font-medium">Valor gerado</th>
            <th className="px-3 py-2.5 text-right font-medium">Pagos</th>
            <th className="px-3 py-2.5 text-right font-medium">Conversão</th>
            <th className="px-3 py-2.5 text-right font-medium">Recebido</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {!ordenadas
            ? [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-3 py-3">
                    <div className="h-4 animate-pulse rounded bg-white/5" />
                  </td>
                </tr>
              ))
            : ordenadas.map((f) => (
                <tr key={f.key} className="relative">
                  <td className="relative px-3 py-2">
                    {/* Barra pelo RECEBIDO: é o número que decide horário.
                        No papel ela some se ficar `print:hidden` — e some junto
                        a leitura de relance de qual faixa vende. Vira cinza
                        claro, que é o que uma impressora reproduz bem. */}
                    <span
                      aria-hidden
                      className="barra-curva absolute inset-y-0 left-0 bg-emerald-500/[0.10]"
                      style={{ width: maxPago > 0 ? `${(f.pagos.cents / maxPago) * 100}%` : "0%" }}
                    />
                    <span
                      className={`relative ${f.gerados.count > 0 || f.pagos.count > 0 ? "text-zinc-200" : "text-zinc-600"}`}
                    >
                      {f.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] text-zinc-400">
                    {f.gerados.count}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] text-zinc-500">
                    {brl(f.gerados.cents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] text-zinc-400">
                    {f.geradosPagos.count}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] text-zinc-400">
                    {pct(f.conversao)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-display font-semibold ${
                      f.pagos.cents > 0 ? "text-emerald-400" : "text-zinc-700"
                    }`}
                  >
                    {brl(f.pagos.cents)}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
