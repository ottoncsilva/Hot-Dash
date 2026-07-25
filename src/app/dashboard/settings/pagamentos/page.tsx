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
  // Reprocessamento das vendas antigas (recupera o valor líquido no gateway).
  const [repro, setRepro] = useState<{ pending: number; supported: boolean } | null>(null);
  const [reproRunning, setReproRunning] = useState(false);
  const [reproMsg, setReproMsg] = useState<string | null>(null);
  // Diagnóstico: o que o gateway respondeu de fato (para quando não funciona).
  const [diag, setDiag] = useState<string | null>(null);

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

  async function loadReprocess() {
    try {
      const d = await apiGet<{ pending: number; supported: boolean }>("/api/payments/reprocess");
      setRepro(d);
    } catch {
      setRepro(null);
    }
  }

  async function runReprocess() {
    setReproRunning(true);
    setReproMsg(null);
    try {
      // Em lotes: a API do gateway é consultada uma venda por vez.
      let total = 0, encontradas = 0, semDados = 0, erros = 0, sobra = 0;
      for (let volta = 0; volta < 20; volta++) {
        const r = await apiSend<{
          processed: number; updated: number; notFound: number; failed: number; remaining: number;
        }>("/api/payments/reprocess", "POST", { limit: 100 });
        total += r.processed; encontradas += r.updated; semDados += r.notFound; erros += r.failed;
        sobra = r.remaining;
        if (r.processed === 0 || r.remaining === 0) break;
      }
      const partes = [`${encontradas} atualizada(s)`];
      if (semDados) partes.push(`${semDados} sem dados no gateway`);
      if (erros) partes.push(`${erros} com erro`);
      if (sobra) partes.push(`${sobra} ainda pendente(s)`);
      setReproMsg(total === 0 ? "Nada a reprocessar." : partes.join(" · "));
      // Se não atualizou nada, já traz o diagnóstico sem o usuário precisar pedir.
      if (total > 0 && encontradas === 0) await runDiagnose();
      await loadReprocess();
    } catch (e) {
      setReproMsg(e instanceof Error ? e.message : "Falha ao reprocessar.");
    } finally {
      setReproRunning(false);
    }
  }

  async function runDiagnose() {
    setDiag("consultando...");
    try {
      const d = await apiGet<{
        error?: string; ok?: boolean; providerRef?: string;
        data?: Record<string, unknown>;
        attempts?: { path: string; method: string; httpStatus?: number; bodySample?: string; error?: string }[];
      }>("/api/payments/reprocess?diagnose=1");
      if (d.error) { setDiag(d.error); return; }
      if (d.ok) {
        setDiag(`Funcionou nesta venda (${d.providerRef}): ${JSON.stringify(d.data)}`);
        return;
      }
      const linhas = (d.attempts || []).map(
        (a) => `${a.method} ${a.path} → ${a.httpStatus ?? a.error ?? "?"}${a.bodySample ? ` · ${a.bodySample}` : ""}`,
      );
      setDiag(
        `Venda testada: ${d.providerRef}\nNenhum caminho respondeu com os valores:\n` +
          linhas.join("\n"),
      );
    } catch (e) {
      setDiag(e instanceof Error ? e.message : "Falha no diagnóstico.");
    }
  }

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
    <div className="page-narrow">
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

          {/* Reprocessar vendas antigas: recupera no gateway o valor LÍQUIDO das
              vendas registradas antes de o app passar a guardá-lo. */}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Reconferir vendas antigas
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Consulta cada venda na SyncPay e corrige o <b>status</b> e o <b>valor cheio</b>
                  — útil quando algum webhook se perdeu.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {repro === null ? (
                  <button type="button" onClick={loadReprocess} className="btn-ghost px-3 py-1.5 text-xs">
                    Verificar quantas
                  </button>
                ) : (
                  <>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {repro.pending} pendente(s)
                    </span>
                    <button
                      type="button"
                      onClick={runReprocess}
                      disabled={reproRunning || repro.pending === 0}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      {reproRunning ? "Reconferindo..." : "Reconferir agora"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {reproMsg && <p className="mt-2 text-xs text-zinc-300">{reproMsg}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={runDiagnose} className="btn-ghost px-3 py-1.5 text-xs">
                Testar com 1 venda
              </button>
              {diag && (
                <button type="button" onClick={() => setDiag(null)} className="text-[11px] text-zinc-500 hover:text-white">
                  limpar
                </button>
              )}
            </div>
            {diag && (
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                {diag}
              </pre>
            )}
            <p className="mt-2 text-[11px] text-amber-400/80">
              O <b>valor líquido</b> das vendas antigas não pode ser recuperado: a consulta da
              SyncPay devolve só o valor cheio — o líquido (<span className="font-mono">final_amount</span>)
              existe apenas no webhook. Da data do deploy em diante ele é gravado normalmente.
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              A SyncPay também não oferece listagem de vendas — a consulta é feita uma a uma,
              pelo identificador que já temos. Vendas que nunca chegaram ao painel não aparecem.
            </p>
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
