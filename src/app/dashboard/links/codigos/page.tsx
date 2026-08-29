"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import { DEFAULT_PERIOD, type PeriodKey } from "@/lib/periods";

type CodeRow = {
  code: string;
  profileId: string | null;
  profileName: string;
  starts: number;
  gerados: number;
  pagos: number;
  paidCents: number;
  netCents: number;
  pendingCents: number;
  bots: string[];
};
type Group = { profileId: string | null; profileName: string; codes: CodeRow[] };
type Data = { period?: PeriodKey; groups?: Group[] };

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "sem código" é ausência de rastreio, não um código chamado assim — por isso
 *  o rótulo é diferente do resto e não vai em fonte de código. */
const SEM_CODIGO = "sem código";

type SortKey = "faturamento" | "vendas" | "starts" | "conversao" | "codigo";
const SORT_LABEL: Record<SortKey, string> = {
  faturamento: "Faturamento (maior)",
  vendas: "Vendas (maior)",
  starts: "Starts (maior)",
  conversao: "Conversão (maior)",
  codigo: "Código (A–Z)",
};

/**
 * RASTREIO → CÓDIGOS DE RASTREIO.
 *
 * Irmã da tela de Links: lá a unidade é a página do SLT (view → clique), aqui
 * é o código do deep-link que leva ao bot (start → cobrança → venda). Juntas
 * cobrem o caminho inteiro do lead, e as duas usam o MESMO seletor de período
 * do resto do painel.
 *
 * O agrupamento por modelo vem pronto do servidor. Um mesmo código pode
 * aparecer em mais de uma modelo (reusar "insta_bio" em todas é normal): cada
 * par modelo+código é uma linha, e o resumo do topo soma tudo que passou pelo
 * filtro.
 */
