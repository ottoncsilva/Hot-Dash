"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import {
  IconChevronUp,
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconLock,
  IconTag,
  IconTrash,
  IconPlus,
} from "@/components/icons";
import { NAV_ITEMS, normalizeMenu, type MenuEntry } from "@/lib/navItems";
import type { AiSettingsPublic, GoogleSheetsSettingsPublic, PaymentSettingsPublic } from "@/lib/settings";
import { TAG_COLORS, type Tag } from "@/lib/types";
import { useConfirm } from "@/hooks/useConfirm";

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
      <TagSettings />
      <PaymentSettings />
      <AiSettings />
      <GoogleSheetsSettings />
      <SecurityNote />
    </div>
  );
}

/** Botão "Testar conexão" + luz de status (usado por SyncPay e por cada provedor de IA). */
function ConnectionBadge({
  testUrl,
  buildBody,
}: {
  testUrl: string;
  buildBody: () => Record<string, unknown>;
}) {
  const [status, setStatus] = useState<"idle" | "testing" | "connected" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function test() {
    setStatus("testing");
    setMessage(null);
    try {
      const res = await apiSend<{ connected: boolean; message?: string }>(testUrl, "POST", buildBody());
      if (res.connected) {
        setStatus("connected");
      } else {
        setStatus("error");
        setMessage(res.message || "Não foi possível conectar.");
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Falha ao testar.");
    }
  }

  const dotClass =
    status === "connected" ? "bg-emerald-400" : status === "error" ? "bg-red-400" : "bg-zinc-600";
  const textClass =
    status === "connected" ? "text-emerald-400" : status === "error" ? "text-red-400" : "text-zinc-500";
  const label =
    status === "connected"
      ? "Conectado"
      : status === "error"
        ? message || "Falha na conexão"
        : status === "testing"
          ? "Testando..."
          : "Não testado";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={test}
        disabled={status === "testing"}
        className="btn-ghost px-3 py-1.5 text-xs"
      >
        {status === "testing" ? "Testando..." : "Testar conexão"}
      </button>
      <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span className={textClass}>{label}</span>
      </span>
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
    <section id="menu" className="mt-8 scroll-mt-20">
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

// ---- Etiquetas ----
function TagSettings() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  function load() {
    apiGet<{ tags: Tag[] }>("/api/tags")
      .then((d) => setTags(d.tags))
      .catch(() => {});
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { tag } = await apiSend<{ tag: Tag }>("/api/tags", "POST", {
        name: name.trim(),
        color,
      });
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm("Excluir esta etiqueta? Ela será removida de todas as mídias."))) return;
    await apiSend(`/api/tags/${id}`, "DELETE");
    setTags((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <section id="etiquetas" className="mt-10 scroll-mt-20">
      <p className="eyebrow">organização</p>
      <h2 className="mt-1.5 flex items-center gap-2 font-display text-lg font-semibold">
        <IconTag size={18} /> Etiquetas
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        Crie etiquetas para categorizar fotos e vídeos na Biblioteca de Mídia
        — depois é só aplicar em cada item e filtrar/agrupar por elas.
      </p>

      {tags.length > 0 && (
        <div className="mt-4 card divide-y divide-white/[0.06]">
          {tags.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              <span className="flex-1 text-sm text-zinc-200">{t.name}</span>
              <button
                onClick={() => remove(t.id)}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-red-400"
                aria-label="Excluir"
              >
                <IconTrash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={create} className="mt-4 card p-4">
        <label className="eyebrow mb-1.5 block">Nova etiqueta</label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input flex-1"
            placeholder="Ex.: Instagram, Aprovada, Rascunho..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-1.5">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="grid h-7 w-7 place-items-center rounded-full border-2 transition-all"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? "#fff" : "transparent",
                }}
                aria-label={c}
              />
            ))}
          </div>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="btn-primary"
          >
            <IconPlus size={16} /> Criar
          </button>
        </div>
      </form>

      {ConfirmDialog}
    </section>
  );
}

// ---- Pagamentos ----
function PaymentSettings() {
  const [cfg, setCfg] = useState<PaymentSettingsPublic | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncClientId, setSyncClientId] = useState("");
  const [syncClientSecret, setSyncClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: PaymentSettingsPublic }>("/api/payments/settings")
      .then((d) => {
        setCfg(d.settings);
        setSyncEnabled(d.settings.syncpay.enabled);
        setSyncClientId(d.settings.syncpay.clientId);
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

      <FinanceSettingsCard />
    </section>
  );
}

