"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Profile } from "@/lib/types";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import { DEFAULT_PERIOD } from "@/lib/periods";

/** Um dia da série de crescimento dos grupos. Espelha o que a rota devolve —
 *  declarado aqui porque o módulo que a produz é `server-only`. */
type GroupGrowthPoint = {
  day: string;
  /** Total de membros no fim do dia. Null = sem medição naquele dia. */
  vip: number | null;
  previas: number | null;
  /** Entradas e saídas contadas pelos eventos do bot. Null = não medido
   *  naquele dia (diferente de zero, que é "medido e ninguém se mexeu"). */
  vipJoined: number | null;
  vipLeft: number | null;
  previasJoined: number | null;
  previasLeft: number | null;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(r: number | null) {
  return r === null ? "—" : `${(r * 100).toFixed(1)}%`;
}

type Metricas = {
  totalStarts: number;
  pixGenerated: number;
  pixPaid: number;
  paidCents: number;
  netCents: number;
  pendingCents: number;
  pendingCount: number;
  avgTicketCents: number;
  startToPix: number | null;
  pixToPaid: number | null;
  startToPaid: number | null;
};
type Linha = Metricas & { profileId: string | null; profileName: string; botActive: boolean | null };
type Fonte = { code: string; starts: number; pixGenerated: number; pixPaid: number; paidCents: number };
type Dados = {
  metricas: Metricas;
  linhas: Linha[];
  planos: { planId: string; name: string; cents: number; count: number }[];
  fontes: Fonte[];
};

export default function FunilPage() {
  const [period, setPeriod] = useState<PeriodState>({ period: DEFAULT_PERIOD, from: "", to: "" });
  const [profileId, setProfileId] = useState("");
  // Crescimento dos grupos: vem de consulta à API do Telegram, não das vendas
  // — por isso tem rota própria e não depende do período escolhido.
  const [grupos, setGrupos] = useState<GroupGrowthPoint[] | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ days: "14" });
    if (profileId) qs.set("profileId", profileId);
    apiGet<{ series: typeof grupos }>(`/api/dashboard/group-growth?${qs.toString()}`)
      .then((d) => setGrupos(d.series || []))
      .catch(() => setGrupos([]));
  }, [profileId]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [data, setData] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => setProfiles(d.profiles))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelado = false;
    setData(null);
    const qs = new URLSearchParams(periodQuery(period));
    if (profileId) qs.set("profileId", profileId);
    apiGet<Dados>(`/api/dashboard/funnel?${qs.toString()}`)
      .then((d) => {
        if (!cancelado) {
          setData(d);
          setErro(null);
        }
      })
      .catch((e) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      });
    return () => {
      cancelado = true;
    };
  }, [period, profileId]);

  const m = data?.metricas;

  return (
    <div className="page">
      <p className="eyebrow">funil de vendas</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">Funil de Vendas</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-500">
        A jornada do lead até a compra, por modelo: quem deu /start no bot, quantos pediram o PIX e
        quantos pagaram.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <div className="mt-3 max-w-xs">
        <label className="eyebrow mb-1.5 block">Modelo</label>
        <select className="input" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          <option value="">Todos</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {erro && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {erro}
        </div>
      )}

      {/* Funil: as três etapas com a taxa de passagem entre elas */}
      <div className="mt-6 card p-5">
        <p className="eyebrow">jornada do usuário até a compra</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Etapa titulo="/start" valor={m?.totalStarts} sub="iniciaram conversa" />
          <Etapa titulo="PIX gerado" valor={m?.pixGenerated} sub="checkout iniciado" taxa={m?.startToPix} taxaLabel="do /start" />
          <Etapa titulo="Pago" valor={m?.pixPaid} sub="pagamentos aprovados" taxa={m?.pixToPaid} taxaLabel="do PIX" accent />
        </div>
        <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-3">
          <Conversao label="Start → PIX" valor={m ? pct(m.startToPix) : null} detalhe={m ? `${m.pixGenerated} de ${m.totalStarts}` : ""} />
          <Conversao label="PIX → Pago" valor={m ? pct(m.pixToPaid) : null} detalhe={m ? `${m.pixPaid} de ${m.pixGenerated}` : ""} accent />
          <Conversao label="Start → Pago" valor={m ? pct(m.startToPaid) : null} detalhe={m ? `${m.pixPaid} de ${m.totalStarts}` : ""} />
        </div>
        {m && m.totalStarts === 0 && m.pixGenerated > 0 && (
          <p className="mt-3 text-[11px] text-amber-400/80">
            Sem /start no período: as vendas vieram por fora do bot do Hot-Dash, então a etapa de
            topo do funil não tem como ser medida.
          </p>
        )}
      </div>

      {/* Números do período — só o que é ETAPA da jornada. Receita, receita
          líquida e ticket médio saíram daqui: são os mesmos números do
          Dashboard, e ver o mesmo valor em duas telas só gera dúvida sobre
          qual está certo. O Dashboard responde "quanto entrou"; esta tela,
          "onde as pessoas param". */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card label="Total starts" valor={m ? String(m.totalStarts) : null} />
        <Card label="Vendas pagas" valor={m ? String(m.pixPaid) : null} accent />
        <Card
          label="PIX pendente"
          valor={m ? brl(m.pendingCents) : null}
          hint={m ? `${m.pendingCount} gerado(s) e não pago(s)` : undefined}
          muted
        />
      </div>

      {/* Por modelo */}
      <p className="eyebrow mt-8">por modelo</p>
      <div className="mt-3 card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="p-3">Modelo</th>
              <th className="p-3 text-right">Starts</th>
              <th className="p-3 text-right">PIX</th>
              <th className="p-3 text-right">Pagos</th>
              <th className="p-3 text-right">Start → Pago</th>
              <th className="p-3 text-right">Ticket</th>
              <th className="p-3 text-right">Receita</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {!data ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-xs text-zinc-600">Carregando...</td>
              </tr>
            ) : data.linhas.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-xs text-zinc-600">
                  Nenhum movimento no período.
                </td>
              </tr>
            ) : (
              data.linhas.map((l) => (
                <tr key={l.profileId || "sem-modelo"} className="hover:bg-white/[0.01]">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className={l.profileId ? "text-white" : "text-amber-400/90"}>
                        {l.profileName}
                      </span>
                      {l.botActive === false && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-400">
                          bot off
                        </span>
                      )}
                      {l.botActive === null && l.profileId && (
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-500">
                          sem bot
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono text-zinc-400">{l.totalStarts}</td>
                  <td className="p-3 text-right font-mono text-zinc-400">{l.pixGenerated}</td>
                  <td className="p-3 text-right font-mono text-zinc-300">{l.pixPaid}</td>
                  <td className="p-3 text-right font-mono text-zinc-400">{pct(l.startToPaid)}</td>
                  <td className="p-3 text-right font-mono text-zinc-400">{brl(l.avgTicketCents)}</td>
                  <td className="p-3 text-right font-display font-semibold text-emerald-400">
                    {brl(l.paidCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data?.linhas.some((l) => l.profileId === null) && (
        <p className="mt-2 max-w-2xl text-[11px] text-zinc-500">
          <b className="text-amber-400/90">Sem modelo</b>: vendas que chegaram só pelo webhook, sem
          cobrança criada aqui — a SyncPay não informa de qual modelo é. Dá para atribuir cada uma
          no{" "}
          <Link href="/dashboard/payments" className="text-emerald-400 hover:underline">
            Financeiro
          </Link>
          , pelo botão de correção da linha.
        </p>
      )}

      {/* Crescimento dos grupos do Telegram */}
      <p className="eyebrow mt-8">crescimento dos grupos</p>
      <div className="mt-3 card p-4">
        <p className="text-xs text-zinc-500">
          As <b>barras</b> são o total de membros de cada dia, medido por consulta ao Telegram
          (funciona mesmo sem o Hot-Dash operar o bot). As <b>linhas</b> são quantos entraram e
          quantos saíram, contados pelos eventos do bot — só existem nos dias em que o Hot-Dash
          estava operando. Toque num dia para ver os números dele.
        </p>
        <CrescimentoGrupos series={grupos} />
      </div>

      {/* Fontes de tráfego */}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-2">
        <p className="eyebrow">fontes de tráfego</p>
        <p className="text-[11px] text-zinc-600">faturamento por código de divulgação</p>
      </div>
      <div className="mt-3 card overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="p-3">Código</th>
              <th className="p-3 text-right">Starts</th>
              <th className="p-3 text-right">PIX</th>
              <th className="p-3 text-right">Pagos</th>
              <th className="p-3 text-right">Conversão</th>
              <th className="p-3 text-right">Receita</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {!data ? (
              <tr><td colSpan={6} className="p-6 text-center text-xs text-zinc-600">Carregando...</td></tr>
            ) : data.fontes.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-xs text-zinc-600">Sem tráfego no período.</td></tr>
            ) : (
              data.fontes.map((f) => (
                <tr key={f.code || "(sem)"} className="hover:bg-white/[0.01]">
                  <td className="p-3">
                    {f.code ? (
                      <span className="font-mono text-xs text-zinc-200">{f.code}</span>
                    ) : (
                      <span className="font-mono text-xs text-zinc-500">(sem código)</span>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono text-zinc-400">{f.starts}</td>
                  <td className="p-3 text-right font-mono text-zinc-400">{f.pixGenerated}</td>
                  <td className="p-3 text-right font-mono text-zinc-300">{f.pixPaid}</td>
                  <td className="p-3 text-right font-mono text-zinc-400">
                    {f.starts > 0 ? pct(f.pixPaid / f.starts) : "—"}
                  </td>
                  <td className="p-3 text-right font-display font-semibold text-emerald-400">
                    {brl(f.paidCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Planos */}
      <p className="eyebrow mt-8">planos que mais convertem</p>
      <div className="mt-3 card p-4">
        {!data ? (
          <div className="h-12 animate-pulse rounded bg-white/[0.03]" />
        ) : data.planos.length === 0 ? (
          <p className="text-xs text-zinc-600">
            Nenhuma venda ligada a um plano no período. O vínculo é criado quando a compra passa
            pelo bot de vendas do Hot-Dash.
          </p>
        ) : (
          <div className="space-y-2">
            {data.planos.map((p, i) => (
              <div key={p.planId} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-white/5 font-mono text-[10px] text-zinc-400">
                    {i + 1}
                  </span>
                  <span className="truncate text-zinc-200">{p.name}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-zinc-500">
                  {p.count} venda(s) <span className="text-emerald-400">{brl(p.cents)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function Etapa({
  titulo,
  valor,
  sub,
  taxa,
  taxaLabel,
  accent,
}: {
  titulo: string;
  valor?: number;
  sub: string;
  taxa?: number | null;
  taxaLabel?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{titulo}</p>
      <p className={`mt-1 font-display text-3xl font-semibold ${accent ? "text-emerald-400" : "text-white"}`}>
        {valor === undefined ? <span className="inline-block h-8 w-16 animate-pulse rounded bg-white/5" /> : valor}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-600">{sub}</p>
      {taxa !== undefined && (
        <p className="mt-1.5 font-mono text-[11px] text-zinc-500">
          {pct(taxa)} <span className="text-zinc-600">{taxaLabel}</span>
        </p>
      )}
    </div>
  );
}

/** Barras de variação diária: verde cresceu, vermelho encolheu. */
function CrescimentoGrupos({ series }: { series: GroupGrowthPoint[] | null }) {
  if (series === null) {
    return <div className="mt-4 h-40 animate-pulse rounded-lg bg-white/5" />;
  }
  if (series.length === 0) {
    return (
      <p className="mt-4 text-xs text-zinc-600">
        Ainda sem histórico. A medição do tamanho dos grupos começa no primeiro dia.
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-6">
      <GrupoChart
        rotulo="VIP"
        cor="#34d399"
        series={series}
        total={(d) => d.vip}
        entraram={(d) => d.vipJoined}
        sairam={(d) => d.vipLeft}
      />
      <GrupoChart
        rotulo="Prévias"
        cor="#38bdf8"
        series={series}
        total={(d) => d.previas}
        entraram={(d) => d.previasJoined}
        sairam={(d) => d.previasLeft}
      />
    </div>
  );
}

/**
 * Um grupo: barras com o TOTAL de membros de cada dia e duas linhas por cima
 * com quantos entraram e quantos saíram. Clicar num dia fixa os números dele.
 *
 * As duas escalas são independentes de propósito — o total anda na casa dos
 * milhares e o movimento diário nas dezenas; numa escala só as linhas ficariam
 * coladas no chão e não dariam para ler.
 */
function GrupoChart({
  rotulo,
  cor,
  series,
  total,
  entraram,
  sairam,
}: {
  rotulo: string;
  cor: string;
  series: GroupGrowthPoint[];
  total: (d: GroupGrowthPoint) => number | null;
  entraram: (d: GroupGrowthPoint) => number | null;
  sairam: (d: GroupGrowthPoint) => number | null;
}) {
  const [selecionado, setSelecionado] = useState<number | null>(null);

  const W = 100; // viewBox em unidades relativas; o SVG estica na largura do card
  const H = 46;
  const n = series.length;
  const passo = W / n;
  const maxTotal = Math.max(1, ...series.map((d) => total(d) ?? 0));
  const maxMov = Math.max(1, ...series.map((d) => Math.max(entraram(d) ?? 0, sairam(d) ?? 0)));

  const xCentro = (i: number) => passo * (i + 0.5);
  const yBarra = (v: number) => H - (v / maxTotal) * H;
  const yLinha = (v: number) => H - (v / maxMov) * (H * 0.75) - H * 0.06;

  // A linha só liga dias MEDIDOS em sequência: dia sem registro (null) vira
  // buraco no traço, e não um ponto no zero — senão o gráfico afirmaria que
  // ninguém entrou num dia em que, na verdade, ninguém contou.
  const caminho = (valor: (d: GroupGrowthPoint) => number | null) => {
    let d = "";
    let desenhando = false;
    series.forEach((ponto, i) => {
      const v = valor(ponto);
      if (v === null) {
        desenhando = false;
        return;
      }
      d += `${desenhando ? "L" : "M"} ${xCentro(i).toFixed(2)} ${yLinha(v).toFixed(2)} `;
      desenhando = true;
    });
    return d.trim();
  };

  const dia = selecionado !== null ? series[selecionado] : series[n - 1];
  const somaEntraram = series.reduce((s, d) => s + (entraram(d) ?? 0), 0);
  const somaSairam = series.reduce((s, d) => s + (sairam(d) ?? 0), 0);
  const semMovimento = series.every((d) => entraram(d) === null && sairam(d) === null);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-semibold text-zinc-200">{rotulo}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="text-emerald-400">+{somaEntraram}</span>
          {" · "}
          <span className="text-rose-400">-{somaSairam}</span>
          {" no período"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-2 h-36 w-full touch-manipulation"
        role="img"
        aria-label={`Crescimento do grupo ${rotulo}`}
      >
        {series.map((d, i) => {
          const v = total(d);
          const ativo = selecionado === i;
          return (
            <g key={d.day}>
              {v !== null && (
                <rect
                  x={passo * i + passo * 0.15}
                  y={yBarra(v)}
                  width={passo * 0.7}
                  height={Math.max(0.4, H - yBarra(v))}
                  fill={cor}
                  opacity={ativo ? 0.55 : 0.2}
                />
              )}
              {/* Faixa invisível de toque: cobre a coluna inteira, para o dedo
                  acertar o dia sem precisar mirar na barra. */}
              <rect
                x={passo * i}
                y={0}
                width={passo}
                height={H}
                fill="transparent"
                className="cursor-pointer"
                onClick={() => setSelecionado(ativo ? null : i)}
              />
            </g>
          );
        })}

        {!semMovimento && (
          <>
            <path d={caminho(entraram)} fill="none" stroke="#34d399" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
            <path d={caminho(sairam)} fill="none" stroke="#fb7185" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
          </>
        )}

        {selecionado !== null && (
          <line
            x1={xCentro(selecionado)}
            x2={xCentro(selecionado)}
            y1={0}
            y2={H}
            stroke="#ffffff"
            strokeWidth={0.5}
            opacity={0.35}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      <div className="mt-1 flex gap-1 text-center text-[9px] text-zinc-600">
        {series.map((d, i) => (
          <button
            key={d.day}
            type="button"
            onClick={() => setSelecionado(selecionado === i ? null : i)}
            className={`min-w-0 flex-1 truncate transition-colors ${
              selecionado === i ? "font-bold text-white" : "hover:text-zinc-300"
            }`}
          >
            {d.day.slice(8)}/{d.day.slice(5, 7)}
          </button>
        ))}
      </div>

      {/* Números do dia: o clicado, ou o último quando nada está selecionado. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/[0.03] px-3 py-2 text-[11px]">
        <span className="font-mono uppercase tracking-wider text-zinc-500">
          {selecionado === null ? "último dia" : "dia"} {dia.day.slice(8)}/{dia.day.slice(5, 7)}
        </span>
        <span className="text-zinc-300">
          total <b className="text-white">{total(dia) ?? "—"}</b>
        </span>
        {/* "—" quando o dia não foi medido: não é zero, é sem registro. */}
        <span className="text-emerald-400">entraram <b>{entraram(dia) ?? "—"}</b></span>
        <span className="text-rose-400">saíram <b>{sairam(dia) ?? "—"}</b></span>
        {selecionado !== null && (
          <button
            type="button"
            onClick={() => setSelecionado(null)}
            className="ml-auto text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            limpar
          </button>
        )}
      </div>
    </div>
  );
}

function Conversao({
  label,
  valor,
  detalhe,
  accent,
}: {
  label: string;
  valor: string | null;
  detalhe: string;
  accent?: boolean;
}) {
  return (
    <div className="text-center">
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold ${accent ? "text-emerald-400" : "text-sky-400"}`}>
        {valor ?? <span className="inline-block h-6 w-14 animate-pulse rounded bg-white/5" />}
      </p>
      <p className="text-[11px] text-zinc-600">{detalhe}</p>
    </div>
  );
}

function Card({
  label,
  valor,
  hint,
  accent,
  muted,
}: {
  label: string;
  valor: string | null;
  hint?: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-2 font-display text-xl font-semibold ${
          accent ? "text-emerald-400" : muted ? "text-zinc-400" : "text-white"
        }`}
      >
        {valor ?? <span className="inline-block h-6 w-20 animate-pulse rounded bg-white/5" />}
      </p>
      {hint && <p className="mt-1 text-[11px] text-zinc-600">{hint}</p>}
    </div>
  );
}
