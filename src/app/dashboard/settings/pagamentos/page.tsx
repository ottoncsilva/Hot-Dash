"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconLock } from "@/components/icons";
import Switch from "@/components/Switch";
import { MoneyInput, type MoneyCurrency } from "@/components/MoneyInput";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { CobradorTaxa, TabelaTaxas } from "@/lib/origemVenda";
import { BackToSettings, ConnectionBadge, KeyLabel, WebhookDiaryPanel } from "../_shared";
import CampoSecreto from "@/components/CampoSecreto";
import { showToast } from "@/lib/toast";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function usd(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type LastPaid = { at: number; amountCents: number; customer?: string } | null;

/** Os 4 campos de taxa de um cobrador, como texto de formulário. */
type TaxasForm = { funilFixo: string; funilPct: string; ltvFixo: string; ltvPct: string };
type TodasTaxasForm = Record<CobradorTaxa, TaxasForm>;

const TAXAS_FORM_VAZIO: TaxasForm = { funilFixo: "", funilPct: "", ltvFixo: "", ltvPct: "" };

function taxasParaForm(t: TabelaTaxas): TaxasForm {
  return {
    funilFixo: (t.funil.fixoCents / 100).toFixed(2),
    funilPct: String(t.funil.percent),
    ltvFixo: (t.ltv.fixoCents / 100).toFixed(2),
    ltvPct: String(t.ltv.percent),
  };
}

function formParaTaxas(f: TaxasForm): TabelaTaxas {
  const c = (v: string) => Math.round((Number(v.replace(",", ".")) || 0) * 100);
  const p = (v: string) => Number(v.replace(",", ".")) || 0;
  return {
    funil: { fixoCents: c(f.funilFixo), percent: p(f.funilPct) },
    ltv: { fixoCents: c(f.ltvFixo), percent: p(f.ltvPct) },
  };
}

/**
 * As 4 taxas de um cobrador. Duas linhas com valores DIFERENTES são o que
 * permite ao Financeiro dizer se uma venda de bot operado por fora foi funil
 * ou LTV — ver `lib/origemVenda.ts`. Linhas iguais desligam o critério.
 */
function TaxasBlock({ valor, onChange }: { valor: TaxasForm; onChange: (v: TaxasForm) => void }) {
  const linha = (
    rotulo: string,
    fixo: keyof TaxasForm,
    pct: keyof TaxasForm,
  ) => (
    <div className="flex items-center gap-2">
      <span className="w-10 font-mono text-[10px] uppercase tracking-wider text-zinc-600">{rotulo}</span>
      <MoneyInput
        className="w-24 py-1.5 text-sm"
        placeholder="0,00"
        value={valor[fixo]}
        onChange={(v) => onChange({ ...valor, [fixo]: v })}
      />
      <div className="relative">
        <input
          inputMode="decimal"
          className="input w-20 py-1.5 pr-6 text-sm"
          placeholder="0"
          value={valor[pct]}
          onChange={(e) => onChange({ ...valor, [pct]: e.target.value })}
          aria-label={`Percentual ${rotulo}`}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-600">%</span>
      </div>
    </div>
  );
  return (
    <div className="mt-4 panel p-3">
      <p className="eyebrow">taxas — o que ele retém</p>
      <div className="mt-2 space-y-1.5">
        {linha("funil", "funilFixo", "funilPct")}
        {linha("ltv", "ltvFixo", "ltvPct")}
      </div>
    </div>
  );
}

export default function PaymentSettingsPage() {
  // Vínculo pelo Canal de Vendas — salva SOZINHO no clique (não espera o
  // botão "Salvar pagamentos", que é das chaves dos provedores). `null` =
  // ainda carregando, e o interruptor fica desabilitado até saber o estado
  // real, pra não piscar "desligado" e o operador achar que está desligado.
  const [vincularPeloGrupo, setVincularPeloGrupo] = useState<boolean | null>(null);
  const [vinculoSalvando, setVinculoSalvando] = useState(false);
  // As tabelas de taxa dos três cobradores. Salvam no botão "Salvar
  // pagamentos", junto das chaves — são campos dos mesmos cards.
  const [taxas, setTaxas] = useState<TodasTaxasForm>({
    syncpay: TAXAS_FORM_VAZIO,
    stripe: TAXAS_FORM_VAZIO,
    terceirosSyncpay: TAXAS_FORM_VAZIO,
    terceirosStripe: TAXAS_FORM_VAZIO,
  });

  useEffect(() => {
    apiGet<{ vendasExternas: { vincularPeloGrupo: boolean } }>("/api/payments/vendas-externas")
      .then((r) => setVincularPeloGrupo(r.vendasExternas.vincularPeloGrupo))
      .catch(() => setVincularPeloGrupo(true));
  }, []);

  async function alternarVinculo(valor: boolean) {
    setVinculoSalvando(true);
    try {
      const r = await apiSend<{ vendasExternas: { vincularPeloGrupo: boolean } }>(
        "/api/payments/vendas-externas",
        "PATCH",
        { vincularPeloGrupo: valor },
      );
      setVincularPeloGrupo(r.vendasExternas.vincularPeloGrupo);
      showToast(valor ? "Vínculo pelo Canal de Vendas LIGADO." : "Vínculo pelo Canal de Vendas DESLIGADO.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    } finally {
      setVinculoSalvando(false);
    }
  }

  const [cfg, setCfg] = useState<PaymentSettingsPublic | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncClientId, setSyncClientId] = useState("");
  const [syncClientSecret, setSyncClientSecret] = useState("");
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [stripeCopied, setStripeCopied] = useState(false);
  // Saldo na Stripe (em USD) — consulta simples, sem o cache/diagnóstico que
  // a da SyncPay precisa (a API dela é direta, sem limite de taxa a driblar).
  const [stripeBalance, setStripeBalance] = useState<{
    availableCents: number | null;
    pendingCents: number | null;
    connected: boolean;
    error?: string;
    // BRL do "cartão no Brasil", quando existe.
    outras?: { currency: string; availableCents: number; pendingCents?: number }[] | null;
  } | null>(null);
  const [stripeBalanceBusy, setStripeBalanceBusy] = useState(false);
  // Teste manual de cobrança: gera um link de checkout de verdade (com um
  // valor qualquer) pra confirmar chave + webhook ponta a ponta antes de
  // ligar o botão internacional pros leads.
  const [stripeTestAmount, setStripeTestAmount] = useState("1.00");
  const [stripeTestCurrency, setStripeTestCurrency] = useState<MoneyCurrency>("USD");
  const [stripeTestBusy, setStripeTestBusy] = useState(false);
  const [stripeTestUrl, setStripeTestUrl] = useState<string | null>(null);
  const [stripeTestErr, setStripeTestErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastPaid, setLastPaid] = useState<LastPaid>(null);
  // Meta do mês em REAIS na tela; vira centavos só na hora de salvar.
  const [metaReais, setMetaReais] = useState("");
  const [salvandoMeta, setSalvandoMeta] = useState(false);
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
        setStripeEnabled(d.settings.stripe.enabled);
        setTaxas({
          syncpay: taxasParaForm(d.settings.taxas.syncpay),
          stripe: taxasParaForm(d.settings.taxas.stripe),
          terceirosSyncpay: taxasParaForm(d.settings.taxas.terceirosSyncpay),
          terceirosStripe: taxasParaForm(d.settings.taxas.terceirosStripe),
        });
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

  const stripeWebhookUrl = origin ? `${origin}/api/webhooks/stripe` : "";

  async function copyStripeWebhook() {
    if (!stripeWebhookUrl) return;
    try {
      await navigator.clipboard.writeText(stripeWebhookUrl);
      setStripeCopied(true);
      setTimeout(() => setStripeCopied(false), 2000);
    } catch {
      /* clipboard indisponível — o usuário pode copiar manualmente */
    }
  }

  async function carregarSaldoStripe() {
    setStripeBalanceBusy(true);
    try {
      const d = await apiGet<{
        connected: boolean;
        availableCents: number | null;
        pendingCents: number | null;
        error?: string;
        outras?: { currency: string; availableCents: number; pendingCents?: number }[] | null;
      }>("/api/payments/stripe/balance");
      setStripeBalance(d);
    } catch (e) {
      setStripeBalance({
        connected: false,
        availableCents: null,
        pendingCents: null,
        error: e instanceof Error ? e.message : "Falha ao consultar o saldo.",
      });
    } finally {
      setStripeBalanceBusy(false);
    }
  }

  async function testarCobrancaStripe() {
    setStripeTestBusy(true);
    setStripeTestErr(null);
    setStripeTestUrl(null);
    try {
      const amount = Number(stripeTestAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setStripeTestErr("Informe um valor válido.");
        return;
      }
      const d = await apiSend<{ checkoutUrl?: string }>("/api/payments/stripe/test-charge", "POST", {
        amount,
        currency: stripeTestCurrency,
      });
      if (!d.checkoutUrl) {
        setStripeTestErr("A Stripe não devolveu um link de checkout.");
        return;
      }
      setStripeTestUrl(d.checkoutUrl);
    } catch (e) {
      setStripeTestErr(e instanceof Error ? e.message : "Falha ao gerar a cobrança de teste.");
    } finally {
      setStripeTestBusy(false);
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
          stripe: {
            enabled: stripeEnabled,
            ...(stripeSecretKey ? { secretKey: stripeSecretKey } : {}),
            ...(stripeWebhookSecret ? { webhookSecret: stripeWebhookSecret } : {}),
          },
          taxas: {
            syncpay: formParaTaxas(taxas.syncpay),
            stripe: formParaTaxas(taxas.stripe),
            terceirosSyncpay: formParaTaxas(taxas.terceirosSyncpay),
            terceirosStripe: formParaTaxas(taxas.terceirosStripe),
          },
        },
      );
      setCfg(settings);
      setTaxas({
        syncpay: taxasParaForm(settings.taxas.syncpay),
        stripe: taxasParaForm(settings.taxas.stripe),
        terceirosSyncpay: taxasParaForm(settings.taxas.terceirosSyncpay),
        terceirosStripe: taxasParaForm(settings.taxas.terceirosStripe),
      });
      setSyncClientSecret("");
      setStripeSecretKey("");
      setStripeWebhookSecret("");
      setSaved(true);
      showToast("Salvo!");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Provedores</h1>
      <p className="mt-2 text-sm text-zinc-500">
        As chaves são guardadas criptografadas (AES-256) no servidor.
      </p>

      {/* Vínculo pelo Canal de Vendas. Mora aqui, e não na tela do bot, porque
          o que ele resolve é do FINANCEIRO: venda que chega só pelo webhook,
          sem passar pelo checkout do Hot-Dash, e que sem isto nasce "Sem
          modelo". */}
      <div className="mt-4 card p-4">
        <p className="eyebrow">vendas de bot operado por fora</p>
        <div className="mt-1.5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Vincular pelo Canal de Vendas</p>
            <p className="mt-1 text-xs text-zinc-500">
              Atribui ao modelo certo a venda de bot que outro sistema opera, lendo o relatório do Canal de
              Vendas. Exige o token do bot cadastrado aqui e o Canal de Vendas preenchido.
            </p>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              checked={vincularPeloGrupo === true}
              onChange={alternarVinculo}
              disabled={vincularPeloGrupo === null || vinculoSalvando}
              ariaLabel="Vincular vendas pelo Canal de Vendas"
            />
          </div>
        </div>
      </div>

      <ImportarHistoricoCard />

      {/* Meta do mês. Mora aqui porque é número financeiro, mas quem a usa é o
          Dashboard — lá ela vira a barra de progresso do faturamento. */}
      <div className="mt-4 card p-4">
        <p className="eyebrow">meta de faturamento</p>
        <p className="mt-1 text-xs text-zinc-500">Barra de progresso do Dashboard. Zero = sem meta.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              meta mensal
            </span>
            <MoneyInput className="w-40 py-1.5 text-sm" placeholder="10000,00" value={metaReais} onChange={setMetaReais} />
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
        <CampoSecreto
          tipo="texto"
          name="syncpay-client-id"
          placeholder="ex.: 11111111-2222-3333-4444-555555555555"
          value={syncClientId}
          onChange={setSyncClientId}
        />
        <div className="mt-3">
          <KeyLabel salva={Boolean(cfg?.syncpay.hasSecret)}>Client Secret</KeyLabel>
        </div>
        <CampoSecreto
          name="syncpay-client-secret"
          placeholder={
            cfg?.syncpay.hasSecret ? "•••••••• (em branco = manter)" : "cole o client secret"
          }
          value={syncClientSecret}
          onChange={setSyncClientSecret}
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
          autoTest={true}
          enabled={syncEnabled}
        />

        <TaxasBlock valor={taxas.syncpay} onChange={(v) => setTaxas((t) => ({ ...t, syncpay: v }))} />

        {/* Webhook de recebimento — alimenta o Financeiro e o Dashboard */}
        <div className="mt-4 panel p-3">
          <p className="eyebrow">webhook de recebimento</p>
          <p className="mt-1.5 text-xs text-zinc-500">
            Cole na SyncPay em <b>Developer → API → Webhooks</b>, evento <b>Recebimento — Cash in</b>, com
            “Disparar para todos os produtos” ativo. Vale por conta: avisa de toda venda paga.
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
                  Nenhuma venda registrada — confira se a URL acima está colada no painel da SyncPay.
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
                <p className="mt-0.5 text-xs text-zinc-500">Resposta crua do gateway.</p>
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
                  O ideal é <b>cashin</b>: <b>all</b> traz saques junto, que não são venda.
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
                      Cadastro com evento diferente de <b>cashin</b> traz saques. Ajuste no painel da SyncPay.
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          {/* Diário dos webhooks: mostra o que a SyncPay manda de fato. É por
              aqui que dá para ver qual campo distingue venda de saque. */}
          <WebhookDiaryPanel
            provider="syncpay"
            descricao='O que a SyncPay mandou e o que o sistema fez. "Relevante" = o que vira venda.'
          />

          {/* Importar o export da SyncPay: única fonte do valor líquido do
              histórico (a API não lista vendas nem devolve o final_amount). */}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Importar histórico da SyncPay
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Gere a <b>Exportação: Transaction</b> do período e envie (PDF ou CSV). Traz o líquido exato do
              painel dela.
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
                <p className="mt-1 text-[11px] text-amber-400/80">Confira o líquido antes de aplicar.</p>
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

      {/* Stripe — cartão em moeda estrangeira (USD), para leads de fora do
          Brasil. Cobrança avulsa por ciclo (Checkout Session), sem assinatura
          nativa — o motor de renovação/downsell que já existe cuida da virada. */}
      <div className="mt-4 card p-4">
        <label className="flex items-center justify-between">
          <span className="font-medium text-white">Stripe (cartão internacional)</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-white"
            checked={stripeEnabled}
            onChange={(e) => setStripeEnabled(e.target.checked)}
          />
        </label>
        <div className="mt-3">
          <KeyLabel salva={Boolean(cfg?.stripe.hasSecretKey)}>Secret Key</KeyLabel>
        </div>
        <CampoSecreto
          name="stripe-secret-key"
          placeholder={
            cfg?.stripe.hasSecretKey ? "•••••••• (em branco = manter)" : "sk_live_... ou sk_test_..."
          }
          value={stripeSecretKey}
          onChange={setStripeSecretKey}
        />
        <div className="mt-3">
          <KeyLabel salva={Boolean(cfg?.stripe.hasWebhookSecret)}>Webhook Signing Secret</KeyLabel>
        </div>
        <CampoSecreto
          name="stripe-webhook-secret"
          placeholder={
            cfg?.stripe.hasWebhookSecret ? "•••••••• (em branco = manter)" : "whsec_..."
          }
          value={stripeWebhookSecret}
          onChange={setStripeWebhookSecret}
        />
        <p className="mt-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          <IconLock size={12} /> obtenha em dashboard.stripe.com → developers → api keys / webhooks
        </p>
        <ConnectionBadge
          testUrl="/api/payments/stripe/settings/test"
          buildBody={() => ({ secretKey: stripeSecretKey || undefined })}
          autoTest={true}
          enabled={stripeEnabled}
        />

        <TaxasBlock valor={taxas.stripe} onChange={(v) => setTaxas((t) => ({ ...t, stripe: v }))} />

        <div className="mt-4 panel p-3">
          <p className="eyebrow">webhook de recebimento</p>
          <p className="mt-1.5 text-xs text-zinc-500">
            Cadastre no Dashboard da Stripe em <b>Developers → Webhooks</b>, evento{" "}
            <b>checkout.session.completed</b>.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              readOnly
              value={stripeWebhookUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="input flex-1 font-mono text-xs"
              placeholder="carregando…"
            />
            <button
              type="button"
              onClick={copyStripeWebhook}
              disabled={!stripeWebhookUrl}
              className="btn-ghost shrink-0 px-3 py-2 text-xs"
            >
              {stripeCopied ? "Copiado ✓" : "Copiar"}
            </button>
          </div>
        </div>

        {/* Saldo — equivalente ao painel da SyncPay, mas em USD e sem o
            diagnóstico multi-caminho (a API da Stripe é direta). */}
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Saldo na Stripe
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">Total, e como ele está dividido.</p>
            </div>
            <button
              type="button"
              onClick={carregarSaldoStripe}
              disabled={stripeBalanceBusy}
              className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
            >
              {stripeBalanceBusy ? "Consultando..." : stripeBalance ? "Atualizar" : "Consultar"}
            </button>
          </div>
          {stripeBalance && (
            <div className="mt-2 space-y-0.5 text-xs">
              {!stripeBalance.connected ? (
                <p className="text-amber-400/80">
                  {stripeBalance.error || "Não foi possível consultar — confira a Secret Key acima."}
                </p>
              ) : (
                <>
                  {/* O TOTAL de cada moeda em destaque, e a divisão embaixo.
                      Antes só o disponível aparecia — e o disponível pode ser
                      NEGATIVO (taxa cobrada antes do repasse cair), o que fazia
                      uma conta com dinheiro a caminho parecer conta no
                      vermelho. Total = disponível + a caminho.

                      Uma moeda por bloco, NUNCA somadas entre si: o saldo em
                      dólar e o em real são dois dinheiros diferentes. */}
                  {(() => {
                    const linhas = [
                      {
                        currency: "USD",
                        availableCents: stripeBalance.availableCents,
                        pendingCents: stripeBalance.pendingCents,
                      },
                      ...(stripeBalance.outras || []),
                    ]
                      .filter((l) => l.availableCents !== null && l.availableCents !== undefined)
                      .map((l) => ({
                        currency: l.currency,
                        disp: l.availableCents as number,
                        vindo: l.pendingCents || 0,
                        total: (l.availableCents as number) + (l.pendingCents || 0),
                      }))
                      // Moeda zerada dos dois lados é ruído: uma conta que só
                      // opera em real não precisa ver "$ 0,00" toda vez.
                      .filter((l) => l.disp !== 0 || l.vindo !== 0)
                      .sort((a, b) => b.total - a.total);

                    if (linhas.length === 0) {
                      return <p className="text-zinc-500">Sem saldo em nenhuma moeda.</p>;
                    }

                    return linhas.map((l) => {
                      const fmt = (c: number) =>
                        (c / 100).toLocaleString(l.currency === "BRL" ? "pt-BR" : "en-US", {
                          style: "currency",
                          currency: l.currency,
                        });
                      return (
                        <div key={l.currency} className="pt-1 first:pt-0">
                          <p className="font-display text-lg font-semibold text-white">
                            {fmt(l.total)}
                            <span className="ml-1.5 font-mono text-[10px] font-normal tracking-wider text-zinc-600">
                              {l.currency}
                            </span>
                          </p>
                          <p className="text-zinc-500">
                            disponível{" "}
                            <span className={l.disp < 0 ? "text-amber-400/90" : "text-emerald-400"}>
                              {fmt(l.disp)}
                            </span>{" "}
                            · a caminho <span className="text-zinc-400">{fmt(l.vindo)}</span>
                          </p>
                        </div>
                      );
                    });
                  })()}
                </>
              )}
            </div>
          )}
        </div>

        {/* Teste de cobrança: gera um link de checkout de VERDADE (mesmo
            caminho de uma venda real), pra confirmar chave + webhook ponta a
            ponta antes de ligar o botão internacional pros leads. */}
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Testar cobrança
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Gera um link de checkout real com o valor abaixo, para conferir se a venda chega no Financeiro.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className="input w-24 py-1.5 text-xs"
              value={stripeTestCurrency}
              onChange={(e) => setStripeTestCurrency(e.target.value as MoneyCurrency)}
              aria-label="Moeda da cobrança de teste"
            >
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="MXN">MXN</option>
              <option value="EUR">EUR</option>
              <option value="BRL">BRL</option>
            </select>
            <MoneyInput
              className="w-32"
              currency={stripeTestCurrency}
              value={stripeTestAmount}
              onChange={setStripeTestAmount}
            />
            <button
              type="button"
              onClick={testarCobrancaStripe}
              disabled={stripeTestBusy || !stripeEnabled}
              className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {stripeTestBusy ? "Gerando..." : "Gerar link de teste"}
            </button>
          </div>
          {!stripeEnabled && (
            <p className="mt-1.5 text-[11px] text-zinc-600">Ative e salve a Stripe acima primeiro.</p>
          )}
          {stripeTestErr && <p className="mt-1.5 text-xs text-red-400">{stripeTestErr}</p>}
          {stripeTestUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-2">
              <a
                href={stripeTestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-xs text-emerald-300 underline underline-offset-2"
              >
                {stripeTestUrl}
              </a>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(stripeTestUrl).catch(() => {})}
                className="btn-ghost shrink-0 px-2.5 py-1 text-[11px]"
              >
                Copiar
              </button>
            </div>
          )}
        </div>

        {/* Diário dos webhooks da Stripe — mesmo painel da SyncPay, mesma
            regra de "relevante" (o que o código já trata hoje). */}
        <WebhookDiaryPanel
          provider="stripe"
          descricao='O que a Stripe mandou e o que o sistema fez. "Relevante" = checkout.session.completed.'
        />
      </div>

      {/* TERCEIROS. Não é gateway: é quem opera o bot por fora e retém a
          própria comissão no split. É a tabela que o Financeiro usa para
          separar funil de LTV nessas vendas — ver `lib/origemVenda.ts`. */}
      <div className="mt-4 card p-4">
        <p className="font-medium text-white">Terceiros (Bobz)</p>
        <p className="mt-1 text-xs text-zinc-500">
          Quem opera o bot por fora e retém a própria comissão. Cobra tabelas diferentes em cada gateway, por
          isso são duas. Taxas diferentes entre funil e LTV é o que permite separar os dois.
        </p>
        <p className="eyebrow mt-3">na syncpay</p>
        <TaxasBlock
          valor={taxas.terceirosSyncpay}
          onChange={(v) => setTaxas((t) => ({ ...t, terceirosSyncpay: v }))}
        />
        <p className="eyebrow mt-3">na stripe</p>
        <TaxasBlock
          valor={taxas.terceirosStripe}
          onChange={(v) => setTaxas((t) => ({ ...t, terceirosStripe: v }))}
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

    </div>
  );
}

