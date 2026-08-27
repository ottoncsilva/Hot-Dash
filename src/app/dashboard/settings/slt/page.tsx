"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { BackToSettings, KeyLabel } from "../_shared";

type SltState = {
  hasApiKey: boolean;
  lastSyncedAt?: number;
  lastSyncError?: string;
};

/**
 * SLT (slt.bio, link na bio) — só leitura, uma chave pra conta inteira (não
 * é por modelo). Sincroniza sozinho a cada ~15 min (ver instrumentation.ts);
 * o botão aqui é só pra não esperar o próximo tick depois de configurar.
 *
 * Tela própria (fora de Pagamentos): não é um provedor de cobrança, é uma
 * fonte de tráfego/analytics — a atribuição por modelo/rede mora em
 * Links (bio), esta tela só guarda a chave e sincroniza.
 */
export default function SltSettingsPage() {
  const [sltState, setSltState] = useState<SltState | null>(null);
  const [sltApiKey, setSltApiKey] = useState("");
  const [sltSaving, setSltSaving] = useState(false);
  const [sltSyncing, setSltSyncing] = useState(false);
  const [sltMsg, setSltMsg] = useState<string | null>(null);

  function loadSlt() {
    apiGet<{ settings: SltState }>("/api/settings/slt")
      .then((d) => setSltState(d.settings))
      .catch(() => {});
  }

  useEffect(() => {
    loadSlt();
  }, []);

  async function salvarChaveSlt() {
    setSltSaving(true);
    setSltMsg(null);
    try {
      await apiSend("/api/settings/slt", "PATCH", { apiKey: sltApiKey });
      setSltApiKey("");
      setSltMsg("Chave salva e validada.");
      loadSlt();
    } catch (e) {
      setSltMsg(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSltSaving(false);
    }
  }

  async function desconectarSlt() {
    setSltSaving(true);
    setSltMsg(null);
    try {
      await apiSend("/api/settings/slt", "PATCH", { apiKey: "" });
      setSltMsg("Chave removida.");
      loadSlt();
    } catch (e) {
      setSltMsg(e instanceof Error ? e.message : "Falha ao remover.");
    } finally {
      setSltSaving(false);
    }
  }

  async function sincronizarSltAgora() {
    setSltSyncing(true);
    setSltMsg(null);
    try {
      const d = await apiSend<{ ok: boolean; synced: number; error?: string }>(
        "/api/settings/slt",
        "POST",
        {},
      );
      setSltMsg(
        d.ok
          ? `Sincronizado: ${d.synced} evento(s) novo(s).`
          : `Falha na sincronização: ${d.error || "erro desconhecido"}`,
      );
      loadSlt();
    } catch (e) {
      setSltMsg(e instanceof Error ? e.message : "Falha ao sincronizar.");
    } finally {
      setSltSyncing(false);
    }
  }

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">SLT (link na bio)</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Traz visualização e clique de cada página do SLT pro Funil de Vendas e pra tela de Links —
        casado pelo código do link (<code>?start=CODIGO</code> igual ao slug da página no SLT). A
        chave é guardada criptografada (AES-256) no servidor.
      </p>

      <div className="mt-4 card p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-white">Chave da API</span>
          {sltState?.hasApiKey && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              conectado
            </span>
          )}
        </div>

        <div className="mt-3">
          <KeyLabel salva={Boolean(sltState?.hasApiKey)}>API Key</KeyLabel>
        </div>
        <input
          className="input font-mono"
          type="password"
          placeholder={sltState?.hasApiKey ? "•••••••• (em branco = manter)" : "slt_live_..."}
          value={sltApiKey}
          onChange={(e) => setSltApiKey(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Gerada em slt.bio → Dashboard → Settings → API Keys (planos Pro/Agency).
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={salvarChaveSlt}
            disabled={sltSaving || !sltApiKey.trim()}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {sltSaving ? "Salvando..." : "Salvar chave"}
          </button>
          {sltState?.hasApiKey && (
            <>
              <button
                type="button"
                onClick={sincronizarSltAgora}
                disabled={sltSyncing}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                {sltSyncing ? "Sincronizando..." : "Sincronizar agora"}
              </button>
              <button
                type="button"
                onClick={desconectarSlt}
                disabled={sltSaving}
                className="btn-ghost px-3 py-1.5 text-xs text-red-400"
              >
                Remover chave
              </button>
            </>
          )}
        </div>

        {sltState?.hasApiKey && (
          <p className="mt-2 text-[11px] text-zinc-500">
            {sltState.lastSyncedAt
              ? `Última sincronização com evento novo: ${new Date(sltState.lastSyncedAt).toLocaleString("pt-BR")}.`
              : "Ainda sem eventos sincronizados — o tick de fundo roda a cada minuto e checa a cada ~15min."}
            {sltState.lastSyncError && (
              <span className="mt-1 block text-amber-400">Último erro: {sltState.lastSyncError}</span>
            )}
          </p>
        )}
        {sltMsg && <p className="mt-2 text-xs text-zinc-300">{sltMsg}</p>}
      </div>
    </div>
  );
}
