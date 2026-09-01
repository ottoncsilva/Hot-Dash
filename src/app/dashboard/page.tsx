"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Profile } from "@/lib/types";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { PeriodStats, QuandoRow } from "@/lib/transactions";
import { IconSettings } from "@/components/icons";
import FaixaRolavel from "@/components/FaixaRolavel";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import PageHeader from "@/components/PageHeader";
import ReceitaEstrangeira, { type LinhaMoeda } from "@/components/ReceitaEstrangeira";
import CurvaSort, {
  ALTURA_LISTA,
  FAIXA_ALTURA,
  ordenarFaixas,
  type CurvaOrdem,
} from "@/components/CurvaSort";
import { DEFAULT_PERIOD, PERIOD_OPTIONS, type PeriodKey } from "@/lib/periods";
import { useProfile } from "@/context/ProfileContext";
import { niceTicks } from "@/lib/chartTicks";
import { maiorSaldoStripe, moedaCents } from "@/lib/stripeSaldo";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
/** Valor na moeda informada — o saldo da Stripe pode estar em real, dólar,
 *  euro ou libra, e escrever "US$" em cima de real já enganou uma vez. */
/** Reexporta com o nome curto que esta tela já usava em dezenas de lugares. */
const moeda = moedaCents;
function usd(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function pct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

// ---- Painel do Bot de Vendas ----
// A lista de períodos e o cálculo das datas ficam em lib/periods + PeriodPicker,
// compartilhados com o Financeiro.

type BotOverviewData = {
  period: PeriodKey;
  stats: PeriodStats;
  funnel: {
    totalStarts: number;
    pixGenerated: number;
    pixPaid: number;
    userConversion: number | null;
    paymentConversion: number | null;
  };
  byProfile: { profileId: string; profileName: string; botActive: boolean | null; paidCents: number; paidCount: number }[];
  series: { day: string; cents: number }[];
  netRevenueCents: number;
  /** Venda em moeda que não é real — fora dos totais acima, de propósito. */
  receitaEstrangeira?: LinhaMoeda[];
  netProfitCents: number;
  /** Meta de faturamento do mês (Configurações → Pagamentos). Zero = sem meta. */
  metaMensalCents: number;
  /** Pago no mês corrente. Da operação INTEIRA — a meta não é por modelo. */
  metaFeitoCents: number;
  byWeekday: QuandoRow[];
  byHour: QuandoRow[];
};

export default function DashboardHome() {
  // A lista de modelos e a seleção vêm do menu (ProfileProvider).
  const { profiles, profileId } = useProfile();
  const [providers, setProviders] = useState<PaymentSettingsPublic | null>(null);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seenPaidRef = useRef<number | null>(null);
  const [newSale, setNewSale] = useState<{ amountCents: number; customer?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    apiGet<{ settings: PaymentSettingsPublic }>("/api/payments/settings")
      .then((d) => {
        setProviders(d.settings);
        setError(null);
      })
      .catch(() => setError("Sem conexão com o servidor. Verifique a internet e tente de novo."));
    // Status de IA para o checklist de primeiros passos.
    apiGet<{ settings: { openai: { enabled: boolean; hasKey: boolean }; gemini: { enabled: boolean; hasKey: boolean } } }>(
      "/api/settings/ai",
    )
      .then((d) =>
        setAiConnected(
          Boolean(
            (d.settings.openai.enabled && d.settings.openai.hasKey) ||
              (d.settings.gemini.enabled && d.settings.gemini.hasKey),
          ),
        ),
      )
      .catch(() => setAiConnected(false));
  }, [reloadKey]);

  // Detecta venda nova (via webhook de qualquer provedor) para o toast "🎉
  // Nova venda confirmada" — independe do painel abaixo e do bot estar
  // rodando ou não. `bot-overview` só dá o TOTAL do dia (paidCents), então
  // serve só de GATILHO (a contagem subiu = algo novo entrou); o VALOR
  // mostrado vem de `lastPaidTransaction` — a venda em si, não a soma do dia.
  useEffect(() => {
    async function checkNewSale() {
      try {
        const d = await apiGet<{ stats: PeriodStats }>("/api/dashboard/bot-overview?period=today");
        const paid = d.stats.paidCount;
        if (seenPaidRef.current !== null && paid > seenPaidRef.current) {
          const { lastPaid } = await apiGet<{
            lastPaid: { at: number; amountCents: number; customer?: string } | null;
          }>("/api/payments/last-paid");
          if (lastPaid) setNewSale({ amountCents: lastPaid.amountCents, customer: lastPaid.customer });
        }
        seenPaidRef.current = paid;
      } catch {
        /* silencioso — não é crítico para a UI */
      }
    }
    checkNewSale();
    const t = setInterval(checkNewSale, 20000);
    return () => clearInterval(t);
  }, []);

  const profileCount = profiles.length;
  const accountCount = profiles.reduce((n, p) => n + p.accounts.length, 0);
  const anyProvider = providers?.syncpay.enabled;

  return (
    <div className="page">
      <PageHeader size="lg" title="Dashboard" />

      {aiConnected !== null && providers !== null && (
        <SetupChecklist
          profileDone={profiles.length > 0}
          aiDone={aiConnected}
          payDone={Boolean(providers.syncpay.enabled)}
        />
      )}

      {newSale && (
        <div className="mt-5 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-3">
          <p className="text-sm text-emerald-200">
            🎉 Nova venda confirmada: <strong>{brl(newSale.amountCents)}</strong>
            {newSale.customer ? ` · ${newSale.customer}` : ""}
          </p>
          <button
            onClick={() => setNewSale(null)}
            className="font-mono text-[11px] uppercase tracking-wider text-emerald-300/80 hover:text-emerald-200"
          >
            ok
          </button>
        </div>
      )}

      {error && (
        <div className="mt-5 flex flex-col gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            onClick={() => { setError(null); setReloadKey((k) => k + 1); }}
            className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {providers !== null && !anyProvider && (
        <div className="mt-5 flex items-center justify-between card p-4">
          <p className="text-sm text-zinc-400">Nenhum provedor conectado ainda.</p>
          <Link href="/dashboard/settings/pagamentos" className="btn-ghost text-xs">
            <IconSettings size={14} /> Configurar
          </Link>
        </div>
      )}

      {/* Painel do Bot de Vendas — vendas, funil de conversão e faturamento por modelo */}
      <BotSalesPanel profileId={profileId} profiles={profiles} reloadKey={reloadKey} />

      {/* Operação */}
      <p className="eyebrow mt-10">operação</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Modelos" value={profileCount} />
        <Stat label="Contas sociais" value={accountCount} />
      </div>
    </div>
  );
}

/**
 * O cartão de topo do Dashboard: faturamento e líquido lado a lado, e embaixo
 * os números que qualificam os dois — vendas, ticket médio, starts e a
 * conversão do PIX.
 *
 * Os DOIS valores em tamanho grande, não um só. Bruto sem líquido esconde a
 * taxa do gateway; líquido sem bruto esconde o tamanho da operação. Quem opera
 * olha os dois na mesma piscada, e é por isso que eles dividem a primeira
 * linha em vez de virarem dois cartões separados.
 *
 * Nada aqui é informação nova nem informação que saiu de outro lugar: são os
 * mesmos números que já estavam na grade de cartões, reorganizados por
 * importância.
 */
function HeroFaturamento({
  data,
  periodo,
}: {
  data: BotOverviewData | null;
  periodo: string;
}) {
  const carregando = !data;
  const esqueleto = (w: string) => (
    <span className={`inline-block h-8 ${w} animate-pulse rounded bg-white/5 align-middle`} />
  );

  return (
    <div className="mt-4 card p-5">
      <p className="eyebrow">
        vendas aprovadas{periodo ? ` · ${periodo}` : ""}
      </p>

      {/* GRADE de duas colunas, não `flex-wrap`. Com flex, o líquido descia
          para a linha de baixo assim que o faturamento ganhava um dígito —
          "R$ 761,95" cabia ao lado, "R$ 8.709,21" não. Cada valor tem metade
          da largura garantida, e o corpo encolhe no celular para os dois
          caberem em qualquer valor. */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 sm:max-w-2xl sm:gap-x-8">
        <div className="min-w-0">
          <p className="whitespace-nowrap font-display text-[24px] font-semibold leading-tight text-white sm:text-4xl">
            {carregando ? esqueleto("w-32 sm:w-40") : brl(data.stats.paidCents)}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">faturamento bruto</p>
        </div>
        <div className="min-w-0">
          <p className="whitespace-nowrap font-display text-[22px] font-semibold leading-tight text-emerald-400 sm:text-3xl">
            {carregando ? esqueleto("w-28 sm:w-32") : brl(data.netRevenueCents)}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">
            líquido, já sem a taxa do gateway
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniNumero
          rotulo="Vendas"
          valor={data ? String(data.stats.paidCount) : null}
        />
        <MiniNumero
          rotulo="Ticket médio"
          valor={data ? brl(data.stats.avgTicketCents) : null}
        />
        <MiniNumero
          rotulo="Starts"
          valor={data ? String(data.funnel.totalStarts) : null}
        />
        <MiniNumero
          rotulo="Conv. PIX"
          valor={
            data ? (data.funnel.paymentConversion === null ? "—" : pct(data.funnel.paymentConversion)) : null
          }
        />
      </div>
    </div>
  );
}

/** Um número de apoio do cartão de topo — menor que o faturamento de propósito. */
function MiniNumero({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="panel px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-widest2 text-zinc-500">{rotulo}</p>
      <p className="mt-1 font-display text-lg font-semibold text-white">
        {valor ?? <span className="inline-block h-5 w-12 animate-pulse rounded bg-white/5" />}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  muted,
  negative,
  hint,
}: {
  label: string;
  value: string | null;
  accent?: boolean;
  muted?: boolean;
  negative?: boolean;
  /** Legenda curta abaixo do valor (ex.: como o número foi calculado). */
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-2 font-display text-xl font-semibold ${
          negative
            ? "text-red-400"
            : accent
              ? "text-emerald-400"
              : muted
                ? "text-zinc-400"
                : "text-white"
        }`}
      >
        {value ?? <span className="inline-block h-6 w-16 animate-pulse rounded bg-white/5" />}
      </p>
      {hint && <p className="mt-1 text-[11px] text-zinc-600">{hint}</p>}
    </div>
  );
}

function SetupChecklist({
  profileDone,
  aiDone,
  payDone,
}: {
  profileDone: boolean;
  aiDone: boolean;
  payDone: boolean;
}) {
  const steps = [
    { done: profileDone, label: "Crie seu primeiro modelo", href: "/dashboard/profiles" },
    { done: aiDone, label: "Conecte uma IA (legendas e cronograma)", href: "/dashboard/settings/ia" },
    { done: payDone, label: "Conecte os pagamentos (SyncPay)", href: "/dashboard/settings/pagamentos" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  // NO CELULAR, DOBRADO ASSIM QUE A CONFIGURAÇÃO COMEÇA.
  //
  // O cartão aberto ocupava a primeira tela inteira, e o faturamento — o motivo
  // de abrir o painel — só aparecia rolando. Quem ainda não fez nada continua
  // vendo a lista aberta (é uma tela nova, e a lista é o que fazer primeiro);
  // quem já cumpriu um passo vê a linha de progresso e abre se quiser.
  //
  // O padrão é CALCULADO a cada render, não congelado num `useState` inicial:
  // na montagem os dados de modelos/IA/pagamento ainda não chegaram, então
  // `doneCount` vale 0 e um estado inicial deixaria o cartão aberto para
  // sempre — que era exatamente o que acontecia. `manual` guarda só a decisão
  // de quem clicou, e ela tem a última palavra.
  const [manual, setManual] = useState<boolean | null>(null);
  const aberto = manual ?? doneCount === 0;

  // Some quando tudo está configurado. Depois dos hooks, sempre: um `return`
  // antes deles mudaria a quantidade de hooks entre renders.
  if (doneCount === steps.length) return null;

  return (
    <div className="mt-5 card p-4">
      <button
        type="button"
        onClick={() => setManual(!aberto)}
        aria-expanded={aberto}
        // No celular esta linha é o que abre e fecha o cartão, e tinha só a
        // altura do texto. `-my-1` devolve a folga ao card para o cartão não
        // crescer por causa do alvo maior.
        className="flex w-full items-center justify-between gap-3 text-left [@media(pointer:coarse)]:-my-1 [@media(pointer:coarse)]:min-h-[44px] sm:cursor-default"
      >
        <p className="font-display text-base font-semibold text-white">Primeiros passos</p>
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          {doneCount}/{steps.length}
          <span className={`transition-transform sm:hidden ${aberto ? "rotate-180" : ""}`}>▾</span>
        </span>
      </button>
      <p className={`mt-1 text-xs text-zinc-500 ${aberto ? "" : "hidden sm:block"}`}>
        Complete a configuração para o painel funcionar por inteiro.
      </p>
      <div className={`mt-3 space-y-1.5 ${aberto ? "" : "hidden sm:block"}`}>
        {steps.map((s) => (
          <div
            key={s.href}
            className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5"
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                s.done ? "border-emerald-500 bg-emerald-500 text-black" : "border-white/25 text-transparent"
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4 10-10" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className={`flex-1 text-sm ${s.done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
              {s.label}
            </span>
            {!s.done && (
              <Link href={s.href} className="btn-ghost px-3 py-1.5 text-xs">
                Configurar
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-white">
        {value === null ? (
          <span className="inline-block h-6 w-10 animate-pulse rounded bg-white/5" />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel do Bot de Vendas — cards, gráfico de faturamento, funil de conversão
// e faturamento por modelo. Espelha o painel do bot de vendas,
// usando os dados reais de transactions/telegram_leads/telegram_subscriptions.
// ---------------------------------------------------------------------------
function BotSalesPanel({
  profileId,
  profiles,
  reloadKey,
}: {
  profileId: string;
  profiles: Profile[] | null;
  reloadKey: number;
}) {
  // Padrão: HOJE — ao abrir ou recarregar o painel, o número que interessa é o
  // do dia corrente.
  const [period, setPeriod] = useState<PeriodState>({ period: DEFAULT_PERIOD, from: "", to: "" });
  const [data, setData] = useState<BotOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [innerReload, setInnerReload] = useState(0);

  // Saldo do gateway: não depende do período, então é buscado à parte e não é
  // refeito ao trocar Hoje/Ontem/7 dias. `refresh=1` fura o cache da rota —
  // toda abertura (ou recarga) do Dashboard consulta a SyncPay de novo.
  type Balance = { connected: boolean; balanceCents: number | null; stale?: boolean; reason?: string };
  const [balance, setBalance] = useState<Balance | null>(null);
  useEffect(() => {
    setBalance(null);
    apiGet<Balance>("/api/payments/balance?refresh=1")
      .then(setBalance)
      .catch(() => setBalance(null));
  }, [innerReload, reloadKey]);

  // Saldo na Stripe (USD) — mesma lógica do da SyncPay, mas sem cache pra
  // furar: a rota já consulta a Stripe direto, sem o limite de taxa que a
  // da SyncPay precisa contornar.
  type StripeBalance = {
    connected: boolean;
    availableCents: number | null;
    pendingCents: number | null;
    /** Saldo em toda moeda que não é dólar — BRL do cartão no Brasil, EUR/GBP
     *  da cobrança na moeda do lead. A rota já mandava; a tela é que ignorava. */
    outras?: { currency: string; availableCents: number; pendingCents?: number }[] | null;
    error?: string;
  };
  const [stripeBalance, setStripeBalance] = useState<StripeBalance | null>(null);
  // A regra de qual moeda mostrar mora em `maiorSaldoStripe` — o Financeiro
  // mostra o mesmo número e leria diferente se cada tela tivesse a sua.
  const saldoStripe =
    stripeBalance?.connected && stripeBalance.availableCents !== null
      ? maiorSaldoStripe({
          availableCents: stripeBalance.availableCents,
          pendingCents: stripeBalance.pendingCents,
          outras: stripeBalance.outras,
        })
      : null;
  useEffect(() => {
    setStripeBalance(null);
    apiGet<StripeBalance>("/api/payments/stripe/balance")
      .then(setStripeBalance)
      .catch(() => setStripeBalance(null));
  }, [innerReload, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    const qs = new URLSearchParams(periodQuery(period));
    if (profileId) qs.set("profileId", profileId);
    apiGet<BotOverviewData>(`/api/dashboard/bot-overview?${qs.toString()}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Sem conexão com o servidor. Verifique a internet e tente de novo.");
      });
    return () => {
      cancelled = true;
    };
  }, [period, profileId, reloadKey, innerReload]);

  const profileName = (id: string) => profiles?.find((p) => p.id === id)?.name || id;
  // "vendas aprovadas · HOJE" — o cartão precisa dizer de que janela
  // aquele número é, senão os R$ 761,95 do dia são lidos como do mês.
  const rotuloPeriodo = PERIOD_OPTIONS.find((o) => o.key === period.period)?.label || "";

  return (
    <div className="mt-6">
      {/* Sem título: os cartões abaixo já dizem o que são, e no celular esse
          rótulo custava uma linha inteira antes do primeiro número. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {error && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            onClick={() => setInnerReload((k) => k + 1)}
            className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {/* O CARTÃO DE CIMA: os dois números que o operador abre o painel para
          ver — o faturamento e o líquido — juntos, grandes, e com o resto da
          leitura do período pendurado neles. Antes eram seis cartões iguais
          numa grade, todos do mesmo tamanho: o dinheiro tinha o mesmo peso
          visual que o saldo do gateway, e no celular a primeira tela acabava
          antes de mostrar o faturamento. */}
      <HeroFaturamento data={data} periodo={rotuloPeriodo} />

      {/* Só aparece quando existe venda em outra moeda no período. */}
      <ReceitaEstrangeira linhas={data?.receitaEstrangeira} className="mt-3" />

      {/* A META e o GRÁFICO trocam de ordem conforme a tela.
          No CELULAR o gráfico vem primeiro e a meta logo abaixo dele: a tela é
          estreita e alta, e empurrar o gráfico para baixo da barra fazia ele
          nascer fora da primeira rolagem. No iPad e no desktop a meta volta
          para cima, colada nos números de faturamento — que é o que ela mede.
          É a MESMA barra nos dois casos, só reordenada por CSS; renderizar
          duas vezes deixaria duas metas no HTML. */}
      <div className="mt-3 flex flex-col gap-3">
        {/* Faturamento por período */}
        <div className="order-1 card p-4 sm:order-2">
          <p className="eyebrow">faturamento por período</p>
          <div className="mt-3">
            {data ? <RevenueChart series={data.series} /> : <ChartSkeleton />}
          </div>
        </div>

        {/* Meta do mês. Só aparece quando existe meta configurada: barra de
            progresso contra zero não diz nada. NÃO segue o seletor de modelo
            (a meta é uma só da operação); por isso o rodapé diz "todos os
            modelos". */}
        {data && data.metaMensalCents > 0 && (
          <div className="order-2 sm:order-1">
            <BarraMeta feitoCents={data.metaFeitoCents} metaCents={data.metaMensalCents} />
          </div>
        )}
      </div>

      {/* Os dois saldos, depois do gráfico. São foto do AGORA e NÃO seguem o
          período escolhido — ficar no topo, ao lado de números que mudam com
          o filtro, fazia parecer que mudavam junto. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <MetricCard
          label="Saldo na SyncPay"
          value={
            balance === null
              ? null
              : !balance.connected
                ? "—"
                : balance.balanceCents === null
                  ? "indisponível"
                  : brl(balance.balanceCents)
          }
          muted={balance !== null && (!balance.connected || balance.balanceCents === null)}
          hint={
            balance === null
              ? undefined
              : !balance.connected
                ? "Conecte a SyncPay em Configurações"
                : balance.balanceCents === null
                  ? balance.reason || "Teste em Configurações → Pagamentos"
                  : balance.stale
                    ? "Último valor conhecido"
                    : "Disponível agora"
          }
        />
        <MetricCard
          label="Saldo na Stripe"
          value={
            stripeBalance === null
              ? null
              : !stripeBalance.connected
                ? "—"
                : saldoStripe === null
                  ? "indisponível"
                  : moeda(saldoStripe.total, saldoStripe.currency)
          }
          muted={stripeBalance !== null && (!stripeBalance.connected || saldoStripe === null)}
          hint={
            stripeBalance === null
              ? undefined
              : !stripeBalance.connected
                ? "Conecte a Stripe em Configurações"
                : saldoStripe === null
                  ? stripeBalance.error || "Teste em Configurações → Pagamentos"
                  : `Disponível ${moeda(saldoStripe.disp, saldoStripe.currency)} · a caminho ${moeda(saldoStripe.vindo, saldoStripe.currency)}`
          }
        />
      </div>

      {/* Conversões do bot */}
      <p className="eyebrow mt-8">conversões do bot</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ConversionCard
          title="Conversão de Usuário"
          subtitle="% que compraram"
          value={data?.funnel.userConversion != null ? pct(data.funnel.userConversion) : "—"}
          rows={data ? [["Total", String(data.funnel.totalStarts)], ["Vendas", String(data.funnel.pixPaid)]] : []}
        />
        <ConversionCard
          title="Conversão de Pagamento"
          subtitle="PIX pagos / gerados"
          value={data?.funnel.paymentConversion != null ? pct(data.funnel.paymentConversion) : "—"}
          rows={data ? [["Gerados", String(data.funnel.pixGenerated)], ["Pagos", String(data.funnel.pixPaid)]] : []}
        />
        <ConversionCard
          title="Ticket Médio"
          subtitle="por venda"
          value={data ? brl(data.stats.avgTicketCents) : "—"}
          rows={data ? [["Vendas", String(data.stats.paidCount)], ["Receita", brl(data.stats.paidCents)]] : []}
        />
      </div>

      {/* Quando o público compra — dia da semana e hora. */}
      <p className="eyebrow mt-8">quando o público compra</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <RankingCard title="Vendas por dia da semana" rows={data?.byWeekday} />
        <RankingCard title="Vendas por horário" rows={data?.byHour} />
      </div>

      {/* Faturamento por Modelo */}
      <p className="eyebrow mt-8">faturamento por modelo</p>
      <div className="mt-3 card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3 font-medium">Modelo</th>
              {/* "Plataforma" saiu: escrevia "Telegram" fixo em toda linha, sem
                  exceção — uma coluna que não distingue nada de nada. E o
                  "Status" dizia respeito ao BOT, não à modelo; o nome novo diz
                  isso. */}
              <th className="px-4 py-3 font-medium">Status BOT</th>
              <th className="px-4 py-3 text-right font-medium">Faturamento</th>
              <th className="px-4 py-3 text-right font-medium">% do Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {!data ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-600">
                  Carregando...
                </td>
              </tr>
            ) : data.byProfile.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-xs text-zinc-600">
                  Nenhuma venda ainda.{" "}
                  <Link href="/dashboard/telegram/bot" className="text-emerald-400 hover:underline">
                    Configurar bot de vendas →
                  </Link>
                </td>
              </tr>
            ) : (
              (() => {
                const totalCents = data.byProfile.reduce((n, r) => n + r.paidCents, 0);
                return data.byProfile.map((r) => (
                  <tr key={r.profileId}>
                    <td className="px-4 py-3 text-white">{r.profileName || profileName(r.profileId)}</td>
                    <td className="px-4 py-3">
                      {r.botActive === null ? (
                        <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-500">
                          Sem bot
                        </span>
                      ) : r.botActive ? (
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-400">
                          Ativo
                        </span>
                      ) : (
                        <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-400">
                          Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-white">{brl(r.paidCents)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">
                      {totalCents > 0 ? pct(r.paidCents / totalCents) : "—"}
                    </td>
                  </tr>
                ));
              })()
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-40 w-full animate-pulse rounded-lg bg-white/[0.03]" />;
}

/** Gráfico de linha simples (SVG), sem dependências externas. */
/** Número da base de usuários. `undefined` = ainda carregando. */
/**
 * Barra de progresso da meta do mês.
 *
 * O valor da meta vem de Configurações → Pagamentos e é UM só da operação —
 * não existe meta por modelo. Por isso o realizado que ela compara também é da
 * operação inteira, e a barra não muda ao filtrar por modelo.
 */
function BarraMeta({ feitoCents, metaCents }: { feitoCents: number; metaCents: number }) {
  const pctFeito = Math.round((feitoCents / metaCents) * 100);
  const bateu = feitoCents >= metaCents;
  // Sem margem própria: quem espaça é o contêiner que a ordena junto do
  // gráfico (`gap-3`), e margem aqui somaria com ele.
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">meta do mês</p>
        <p className={`font-display text-sm font-semibold ${bateu ? "text-emerald-400" : "text-zinc-300"}`}>
          {pctFeito}%
        </p>
      </div>
      <p className="mt-1 font-display text-xl font-semibold text-white">
        {brl(feitoCents)} <span className="text-sm font-normal text-zinc-500">de {brl(metaCents)}</span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full ${bateu ? "bg-emerald-400" : "bg-emerald-500/70"}`}
          style={{ width: `${Math.min(100, Math.max(0, pctFeito))}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-600">
        {bateu ? "meta batida 🎉" : `faltam ${brl(metaCents - feitoCents)}`}
        <span className="text-zinc-700"> · conta o pago do mês, todos os modelos</span>
      </p>
    </div>
  );
}

/**
 * Curva de vendas por faixa (dia da semana ou hora do dia).
 *
 * Mostra TODAS as faixas, inclusive as zeradas, em ordem cronológica: a
 * pergunta que este card responde é a forma da curva — de que horas o público
 * compra, e de que horas ele NÃO compra. Um top-5 por faturamento escondia as
 * duas pontas (a madrugada some, e domingo/segunda também).
 *
 * A barra é proporcional ao faturamento da maior faixa; é ela que faz 24 linhas
 * de número virarem curva legível de relance.
 */
function RankingCard({ title, rows }: { title: string; rows?: QuandoRow[] }) {
  const [ordem, setOrdem] = useState<CurvaOrdem>("cron");
  const max = rows ? Math.max(0, ...rows.map((r) => r.cents)) : 0;
  const semVenda = rows ? rows.every((r) => r.count === 0) : false;
  // A barra continua proporcional ao MAIOR valor do conjunto, não à ordem —
  // reordenar não pode mudar o tamanho das barras.
  const ordenadas = rows ? ordenarFaixas(rows, ordem, (r) => r) : undefined;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{title}</p>
        {rows && <CurvaSort value={ordem} onChange={setOrdem} />}
      </div>
      {!ordenadas ? (
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-white/5" />
          ))}
        </div>
      ) : semVenda ? (
        <p className="mt-3 text-xs text-zinc-600">Nenhuma venda no período.</p>
      ) : (
        <div
          className="mt-3 space-y-1 overflow-y-auto pr-1"
          style={{ height: ALTURA_LISTA }}
        >
          {ordenadas.map((r) => (
            <div
              key={r.key}
              className="relative flex flex-col justify-center overflow-hidden rounded-md px-2"
              style={{ height: FAIXA_ALTURA }}
            >
              {/* Barra ao fundo: some por completo na faixa sem venda, para o
                  vazio ficar visualmente óbvio. */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-md bg-emerald-500/[0.12]"
                style={{ width: max > 0 ? `${(r.cents / max) * 100}%` : "0%" }}
              />
              <div className="relative flex items-baseline justify-between gap-3 text-sm">
                <span className={r.count > 0 ? "text-zinc-200" : "text-zinc-600"}>{r.label}</span>
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-zinc-500">
                    {r.count} {r.count === 1 ? "venda" : "vendas"}
                  </span>
                  <span
                    className={`font-display font-semibold ${
                      r.count > 0 ? "text-emerald-400" : "text-zinc-700"
                    }`}
                  >
                    {brl(r.cents)}
                  </span>
                </span>
              </div>
              {r.count > 0 && (
                <p className="relative mt-0.5 font-mono text-[10px] text-zinc-600">
                  média{" "}
                  {r.avgCount !== null
                    ? `${r.avgCount.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${
                        r.avgCount === 1 ? "venda" : "vendas"
                      }/dia`
                    : "—"}
                  {" · "}
                  {r.avgCents !== null ? `${brl(r.avgCents)}/dia` : "—"}
                  {/* O ticket é informação secundária: no celular a linha não
                      comporta os três números e quebrava feio. */}
                  <span className="hidden sm:inline">
                    {" · ticket "}
                    {r.avgTicketCents !== null ? brl(r.avgTicketCents) : "—"}
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RevenueChart({ series }: { series: { day: string; cents: number }[] }) {
  // Ponto sob o cursor/dedo. Fica antes do early-return porque hook não pode
  // ficar depois de um return condicional.
  const [active, setActive] = useState<number | null>(null);

  // LARGURA REAL do card, medida fora da faixa rolável (que é quem tem a
  // largura "de mentira" — ela estica para caber o conteúdo). Sem isto o
  // viewBox usava um valor fixo (600) que quase nunca batia com o que o SVG
  // de fato ocupava na tela — um período curto num card largo, ou muitos
  // dias na faixa rolável, esticava só o eixo X (`preserveAspectRatio="none"`
  // exige os dois batendo) e os pontos saíam ovais em vez de redondos.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [larguraCard, setLarguraCard] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const medir = () => setLarguraCard(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (series.length === 0) {
    return <div className="grid h-40 place-items-center text-xs text-zinc-600">sem dados no período</div>;
  }
  // Mesma conta do `minWidth` que a faixa rolável já aplicava: nunca mais
  // estreito que 38px por dia (senão os rótulos colam uns nos outros), e
  // nunca mais estreito que o card (período curto continua preenchendo o
  // card como sempre preencheu). É exatamente a largura que o navegador vai
  // desenhar — por isso o viewBox pode copiá-la e não há mais o que esticar.
  const larguraMinima = Math.max(280, series.length * 38);
  const W = Math.max(larguraMinima, larguraCard);
  const H = 160;
  const PAD = 8;
  const max = Math.max(1, ...series.map((s) => s.cents));
  const stepX = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
  const points = series.map((s, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - (s.cents / max) * (H - PAD * 2);
    return { x, y };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${H - PAD} L${points[0].x.toFixed(1)},${H - PAD} Z`;
  const total = series.reduce((n, s) => n + s.cents, 0);
  // Marcas horizontais leves — os VALORES se adaptam a cada período (não são
  // fixos): num dia fraco elas caem em 50/100/150/200, num dia forte em
  // 5.000/10.000/... — sempre a mesma escala usada pra plotar os pontos.
  const gridTicks = niceTicks(max);

  return (
    <div ref={wrapRef}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">
          {series[0].day} – {series[series.length - 1].day}
        </span>
        <span className="font-display text-sm font-semibold text-emerald-400">{brl(total)}</span>
      </div>
      {/* Gráfico + datas rolam JUNTOS: com 30 dias os rótulos não caberiam num
          celular, então garantimos uma largura mínima por dia e deixamos rolar.
          A faixa põe o degradê nas pontas: rolar já rolava, mas nada dizia que
          havia mais dias fora da tela. */}
      <FaixaRolavel className="mt-2" ariaLabel="Faturamento por dia">
      <div style={{ minWidth: `${W}px` }}>
      {/* `relative` para ancorar a camada de interação e o balão do valor. */}
      <div className="relative" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Marcas horizontais — atrás de tudo, bem leves (só de referência). */}
        {gridTicks.map((t) => (
          <line
            key={t}
            x1={PAD}
            y1={H - PAD - (t / max) * (H - PAD * 2)}
            x2={W - PAD}
            y2={H - PAD - (t / max) * (H - PAD * 2)}
            stroke="#ffffff"
            strokeOpacity={0.06}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={areaPath} fill="url(#revenueFill)" stroke="none" />
        <path d={linePath} fill="none" stroke="#34d399" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {/* Guia vertical no ponto ativo. */}
        {active !== null && (
          <line
            x1={points[active].x}
            y1={PAD}
            x2={points[active].x}
            y2={H - PAD}
            stroke="#34d399"
            strokeOpacity={0.35}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={active === i ? 5 : 2.5}
            fill="#34d399"
            stroke={active === i ? "#052e1f" : "none"}
            strokeWidth={active === i ? 2 : 0}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* Camada de interação: uma faixa invisível por ponto, cobrindo toda a
          altura. Passar o mouse ou tocar mostra o valor daquele dia. Faixas em
          vez de mirar no pontinho: no toque, acertar um círculo de 5px é
          impossível. */}
      <div className="absolute inset-0 flex">
        {series.map((s, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${s.day}: ${brl(s.cents)}`}
            className="h-full flex-1 cursor-default"
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onTouchStart={() => setActive(i)}
          />
        ))}
      </div>

      {/* Balão com o valor do ponto ativo. Fica ACIMA do ponto, mas vira para
          BAIXO quando o ponto é alto: a área do gráfico rola na horizontal e
          isso faz o navegador cortar tudo que passa do topo — nos dias de pico
          o balão simplesmente sumia. Nas pontas ele encosta na borda lateral em
          vez de vazar para fora. */}
      {active !== null && (() => {
        const abaixo = points[active].y < H * 0.4;
        const dx = active === 0 ? "0" : active === series.length - 1 ? "-100%" : "-50%";
        return (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-emerald-500/30 bg-ink-800/95 px-2.5 py-1.5 text-center shadow-xl backdrop-blur-sm"
          style={{
            left: `${((PAD + active * stepX) / W) * 100}%`,
            top: `${(points[active].y / H) * 100}%`,
            transform: `translate(${dx}, ${abaixo ? "8px" : "calc(-100% - 8px)"})`,
          }}
        >
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {series[active].day}
          </div>
          <div className="font-display text-sm font-semibold text-emerald-400">
            {brl(series[active].cents)}
          </div>
        </div>
        );
      })()}
      </div>
      {/* TODAS as datas do período (antes só apareciam primeira, meio e última).
          Cada rótulo fica alinhado ao seu ponto no gráfico. */}
      <div
        className="mt-1 grid text-center text-[10px] text-zinc-600"
        style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }}
      >
        {series.map((s, i) => (
          <span key={i} className="truncate">{s.day}</span>
        ))}
      </div>
      </div>
      </FaixaRolavel>
    </div>
  );
}

function ConversionCard({
  title,
  subtitle,
  value,
  rows,
}: {
  title: string;
  subtitle: string;
  value: string;
  rows: [string, string][];
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{title}</p>
      <p className="mt-0.5 text-[11px] text-zinc-600">{subtitle}</p>
      <p className="mt-2 font-display text-xl font-semibold text-emerald-400">{value}</p>
      <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-2">
        {rows.length === 0 ? (
          <span className="inline-block h-3 w-16 animate-pulse rounded bg-white/5" />
        ) : (
          rows.map(([label, val]) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">{label}</span>
              <span className="font-mono text-zinc-300">{val}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
