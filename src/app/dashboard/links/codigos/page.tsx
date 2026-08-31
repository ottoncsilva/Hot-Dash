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
  cliques: number;
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

  /** Os cards do topo numa lista só: a grade precisa saber quantos são para
   *  escolher o número de colunas e para tratar a contagem ímpar. */
  const cardsDoTopo = useMemo(() => {
    const cards: {
      label: string;
      value: string;
      accent?: boolean;
      alerta?: boolean;
      detalhe?: string;
    }[] = [
      { label: "Códigos", value: String(total.codigos) },
      { label: "Starts", value: total.starts.toLocaleString("pt-BR") },
      { label: "Vendas", value: total.pagos.toLocaleString("pt-BR") },
      { label: "Faturamento", value: brl(total.paidCents), accent: true },
    ];
    // O ponto cego do rastreio, em dinheiro. Só entra quando existe — sem nada
    // fora do rastreio, um card zerado seria só ruído.
    if (total.semCodigoCents > 0 || total.semCodigoStarts > 0) {
      cards.push({
        label: "Sem código",
        value:
          total.semCodigoCents > 0
            ? `${total.semCodigoPct.toFixed(0)}%`
            : `${total.semCodigoStarts.toLocaleString("pt-BR")} starts`,
        alerta: true,
        detalhe:
          total.semCodigoCents > 0
            ? `${brl(total.semCodigoCents)} · ${total.semCodigoPagos} venda${total.semCodigoPagos === 1 ? "" : "s"} · ${total.semCodigoStarts.toLocaleString("pt-BR")} starts`
            : "nenhuma venda, só starts",
      });
    }
    return cards;
  }, [total]);

  const modelos = useMemo(
    () => (data?.groups || []).map((g) => [g.profileId || "", g.profileName] as [string, string]),
    [data],
  );

  const filtrando = busca !== "" || modelo !== "all" || sort !== "faturamento" || soComVenda;

  return (
    <div className="page">
      <PageHeader
        title="Códigos de rastreio"
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
          {/* Grade, não `flex-wrap`: com largura livre cada card ficava de um
              tamanho e o último sobrava sozinho numa linha, mais estreito que
              os outros. Em grade todos têm a mesma largura e a linha fecha. */}
          <div
            className={`mt-4 grid grid-cols-2 gap-2 ${
              cardsDoTopo.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"
            }`}
          >
            {cardsDoTopo.map((c, i) => (
              <Chip
                key={c.label}
                {...c}
                /* Contagem ímpar deixa o último órfão na grade de 2 colunas do
                   celular: ele ocupa a linha inteira em vez de meia. */
                className={
                  cardsDoTopo.length % 2 === 1 && i === cardsDoTopo.length - 1
                    ? "col-span-2 lg:col-span-1"
                    : ""
                }
              />
            ))}
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
  className = "",
}: {
  label: string;
  value: string;
  accent?: boolean;
  /** Âmbar: não é erro, é o que está fora do rastreio. */
  alerta?: boolean;
  /** Segunda linha, menor — a conta por trás do número grande. */
  detalhe?: string;
  className?: string;
}) {
  return (
    <div className={`card px-4 py-2.5 ${className}`}>
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
  const ticket = codigo.pagos > 0 ? Math.round(codigo.paidCents / codigo.pagos) : 0;

  return (
    <div className="card p-4">
      {/* Sem `flex-wrap`: com ele o bloco do dinheiro caía para a linha de
          baixo só nos cards de rótulo comprido ("sem código" + a etiqueta), e
          o valor ficava à esquerda num card e à direita no de cima. Agora a
          coluna do dinheiro é fixa à direita em todos, e quem espreme é o
          rótulo, que já quebra sozinho. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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

      {/* O FUNIL, uma etapa por coluna, com a queda entre elas embaixo.
          Antes eram seis números soltos numa fila que quebrava em qualquer
          ponto — dava para ler cada um, não dava para ver ONDE se perde.

          O CLIQUE vem da tela de Links (o link do SLT que carrega este
          código). Ele é a etapa que faltava: entre clicar no link da bio e
          apertar Iniciar no bot há uma perda que nenhuma tela mostrava.

          Traço, e não zero, quando não há clique: zero afirma que ninguém
          clicou; traço diz que não há de onde saber — é o caso das Prévias,
          cujo link é convite de grupo e não carrega código. */}
      <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-white/[0.06]">
        <Etapa rotulo="Cliques" valor={codigo.cliques > 0 ? n(codigo.cliques) : "—"} />
        <Etapa
          rotulo="Starts"
          valor={n(codigo.starts)}
          queda={codigo.cliques > 0 ? pct(codigo.starts, codigo.cliques) : null}
        />
        <Etapa rotulo="Cobranças" valor={n(codigo.gerados)} queda={pct(codigo.gerados, codigo.starts)} />
        <Etapa rotulo="Vendas" valor={n(codigo.pagos)} queda={pct(codigo.pagos, codigo.gerados)} destaque />
      </div>

      {ticket > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          Ticket médio <b className="text-zinc-300">{brl(ticket)}</b>
        </p>
      )}
    </div>
  );
}

/** Número com separador de milhar, do jeito que o painel escreve em todo lugar. */
function n(v: number): string {
  return v.toLocaleString("pt-BR");
}

/**
 * A passagem de uma etapa para a seguinte, em porcentagem.
 *
 * `null` quando a etapa anterior é zero: dividir por zero não dá 0%, dá
 * "não dá para saber" — e escrever 0% ali acusaria uma queda que não houve.
 */
function pct(parte: number, total: number): string | null {
  if (total <= 0) return null;
  const v = (parte / total) * 100;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

/** Uma etapa do funil: o número em cima, a passagem desde a etapa anterior embaixo. */
function Etapa({
  rotulo,
  valor,
  queda,
  destaque,
}: {
  rotulo: string;
  valor: string;
  queda?: string | null;
  destaque?: boolean;
}) {
  return (
    <div className="bg-ink-850 px-2.5 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{rotulo}</p>
      <p className={`mt-0.5 font-display text-base font-semibold ${destaque ? "text-emerald-400" : "text-white"}`}>
        {valor}
      </p>
      {/* Espaço reservado mesmo sem valor: sem isso os cards da lista ficam de
          alturas diferentes e o ritmo da coluna some. */}
      <p className="mt-0.5 h-3.5 font-mono text-[10px] text-zinc-600">{queda ?? ""}</p>
    </div>
  );
}
