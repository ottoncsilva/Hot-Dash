"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import { IconPlus, IconSettings, IconPayments, IconCopy } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { Transaction, Overview } from "@/lib/transactions";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const STATUS_LABEL: Record<string, string> = {
  paid: "pago",
  pending: "pendente",
  failed: "falhou",
  refunded: "estornado",
};

type Data = {
  providers: PaymentSettingsPublic;
  overview: Overview;
  transactions: Transaction[];
  balanceCents: number | null;
};

export default function PaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  const [newSale, setNewSale] = useState<{ amountCents: number; customer?: string } | null>(null);
  const seenRef = useRef<{ count: number; last: number | null } | null>(null);

  async function load(silent = false) {
    try {
      const d = await apiGet<Data>("/api/payments/overview");
      // Detecta nova venda paga desde a última leitura (alerta).
      const prev = seenRef.current;
      if (prev && (d.overview.paidCount > prev.count)) {
        const newest = d.transactions.find((t) => t.status === "paid");
        if (newest) setNewSale({ amountCents: newest.amountCents, customer: newest.customer });
      }
      seenRef.current = { count: d.overview.paidCount, last: d.overview.lastSaleAt };
      setData(d);
      if (!silent) setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Falha.");
    }
  }

  useEffect(() => {
    load();
    // Poll para alertar novas vendas (o webhook confirma o pagamento no banco).
    const t = setInterval(() => load(true), 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anyProvider =
    data?.providers.syncpay.enabled || data?.providers.stripe.enabled;
  const ov = data?.overview;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">financeiro</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Financeiro
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Resumo de vendas e receita — atualiza sozinho quando entra uma venda.
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

      {/* Alerta de nova venda */}
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

      {/* Venda do dia — destaque */}
      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-1">
          <p className="eyebrow">vendas de hoje</p>
          <p className="mt-2 font-display text-3xl font-semibold text-white">
            {ov ? brl(ov.todayPaidCents) : <Skel />}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {ov ? `${ov.todayCount} venda(s) paga(s) hoje` : "—"}
          </p>
        </div>
        <div className="card p-5 lg:col-span-2">
          <p className="eyebrow">receita (últimos 14 dias)</p>
          <div className="mt-3">{ov ? <MiniChart series={ov.dailySeries} /> : <Skel wide />}</div>
        </div>
      </div>

      {/* Métricas */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Recebido (semana)" value={ov ? brl(ov.weekPaidCents) : null} />
        <Metric label="Recebido (mês)" value={ov ? brl(ov.monthPaidCents) : null} />
        <Metric label="Recebido (total)" value={ov ? brl(ov.totalPaidCents) : null} />
        <Metric
          label="Saldo no provedor"
          value={data ? (data.balanceCents !== null ? brl(data.balanceCents) : "—") : null}
        />
        <Metric label="Ticket médio" value={ov ? brl(ov.avgTicketCents) : null} />
        <Metric label="Vendas pagas" value={ov ? String(ov.paidCount) : null} />
        <Metric
          label="Pendentes"
          value={ov ? `${ov.pendingCount} · ${brl(ov.pendingCents)}` : null}
        />
        <Metric
          label="Última venda"
          value={
            ov
              ? ov.lastSaleAt
                ? new Date(ov.lastSaleAt).toLocaleDateString("pt-BR")
                : "—"
              : null
          }
        />
      </div>

      {/* Provedores */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <ProviderCard
          name="SyncPay"
          connected={
            !!data?.providers.syncpay.enabled && !!data?.providers.syncpay.hasSecret
          }
          enabled={!!data?.providers.syncpay.enabled}
        />
        <ProviderCard
          name="Stripe"
          connected={
            !!data?.providers.stripe.enabled && !!data?.providers.stripe.hasSecret
          }
          enabled={!!data?.providers.stripe.enabled}
        />
      </div>

      {!anyProvider && data && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-400">Nenhum provedor conectado ainda.</p>
          <Link href="/dashboard/settings#pagamentos" className="btn-ghost text-xs">
            <IconSettings size={14} /> Configurar
          </Link>
        </div>
      )}

      {/* Transações */}
      <p className="eyebrow mt-10">transações</p>
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

function Skel({ wide }: { wide?: boolean }) {
  return (
    <span
      className={`inline-block h-8 ${wide ? "w-full" : "w-24"} animate-pulse rounded bg-white/5`}
    />
  );
}

function MiniChart({ series }: { series: { day: string; cents: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.cents));
  return (
    <div className="flex h-24 items-end gap-1">
      {series.map((s, i) => (
        <div key={i} className="group relative flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-white/70 transition-all group-hover:bg-white"
            style={{ height: `${Math.max(2, (s.cents / max) * 100)}%` }}
            title={`${s.day}: ${brl(s.cents)}`}
          />
          {i % 2 === 0 && (
            <span className="font-mono text-[8px] text-zinc-600">{s.day.slice(0, 2)}</span>
          )}
        </div>
      ))}
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

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold text-white">
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
