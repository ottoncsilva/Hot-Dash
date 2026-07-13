"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import type { GoogleSheetsSettingsPublic } from "@/lib/settings";
import { BackToSettings } from "../_shared";

export default function GoogleSheetsSettingsPage() {
  const [cfg, setCfg] = useState<GoogleSheetsSettingsPublic | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [json, setJson] = useState("");
  const [shareEmail, setShareEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ settings: GoogleSheetsSettingsPublic }>("/api/settings/google-sheets")
      .then((d) => {
        setCfg(d.settings);
        setEnabled(d.settings.enabled);
        setShareEmail(d.settings.shareEmail);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { settings } = await apiSend<{ settings: GoogleSheetsSettingsPublic }>(
        "/api/settings/google-sheets",
        "PATCH",
        {
          enabled,
          shareEmail,
          ...(json.trim() ? { serviceAccountJson: json } : {}),
        },
      );
      setCfg(settings);
      setJson("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackToSettings />
      <p className="eyebrow mt-4">automação</p>
      <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Google Sheets</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Cada modelo ganha uma planilha própria, atualizada automaticamente a
        cada foto/vídeo enviado: nome do arquivo, data, modelo, tipo, link
        público e uma coluna com checkbox para cada etiqueta. Use o link
        público das mídias em fluxos do Make/n8n.
      </p>

      <div className="mt-4 card p-4">
        <label className="flex items-center justify-between">
          <span className="font-medium text-white">Ativado</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-white"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>

        <label className="eyebrow mb-1.5 mt-3 block">
          Chave da conta de serviço (JSON do Google Cloud)
        </label>
        <textarea
          className="input min-h-[100px] font-mono text-xs"
          placeholder={
            cfg?.hasCredentials
              ? `configurado (${cfg.clientEmail}) — cole um novo JSON para substituir`
              : `cole aqui o conteúdo do arquivo .json baixado do Google Cloud Console`
          }
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />

        <label className="eyebrow mb-1.5 mt-3 block">
          Compartilhar planilhas com este e-mail (opcional)
        </label>
        <input
          className="input"
          placeholder="seu-email@gmail.com"
          value={shareEmail}
          onChange={(e) => setShareEmail(e.target.value)}
        />

        <p className="mt-3 text-xs text-zinc-500">
          Crie uma conta de serviço no Google Cloud Console com acesso à
          Sheets API e à Drive API, baixe a chave em JSON e cole acima. As
          planilhas são criadas pela conta de serviço — preencha o e-mail
          acima para que também apareçam no seu Google Drive.
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Salvando..." : "Salvar integração"}
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
