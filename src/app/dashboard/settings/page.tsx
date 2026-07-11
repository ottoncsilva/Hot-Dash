"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import {
  IconChevronUp,
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconLock,
} from "@/components/icons";
import { NAV_ITEMS, normalizeMenu, type MenuEntry } from "@/lib/navItems";
import type { PaymentSettingsPublic } from "@/lib/settings";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">sistema</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
        Configurações
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Personalize o menu e conecte os provedores de pagamento.
      </p>

      <MenuSettings />
      <PaymentSettings />
      <SecurityNote />
    </div>
  );
}

// ---- Menu ----
function MenuSettings() {
  const [menu, setMenu] = useState<MenuEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{ menu: MenuEntry[] }>("/api/settings/menu")
      .then((d) => setMenu(normalizeMenu(d.menu)))
      .catch(() => {});
  }, []);

  function move(index: number, dir: -1 | 1) {
    const next = [...menu];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setMenu(next);
    setSaved(false);
  }
  function toggleHidden(index: number) {
    const next = menu.map((m, i) =>
      i === index ? { ...m, hidden: !m.hidden } : m,
    );
    setMenu(next);
    setSaved(false);
  }
  async function save() {
    setSaving(true);
    try {
      await apiSend("/api/settings/menu", "PATCH", { menu });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-8">
      <p className="eyebrow">menu</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">Ordem do menu</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Reordene ou oculte itens. O Dashboard não pode ser ocultado.
      </p>

      <div className="mt-4 card divide-y divide-white/[0.06]">
        {menu.map((entry, i) => {
          const item = NAV_ITEMS[entry.key];
          const isDashboard = entry.key === "dashboard";
          return (
            <div key={entry.key} className="flex items-center gap-3 px-4 py-3">
              <span className="font-mono text-xs text-zinc-600">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={`flex-1 text-sm ${
                  entry.hidden ? "text-zinc-600 line-through" : "text-zinc-200"
                }`}
              >
                {item.label}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-30"
                  aria-label="Subir"
                >
                  <IconChevronUp size={16} />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === menu.length - 1}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-30"
                  aria-label="Descer"
                >
                  <IconChevronDown size={16} />
                </button>
                <button
                  onClick={() => toggleHidden(i)}
                  disabled={isDashboard}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-20"
                  aria-label="Mostrar/ocultar"
                >
                  {entry.hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Salvando..." : "Salvar menu"}
        </button>
        {saved && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            salvo ✓
          </span>
        )}
      </div>
    </section>
  );
}

// ---- Pagamentos ----
function PaymentSettings() {
  const [cfg, setCfg] = useState<PaymentSettingsPublic | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncKey, setSyncKey] = useState("");
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripeSecret, setStripeSecret] = useState("");
  const [stripePub, setStripePub] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: PaymentSettingsPublic }>("/api/payments/settings")
      .then((d) => {
        setCfg(d.settings);
        setSyncEnabled(d.settings.syncpay.enabled);
        setStripeEnabled(d.settings.stripe.enabled);
        setStripePub(d.settings.stripe.publishableKey);
      })
      .catch(() => {});
  }, []);

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
            ...(syncKey ? { apiKey: syncKey } : {}),
          },
          stripe: {
            enabled: stripeEnabled,
            publishableKey: stripePub,
            ...(stripeSecret ? { secretKey: stripeSecret } : {}),
          },
        },
      );
      setCfg(settings);
      setSyncKey("");
      setStripeSecret("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="pagamentos" className="mt-10 scroll-mt-20">
      <p className="eyebrow">pagamentos</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">
        Provedores
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
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
        <label className="eyebrow mb-1.5 mt-3 block">
          Chave / client_id:client_secret
        </label>
        <input
          className="input font-mono"
          type="password"
          placeholder={
            cfg?.syncpay.hasSecret ? "•••••••• (em branco = manter)" : "cole a chave"
          }
          value={syncKey}
          onChange={(e) => setSyncKey(e.target.value)}
        />
      </div>

      {/* Stripe */}
      <div className="mt-3 card p-4">
        <label className="flex items-center justify-between">
          <span className="font-medium text-white">Stripe</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-white"
            checked={stripeEnabled}
            onChange={(e) => setStripeEnabled(e.target.checked)}
          />
        </label>
        <label className="eyebrow mb-1.5 mt-3 block">Secret key (sk_...)</label>
        <input
          className="input font-mono"
          type="password"
          placeholder={
            cfg?.stripe.hasSecret ? "•••••••• (em branco = manter)" : "sk_live_..."
          }
          value={stripeSecret}
          onChange={(e) => setStripeSecret(e.target.value)}
        />
        <label className="eyebrow mb-1.5 mt-3 block">
          Publishable key (pk_...)
        </label>
        <input
          className="input font-mono"
          placeholder="pk_live_..."
          value={stripePub}
          onChange={(e) => setStripePub(e.target.value)}
        />
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
    </section>
  );
}

function SecurityNote() {
  return (
    <section className="mt-10">
      <p className="eyebrow">segurança</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">Acesso</h2>
      <div className="mt-4 card flex items-start gap-3 p-4">
        <span className="mt-0.5 text-zinc-500">
          <IconLock size={18} />
        </span>
        <p className="text-sm text-zinc-400">
          O e-mail e a senha de login ficam nas variáveis de ambiente
          (`AUTH_EMAIL` / `AUTH_PASSWORD`) no EasyPanel. Para trocar, edite lá e
          reinicie o app.
        </p>
      </div>
    </section>
  );
}