export default function CodigosDeRastreioPage() {
  const [data, setData] = useState<Data | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodState>({ period: DEFAULT_PERIOD, from: "", to: "" });
  const [busca, setBusca] = useState("");
  const [modelo, setModelo] = useState("all");
  const [sort, setSort] = useState<SortKey>("faturamento");
  // Código que nunca gerou cobrança nenhuma polui a lista quando se está
  // procurando o que dá dinheiro — mas não pode sumir por padrão, senão uma
  // divulgação que não converteu vira um buraco invisível.
  const [soComVenda, setSoComVenda] = useState(false);

  useEffect(() => {
    setErro(null);
    apiGet<Data>(`/api/links/codigos?${periodQuery(period)}`)
      .then(setData)
      .catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar."));
  }, [period]);

  const grupos = useMemo(() => {
    if (!data?.groups) return [];
    const termo = busca.trim().toLowerCase();
    const conversao = (c: CodeRow) => (c.starts > 0 ? c.pagos / c.starts : 0);
    return data.groups
      .filter((g) => modelo === "all" || (g.profileId || "") === modelo)
      .map((g) => ({
        ...g,
        codes: g.codes
          .filter((c) => (soComVenda ? c.pagos > 0 : true))
          .filter((c) => {
            if (!termo) return true;
            const nome = c.code || SEM_CODIGO;
            return nome.toLowerCase().includes(termo) || c.bots.some((b) => b.toLowerCase().includes(termo));
          })
          .sort((a, b) => {
            switch (sort) {
              case "vendas": return b.pagos - a.pagos;
              case "starts": return b.starts - a.starts;
              case "conversao": return conversao(b) - conversao(a);
              case "codigo": return (a.code || SEM_CODIGO).localeCompare(b.code || SEM_CODIGO, "pt-BR");
              default: return b.paidCents - a.paidCents;
            }
          }),
      }))
      .filter((g) => g.codes.length > 0);
  }, [data, busca, modelo, sort, soComVenda]);

  // Resumo do topo: soma do que está VISÍVEL, não do acervo inteiro — senão o
  // número do topo contradiz a lista logo abaixo dele.
  const total = useMemo(() => {
    const linhas = grupos.flatMap((g) => g.codes);
    const paidCents = linhas.reduce((s, c) => s + c.paidCents, 0);
    // O que chegou SEM rastreio nenhum. É a métrica que diz o tamanho do
    // ponto cego — sozinha, a linha "sem código" fica perdida no meio da
    // lista ordenada por faturamento, e é justamente a que precisa saltar.
    const semCodigo = linhas.filter((c) => !c.code);
    const semCodigoCents = semCodigo.reduce((s, c) => s + c.paidCents, 0);
    return {
      codigos: linhas.filter((c) => c.code).length,
      starts: linhas.reduce((s, c) => s + c.starts, 0),
      pagos: linhas.reduce((s, c) => s + c.pagos, 0),
      paidCents,
      semCodigoStarts: semCodigo.reduce((s, c) => s + c.starts, 0),
      semCodigoPagos: semCodigo.reduce((s, c) => s + c.pagos, 0),
      semCodigoCents,
      semCodigoPct: paidCents > 0 ? (semCodigoCents / paidCents) * 100 : 0,
    };
  }, [grupos]);

  const modelos = useMemo(
    () => (data?.groups || []).map((g) => [g.profileId || "", g.profileName] as [string, string]),
    [data],
  );

  const filtrando = busca !== "" || modelo !== "all" || sort !== "faturamento" || soComVenda;

  return (
    <div className="page">
      <PageHeader
        title="Códigos de rastreio"
        description="Todo código de deep-link do /start, por modelo — quantos leads trouxe, quantas vendas fechou e quanto faturou no período."
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {erro && (
        <div className="mt-4 card border-red-500/30 bg-red-500/[0.07] p-4 text-sm text-red-300">{erro}</div>
      )}

      {!data && !erro && (
        <div className="mt-4 space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
        </div>
      )}

      {data && (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <Chip label="Códigos" value={String(total.codigos)} />
            <Chip label="Starts" value={total.starts.toLocaleString("pt-BR")} />
            <Chip label="Vendas" value={total.pagos.toLocaleString("pt-BR")} />
            <Chip label="Faturamento" value={brl(total.paidCents)} accent />
            {/* O ponto cego do rastreio, em dinheiro. Só aparece quando existe
                — sem nada sem código, um card zerado seria só ruído. */}
            {(total.semCodigoCents > 0 || total.semCodigoStarts > 0) && (
              <Chip
                label="Sem código"
                value={
                  total.semCodigoCents > 0
                    ? `${total.semCodigoPct.toFixed(0)}%`
                    : `${total.semCodigoStarts.toLocaleString("pt-BR")} starts`
                }
                alerta
                detalhe={
                  total.semCodigoCents > 0
                    ? `${brl(total.semCodigoCents)} · ${total.semCodigoPagos} venda${total.semCodigoPagos === 1 ? "" : "s"} · ${total.semCodigoStarts.toLocaleString("pt-BR")} starts`
                    : "nenhuma venda, só starts"
                }
              />
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              className="input w-48 py-1.5 text-xs"
              placeholder="Buscar código ou bot..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {modelos.length > 1 && (
              <select
                className="input w-auto py-1.5 text-xs"
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
              >
                <option value="all">Modelo: todas</option>
                {modelos.map(([id, nome]) => (
                  <option key={id || "sem"} value={id}>{nome}</option>
                ))}
              </select>
            )}
            <select
              className="input w-auto py-1.5 text-xs"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>{SORT_LABEL[k]}</option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={soComVenda}
                onChange={(e) => setSoComVenda(e.target.checked)}
                className="h-3.5 w-3.5 accent-white"
              />
              Só com venda
            </label>
            {filtrando && (
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  setModelo("all");
                  setSort("faturamento");
                  setSoComVenda(false);
                }}
                className="btn-ghost py-1.5 text-xs"
              >
                Limpar
              </button>
            )}
          </div>

          {grupos.length === 0 ? (
            <p className="mt-5 card p-6 text-center text-sm text-zinc-500">
              {data.groups && data.groups.length > 0
                ? "Nenhum código com esse filtro."
                : "Nenhum código de rastreio no período. Os códigos aparecem sozinhos assim que um lead entra por um link com ?start=CODIGO."}
            </p>
          ) : (
            <div className="mt-5 space-y-6">
              {grupos.map((g) => (
                <div key={g.profileId || "sem-modelo"}>
                  <p className={`eyebrow ${g.profileId ? "" : "text-amber-400"}`}>
                    {g.profileName}
                    <span className="ml-2 normal-case text-zinc-600">({g.codes.length})</span>
                  </p>
                  <div className="mt-2 space-y-2">
                    {g.codes.map((c) => (
                      <CodigoCard key={`${g.profileId || ""}|${c.code}`} codigo={c} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({
  label,
  value,
  accent,
  alerta,
  detalhe,
}: {
  label: string;
  value: string;
  accent?: boolean;
  /** Âmbar: não é erro, é o que está fora do rastreio. */
  alerta?: boolean;
  /** Segunda linha, menor — a conta por trás do número grande. */
  detalhe?: string;
}) {
  return (
    <div className="card px-4 py-2.5">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-0.5 font-display text-lg font-semibold ${
          alerta ? "text-amber-400" : accent ? "text-emerald-400" : "text-white"
        }`}
      >
        {value}
      </p>
      {detalhe && <p className="mt-0.5 text-[11px] text-zinc-500">{detalhe}</p>}
    </div>
  );
}

function CodigoCard({ codigo }: { codigo: CodeRow }) {
  const conversao = codigo.starts > 0 ? (codigo.pagos / codigo.starts) * 100 : null;
  const fechamento = codigo.gerados > 0 ? (codigo.pagos / codigo.gerados) * 100 : null;
  const ticket = codigo.pagos > 0 ? Math.round(codigo.paidCents / codigo.pagos) : 0;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {codigo.code ? (
              <p className="font-mono text-sm font-semibold text-white">{codigo.code}</p>
            ) : (
              // Âmbar, o mesmo que a tela de Links usa para "sem rede": não é
              // erro, é o que está fora do rastreio — e precisa saltar dentro
              // de uma lista ordenada por faturamento, onde essa linha pode
              // cair em qualquer posição.
              <>
                <p className="text-sm font-semibold text-amber-400">{SEM_CODIGO}</p>
                <span
                  className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400"
                  title="Lead que entrou pelo link sem ?start=CODIGO, ou venda cujo código não foi possível recuperar de nenhuma fonte."
                >
                  fora do rastreio
                </span>
              </>
            )}
            {codigo.starts === 0 && codigo.gerados > 0 && (
              <span
                className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
                title="A venda trouxe o código, mas nenhum /start com ele caiu neste período — normal quando o lead entrou antes da janela escolhida."
              >
                venda sem start no período
              </span>
            )}
          </div>
          {codigo.bots.length > 0 && (
            <p className="mt-0.5 font-mono text-[11px] text-zinc-600">
              {codigo.bots.map((b) => `@${b}`).join(" · ")}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-lg font-semibold text-emerald-400">{brl(codigo.paidCents)}</p>
          {codigo.pendingCents > 0 && (
            <p className="text-[11px] text-amber-400/80" title="Cobrança gerada e ainda não paga">
              {brl(codigo.pendingCents)} na mesa
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-zinc-400">
          Starts: <b className="text-zinc-200">{codigo.starts.toLocaleString("pt-BR")}</b>
        </span>
        <span className="text-zinc-400">
          Cobranças: <b className="text-zinc-200">{codigo.gerados.toLocaleString("pt-BR")}</b>
        </span>
        <span className="text-zinc-400">
          Vendas: <b className="text-zinc-200">{codigo.pagos.toLocaleString("pt-BR")}</b>
        </span>
        {conversao !== null && (
          <span className="text-zinc-400" title="Vendas pagas ÷ starts">
            Start → venda: <b className="text-zinc-200">{conversao.toFixed(1)}%</b>
          </span>
        )}
        {fechamento !== null && (
          <span className="text-zinc-400" title="Vendas pagas ÷ cobranças geradas">
            Cobrança → paga: <b className="text-zinc-200">{fechamento.toFixed(1)}%</b>
          </span>
        )}
        {ticket > 0 && (
          <span className="text-zinc-400">
            Ticket: <b className="text-zinc-200">{brl(ticket)}</b>
          </span>
        )}
      </div>
    </div>
  );
}
