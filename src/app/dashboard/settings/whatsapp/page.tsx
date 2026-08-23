"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { BackToSettings } from "../_shared";
import type { UazapiSettingsPublic } from "@/lib/settings";
import { showToast } from "@/lib/toast";

/**
 * Conexão do WhatsApp do LTV, pela uazapi.
 *
 * Só duas coisas moram aqui, e são as duas que aparecem no painel da uazapi:
 * a URL do servidor e o admintoken. O token de CADA número é criado pelo
 * painel na hora de adicionar o número e fica cifrado junto da conta — não é
 * algo para a pessoa copiar e colar.
 *
 * O serviço do chip do Telegram NÃO está aqui de propósito: ele sobe no mesmo
 * docker-compose, então o endereço e o segredo vêm do ambiente.
 */
export default function ConexoesLtvPage() {
  const [cfg, setCfg] = useState<UazapiSettingsPublic | null>(null);
  const [url, setUrl] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: UazapiSettingsPublic }>("/api/settings/whatsapp")
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
      const { settings } = await apiSend<{ settings: UazapiSettingsPublic }>(
        "/api/settings/whatsapp",
        "PATCH",
        { url: url || undefined, ...(adminToken ? { adminToken } : {}) },
      );
      setCfg(settings);
      setAdminToken("");
      setSaved(true);
      showToast("Salvo!");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
        Conexões do LTV
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        O WhatsApp do LTV fala pela <strong className="text-zinc-300">uazapi</strong>. Estes dois
        campos são os mesmos que aparecem na tela &quot;Conecte seu número&quot; do painel dela, e
        valem para todas as modelos. Cada número ganha o token dele sozinho, na hora de conectar.
      </p>

      <div className="mt-6 card p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="eyebrow mb-1.5 block">Server URL</label>
            <input
              className="input font-mono"
              type="text"
              placeholder="https://seunome.uazapi.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              o endereço do seu servidor na uazapi
            </p>
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Admin Token</label>
            <input
              className="input font-mono"
              type="password"
              placeholder={
                cfg?.hasAdminToken ? "•••••••• (em branco = manter)" : "Cole o admintoken aqui"
              }
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              é ele que cria e apaga instância
            </p>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-zinc-600">
        O Telegram não aparece aqui: o serviço do chip sobe junto do painel e se acha sozinho pelo
        ambiente. Nada para configurar.
      </p>

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
