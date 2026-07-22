"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconLock } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import { BackToSettings, ConnectionBadge } from "../_shared";

type LastPaid = { at: number; amountCents: number; customer?: string } | null;

export default function PaymentSettingsPage() {
  const [cfg, setCfg] = useState<PaymentSettingsPublic | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncClientId, setSyncClientId] = useState("");
  const [syncClientSecret, setSyncClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastPaid, setLastPaid] = useState<LastPaid>(null);

  function loadDiagnostics() {
    apiGet<{ settings: PaymentSettingsPublic; lastPaid: LastPaid }>("/api/payments/settings")
      .then((d) => {
        setCfg(d.settings);
        setSyncEnabled(d.settings.syncpay.enabled);
        setSyncClientId(d.settings.syncpay.clientId);
        setLastPaid(d.lastPaid);
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
    loadDiagnostics();
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
            “Disparar para todos os produtos” ativo. Esse cadastro é{" "}
            <b>por conta, não por cobrança</b>: uma vez colado, a SyncPay avisa o
            Hot-Dash de <b>toda</b> venda paga — não importa quem gerou o PIX
            (bot do Telegram, checkout externo, o que for). É isso que alimenta
            o Dashboard, e continua funcionando mesmo antes (ou independente)
            de o bot de vendas estar rodando pelo Hot-Dash.
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

          {/* Diagnóstico: prova se o webhook está de fato chegando */}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Última venda recebida via webhook
              </p>
              {lastPaid ? (
                <p className="mt-0.5 text-xs text-emerald-300">
                  {(lastPaid.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  {lastPaid.customer ? ` · ${lastPaid.customer}` : ""} ·{" "}
                  {new Date(lastPaid.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-amber-300">
                  Nenhuma venda registrada ainda. Se você já tem vendas pagas na SyncPay, confira
                  se colou a URL acima no painel da SyncPay.
                </p>
              )}
            </div>
            <button type="button" onClick={loadDiagnostics} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">
              Verificar agora
            </button>
          </div>
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

    </div>
  );
}
