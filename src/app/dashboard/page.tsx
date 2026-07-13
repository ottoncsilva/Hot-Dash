"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Profile } from "@/lib/types";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { Overview, PeriodStats, Transaction } from "@/lib/transactions";
import { IconSettings, IconSparkle, IconChevronRight } from "@/components/icons";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "week", label: "Últimos 7 dias" },
  { key: "month", label: "Este mês" },
  { key: "total", label: "Total" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

const METHOD_COLORS: Record<string, string> = {
  Pix: "#3b82f6",
  Cartão: "#38bdf8",
  Boleto: "#f59e0b",
  Outros: "#ef4444",
};

type Data = {
  providers: PaymentSettingsPublic;
  overview: Overview;
  transactions: Transaction[];
  balanceCents: number | null;
  finance: { adSpendCents: number; taxRatePercent: number };
};

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 5) return "agora mesmo";
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} minuto${m > 1 ? "s" : ""}`;
  const h = Math.floor(m / 60);
  return `há ${h} hora${h > 1 ? "s" : ""}`;
}

export default function DashboardHome() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string>("");
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const seenRef = useRef<number | null>(null);
  const [newSale, setNewSale] = useState<{ amountCents: number; customer?: string } | null>(null);

  async function load(silent = false) {
    try {
      const qs = profileId ? `?profileId=${profileId}` : "";
      const d = await apiGet<Data>(`/api/payments/overview${qs}`);
      const totalPaid = d.overview.total.paidCount;
      if (seenRef.current !== null && totalPaid > seenRef.current) {
        const newest = d.transactions.find((t) => t.status === "paid");
        if (newest) setNewSale({ amountCents: newest.amountCents, customer: newest.customer });
      }
      seenRef.current = totalPaid;
      setData(d);
      setLastFetch(Date.now());
      if (!silent) setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Falha.");
    }
  }

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => setProfiles(d.profiles))
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const profileCount = profiles?.length ?? null;
  const accountCount = profiles?.reduce((n, p) => n + p.accounts.length, 0) ?? null;

  const anyProvider = data?.providers.syncpay.enabled;
  const stats: PeriodStats | undefined = data?.overview[period];
  const finance = data?.finance;

  const derived = useMemo(() => {
    if (!stats || !finance) return null;
    const faturamento = stats.paidCents;
    const gastos = finance.adSpendCents;
    const lucro = faturamento - gastos;
    const roas = gastos > 0 ? faturamento / gastos : null;
    const roi = gastos > 0 ? lucro / gastos : null;
    const margem = faturamento > 0 ? lucro / faturamento : null;
    const imposto = Math.round((faturamento * finance.taxRatePercent) / 100);
    const base = stats.paidCents + stats.refundedCents + stats.chargebackCents;
    const reembolsoPct = base > 0 ? stats.refundedCents / base : 0;
    const chargebackPct = base > 0 ? stats.chargebackCents / base : 0;
    return { faturamento, gastos, lucro, roas, roi, margem, imposto, reembolsoPct, chargebackPct };
  }, [stats, finance]);

  const donutTotal = stats?.methodBreakdown.reduce((n, m) => n + m.count, 0) || 0;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="eyebrow">visão geral</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-500">
        Resumo financeiro e operacional das suas personagens.
      </p>

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
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Resumo: filtros + atualizar */}
      <div className="mt-6 card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-display text-base font-semibold text-white">Resumo</p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              {lastFetch ? `atualizado ${timeAgo(lastFetch)}` : "carregando..."}
            </span>
            <button onClick={() => load()} className="btn-primary px-3 py-1.5 text-xs">
              Atualizar
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="eyebrow mb-1.5 block">Período</label>
            <select
              className="input"
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodKey)}
            >
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
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
        </div>
      </div>

      {!anyProvider && data && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-400">Nenhum provedor conectado ainda.</p>
          <Link href="/dashboard/settings#pagamentos" className="btn-ghost text-xs">
            <IconSettings size={14} /> Configurar
          </Link>
        </div>
      )}

      {/* Grade de métricas no modelo do painel financeiro */}
      <div className="mt-6 grid gap-3 lg:grid-cols-4">
        <MetricCard label="Faturamento Líquido" value={stats ? brl(stats.paidCents) : null} />
        <MetricCard label="Gastos com anúncios" value={derived ? brl(derived.gastos) : null} muted />
        <MetricCard
          label="ROAS"
          value={derived ? (derived.roas !== null ? derived.roas.toFixed(2) : "—") : null}
          accent
        />
        <MetricCard
          label="Lucro"
          value={derived ? brl(derived.lucro) : null}
          accent
          negative={derived ? derived.lucro < 0 : false}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-4">
        <div className="card p-4 lg:row-span-3">
          <p className="eyebrow">vendas por pagamento</p>
          {stats && donutTotal > 0 ? (
            <PaymentDonut breakdown={stats.methodBreakdown} total={donutTotal} />
          ) : (
            <div className="mt-4 grid h-40 place-items-center text-xs text-zinc-600">
              sem vendas pagas no período
            </div>
          )}
        </div>

        <MetricCard label="Vendas Pendentes" value={stats ? brl(stats.pendingCents) : null} />
        <MetricCard
          label="ROI"
          value={derived ? (derived.roi !== null ? pct(derived.roi) : "—") : null}
          accent
        />
        <MetricCard
          label="Margem de Lucro"
          value={derived ? (derived.margem !== null ? pct(derived.margem) : "—") : null}
          accent
        />

        <MetricCard label="Vendas Reembolsadas" value={stats ? brl(stats.refundedCents) : null} />
        <MetricCard label="Reembolso" value={derived ? pct(derived.reembolsoPct) : null} accent />
        <MetricCard label="ARPU" value={stats ? brl(stats.avgTicketCents) : null} />

        <MetricCard label="Imposto" value={derived ? brl(derived.imposto) : null} muted />
        <MetricCard label="Chargeback" value={derived ? pct(derived.chargebackPct) : null} accent />
        <MetricCard
          label="Saldo no provedor"
          value={data ? (data.balanceCents !== null ? brl(data.balanceCents) : "—") : null}
        />
      </div>

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

function PaymentDonut({
  breakdown,
  total,
}: {
  breakdown: { method: string; count: number; cents: number }[];
  total: number;
}) {
  let acc = 0;
  const stops: string[] = [];
  const ordered = [...breakdown].sort((a, b) => b.count - a.count);
  for (const m of ordered) {
    const start = (acc / total) * 360;
    acc += m.count;
    const end = (acc / total) * 360;
    const color = METHOD_COLORS[m.method] || "#a1a1aa";
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  return (
    <div className="mt-4 flex flex-col items-center">
      <div
        className="relative grid h-40 w-40 place-items-center rounded-full"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      >
        <div className="grid h-28 w-28 place-items-center rounded-full bg-ink-900">
          <p className="font-display text-xl font-semibold text-white">{total}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">total</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {ordered.map((m) => (
          <span key={m.method} className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: METHOD_COLORS[m.method] || "#a1a1aa" }}
            />
            {m.method} · {Math.round((m.count / total) * 100)}%
          </span>
        ))}
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
