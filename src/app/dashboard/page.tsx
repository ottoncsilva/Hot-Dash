"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Profile } from "@/lib/types";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { PeriodStats } from "@/lib/transactions";
import { IconSettings, IconSparkle, IconChevronRight } from "@/components/icons";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

// ---- Painel do Bot de Vendas (estilo BobzBot/ApexVips) ----
const BOT_PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "last7", label: "Últimos 7 dias" },
  { key: "last30", label: "Últimos 30 dias" },
  { key: "all", label: "Máximo" },
] as const;
type BotPeriodKey = (typeof BOT_PERIODS)[number]["key"];

type BotOverviewData = {
  period: BotPeriodKey;
  stats: PeriodStats;
  funnel: {
    totalStarts: number;
    pixGenerated: number;
    pixPaid: number;
    userConversion: number | null;
    paymentConversion: number | null;
  };
  topPlans: { planId: string; name: string; cents: number; count: number }[];
  byProfile: { profileId: string; profileName: string; botActive: boolean | null; paidCents: number; paidCount: number }[];
  series: { day: string; cents: number }[];
  netProfitCents: number;
};

export default function DashboardHome() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [providers, setProviders] = useState<PaymentSettingsPublic | null>(null);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string>("");
  const seenPaidRef = useRef<number | null>(null);
  const [newSale, setNewSale] = useState<{ amountCents: number; customer?: string } | null>(null);

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => setProfiles(d.profiles))
      .catch(() => setProfiles([]));
    apiGet<{ settings: PaymentSettingsPublic }>("/api/payments/settings")
      .then((d) => setProviders(d.settings))
      .catch((e) => setError(e instanceof Error ? e.message : "Falha ao carregar."));
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
  }, []);

  // Detecta venda nova (via webhook da SyncPay) para o toast "🎉 Nova venda
  // confirmada" — independe do painel abaixo e do bot estar rodando ou não.
  useEffect(() => {
    async function checkNewSale() {
      try {
        const d = await apiGet<{ stats: PeriodStats }>("/api/dashboard/bot-overview?period=today");
        const paid = d.stats.paidCount;
        if (seenPaidRef.current !== null && paid > seenPaidRef.current) {
          setNewSale({ amountCents: d.stats.paidCents });
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

  const profileCount = profiles?.length ?? null;
  const accountCount = profiles?.reduce((n, p) => n + p.accounts.length, 0) ?? null;
  const anyProvider = providers?.syncpay.enabled;

  return (
    <div className="w-full">
      <p className="eyebrow">visão geral</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-500">
        Resumo financeiro e operacional das suas personagens.
      </p>

      {profiles !== null && aiConnected !== null && providers !== null && (
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
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {providers !== null && !anyProvider && (
        <div className="mt-5 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-400">Nenhum provedor conectado ainda.</p>
          <Link href="/dashboard/settings/pagamentos" className="btn-ghost text-xs">
            <IconSettings size={14} /> Configurar
          </Link>
        </div>
      )}

      {/* Filtro de perfil, compartilhado com o painel abaixo */}
      <div className="mt-5 max-w-xs">
        <label className="eyebrow mb-1.5 block">Perfil</label>
        <select className="input" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          <option value="">Todos</option>
          {(profiles || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Painel do Bot de Vendas — vendas, funil de conversão e faturamento por modelo */}
      <BotSalesPanel profileId={profileId} profiles={profiles} />

      {/* Operação */}
      <p className="eyebrow mt-10">operação</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Modelos" value={profileCount} />
        <Stat label="Contas sociais" value={accountCount} />
        <ModuleLink
          href="/dashboard/metadata"
          icon={<IconSparkle size={18} />}
          title="Limpar Metadados"
          desc="EXIF, GPS e rastros de IA"
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  muted,
  negative,
}: {
  label: string;
  value: string | null;
  accent?: boolean;
  muted?: boolean;
  negative?: boolean;
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
  // Some quando tudo está configurado.
  if (doneCount === steps.length) return null;

  return (
    <div className="mt-5 rounded-xl border border-white/15 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-base font-semibold text-white">Primeiros passos</p>
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          {doneCount}/{steps.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Complete a configuração para o painel funcionar por inteiro.
      </p>
      <div className="mt-3 space-y-1.5">
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

function ModuleLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="card group flex items-center gap-3 p-4 transition-all hover:border-white/20 hover:bg-white/[0.04]"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300 transition-colors group-hover:text-white">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="truncate text-xs text-zinc-500">{desc}</p>
      </div>
      <span className="text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-300">
        <IconChevronRight size={16} />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Painel do Bot de Vendas — cards, gráfico de faturamento, funil de conversão
// e faturamento por modelo. Espelha o painel do bot de vendas (ex-ApexVips),
// usando os dados reais de transactions/telegram_leads/telegram_subscriptions.
// ---------------------------------------------------------------------------
function BotSalesPanel({ profileId, profiles }: { profileId: string; profiles: Profile[] | null }) {
  const [period, setPeriod] = useState<BotPeriodKey>("last7");
  const [data, setData] = useState<BotOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    const qs = new URLSearchParams({ period });
    if (profileId) qs.set("profileId", profileId);
    apiGet<BotOverviewData>(`/api/dashboard/bot-overview?${qs.toString()}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar o painel.");
      });
    return () => {
      cancelled = true;
    };
  }, [period, profileId]);

  const profileName = (id: string) => profiles?.find((p) => p.id === id)?.name || id;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-base font-semibold text-white">Painel do Bot de Vendas</p>
        <div className="flex flex-wrap gap-1.5">
          {BOT_PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p.key
                  ? "bg-emerald-500 text-black"
                  : "border border-white/10 bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Cards principais */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricCard label="Vendas Aprovadas" value={data ? brl(data.stats.paidCents) : null} accent />
        <MetricCard
          label="Lucro Líquido"
          value={data ? brl(data.netProfitCents) : null}
          accent={data ? data.netProfitCents >= 0 : undefined}
          negative={data ? data.netProfitCents < 0 : false}
        />
        <MetricCard label="Total Starts" value={data ? String(data.funnel.totalStarts) : null} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <MetricCard label="Quantidade de Vendas" value={data ? String(data.stats.paidCount) : null} />
        <MetricCard label="Ticket Médio" value={data ? brl(data.stats.avgTicketCents) : null} />
      </div>

      {/* Faturamento por período */}
      <div className="mt-3 card p-4">
        <p className="eyebrow">faturamento por período</p>
        <div className="mt-3">
          {data ? <RevenueChart series={data.series} /> : <ChartSkeleton />}
        </div>
      </div>

      {/* Conversões do bot */}
      <p className="eyebrow mt-8">conversões do bot</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="card p-4">
          <p className="eyebrow">Códigos de Venda</p>
          <p className="mt-0.5 text-[11px] text-zinc-600">top faturamento</p>
          <div className="mt-3 space-y-2">
            {!data ? (
              <span className="inline-block h-5 w-24 animate-pulse rounded bg-white/5" />
            ) : data.topPlans.length === 0 ? (
              <p className="text-xs text-zinc-600">Sem dados</p>
            ) : (
              data.topPlans.map((p) => (
                <div key={p.planId} className="flex items-center justify-between text-xs">
                  <span className="truncate pr-2 text-zinc-300">{p.name}</span>
                  <span className="shrink-0 font-mono text-zinc-500">{brl(p.cents)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Faturamento por Modelo */}
      <p className="eyebrow mt-8">faturamento por modelo</p>
      <div className="mt-3 card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3 font-medium">Modelo</th>
              <th className="px-4 py-3 font-medium">Plataforma</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Faturamento</th>
              <th className="px-4 py-3 text-right font-medium">% do Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {!data ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-xs text-zinc-600">
                  Carregando...
                </td>
              </tr>
            ) : data.byProfile.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-xs text-zinc-600">
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
                    <td className="px-4 py-3 text-zinc-400">Telegram</td>
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
function RevenueChart({ series }: { series: { day: string; cents: number }[] }) {
  if (series.length === 0) {
    return <div className="grid h-40 place-items-center text-xs text-zinc-600">sem dados no período</div>;
  }
  const W = 600;
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">
          {series[0].day} – {series[series.length - 1].day}
        </span>
        <span className="font-display text-sm font-semibold text-emerald-400">{brl(total)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-40 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#revenueFill)" stroke="none" />
        <path d={linePath} fill="none" stroke="#34d399" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
        <span>{series[0].day}</span>
        {series.length > 2 && <span>{series[Math.floor(series.length / 2)].day}</span>}
        <span>{series[series.length - 1].day}</span>
      </div>
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
