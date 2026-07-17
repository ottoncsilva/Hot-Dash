"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconLock } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import { BackToSettings, ConnectionBadge } from "../_shared";

export default function PaymentSettingsPage() {
  const [cfg, setCfg] = useState<PaymentSettingsPublic | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncClientId, setSyncClientId] = useState("");
  const [syncClientSecret, setSyncClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
    apiGet<{ settings: PaymentSettingsPublic }>("/api/payments/settings")
      .then((d) => {
        setCfg(d.settings);
        setSyncEnabled(d.settings.syncpay.enabled);
        setSyncClientId(d.settings.syncpay.clientId);
      })
      .catch(() => {});
  }, []);

  const webhookUrl = cfg?.syncpay.webhookToken
    ? `${origin}/api/webhooks/syncpay?token=${cfg.syncpay.webhookToken}`
    : "";

  async function copyWebhook() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível — o usuário pode copiar manualmente */
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const { settings } = await apiSend<{ settings: PaymentSettingsPublic }>(
        "/api/payments/settings",
        "PATCH",
        {
          syncpay: {
            enabled: syncEnabled,
            clientId: syncClientId,
            ...(syncClientSecret ? { clientSecret: syncClientSecret } : {}),
          },
        },
      );
      setCfg(settings);
      setSyncClientSecret("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackToSettings />
      <p className="eyebrow mt-4">pagamentos</p>
      <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Provedores</h1>
      <p className="mt-2 text-sm text-zinc-500">
        As chaves são guardadas criptografadas (AES-256) no servidor.
      </p>

      {/* SyncPay */}
      <div className="mt-4 card p-4">
        <label className="flex items-center justify-between">
          <span className="font-medium text-white">SyncPay</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-white"
            checked={syncEnabled}
            onChange={(e) => setSyncEnabled(e.target.checked)}
          />
        </label>
        <label className="eyebrow mb-1.5 mt-3 block">Client ID</label>
        <input
          className="input font-mono"
          placeholder="ex.: 11111111-2222-3333-4444-555555555555"
          value={syncClientId}
          onChange={(e) => setSyncClientId(e.target.value)}
        />
        <label className="eyebrow mb-1.5 mt-3 block">Client Secret</label>
        <input
          className="input font-mono"
          type="password"
          placeholder={
            cfg?.syncpay.hasSecret ? "•••••••• (em branco = manter)" : "cole o client secret"
          }
          value={syncClientSecret}
          onChange={(e) => setSyncClientSecret(e.target.value)}
        />
        <p className="mt-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          <IconLock size={12} /> obtenha em app.syncpayments.com.br → developer api
        </p>
        <ConnectionBadge
          testUrl="/api/payments/settings/test"
          buildBody={() => ({
            clientId: syncClientId || undefined,
            clientSecret: syncClientSecret || undefined,
          })}
        />

        {/* Webhook de recebimento — alimenta o Financeiro e o Dashboard */}
        <div className="mt-4 rounded-lg border border-white/10 bg-ink-900 p-3">
          <p className="eyebrow">webhook de recebimento</p>
          <p className="mt-1.5 text-xs text-zinc-500">
            Cole esta URL na SyncPay em <b>Developer → API → Webhooks</b> (campo
            “Url alvo do disparo”), evento <b>Recebimento — Cash in</b>, com
            “Disparar para todos os produtos” ativo. É isso que confirma as
            vendas e alimenta o Financeiro e o Dashboard.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              readOnly
              value={webhookUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="input flex-1 font-mono text-xs"
              placeholder="carregando…"
            />
            <button
              type="button"
              onClick={copyWebhook}
              disabled={!webhookUrl}
              className="btn-ghost shrink-0 px-3 py-2 text-xs"
            >
              {copied ? "Copiado ✓" : "Copiar"}
            </button>
          </div>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            o token autentica o webhook — mantenha esta URL privada
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Salvando..." : "Salvar pagamentos"}
        </button>
        {saved && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            salvo ✓
          </span>
        )}
      </div>

      <FinanceSettingsCard />
    </div>
  );
}

// ---- Financeiro manual (gastos com anúncios + imposto) ----
function FinanceSettingsCard() {
  const [adSpend, setAdSpend] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ finance: { adSpendCents: number; taxRatePercent: number } }>(
      "/api/payments/finance-settings",
    )
      .then((d) => {
        setAdSpend((d.finance.adSpendCents / 100).toFixed(2).replace(".", ","));
        setTaxRate(String(d.finance.taxRatePercent));
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await apiSend("/api/payments/finance-settings", "PATCH", {
        adSpendCents: Math.round(Number(adSpend.replace(",", ".")) * 100) || 0,
        taxRatePercent: Number(taxRate) || 0,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 card p-4">
      <p className="font-medium text-white">Financeiro (manual)</p>
      <p className="mt-1 text-xs text-zinc-500">
        Sem integração com plataformas de anúncio: informe aqui os gastos do
        período em análise e a alíquota de imposto para o painel calcular
        ROAS, ROI, Lucro, Margem e Imposto no Dashboard Financeiro.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="eyebrow mb-1.5 block">Gastos com anúncios (R$)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            value={adSpend}
            onChange={(e) => setAdSpend(e.target.value)}
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Alíquota de imposto (%)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-ghost">
          {saving ? "Salvando..." : "Salvar financeiro"}
        </button>
        {saved && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            salvo ✓
          </span>
        )}
      </div>
    </div>
  );
}
