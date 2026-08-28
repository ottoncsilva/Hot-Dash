"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Profile } from "@/lib/types";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import PageHeader from "@/components/PageHeader";
import { DEFAULT_PERIOD } from "@/lib/periods";
import { useProfile } from "@/context/ProfileContext";
import { niceTicks } from "@/lib/chartTicks";

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
  /** Do SLT (link na bio) — zerado sem a chave configurada. */
  views: number;
  clicks: number;
  totalStarts: number;
  pixGenerated: number;
  pixPaid: number;
  paidCents: number;
  netCents: number;
  pendingCents: number;
  pendingCount: number;
  avgTicketCents: number;
  viewToClick: number | null;
  clickToStart: number | null;
  startToPix: number | null;
  pixToPaid: number | null;
  startToPaid: number | null;
};
type Linha = Metricas & { profileId: string | null; profileName: string; botActive: boolean | null };
type Fonte = {
  code: string;
  starts: number;
  pixGenerated: number;
  pixPaid: number;
  paidCents: number;
  /** Do SLT (link na bio) — só existe quando o código bate com o slug de
   *  uma página lá. Ver Configurações → Pagamentos → SLT. */
  views?: number;
  clicks?: number;
};
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

      {/* Funil: o desenho (com o número de cada etapa grudado na própria
          cintura) SEMPRE ao lado das 5 taxas de conversão — inclusive no
          celular, não só a partir do desktop/iPad. Pra caber, o desenho fica
          mais estreito (54% da largura, contra os 420px fixos do desktop) e
          a coluna de números encolhe na mesma proporção (ver `divisor`
          menor em `FunilVisual`). `items-stretch` faz a coluna de taxas
          esticar pra MESMA altura do desenho e `justify-between` espalha as
          5 igualmente por essa altura. */}
      {/* No desktop largo o funil fica LADO A LADO com os quatro
          comparativos, em vez de empilhado: o desenho da jornada fica
          junto dos números que ele explica, e a tela inteira cabe sem
          rolar. Só a partir de `xl` — abaixo disso a coluna do funil
          ficaria estreita demais e espremeria as 5 taxas ao lado do
          desenho (que é fixo em 420px daqui pra cima). O `minmax(0,…)`
          nas duas colunas é o que impede uma delas de estourar a
          largura por causa de um conteúdo comprido. */}
      <div className="mt-6 xl:grid xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:items-start xl:gap-6">
        <div className="card p-5">
          <p className="eyebrow">jornada do usuário até a compra</p>
          <div className="flex items-stretch gap-3 lg:gap-6">
            <FunilVisual m={m} />
            <div className="flex flex-1 flex-col justify-between border-l border-white/[0.06] pl-3 lg:pl-6">
              <Conversao label="View → Clique" valor={m ? pctFunil(m.viewToClick) : null} detalhe={m ? `${m.clicks} de ${m.views}` : ""} />
              <Conversao label="Clique → Start" valor={m ? pctFunil(m.clickToStart) : null} detalhe={m ? `${m.totalStarts} de ${m.clicks}` : ""} />
              <Conversao label="Start → PIX" valor={m ? pctFunil(m.startToPix) : null} detalhe={m ? `${m.pixGenerated} de ${m.totalStarts}` : ""} />
              <Conversao label="PIX → Pago" valor={m ? pctFunil(m.pixToPaid) : null} detalhe={m ? `${m.pixPaid} de ${m.pixGenerated}` : ""} accent />
              <Conversao label="Start → Pago" valor={m ? pctFunil(m.startToPaid) : null} detalhe={m ? `${m.pixPaid} de ${m.totalStarts}` : ""} accent />
            </div>
          </div>
          {m && m.pixGenerated > m.totalStarts && (
            <p className="mt-3 text-[11px] text-amber-400/80">
              {m.totalStarts === 0
                ? "Sem /start no período — as vendas vieram por fora do bot, então o topo do funil não dá para medir."
                : "Mais PIX do que /start: parte das vendas é de gente que entrou antes. As taxas ficam sem número porque não seriam conversão."}
            </p>
          )}
        </div>

        {/* Empilhado, os quatro cabem numa linha só (nunca mais o 4º órfão
            numa segunda fila, que era o que a grade de 3 colunas fazia). Ao
            lado do funil, viram UMA coluna: em duas, cada card fica com
            ~190px a 1280px e ~220px a 1440px, e os três valores (hoje/mês/
            total) passam a truncar — "R$ 28,67" precisa de 80px e sobravam
            46. Duas colunas só caberiam de ~1900px pra cima. Medido no
            navegador, não estimado.

            `pt-5` só no lado a lado: alinha este rótulo com o "jornada do
            usuário" lá de dentro do card, que o padding do card empurra. */}
        <div className="xl:pt-5">
          {/* Comparativo de três janelas. NÃO segue o seletor de período de
              propósito: 11% hoje só significa alguma coisa ao lado do histórico. */}
          <p className="eyebrow mt-8 xl:mt-0">hoje, no mês e desde sempre</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-1">
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
        </div>
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
          <b>Barras</b>: total de membros por dia, consultado no Telegram. <b>Linhas</b>: entradas e saídas
          pelos eventos do bot, só nos dias em que o Hot-Dash operava. Toque num dia para ver os
          números.
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
              <th className="p-3 text-right">Views</th>
              <th className="p-3 text-right">Cliques</th>
              <th className="p-3 text-right">Starts</th>
              <th className="p-3 text-right">PIX</th>
              <th className="p-3 text-right">Pagos</th>
              <th className="p-3 text-right">Conversão</th>
              <th className="p-3 text-right">Receita</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {!data ? (
              <tr><td colSpan={8} className="p-6 text-center text-xs text-zinc-600">Carregando...</td></tr>
            ) : data.fontes.length === 0 ? (
              <tr><td colSpan={8} className="p-6 text-center text-xs text-zinc-600">Sem tráfego no período.</td></tr>
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
                  <td className="p-3 text-right font-mono text-zinc-500">
                    {f.views !== undefined ? f.views : "—"}
                  </td>
                  <td className="p-3 text-right font-mono text-zinc-500">
                    {f.clicks !== undefined ? f.clicks : "—"}
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
      <p className="mt-1.5 text-[11px] text-zinc-600">
        Views/Cliques vêm do SLT (link na bio) — só aparecem quando o código é igual ao slug da página
        lá. Veja a lista completa em <Link href="/dashboard/links" className="underline">Links</Link>.
      </p>

      {/* Planos */}
      <p className="eyebrow mt-8">planos que mais convertem</p>
      <div className="mt-3 card p-4">
        {!data ? (
          <div className="h-12 animate-pulse rounded bg-white/[0.03]" />
        ) : data.planos.length === 0 ? (
          <p className="text-xs text-zinc-600">
            Nenhuma venda ligada a um plano — o vínculo nasce quando a compra passa pelo bot de vendas.
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


/** Cor única do desenho — sólida, sem gradiente e sem brilho/borda: o
 *  contorno é só o traço nítido que o próprio SVG já desenha. Mesmo verde
 *  (emerald-400) já usado em "Pago" e no gráfico de crescimento do grupo
 *  VIP — o verde de "dinheiro entrando" do resto do painel, não uma cor
 *  nova só pro funil. */
const FUNIL_COR = "#34d399";

/**
 * A jornada desenhada como um fio de líquido descendo — de cima (topo do
 * funil) para baixo (pago), afinando na proporção de quanta gente sobrou em
 * cada etapa. Um contorno só, sem NENHUM segmento reto: as bordas viram um
 * caminho SVG feito de curvas (`Q` no arremate de cima/baixo, `C` ligando
 * cada cintura à seguinte, no estilo dos links de um diagrama de Sankey —
 * tangente horizontal em cada nó, sem quina).
 *
 * A largura tem um PISO (3.5%): uma etapa com uma venda só continua sendo um
 * fio fino e legível em vez de sumir de vez. O piso deforma a proporção de
 * propósito — por isso o número absoluto vai escrito na legenda de cada
 * transição, e é ele que manda.
 *
 * O número de cada etapa mora numa coluna FIXA à esquerda — uma embaixo da
 * outra, alinhada em linha reta (mesmo padrão da coluna de conversão à
 * direita, do outro lado do gráfico) — separada do desenho por uma linha
 * vertical, e cada uma casada com uma linha horizontal sutil que atravessa
 * o gráfico na altura exata daquela etapa (`centerYs[i]`, o mesmo ponto que
 * o caminho SVG usa como cintura). Nada de posição "encostada na curva":
 * é grade (linha × coluna), não colagem.
 */
function FunilVisual({ m }: { m?: Metricas }) {
  if (!m) return <div className="h-80 w-[54%] shrink-0 animate-pulse rounded-lg bg-white/5 lg:w-[420px] xl:w-[54%]" />;

  // SEMPRE as 5 etapas — mesmo sem SLT conectado, mesmo período sem
  // nenhuma venda. Esconder etapa quando o número é 0 já escondeu dado de
  // verdade (SLT conectado mas com 0 view/clique naquela janela é uma
  // resposta, não um "não configurado"); zero é informação, não motivo pra
  // sumir com o desenho.
  const base = Math.max(m.views, m.clicks, m.totalStarts, m.pixGenerated, m.pixPaid, 1);
  const rotulos = ["Views", "Cliques", "/start", "PIX gerado", "Pago"];
  const valores = [m.views, m.clicks, m.totalStarts, m.pixGenerated, m.pixPaid];
  const N = valores.length;

  // Coordenadas em unidades "percentuais" (W/H = 100): 1 unidade = 1% do
  // contêiner — desenho, coluna de números e linhas-guia escalam juntos em
  // qualquer tamanho. A coluna da esquerda (rótulos) vai de 0 a `divisor`;
  // o desenho ocupa o resto, à direita da linha divisória. Coluna e forma
  // mais estreitas que antes (era 24/32) — o contêiner agora divide espaço
  // com os cards de conversão em QUALQUER largura de tela, não só depois de
  // sobrar espaço no desktop.
  const W = 100;
  const H = 100;
  const divisor = 20;
  const cx = 60; // centro da forma, DENTRO da área à direita do divisor
  const maxHalf = 27;
  const topPad = 8;
  const bottomPad = 8;
  const halfWidths = valores.map((v) => maxHalf * Math.min(1, Math.max(0.035, v / base)));
  const centerYs = valores.map((_, i) => topPad + (i * (H - topPad - bottomPad)) / (N - 1));
  const domeTopo = 5.5;
  const domeBase = Math.min(8, Math.max(2.5, halfWidths[N - 1] * 0.55));

  // Contorno em UM caminho fechado, só com curvas: arremate de cima (Q,
  // bojo pra cima — "superfície do líquido"), desce pela borda direita
  // ligando cintura a cintura (C, tangente horizontal em cada nó — mesma
  // curva usada em link de Sankey), arremate de baixo (Q, bojo pra baixo —
  // afina até a última etapa) e sobe pela esquerda espelhado.
  let d = `M ${cx - halfWidths[0]} ${centerYs[0]}`;
  d += ` Q ${cx} ${centerYs[0] - domeTopo} ${cx + halfWidths[0]} ${centerYs[0]}`;
  for (let i = 0; i < N - 1; i++) {
    const ymid = (centerYs[i] + centerYs[i + 1]) / 2;
    d += ` C ${cx + halfWidths[i]} ${ymid} ${cx + halfWidths[i + 1]} ${ymid} ${cx + halfWidths[i + 1]} ${centerYs[i + 1]}`;
  }
  d += ` Q ${cx} ${centerYs[N - 1] + domeBase} ${cx - halfWidths[N - 1]} ${centerYs[N - 1]}`;
  for (let i = N - 1; i > 0; i--) {
    const ymid = (centerYs[i] + centerYs[i - 1]) / 2;
    d += ` C ${cx - halfWidths[i]} ${ymid} ${cx - halfWidths[i - 1]} ${ymid} ${cx - halfWidths[i - 1]} ${centerYs[i - 1]}`;
  }
  d += " Z";

  // Altura de referência casada com uma largura de referência: a RAZÃO
  // entre as duas vira `aspect-ratio` do contêiner, não um tamanho fixo em
  // pixel — o navegador escala os dois juntos conforme sobra espaço na
  // tela (cresce até o teto, encolhe no celular) sem esticar/achatar a
  // curva.
  const alturaRef = Math.max(340, 78 * N + 60);
  const larguraRef = 300;

  return (
    <div
      className="relative w-[54%] shrink-0 lg:w-[420px] xl:w-[54%]"
      style={{ aspectRatio: `${larguraRef} / ${alturaRef}` }}
    >
      {/* Linhas-guia horizontais — só dentro do DESENHO, entre a linha
          vertical divisória (à esquerda dela mora a coluna de números, sem
          linha nenhuma cruzando por baixo) e a borda direita do gráfico, na
          mesma altura exata da cintura daquela etapa. */}
      {centerYs.map((y, i) => (
        <div
          key={`linha-${rotulos[i]}`}
          className="absolute h-px bg-white/[0.06]"
          style={{ top: `${(y / H) * 100}%`, left: `${divisor}%`, right: 0 }}
        />
      ))}

      {/* Linha vertical separando a coluna de números do desenho — o par da
          que já existe do lado direito, entre o funil e a lista de
          conversão. */}
      <div className="absolute inset-y-0 border-l border-white/10" style={{ left: `${divisor}%` }} />

      {/* Coluna de números: uma linha reta só, cada etapa na MESMA posição
          horizontal (não colada na largura da curva) — é a "linha vertical
          igual a da direita" que estava faltando. */}
      {valores.map((v, i) => (
        <div
          key={rotulos[i]}
          className="absolute -translate-y-1/2 text-right"
          style={{ top: `${(centerYs[i] / H) * 100}%`, left: 0, width: `${divisor - 2.5}%` }}
        >
          <p className="font-mono text-[8px] uppercase leading-tight tracking-tight text-zinc-500 lg:text-[9px] lg:tracking-wider">
            {rotulos[i]}
          </p>
          <p className={`font-display text-base font-semibold leading-tight lg:text-lg ${i === N - 1 ? "text-emerald-400" : "text-white"}`}>
            {v}
          </p>
        </div>
      ))}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={valores.map((v, i) => `${rotulos[i]} ${v}`).join(", ")}
      >
        {/* Cor sólida só, sem gradiente, sem stroke, sem blur — a borda é o
            próprio traçado do path, nítida por definição. */}
        <path d={d} fill={FUNIL_COR} />
      </svg>
    </div>
  );
}

/** Uma linha de conversão (rótulo, taxa, "X de Y") — usada na coluna ao lado
 *  do funil, sempre à esquerda (mesmo layout no celular e no desktop). */
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
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2 text-left lg:px-3 lg:py-2.5">
      <p className="font-mono text-[9px] uppercase leading-tight tracking-tight text-zinc-500 lg:text-[10px] lg:tracking-wider">
        {label}
      </p>
      <p className={`mt-1 font-display text-lg font-semibold lg:text-xl ${accent ? "text-emerald-400" : "text-sky-400"}`}>
        {valor ?? <span className="inline-block h-6 w-14 animate-pulse rounded bg-white/5" />}
      </p>
      <p className="text-[11px] text-zinc-600">{detalhe}</p>
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
        Ainda sem histórico — a medição começa no primeiro dia.
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
  // Marcas horizontais leves, na escala das BARRAS (total de membros) — a
  // mais proeminente das duas. Os valores se adaptam a cada grupo/período.
  const gridTicks = niceTicks(maxTotal);

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
        {gridTicks.map((t) => (
          <line
            key={t}
            x1={0}
            y1={yBarra(t)}
            x2={W}
            y2={yBarra(t)}
            stroke="#ffffff"
            strokeOpacity={0.06}
            vectorEffect="non-scaling-stroke"
          />
        ))}
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
