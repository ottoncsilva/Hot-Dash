"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { BackToSettings, KeyLabel } from "../_shared";
import CampoSecreto from "@/components/CampoSecreto";
import type { TelegramAppSettingsPublic, UazapiSettingsPublic } from "@/lib/settings";
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
  const [tg, setTg] = useState<TelegramAppSettingsPublic | null>(null);
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: UazapiSettingsPublic; telegram: TelegramAppSettingsPublic }>(
      "/api/settings/whatsapp",
    )
      .then((d) => {
        setCfg(d.settings);
        setUrl(d.settings.url || "");
        setTg(d.telegram);
        setApiId(d.telegram?.apiId ? String(d.telegram.apiId) : "");
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const r = await apiSend<{
        settings: UazapiSettingsPublic;
        telegram: TelegramAppSettingsPublic;
      }>("/api/settings/whatsapp", "PATCH", {
        url: url || undefined,
        ...(adminToken ? { adminToken } : {}),
        ...(apiId ? { apiId: Number(apiId) } : {}),
        ...(apiHash ? { apiHash } : {}),
      });
      setCfg(r.settings);
      setTg(r.telegram);
      setAdminToken("");
      setApiHash("");
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
            <KeyLabel salva={Boolean(cfg?.hasAdminToken)}>Admin Token</KeyLabel>
            <CampoSecreto
              name="uazapi-admin-token"
              placeholder={
                cfg?.hasAdminToken ? "•••••••• (em branco = manter)" : "Cole o admintoken aqui"
              }
              value={adminToken}
              onChange={setAdminToken}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              é ele que cria e apaga instância
            </p>
          </div>
        </div>
      </div>

      <h2 className="eyebrow mt-8">Telegram · conta real (chip)</h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-500">
        O chip roda dentro do próprio painel — não há serviço para subir nem endereço para
        configurar. O que o Telegram exige, e ninguém pode adivinhar, é uma credencial de
        aplicativo: pegue de graça em{" "}
        <a
          href="https://my.telegram.org"
          target="_blank"
          rel="noreferrer"
          className="text-emerald-400 underline"
        >
          my.telegram.org
        </a>{" "}
        → API development tools. É por conta de desenvolvedor, não por chip: um par serve para
        todas as modelos.
      </p>

      <div className="mt-3 card p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="eyebrow mb-1.5 block">api_id</label>
            <CampoSecreto
              tipo="texto"
              inputMode="numeric"
              name="telegram-api-id"
              placeholder="1234567"
              value={apiId}
              onChange={setApiId}
            />
          </div>
          <div>
            <KeyLabel salva={Boolean(tg?.hasApiHash)}>api_hash</KeyLabel>
            <CampoSecreto
              name="telegram-api-hash"
              placeholder={tg?.hasApiHash ? "•••••••• (em branco = manter)" : "Cole o api_hash aqui"}
              value={apiHash}
              onChange={setApiHash}
            />
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