// ---- Financeiro manual (gastos com anúncios + imposto) ----
function FinanceSettingsCard() {
  const [adSpend, setAdSpend] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ finance: { adSpendCents: number; taxRatePercent: number } }>(
      "/api/payments/finance-settings",
    )
      .then((d) => {
        setAdSpend((d.finance.adSpendCents / 100).toFixed(2).replace(".", ","));
        setTaxRate(String(d.finance.taxRatePercent));
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await apiSend("/api/payments/finance-settings", "PATCH", {
        adSpendCents: Math.round(Number(adSpend.replace(",", ".")) * 100) || 0,
        taxRatePercent: Number(taxRate) || 0,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 card p-4">
      <p className="font-medium text-white">Financeiro (manual)</p>
      <p className="mt-1 text-xs text-zinc-500">
        Sem integração com plataformas de anúncio: informe aqui os gastos do
        período em análise e a alíquota de imposto para o painel calcular
        ROAS, ROI, Lucro, Margem e Imposto no Dashboard Financeiro.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="eyebrow mb-1.5 block">Gastos com anúncios (R$)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            value={adSpend}
            onChange={(e) => setAdSpend(e.target.value)}
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Alíquota de imposto (%)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-ghost">
          {saving ? "Salvando..." : "Salvar financeiro"}
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

// ---- Conexão com IA (OpenAI / Google Gemini) ----
const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];
const GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-1.5-pro",
];

function AiSettings() {
  const [cfg, setCfg] = useState<AiSettingsPublic | null>(null);
  const [openaiEnabled, setOpenaiEnabled] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState(OPENAI_MODELS[0]);
  const [geminiEnabled, setGeminiEnabled] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState(GEMINI_MODELS[0]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: AiSettingsPublic }>("/api/settings/ai")
      .then((d) => {
        setCfg(d.settings);
        setOpenaiEnabled(d.settings.openai.enabled);
        setOpenaiModel(d.settings.openai.model);
        setGeminiEnabled(d.settings.gemini.enabled);
        setGeminiModel(d.settings.gemini.model);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const { settings } = await apiSend<{ settings: AiSettingsPublic }>(
        "/api/settings/ai",
        "PATCH",
        {
          openai: { enabled: openaiEnabled, model: openaiModel, ...(openaiKey ? { apiKey: openaiKey } : {}) },
          gemini: { enabled: geminiEnabled, model: geminiModel, ...(geminiKey ? { apiKey: geminiKey } : {}) },
        },
      );
      setCfg(settings);
      setOpenaiKey("");
      setGeminiKey("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="ia" className="mt-10 scroll-mt-20">
      <p className="eyebrow">inteligência artificial</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">Conexão com IA</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Usada para gerar legendas e para montar o Cronograma automaticamente.
        Ative um ou os dois provedores abaixo e cole a chave de API — ela fica
        criptografada (AES-256) no servidor. Qual usar é escolhido na hora de
        cada atividade, não há um provedor fixo.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {/* OpenAI */}
        <div className="card p-4">
          <label className="flex items-center justify-between">
            <span className="font-medium text-white">OpenAI</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-white"
              checked={openaiEnabled}
              onChange={(e) => setOpenaiEnabled(e.target.checked)}
            />
          </label>
          {openaiEnabled && (
            <>
              <label className="eyebrow mb-1.5 mt-3 block">Modelo</label>
              <select className="input" value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)}>
                {OPENAI_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <label className="eyebrow mb-1.5 mt-3 block">API key</label>
              <input
                className="input font-mono"
                type="password"
                placeholder={cfg?.openai.hasKey ? "•••••••• (em branco = manter)" : "sk-..."}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
              />
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                platform.openai.com → api keys
              </p>
              <ConnectionBadge
                testUrl="/api/settings/ai/test"
                buildBody={() => ({ provider: "openai", apiKey: openaiKey || undefined })}
              />
            </>
          )}
        </div>

        {/* Google Gemini */}
        <div className="card p-4">
          <label className="flex items-center justify-between">
            <span className="font-medium text-white">Google Gemini</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-white"
              checked={geminiEnabled}
              onChange={(e) => setGeminiEnabled(e.target.checked)}
            />
          </label>
          {geminiEnabled && (
            <>
              <label className="eyebrow mb-1.5 mt-3 block">Modelo</label>
              <select className="input" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)}>
                {GEMINI_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <label className="eyebrow mb-1.5 mt-3 block">API key</label>
              <input
                className="input font-mono"
                type="password"
                placeholder={cfg?.gemini.hasKey ? "•••••••• (em branco = manter)" : "AIza..."}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
              />
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                aistudio.google.com → get api key
              </p>
              <ConnectionBadge
                testUrl="/api/settings/ai/test"
                buildBody={() => ({ provider: "gemini", apiKey: geminiKey || undefined })}
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Salvando..." : "Salvar IA"}
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

// ---- Integração Google Sheets ----
function GoogleSheetsSettings() {
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
    <section id="google-sheets" className="mt-10 scroll-mt-20">
      <p className="eyebrow">automação</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">Google Sheets</h2>
      <p className="mt-1 text-sm text-zinc-500">
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
    </section>
  );
}

function SecurityNote() {
  return (
    <section id="seguranca" className="mt-10 scroll-mt-20">
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
