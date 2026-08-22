"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { BackToSettings, ConnectionBadge } from "../_shared";
import type { EvolutionSettingsPublic, TelegramChipSettingsPublic } from "@/lib/settings";
import { showToast } from "@/lib/toast";

export default function WhatsAppSettingsPage() {
  const [cfg, setCfg] = useState<EvolutionSettingsPublic | null>(null);
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [chip, setChip] = useState<TelegramChipSettingsPublic | null>(null);
  const [chipUrl, setChipUrl] = useState("");
  const [chipToken, setChipToken] = useState("");
  
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: EvolutionSettingsPublic; chip: TelegramChipSettingsPublic }>(
      "/api/settings/whatsapp",
    )
      .then((d) => {
        setCfg(d.settings);
        setUrl(d.settings.url || "");
        setChip(d.chip);
        setChipUrl(d.chip?.url || "");
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const resp = await apiSend<{
        settings: EvolutionSettingsPublic;
        chip: TelegramChipSettingsPublic;
      }>("/api/settings/whatsapp", "PATCH", {
        url: url || undefined,
        ...(apiKey ? { apiKey } : {}),
        chipUrl: chipUrl || "",
        ...(chipToken ? { chipToken } : {}),
      });
      setCfg(resp.settings);
      setChip(resp.chip);
      setApiKey("");
      setChipToken("");
      setSaved(true);
      showToast("Salvo!");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Conexões do LTV</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Por onde a modelo fala com o lead: a Evolution leva o WhatsApp, o serviço do chip leva o
        Telegram. Estas credenciais valem para todas as modelos.
      </p>

      <h2 className="eyebrow mt-6">WhatsApp · Evolution API</h2>

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

      <h2 className="eyebrow mt-6">Telegram · serviço do chip (MTProto)</h2>
      <p className="mt-1 text-sm text-zinc-500">
        O LTV do Telegram fala pela conta REAL da modelo, e conta real não roda dentro do painel —
        precisa do container de <code className="font-mono text-xs">telegram-mtproto-service/</code>.
        Com a URL em branco, o LTV do Telegram fica desligado.
      </p>

      <div className="mt-3 card p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="eyebrow mb-1.5 block">URL do serviço</label>
            <input
              className="input font-mono"
              type="text"
              placeholder="Ex: http://telegram-chip:8100"
              value={chipUrl}
              onChange={(e) => setChipUrl(e.target.value)}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              endereço interno do container
            </p>
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Token do serviço</label>
            <input
              className="input font-mono"
              type="password"
              placeholder={chip?.hasToken ? "•••••••• (em branco = manter)" : "O mesmo CHIP_API_TOKEN do container"}
              value={chipToken}
              onChange={(e) => setChipToken(e.target.value)}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              sem ele, qualquer um manda mensagem pelo chip
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
