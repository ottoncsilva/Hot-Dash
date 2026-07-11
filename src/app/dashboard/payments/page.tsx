"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import { IconPlus, IconSettings, IconPayments } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { Transaction, Overview } from "@/lib/transactions";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

type Data = {
  providers: PaymentSettingsPublic;
  overview: Overview;
  transactions: Transaction[];
};

export default function PaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);

  async function load() {
    try {
      setData(await apiGet<Data>("/api/payments/overview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha.");
    }
  }
  useEffect(() => {
    load();
  }, []);

  const anyProvider =
    data?.providers.syncpay.enabled || data?.providers.stripe.enabled;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">financeiro</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Pagamentos
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Vendas e receita das suas personagens.
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

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

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
          <p className="text-sm text-zinc-400">
            Nenhum provedor conectado ainda.
          </p>
          <Link
            href="/dashboard/settings#pagamentos"
            className="btn-ghost text-xs"
          >
            <IconSettings size={14} /> Configurar
          </Link>
        </div>
      )}

      {/* Métricas */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Recebido (total)" value={data ? brl(data.overview.totalPaidCents) : null} />
        <Metric label="Recebido (mês)" value={data ? brl(data.overview.monthPaidCents) : null} />
        <Metric label="Vendas pagas" value={data ? String(data.overview.paidCount) : null} />
        <Metric label="Pendentes" value={data ? String(data.overview.pendingCount) : null} />
      </div>

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
            <p className="text-sm text-zinc-500">
              Nenhuma transação ainda.
            </p>
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
                    {t.provider} · {t.method || "—"} ·{" "}
                    {new Date(t.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <p className="font-display font-semibold text-white">
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
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          connected ? "bg-white" : "bg-zinc-700"
        }`}
      />
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold text-white">
        {value ?? (
          <span className="inline-block h-6 w-16 animate-pulse rounded bg-white/5" />
        )}
      </p>
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const paid = status === "paid";
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${
        paid ? "bg-white" : status === "pending" ? "bg-zinc-500" : "bg-red-500"
      }`}
    />
  );
}

function ChargeForm({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [customer, setCustomer] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pix, setPix] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await apiSend<{ pixCode?: string }>(
        "/api/payments/charge",
        "POST",
        {
          amount: Number(amount.replace(",", ".")),
          description,
          customer: customer ? { name: customer } : undefined,
        },
      );
      if (res.pixCode) {
        setPix(res.pixCode);
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
    return (
      <div>
        <p className="eyebrow">pix gerado</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">
          Copia e cola
        </h2>
        <textarea
          readOnly
          className="input mt-3 min-h-[100px] font-mono text-xs"
          value={pix}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
        <button onClick={onDone} className="btn-primary mt-4 w-full">
          Concluir
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <p className="eyebrow">nova</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">
        Nova cobrança PIX
      </h2>
      {err && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      )}
      <div className="mt-4 grid gap-3">
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
          <label className="eyebrow mb-1.5 block">Descrição</label>
          <input
            className="input"
            placeholder="Ex.: Pacote de mídia"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Cliente (opcional)</label>
          <input
            className="input"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost flex-1"
          disabled={saving}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={saving || !amount}
        >
          {saving ? "Gerando..." : "Gerar PIX"}
        </button>
      </div>
    </form>
  );
}
