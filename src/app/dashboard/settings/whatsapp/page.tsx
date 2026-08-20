"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { BackToSettings, ConnectionBadge } from "../_shared";
import type { EvolutionSettingsPublic } from "@/lib/settings";
import { showToast } from "@/lib/toast";

export default function WhatsAppSettingsPage() {
  const [cfg, setCfg] = useState<EvolutionSettingsPublic | null>(null);
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: EvolutionSettingsPublic }>("/api/settings/whatsapp")
      .then((d) => {
        setCfg(d.settings);
        setUrl(d.settings.url || "");
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const { settings } = await apiSend<{ settings: EvolutionSettingsPublic }>(
        "/api/settings/whatsapp",
        "PATCH",
        {
          url: url || undefined,
          ...(apiKey ? { apiKey } : {}),
        },
      );
      setCfg(settings);
      setApiKey("");
      setSaved(true);
      showToast("Salvo!");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Conexão WhatsApp (Evolution)</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Conecte seu servidor da Evolution API para os Agentes de Venda e o Funil de LTV. Estas credenciais
        valem para todas as modelos.
      </p>

      <div className="mt-6 card p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="eyebrow mb-1.5 block">Evolution API URL</label>
            <input
              className="input font-mono"
              type="text"
              placeholder="Ex: https://evolution.seusite.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              A url base do seu servidor
            </p>
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Global API Key</label>
            <input
              className="input font-mono"
              type="password"
              placeholder={cfg?.hasKey ? "•••••••• (em branco = manter)" : "Cole sua Global API Key aqui"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              A chave mestre da Evolution
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Salvando..." : "Salvar Configurações"}
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
