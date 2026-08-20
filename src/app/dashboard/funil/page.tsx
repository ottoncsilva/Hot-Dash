"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Profile } from "@/lib/types";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import PageHeader from "@/components/PageHeader";
import { DEFAULT_PERIOD } from "@/lib/periods";
import { useProfile } from "@/context/ProfileContext";

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

/**
 * Taxa de passagem do funil. Acima de 100% não existe como conversão — quer
 * dizer que a janela tem venda de gente que deu /start antes dela. Nesse caso
 * some com o número: o detalhe ("7 de 4") já conta o que aconteceu, e um
 * "175%" só faria o operador desconfiar do painel inteiro.
 */
function pctFunil(r: number | null) {
  return r === null || r > 1 ? "—" : `${(r * 100).toFixed(1)}%`;
}

/** Duração legível e curta, para caber na coluna estreita do celular. */
function duracao(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 === 0 ? `${h}h` : `${h}h${min % 60}`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d${h % 24}h`;
}

/**
 * "1 venda a cada X". Devolve null quando não dá para dividir — a tela escreve
 * o motivo em vez de mostrar 0 ou infinito.
 *
 * Atenção ao ler: numerador e denominador são da MESMA janela, mas não da
 * mesma gente — quem deu /start hoje pode comprar amanhã. Numa janela curta é
 * normal haver venda de lead antigo, e por isso o rótulo diz "no período".
 */
function porVenda(de: number, vendas: number): number | null {
  if (vendas <= 0 || de <= 0) return null;
  return de / vendas;
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
/** Tempo entre o primeiro /start e o pagamento. `base` são as PRIMEIRAS
 *  compras (renovação mediria meses de relacionamento, não decisão de compra);
 *  `semStart` são as pagas que vieram por fora do bot e não dá para
 *  cronometrar. Os dois aparecem na tela para o número não enganar. */
type Tempo = {
  mediaMs: number;
  medianaMs: number;
  base: number;
  semStart: number;
  renovacoes: number;
};
type Janela = Metricas & {
  tempo: Tempo;
  valorMaisComprado: { cents: number; vezes: number } | null;
};
/** A mesma métrica em três janelas. Não segue o período escolhido: o sentido
 *  dela é comparar o curto com o longo. */
type Comparativo = { hoje: Janela; mes: Janela; total: Janela };

type Dados = {
  metricas: Metricas;
  linhas: Linha[];
  planos: { planId: string; name: string; cents: number; count: number }[];
  fontes: Fonte[];
  comparativo: Comparativo;
  /** Base do Telegram — foto do AGORA, não segue o período selecionado. */
  users: { total: number; vips: number; expirados: number; leads: number; bloqueados: number };
  /** Membros dos grupos, por consulta à API — existem mesmo com o bot desligado. */
  groups: { vip: number | null; previas: number | null; checkedAt: number | null };
};

export default function FunilPage() {
  const [period, setPeriod] = useState<PeriodState>({ period: DEFAULT_PERIOD, from: "", to: "" });
  // Modelo selecionada no menu — vale para o painel inteiro.
  const { profileId } = useProfile();
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
  const [data, setData] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

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
      <PageHeader title="Funil de Vendas" />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {erro && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {erro}
        </div>
      )}

      {/* Funil: as três etapas com a taxa de passagem entre elas */}
      <div className="mt-6 card p-5">
        <p className="eyebrow">jornada do usuário até a compra</p>
        <FunilVisual m={m} />
        <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-3">
          <Conversao label="Start → PIX" valor={m ? pctFunil(m.startToPix) : null} detalhe={m ? `${m.pixGenerated} de ${m.totalStarts}` : ""} />
          <Conversao label="PIX → Pago" valor={m ? pctFunil(m.pixToPaid) : null} detalhe={m ? `${m.pixPaid} de ${m.pixGenerated}` : ""} accent />
          <Conversao label="Start → Pago" valor={m ? pctFunil(m.startToPaid) : null} detalhe={m ? `${m.pixPaid} de ${m.totalStarts}` : ""} />
        </div>
        {m && m.pixGenerated > m.totalStarts && (
          <p className="mt-3 text-[11px] text-amber-400/80">
            {m.totalStarts === 0
              ? "Sem /start no período — as vendas vieram por fora do bot, então o topo do funil não dá para medir."
              : "Mais PIX do que /start: parte das vendas é de gente que entrou antes. As taxas ficam sem número porque não seriam conversão."}
          </p>
        )}
      </div>

      {/* Comparativo de três janelas. NÃO segue o seletor de período de
          propósito: 11% hoje só significa alguma coisa ao lado do histórico. */}
      <p className="eyebrow mt-8">hoje, no mês e desde sempre</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CartaoComparativo
          titulo="Conversão de usuário"
          subtitulo="% de quem deu /start e comprou"
          comp={data?.comparativo}
          valor={(j) => pct(j.startToPaid)}
          rodape={(j) => {
            const r = porVenda(j.totalStarts, j.pixPaid);
            if (j.pixPaid > j.totalStarts && j.totalStarts > 0)
              return "vendas de leads de outros dias";
            return r === null ? "ainda sem venda" : `1 venda a cada ${Math.round(r)} starts`;
          }}
        />
        <CartaoComparativo
          titulo="Conversão de pagamento"
          subtitulo="% dos PIX gerados que foram pagos"
          comp={data?.comparativo}
          valor={(j) => pct(j.pixToPaid)}
          rodape={(j) => {
            const r = porVenda(j.pixGenerated, j.pixPaid);
            return r === null ? "ainda sem venda" : `1 venda a cada ${Math.round(r)} PIX`;
          }}
        />
        <CartaoTempo comp={data?.comparativo} />
        <CartaoComparativo
          titulo="Ticket médio"
          subtitulo="valor médio por venda"
          comp={data?.comparativo}
          valor={(j) => brl(j.avgTicketCents)}
          rodape={(j) =>
            j.valorMaisComprado && j.pixPaid >= 5
              ? `mais comprado: ${brl(j.valorMaisComprado.cents)} (${j.valorMaisComprado.vezes}×)`
              : "poucas vendas para dizer qual valor mais vende"
          }
        />
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

      {/* Base de usuários do Telegram — a matéria-prima do topo do funil.
          Continua contando com a automação desligada: o bot só não dispara,
          mas segue captando. É foto do AGORA, não segue o período. */}
      <p className="eyebrow mt-8">usuários do telegram</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <UserStat label="Total" value={data?.users.total} />
        <UserStat label="VIPs" value={data?.users.vips} tone="text-emerald-400" />
        <UserStat label="Expirados" value={data?.users.expirados} tone="text-amber-400" />
        <UserStat label="Leads" value={data?.users.leads} tone="text-sky-400" />
        <UserStat label="Bloqueados" value={data?.users.bloqueados} tone="text-rose-400" />
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
                <tr key={l.profileId || "sem-modelo"} className="hover:bg-white/[0.04]">
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
          <b className="text-amber-400/90">Sem modelo</b>: vendas que vieram só pelo webhook — a SyncPay não
          diz de qual modelo. Dá para atribuir no{" "}
          <Link href="/dashboard/payments" className="text-emerald-400 hover:underline">
            Financeiro
          </Link>
          , pelo botão de correção da linha.
        </p>
      )}

      {/* Crescimento dos grupos do Telegram */}
      {/* Quantos são AGORA, logo antes de "como chegaram até aqui" — o total
          abaixo é literalmente o último ponto da série do gráfico seguinte. */}
      <p className="eyebrow mt-8">
        grupos do telegram
        {data?.groups.checkedAt ? (
          <span className="ml-2 normal-case tracking-normal text-zinc-600">
            (verificado{" "}
            {new Date(data.groups.checkedAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            )
          </span>
        ) : null}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <UserStat
          label="Membros no VIP"
          value={data ? (data.groups.vip ?? 0) : undefined}
          tone="text-emerald-400"
        />
        <UserStat
          label="Membros nas Prévias"
          value={data ? (data.groups.previas ?? 0) : undefined}
          tone="text-sky-400"
        />
      </div>

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
                <tr key={f.code || "(sem)"} className="hover:bg-white/[0.04]">
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


/**
 * A jornada desenhada como funil: três faixas que estreitam da esquerda para a
 * direita, na proporção de quanta gente sobrou em cada etapa.
 *
 * A largura tem um PISO (20%): uma etapa com uma venda só continua sendo um
 * trapézio legível em vez de um fio invisível. O piso deforma a proporção de
 * propósito — por isso o número absoluto vai escrito embaixo de cada etapa, e
 * é ele que manda.
 *
 * Vertical seria mais fácil, mas o funil horizontal cabe em 430px sem rolagem
 * e é a leitura que o operador já conhece.
 */
function FunilVisual({ m }: { m?: Metricas }) {
  if (!m) return <div className="mt-4 h-40 animate-pulse rounded-lg bg-white/5" />;

  // A base é a MAIOR etapa, não o /start. Numa janela curta é comum haver mais
  // venda que start (gente que entrou antes e comprou agora): com o /start de
  // base, as faixas seguintes estourariam a largura e o funil viraria três
  // retângulos iguais, deixando de ser funil.
  const base = Math.max(m.totalStarts, m.pixGenerated, m.pixPaid, 1);
  // Taxa acima de 100% não é conversão: é venda de lead de outro dia. Melhor
  // não mostrar número nenhum do que anunciar "175% do /start".
  const taxaOuNada = (r: number | null) => (r !== null && r <= 1 ? r : null);
  const etapas = [
    { rotulo: "/start", valor: m.totalStarts, taxa: null as number | null, topo: true },
    { rotulo: "PIX gerado", valor: m.pixGenerated, taxa: taxaOuNada(m.startToPix), topo: false },
    { rotulo: "Pago", valor: m.pixPaid, taxa: taxaOuNada(m.startToPaid), topo: false },
  ];

  const W = 100;
  const H = 44;
  const meia = (v: number) => (H / 2) * Math.min(1, Math.max(0.2, v / base));
  const x = (i: number) => (W / 3) * i;

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
        role="img"
        aria-label={`Funil: ${m.totalStarts} starts, ${m.pixGenerated} PIX gerados, ${m.pixPaid} pagos`}
      >
        {etapas.map((e, i) => {
          const proximo = etapas[i + 1];
          const aEsq = meia(e.valor);
          const aDir = meia(proximo ? proximo.valor : e.valor * 0.9);
          const x1 = x(i);
          const x2 = x(i + 1);
          return (
            <polygon
              key={e.rotulo}
              points={`${x1},${H / 2 - aEsq} ${x2},${H / 2 - aDir} ${x2},${H / 2 + aDir} ${x1},${H / 2 + aEsq}`}
              fill="#34d399"
              opacity={0.25 + i * 0.2}
            />
          );
        })}
      </svg>

      {/* Os números por baixo do desenho: é aqui que está a verdade exata, já
          que a largura das faixas tem piso. */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        {etapas.map((e, i) => (
          <div key={e.rotulo} className="min-w-0">
            <p className="truncate font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {e.rotulo}
            </p>
            <p
              className={`font-display text-2xl font-semibold ${i === 2 ? "text-emerald-400" : "text-white"}`}
            >
              {e.valor}
            </p>
            <p className="font-mono text-[10px] text-zinc-600">
              {e.topo
                ? "topo do funil"
                : e.taxa === null
                  ? "leads de outros dias"
                  : `${pct(e.taxa)} do /start`}
            </p>
          </div>
        ))}
      </div>
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

/**
 * Um número em três janelas — hoje, mês e desde sempre — com uma leitura
 * derivada embaixo. É o formato que deixa a tendência à vista sem obrigar a
 * trocar o período no seletor.
 */
function CartaoComparativo({
  titulo,
  subtitulo,
  comp,
  valor,
  rodape,
}: {
  titulo: string;
  subtitulo: string;
  comp?: Comparativo;
  valor: (j: Janela) => string;
  rodape: (j: Janela) => string;
}) {
  const janelas: { rotulo: string; chave: keyof Comparativo }[] = [
    { rotulo: "Hoje", chave: "hoje" },
    { rotulo: "Mês", chave: "mes" },
    { rotulo: "Total", chave: "total" },
  ];
  return (
    <div className="card p-4">
      <p className="text-sm font-semibold text-zinc-200">{titulo}</p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {subtitulo}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {janelas.map((j) => (
          <div key={j.chave} className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {j.rotulo}
            </p>
            <p className="truncate font-display text-base font-semibold tabular-nums text-white">
              {comp ? valor(comp[j.chave]) : "—"}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-white/[0.06] pt-2 text-[11px] text-zinc-500">
        {comp ? rodape(comp.mes) : "—"} <span className="text-zinc-700">no mês</span>
      </p>
    </div>
  );
}

/**
 * Tempo entre o primeiro /start e o pagamento.
 *
 * A MEDIANA é a manchete, não a média: quem deu /start há meses e só agora
 * comprou puxa a média sozinho. E a base aparece sempre — venda que não passou
 * pelo bot não tem como ser cronometrada, e omitir isso faria o número mentir.
 */
function CartaoTempo({ comp }: { comp?: Comparativo }) {
  const janelas: { rotulo: string; chave: keyof Comparativo }[] = [
    { rotulo: "Hoje", chave: "hoje" },
    { rotulo: "Mês", chave: "mes" },
    { rotulo: "Total", chave: "total" },
  ];
  const mes = comp?.mes.tempo;
  return (
    <div className="card p-4">
      <p className="text-sm font-semibold text-zinc-200">Tempo até a compra</p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        metade das vendas em até
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {janelas.map((j) => {
          const t = comp?.[j.chave].tempo;
          return (
            <div key={j.chave} className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {j.rotulo}
              </p>
              <p
                className={`truncate font-display text-base font-semibold tabular-nums ${
                  t && t.base >= 5 ? "text-white" : "text-zinc-500"
                }`}
              >
                {t && t.base > 0 ? duracao(t.medianaMs) : "—"}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 border-t border-white/[0.06] pt-2 text-[11px] text-zinc-500">
        {!mes ? (
          "—"
        ) : mes.base === 0 ? (
          "Nenhuma venda do mês passou pelo /start do bot — não dá para medir."
        ) : (
          <>
            base: {mes.base} primeira{mes.base > 1 ? "s" : ""} compra{mes.base > 1 ? "s" : ""} no mês
            {mes.semStart > 0 && ` · ${mes.semStart} sem /start`}
            {mes.renovacoes > 0 &&
              ` · ${mes.renovacoes} ${mes.renovacoes > 1 ? "renovações" : "renovação"}`}
            {mes.base < 5 && <span className="text-amber-400/80"> · poucos casos</span>}
          </>
        )}
      </p>
    </div>
  );
}

/** Faturamento do mês contra a meta. A conta é sobre o PAGO do mês corrente,
 *  somando todos os modelos — a meta é da operação, não de um perfil. */

/** Número grande de uma base do Telegram (usuários ou membros de grupo). */
function UserStat({ label, value, tone }: { label: string; value?: number; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      {value === undefined ? (
        <div className="mt-2 h-7 w-16 animate-pulse rounded bg-white/5" />
      ) : (
        <p className={`mt-1 font-display text-2xl font-semibold ${tone || "text-white"}`}>{value}</p>
      )}
    </div>
  );
}
