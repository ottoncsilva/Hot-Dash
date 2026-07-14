"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import { IconPlus, IconSettings, IconPayments, IconCopy } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { Transaction, Overview } from "@/lib/transactions";
import type { Profile } from "@/lib/types";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const STATUS_LABEL: Record<string, string> = {
  paid: "pago",
  pending: "gerado",
  failed: "falhou",
  refunded: "estornado",
  chargeback: "chargeback",
};

type PaidFilter = "all" | "paid" | "unpaid";

type Data = {
  providers: PaymentSettingsPublic;
  overview: Overview;
  transactions: Transaction[];
  balanceCents: number | null;
};

export default function PaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");

  async function load() {
    try {
      setData(await apiGet<Data>("/api/payments/overview"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha.");
    }
  }
  useEffect(() => {
    load();
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((r) => setProfiles(r.profiles))
      .catch(() => {});
  }, []);

  const anyProvider = data?.providers.syncpay.enabled;

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    if (paidFilter === "all") return data.transactions;
    if (paidFilter === "paid") return data.transactions.filter((t) => t.status === "paid");
    return data.transactions.filter((t) => t.status !== "paid");
  }, [data, paidFilter]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">financeiro</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Cobranças PIX geradas e status de pagamento.
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

      {!anyProvider && data && (
        <div className="mt-5 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-400">Nenhum provedor conectado ainda.</p>
          <Link href="/dashboard/settings/pagamentos" className="btn-ghost text-xs">
            <IconSettings size={14} /> Configurar
          </Link>
        </div>
      )}

      {/* Resumo simples: faturamento hoje / semana / mês */}
      <div className="mt-5 flex flex-wrap gap-3">
        <SummaryChip label="Hoje" value={data ? brl(data.overview.today.paidCents) : null} />
        <SummaryChip label="Semana" value={data ? brl(data.overview.week.paidCents) : null} />
        <SummaryChip label="Mês" value={data ? brl(data.overview.month.paidCents) : null} />
      </div>

      {/* Lista de PIX gerados */}
      <div className="mt-8 flex items-center justify-between">
        <p className="eyebrow">pix gerados</p>
        <select
          className="input w-auto py-1.5 text-xs"
          value={paidFilter}
          onChange={(e) => setPaidFilter(e.target.value as PaidFilter)}
        >
          <option value="all">Pagos: todos</option>
          <option value="paid">Pagos: sim</option>
          <option value="unpaid">Pagos: não</option>
        </select>
      </div>

      <div className="mt-3 card overflow-hidden">
        {!data ? (
          <div className="h-32 animate-pulse" />
        ) : filteredTransactions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 text-zinc-500">
              <IconPayments size={20} />
            </div>
            <p className="text-sm text-zinc-500">Nenhum PIX encontrado.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {filteredTransactions.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <PaidCheck paid={t.status === "paid"} />
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
          profiles={profiles}
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

function SummaryChip({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-4 py-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="font-display text-sm font-semibold text-white">
        {value ?? <span className="inline-block h-4 w-14 animate-pulse rounded bg-white/5" />}
      </span>
    </div>
  );
}

/** Check verde quando pago; ícone neutro de "gerado/aguardando" caso contrário. */
function PaidCheck({ paid }: { paid: boolean }) {
  if (paid) {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4 10-10"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/15 text-zinc-500">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} />
        <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </span>
  );
}

function ChargeForm({
  profiles,
  onClose,
  onDone,
}: {
  profiles: Profile[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [profileId, setProfileId] = useState("");
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
          profileId: profileId || undefined,
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
          <label className="eyebrow mb-1.5 block">Modelo</label>
          <select
            className="input"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            <option value="">Nenhum</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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