/**
 * Importa o histórico de vendas de um Canal de Vendas a partir do EXPORT do
 * Telegram Desktop (`messages.html`).
 *
 * É o único jeito de recuperar o que já passou: a API do Telegram não deixa
 * um bot ler mensagem antiga de grupo. Cada relatório resolve sozinho de qual
 * bot/modelo é (pelo "ID Bot" que vem escrito nele), então um arquivo com
 * vendas de várias modelas se distribui certo.
 *
 * Só arquivo, sem campo de texto: o export é sempre a origem, e um histórico
 * de verdade (centenas de vendas) não cabe num copiar e colar.
 */
function ImportarHistoricoCard() {
  const [aberto, setAberto] = useState(false);
  const [conteudo, setConteudo] = useState("");
  const [arquivo, setArquivo] = useState("");
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{
    total: number;
    reconhecidos: number;
    vinculadosABot: number;
    transacoesCorrigidas: number;
    ignoradosBotAtivo: number;
  } | null>(null);

  async function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o MESMO arquivo de novo depois
    if (!file) return;
    setResultado(null);
    try {
      const texto = await file.text();
      if (!texto.trim()) {
        showToast("Arquivo vazio.", "error");
        return;
      }
      const vendas = (texto.match(/Pagamento\s+Aprovado/gi) || []).length;
      if (vendas === 0) {
        showToast("Não achei nenhuma venda nesse arquivo. É o messages.html do Canal de Vendas?", "error");
        return;
      }
      setConteudo(texto);
      setArquivo(`${file.name} · ${(file.size / 1024).toFixed(0)} KB · ${vendas} venda(s) encontrada(s)`);
    } catch {
      showToast("Não consegui ler o arquivo.", "error");
    }
  }

  async function importar() {
    if (!conteudo) return;
    setImportando(true);
    setResultado(null);
    try {
      const r = await apiSend<{
        ok: boolean;
        total: number;
        reconhecidos: number;
        vinculadosABot: number;
        transacoesCorrigidas: number;
        ignoradosBotAtivo: number;
      }>("/api/telegram", "POST", { action: "import-sales-reports", text: conteudo });
      setResultado(r);
      if (r.transacoesCorrigidas > 0) {
        showToast(`${r.transacoesCorrigidas} venda(s) corrigida(s) — modelo atribuída.`, "success");
      } else if (r.reconhecidos > 0) {
        showToast(`${r.reconhecidos} venda(s) lida(s), nenhuma precisava de correção.`, "success");
      } else {
        showToast("Nenhuma venda reconhecida nesse arquivo.", "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao importar.", "error");
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="mt-4 card p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-white">Importar histórico de vendas externas</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Vendas passadas de bot operado por fora, a partir do export do Canal de Vendas.
          </p>
        </div>
        <span className="shrink-0 text-xs text-zinc-500">{aberto ? "recolher ▲" : "expandir ▼"}</span>
      </button>
      {aberto && (
        <div className="mt-3">
          <p className="text-[11px] text-zinc-500">
            No <b>Telegram Desktop</b>: Canal de Vendas → ⋮ → <b>Exportar histórico do chat</b> → <b>HTML</b>,
            sem mídia. Envie o <b>messages.html</b>. Repetir não duplica venda.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="btn-ghost cursor-pointer text-xs">
              Escolher messages.html
              <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={escolherArquivo} />
            </label>
            <button onClick={importar} disabled={importando || !conteudo} className="btn-primary text-xs">
              {importando ? "Importando..." : "Importar"}
            </button>
          </div>
          {arquivo && <p className="mt-2 font-mono text-[11px] text-zinc-400">{arquivo}</p>}
          {resultado && (
            <p className="mt-3 border-t border-white/[0.06] pt-2 text-xs text-zinc-500">
              {resultado.reconhecidos} venda(s) lida(s) · {resultado.vinculadosABot} vinculada(s) a um bot ·{" "}
              <span className={resultado.transacoesCorrigidas > 0 ? "text-emerald-400" : ""}>
                {resultado.transacoesCorrigidas} corrigida(s) agora
              </span>
              {resultado.ignoradosBotAtivo > 0 && (
                <> · {resultado.ignoradosBotAtivo} ignorada(s) (bot já operado pelo Hot-Dash)</>
              )}
              {resultado.reconhecidos > resultado.vinculadosABot && (
                <span className="mt-1 block text-amber-400/80">
                  {resultado.reconhecidos - resultado.vinculadosABot} venda(s) de bot não cadastrado aqui.
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
