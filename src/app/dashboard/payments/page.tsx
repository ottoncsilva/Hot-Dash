"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import { IconPlus, IconSettings, IconPayments, IconCopy } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { Transaction, Overview, PeriodStats } from "@/lib/transactions";
import type { Profile } from "@/lib/types";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function pct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

const STATUS_LABEL: Record<string, string> = {
  paid: "pago",
  pending: "pendente",
  failed: "falhou",
  refunded: "estornado",
  chargeback: "chargeback",
};

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

export default function PaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  const [newSale, setNewSale] = useState<{ amountCents: number; customer?: string } | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const seenRef = useRef<number | null>(null);

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
      .catch(() => {});
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

  const anyProvider = data?.providers.syncpay.enabled || data?.providers.stripe.enabled;
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">financeiro</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Resumo de vendas e receita das suas personagens.
          </p>
        </div>
        <button
          onClick={() => setCharging(true)}
          disabled={!anyProvider}
          className="btn-primary"
          title={anyProvider ? "" : "Configure um provedor primeiro"}
        >
          <IconPlus size={16} /> Nova cobrança
        </button>
      </div>

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
              {profiles.map((p) => (
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
        <MetricCard label="Saldo no provedor" value={data ? (data.balanceCents !== null ? brl(data.balanceCents) : "—") : null} />
      </div>

      {/* Provedores */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <ProviderCard
          name="SyncPay"
          connected={!!data?.providers.syncpay.enabled && !!data?.providers.syncpay.hasSecret}
          enabled={!!data?.providers.syncpay.enabled}
        />
        <ProviderCard
          name="Stripe"
          connected={!!data?.providers.stripe.enabled && !!data?.providers.stripe.hasSecret}
          enabled={!!data?.providers.stripe.enabled}
        />
      </div>

      {/* Transações */}
      <p className="eyebrow mt-10">transações recentes</p>
      <div className="mt-3 card overflow-hidden">
        {!data ? (
          <div className="h-32 animate-pulse" />
        ) : data.transactions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 text-zinc-500">
              <IconPayments size={20} />
            </div>
            <p className="text-sm text-zinc-500">Nenhuma transação ainda.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {data.transactions.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <StatusTag status={t.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-200">
                    {t.description || t.customer || "Cobrança"}
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-600">
                    {t.provider} · {STATUS_LABEL[t.status] || t.status} ·{" "}
                    {new Date(t.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <p
                  className={`font-display font-semibold ${
                    t.status === "paid" ? "text-white" : "text-zinc-500"
                  }`}
                >
                  {brl(t.amountCents)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={charging} onClose={() => setCharging(false)}>
        <ChargeForm
          onClose={() => setCharging(false)}
          onDone={() => {
            setCharging(false);
            load();
          }}
        />
      </Modal>
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

function ProviderCard({
  name,
  connected,
  enabled,
}: {
  name: string;
  connected: boolean;
  enabled: boolean;
}) {
  return (
    <div className="card flex items-center justify-between p-4">
      <div>
        <p className="font-medium text-white">{name}</p>
        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-zinc-600">
          {connected ? "conectado" : enabled ? "sem chave" : "desativado"}
        </p>
      </div>
      <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-white" : "bg-zinc-700"}`} />
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

function StatusTag({ status }: { status: string }) {
  const color =
    status === "paid"
      ? "bg-emerald-400"
      : status === "pending"
        ? "bg-zinc-500"
        : status === "refunded"
          ? "bg-amber-400"
          : status === "chargeback"
            ? "bg-purple-400"
            : "bg-red-500";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

function ChargeForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pix, setPix] = useState<{ code?: string; qr?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await apiSend<{ pixCode?: string; qrCodeBase64?: string }>(
        "/api/payments/charge",
        "POST",
        {
          amount: Number(amount.replace(",", ".")),
          description,
          customer: {
            name: name || undefined,
            document: cpf || undefined,
            email: email || undefined,
            phone: phone || undefined,
          },
        },
      );
      if (res.pixCode || res.qrCodeBase64) {
        setPix({ code: res.pixCode, qr: res.qrCodeBase64 });
      } else {
        onDone();
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Falha.");
    } finally {
      setSaving(false);
    }
  }

  if (pix) {
    const qrSrc = pix.qr
      ? pix.qr.startsWith("data:")
        ? pix.qr
        : `data:image/png;base64,${pix.qr}`
      : null;
    return (
      <div>
        <p className="eyebrow">pix gerado</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">Cobrança PIX</h2>
        {qrSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrSrc}
            alt="QR Code PIX"
            className="mx-auto mt-4 h-44 w-44 rounded-lg bg-white p-2"
          />
        )}
        {pix.code && (
          <>
            <label className="eyebrow mb-1.5 mt-4 block">Copia e cola</label>
            <textarea
              readOnly
              className="input min-h-[90px] font-mono text-xs"
              value={pix.code}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(pix.code!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="btn-ghost mt-2 w-full"
            >
              <IconCopy size={15} /> {copied ? "Copiado!" : "Copiar código"}
            </button>
          </>
        )}
        <button onClick={onDone} className="btn-primary mt-4 w-full">
          Concluir
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <p className="eyebrow">nova</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">Nova cobrança PIX</h2>
      {err && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="eyebrow mb-1.5 block">Valor (R$)</label>
            <input
              className="input"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">CPF do cliente</label>
            <input
              className="input"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Descrição</label>
          <input
            className="input"
            placeholder="Ex.: Pacote de mídia"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Cliente (nome)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="eyebrow mb-1.5 block">E-mail</label>
            <input
              className="input"
              type="email"
              placeholder="cliente@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Telefone</label>
            <input
              className="input"
              inputMode="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={saving || !amount}>
          {saving ? "Gerando..." : "Gerar PIX"}
        </button>
      </div>
    </form>
  );
}
