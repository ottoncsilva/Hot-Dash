"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconLock } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import { BackToSettings, ConnectionBadge } from "../_shared";
import { showToast } from "@/lib/toast";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

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
  // Meta do mês em REAIS na tela; vira centavos só na hora de salvar.
  const [metaReais, setMetaReais] = useState("");
  const [salvandoMeta, setSalvandoMeta] = useState(false);
  // Diário dos webhooks: o corpo cru do que a SyncPay manda, para distinguir
  // venda de saque (a documentação só descreve o de venda).
  const [eventos, setEventos] = useState<
    { id: string; receivedAt: number; providerRef?: string; decision: string; body: string }[] | null
  >(null);
  const [aberto, setAberto] = useState<string | null>(null);
  // Webhooks cadastrados NA SYNCPAY: o evento assinado decide o que chega aqui.
  const [cadastrados, setCadastrados] = useState<
    { lista?: { id: number; title: string; url: string; event: string; allProducts: boolean }[]; erro?: string } | null
  >(null);
  // Teste do saldo (o card do Dashboard só diz "indisponível" quando falha).
  const [saldoMsg, setSaldoMsg] = useState<string | null>(null);
  const [saldoBusy, setSaldoBusy] = useState(false);
  // Importação do export da SyncPay (única fonte do valor líquido do histórico).
  const [impPrev, setImpPrev] = useState<any>(null);
  const [impBusy, setImpBusy] = useState(false);
  const [impFile, setImpFile] = useState<File | null>(null);
  const [impMsg, setImpMsg] = useState<string | null>(null);

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
    apiGet<{ finance: { monthlyGoalCents: number } }>("/api/payments/finance-settings")
      .then((d) => {
        const cents = d.finance?.monthlyGoalCents || 0;
        setMetaReais(cents > 0 ? String(cents / 100) : "");
      })
      .catch(() => {});
  }, []);

  async function salvarMeta() {
    setSalvandoMeta(true);
    try {
      const reais = Number(metaReais.replace(",", "."));
      await apiSend("/api/payments/finance-settings", "PATCH", {
        monthlyGoalCents: Number.isFinite(reais) && reais > 0 ? Math.round(reais * 100) : 0,
      });
      showToast("Meta salva!");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Falha ao salvar a meta.");
    } finally {
      setSalvandoMeta(false);
    }
  }

  const webhookUrl = cfg?.syncpay.webhookShort ? `${origin}/w/${cfg.syncpay.webhookShort}` : "";

  async function carregarEventos() {
    try {
      const d = await apiGet<{ events: typeof eventos }>("/api/payments/webhook-events");
      setEventos(d.events || []);
    } catch {
      setEventos([]);
    }
  }

  async function carregarCadastrados() {
    setCadastrados(null);
    try {
      const d = await apiGet<{
        error?: string;
        webhooks?: { id: number; title: string; url: string; event: string; allProducts: boolean }[];
      }>("/api/payments/webhooks-registrados");
      setCadastrados(d.error ? { erro: d.error } : { lista: d.webhooks || [] });
    } catch (e) {
      setCadastrados({ erro: e instanceof Error ? e.message : "Falha ao consultar." });
    }
  }

  async function testarSaldo() {
    setSaldoBusy(true);
    setSaldoMsg("consultando...");
    try {
      const d = await apiGet<{
        error?: string;
        cents?: number | null;
        attempts?: { path: string; httpStatus?: number; bodySample?: string; error?: string }[];
      }>("/api/payments/balance?diagnose=1");
      if (d.error) {
        setSaldoMsg(d.error);
        return;
      }
      const linhas = (d.attempts || []).map(
        (a) => `GET ${a.path} → ${a.httpStatus ?? "?"}${a.error ? ` · ${a.error}` : ""}${a.bodySample ? `\n   ${a.bodySample}` : ""}`,
      );
      setSaldoMsg(
        (d.cents === null || d.cents === undefined
          ? "Nenhum caminho devolveu o saldo.\n"
          : `Saldo lido: ${(d.cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}\n`) +
          linhas.join("\n"),
      );
    } catch (e) {
      setSaldoMsg(e instanceof Error ? e.message : "Falha ao consultar o saldo.");
    } finally {
      setSaldoBusy(false);
    }
  }

  async function enviarExport(file: File, dryRun: boolean) {
    setImpBusy(true);
    setImpMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (dryRun) fd.append("dryRun", "1");
      const res = await fetch("/api/payments/import", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha ao ler o arquivo.");
      if (dryRun) {
        setImpPrev(d);
      } else {
        setImpPrev(null);
        setImpFile(null);
        setImpMsg(
          `Importado: ${d.atualizadas} atualizada(s), ${d.novas} nova(s), ${d.semMudanca} sem mudança.`,
        );
        loadDiagnostics();
      }
    } catch (e) {
      setImpMsg(e instanceof Error ? e.message : "Falha na importação.");
    } finally {
      setImpBusy(false);
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
      showToast("Salvo!");
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

      {/* Meta do mês. Mora aqui porque é número financeiro, mas quem a usa é o
          Funil — lá ela vira a barra de progresso do faturamento. */}
      <div className="mt-4 card p-4">
        <p className="eyebrow">meta de faturamento</p>
        <p className="mt-1 text-xs text-zinc-500">
          Quanto você quer faturar por mês. Aparece como barra de progresso no Funil de Vendas.
          Deixe em branco (ou zero) para não usar meta.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              meta mensal (R$)
            </span>
            <input
              className="input w-40 py-1.5 text-sm"
              type="number"
              min={0}
              step={100}
              placeholder="10000"
              value={metaReais}
              onChange={(e) => setMetaReais(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={salvarMeta}
            disabled={salvandoMeta}
            className="btn-ghost py-2 text-xs disabled:opacity-40"
          >
            {salvandoMeta ? "Salvando..." : "Salvar meta"}
          </button>
        </div>
      </div>

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
        <div className="mt-4 panel p-3">
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

          {/* Saldo: quando o card do Dashboard fica vazio, é aqui que dá para
              ver o que a SyncPay respondeu em cada caminho tentado. */}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Saldo na SyncPay
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Testa a consulta de saldo e mostra a resposta crua do gateway.
                </p>
              </div>
              <button type="button" onClick={testarSaldo} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">
                {saldoBusy ? "Consultando..." : "Testar saldo"}
              </button>
            </div>
            {saldoMsg && (
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                {saldoMsg}
              </pre>
            )}
          </div>

          {/* Quais eventos estão assinados na SyncPay. Assinar "all" traz os
              SAQUES junto das vendas — foi assim que um saque virou venda. */}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Eventos assinados na SyncPay
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  O evento de cada cadastro decide o que chega aqui. O ideal é{" "}
                  <b>cashin</b> — <b>all</b> traz também os saques, que não são venda.
                </p>
              </div>
              <button type="button" onClick={carregarCadastrados} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">
                Consultar
              </button>
            </div>
            {cadastrados?.erro && <p className="mt-2 text-xs text-amber-400/80">{cadastrados.erro}</p>}
            {cadastrados?.lista && (
              cadastrados.lista.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-600">Nenhum webhook cadastrado na conta.</p>
              ) : (
                <div className="mt-2 space-y-1">
                  {cadastrados.lista.map((w) => (
                    <div key={w.id} className="flex flex-wrap items-center gap-2 rounded border border-white/10 bg-black/30 px-2 py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                          w.event === "cashin"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {w.event}
                      </span>
                      <span className="text-xs text-zinc-300">{w.title}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-600">{w.url}</span>
                    </div>
                  ))}
                  {cadastrados.lista.some((w) => w.event !== "cashin") && (
                    <p className="text-[11px] text-amber-400/80">
                      Há cadastro com evento diferente de <b>cashin</b>: é por ele que chegam saques e
                      outros movimentos. Ajuste no painel da SyncPay para receber só as vendas.
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          {/* Diário dos webhooks: mostra o que a SyncPay manda de fato. É por
              aqui que dá para ver qual campo distingue venda de saque. */}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Webhooks recebidos
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Os últimos eventos que a SyncPay mandou, com o conteúdo cru e o que o sistema
                  fez com cada um. Serve para conferir por que algo entrou (ou não) no Financeiro.
                </p>
              </div>
              <button type="button" onClick={carregarEventos} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">
                {eventos === null ? "Ver eventos" : "Atualizar"}
              </button>
            </div>
            {eventos !== null && (
              eventos.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-600">
                  Nenhum evento recebido ainda (só aparecem os que chegarem daqui pra frente).
                </p>
              ) : (
                <div className="mt-2 divide-y divide-white/[0.06] rounded-lg border border-white/10">
                  {eventos.map((ev) => (
                    <div key={ev.id} className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => setAberto(aberto === ev.id ? null : ev.id)}
                        className="flex w-full items-center justify-between gap-2 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="font-mono text-[10px] text-zinc-500">
                            {new Date(ev.receivedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}
                          </span>
                          <span
                            className={`ml-2 text-[11px] ${
                              ev.decision.startsWith("ignorado") ? "text-amber-400/80" : "text-emerald-400/80"
                            }`}
                          >
                            {ev.decision}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                          {aberto === ev.id ? "fechar" : "ver json"}
                        </span>
                      </button>
                      {aberto === ev.id && (
                        <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                          {ev.body}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          {/* Importar o export da SyncPay: única fonte do valor líquido do
              histórico (a API não lista vendas nem devolve o final_amount). */}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Importar histórico da SyncPay
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              O Financeiro já calcula taxa e líquido sozinho — a taxa da SyncPay é fixa
              (R$&nbsp;0,80 até R$&nbsp;100; + 1,99% acima). Use a importação só quando quiser os
              números exatos do painel dela, inclusive de vendas que nunca chegaram aqui: gere a
              <b> Exportação: Transaction</b> do período e envie o arquivo (PDF ou CSV). Os
              horários do arquivo estão em UTC e são convertidos para o seu fuso.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept=".pdf,.csv,text/csv,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setImpFile(f);
                  setImpPrev(null);
                  setImpMsg(null);
                  if (f) enviarExport(f, true);
                }}
                className="text-xs text-zinc-400 file:mr-2 file:rounded-lg file:border file:border-white/10 file:bg-white/5 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200"
              />
              {impBusy && <span className="text-[11px] text-zinc-500">lendo...</span>}
            </div>

            {impPrev && (
              <div className="mt-2 rounded-lg border border-white/10 bg-black/40 p-2 text-xs">
                <p className="text-zinc-300">
                  <b>{impPrev.lidas}</b> transações lidas · <b>{impPrev.pagas}</b> pagas
                </p>
                <p className="mt-1 font-mono text-[11px] text-zinc-400">
                  vendas {brl(impPrev.totais.vendaPagas)} · taxa {brl(impPrev.totais.taxaPagas)} ·
                  líquido <span className="text-emerald-400">{brl(impPrev.totais.liquidoPagas)}</span>
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Vai gravar: {impPrev.atualizadas} atualizada(s), {impPrev.novas} nova(s),
                  {" "}{impPrev.semMudanca} sem mudança.
                </p>
                <p className="mt-1 text-[11px] text-amber-400/80">
                  Confira o líquido acima com o saldo/extrato do painel da SyncPay antes de aplicar.
                </p>
                <button
                  type="button"
                  onClick={() => impFile && enviarExport(impFile, false)}
                  disabled={impBusy}
                  className="btn-primary mt-2 px-3 py-1.5 text-xs"
                >
                  {impBusy ? "Importando..." : "Aplicar importação"}
                </button>
              </div>
            )}
            {impMsg && <p className="mt-2 text-xs text-zinc-300">{impMsg}</p>}
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
