"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconRefresh } from "@/components/icons";
import type { AiSettingsPublic } from "@/lib/settings";
import { BackToSettings, ConnectionBadge } from "../_shared";

// Usados só se a busca ao vivo (lista real de modelos do provedor) falhar.
const FALLBACK_OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];
const FALLBACK_GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-1.5-pro",
];

/** Busca a lista de modelos ao vivo na API do provedor (nunca lança). */
async function fetchAiModels(
  provider: "openai" | "gemini",
  apiKey: string,
  setModels: (m: string[] | null) => void,
  setLoading: (b: boolean) => void,
  setError: (m: string | null) => void,
) {
  setLoading(true);
  try {
    const res = await apiSend<{ ok: boolean; models?: string[]; message?: string }>(
      "/api/settings/ai/models",
      "POST",
      { provider, apiKey: apiKey || undefined },
    );
    if (res.ok && res.models && res.models.length > 0) {
      setModels(res.models);
      setError(null);
    } else {
      setModels(null);
      setError(res.message || "Não foi possível carregar a lista ao vivo.");
    }
  } catch (e) {
    setModels(null);
    setError(e instanceof Error ? e.message : "Falha ao carregar modelos.");
  } finally {
    setLoading(false);
  }
}

export default function AiSettingsPage() {
  const [cfg, setCfg] = useState<AiSettingsPublic | null>(null);
  const [openaiEnabled, setOpenaiEnabled] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState(FALLBACK_OPENAI_MODELS[0]);
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");
  const [openaiModels, setOpenaiModels] = useState<string[] | null>(null);
  const [openaiModelsLoading, setOpenaiModelsLoading] = useState(false);
  const [openaiModelsError, setOpenaiModelsError] = useState<string | null>(null);
  const [geminiEnabled, setGeminiEnabled] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState(FALLBACK_GEMINI_MODELS[0]);
  const [geminiModels, setGeminiModels] = useState<string[] | null>(null);
  const [geminiModelsLoading, setGeminiModelsLoading] = useState(false);
  const [geminiModelsError, setGeminiModelsError] = useState<string | null>(null);

  const [grokEnabled, setGrokEnabled] = useState(false);
  const [grokKey, setGrokKey] = useState("");
  const [grokModel, setGrokModel] = useState("grok-4.20-0309-reasoning");
  const [grokBaseUrl, setGrokBaseUrl] = useState("https://api.x.ai/v1/chat/completions");

  const [sightengineEnabled, setSightengineEnabled] = useState(false);
  const [sightengineUser, setSightengineUser] = useState("");
  const [sightengineKey, setSightengineKey] = useState("");

  const [magnificEnabled, setMagnificEnabled] = useState(false);
  const [magnificKey, setMagnificKey] = useState("");

  const [nudenetEnabled, setNudenetEnabled] = useState(false);
  const [nudenetUrl, setNudenetUrl] = useState("");
  const [nudenetToken, setNudenetToken] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const openaiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geminiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiGet<{ settings: AiSettingsPublic }>("/api/settings/ai")
      .then((d) => {
        setCfg(d.settings);
        setOpenaiEnabled(d.settings.openai.enabled);
        setOpenaiModel(d.settings.openai.model);
        setOpenaiBaseUrl(d.settings.openai.baseUrl || "");
        setGeminiEnabled(d.settings.gemini.enabled);
        setGeminiModel(d.settings.gemini.model);
        setGrokEnabled(d.settings.grok.enabled);
        setGrokModel(d.settings.grok.model);
        setGrokBaseUrl(d.settings.grok.baseUrl || "https://api.x.ai/v1");
        setSightengineEnabled(d.settings.sightengine.enabled);
        setMagnificEnabled(d.settings.magnific?.enabled || false);
        setNudenetEnabled(d.settings.nudenet?.enabled || false);
        setNudenetUrl(d.settings.nudenet?.baseUrl || "");
        if (d.settings.openai.hasKey) {
          fetchAiModels("openai", "", setOpenaiModels, setOpenaiModelsLoading, setOpenaiModelsError);
        }
        if (d.settings.gemini.hasKey) {
          fetchAiModels("gemini", "", setGeminiModels, setGeminiModelsLoading, setGeminiModelsError);
        }
      })
      .catch(() => {});
  }, []);

  // Rebusca a lista com debounce enquanto o usuário digita uma chave nova.
  useEffect(() => {
    if (!openaiEnabled || !openaiKey.trim()) return;
    if (openaiDebounceRef.current) clearTimeout(openaiDebounceRef.current);
    openaiDebounceRef.current = setTimeout(() => {
      fetchAiModels("openai", openaiKey, setOpenaiModels, setOpenaiModelsLoading, setOpenaiModelsError);
    }, 600);
    return () => {
      if (openaiDebounceRef.current) clearTimeout(openaiDebounceRef.current);
    };
  }, [openaiKey, openaiEnabled]);

  useEffect(() => {
    if (!geminiEnabled || !geminiKey.trim()) return;
    if (geminiDebounceRef.current) clearTimeout(geminiDebounceRef.current);
    geminiDebounceRef.current = setTimeout(() => {
      fetchAiModels("gemini", geminiKey, setGeminiModels, setGeminiModelsLoading, setGeminiModelsError);
    }, 600);
    return () => {
      if (geminiDebounceRef.current) clearTimeout(geminiDebounceRef.current);
    };
  }, [geminiKey, geminiEnabled]);

  const openaiList = openaiModels && openaiModels.length > 0 ? openaiModels : FALLBACK_OPENAI_MODELS;
  const openaiOptions = openaiModel && !openaiList.includes(openaiModel) ? [openaiModel, ...openaiList] : openaiList;
  const geminiList = geminiModels && geminiModels.length > 0 ? geminiModels : FALLBACK_GEMINI_MODELS;
  const geminiOptions = geminiModel && !geminiList.includes(geminiModel) ? [geminiModel, ...geminiList] : geminiList;

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const { settings } = await apiSend<{ settings: AiSettingsPublic }>(
        "/api/settings/ai",
        "PATCH",
        {
          openai: { enabled: openaiEnabled, model: openaiModel, baseUrl: openaiBaseUrl, ...(openaiKey ? { apiKey: openaiKey } : {}) },
          gemini: { enabled: geminiEnabled, model: geminiModel, ...(geminiKey ? { apiKey: geminiKey } : {}) },
          grok: { enabled: grokEnabled, model: grokModel, baseUrl: grokBaseUrl, ...(grokKey ? { apiKey: grokKey } : {}) },
          sightengine: { enabled: sightengineEnabled, ...(sightengineKey ? { apiKey: sightengineKey } : {}), ...(sightengineUser ? { apiUser: sightengineUser } : {}) },
          magnific: { enabled: magnificEnabled, ...(magnificKey ? { apiKey: magnificKey } : {}) },
          nudenet: { enabled: nudenetEnabled, baseUrl: nudenetUrl, ...(nudenetToken ? { apiKey: nudenetToken } : {}) },
        },
      );
      setCfg(settings);
      setOpenaiKey("");
      setGeminiKey("");
      setGrokKey("");
      setSightengineKey("");
      setSightengineUser("");
      setMagnificKey("");
      setNudenetToken("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackToSettings />
      <p className="eyebrow mt-4">inteligência artificial</p>
      <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Conexão com IA</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Usada para gerar legendas e para montar o Cronograma automaticamente.
        Ative um ou os dois provedores abaixo e cole a chave de API — ela fica
        criptografada (AES-256) no servidor. Qual usar é escolhido na hora de
        cada atividade, não há um provedor fixo.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {/* OpenAI */}
        <div className="card p-4">
          <label className="flex items-center justify-between">
            <span className="font-medium text-white">OpenAI</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-white"
              checked={openaiEnabled}
              onChange={(e) => {
                setOpenaiEnabled(e.target.checked);
                if (e.target.checked && openaiModels === null && !openaiModelsLoading) {
                  fetchAiModels("openai", openaiKey, setOpenaiModels, setOpenaiModelsLoading, setOpenaiModelsError);
                }
              }}
            />
          </label>
          {openaiEnabled && (
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <div>
                <label className="eyebrow mb-1.5 flex items-center justify-between">
                  <span>Modelo</span>
                  <button
                    type="button"
                    onClick={() =>
                      fetchAiModels("openai", openaiKey, setOpenaiModels, setOpenaiModelsLoading, setOpenaiModelsError)
                    }
                    disabled={openaiModelsLoading}
                    className="normal-case text-zinc-500 hover:text-white disabled:opacity-40"
                    title="Atualizar lista de modelos"
                  >
                    <IconRefresh size={13} />
                  </button>
                </label>
                {openaiModelsLoading ? (
                  <select className="input" disabled>
                    <option>Carregando modelos…</option>
                  </select>
                ) : (
                  <select className="input" value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)}>
                    {openaiOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
                {openaiModelsError && (
                  <p className="mt-1 text-[11px] text-amber-500">
                    Não foi possível carregar a lista ao vivo — mostrando modelos padrão.
                  </p>
                )}
              </div>
              
              <div>
                <label className="eyebrow mb-1.5 block">API key</label>
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
              </div>

              <div className="md:col-span-2">
                <label className="eyebrow mb-1.5 block">Base URL (opcional para OpenRouter)</label>
                <input
                  className="input font-mono"
                  type="text"
                  placeholder="https://api.openai.com/v1"
                  value={openaiBaseUrl}
                  onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                />
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Padrão: OpenAI. Use para OpenRouter ou outras APIs.
                </p>
              </div>

              <div className="md:col-span-2">
                <ConnectionBadge
                  testUrl="/api/settings/ai/test"
                  buildBody={() => ({ provider: "openai", apiKey: openaiKey || undefined, baseUrl: openaiBaseUrl || undefined })}
                  autoTest={true}
                  enabled={openaiEnabled}
                />
              </div>
            </div>
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
              onChange={(e) => {
                setGeminiEnabled(e.target.checked);
                if (e.target.checked && geminiModels === null && !geminiModelsLoading) {
                  fetchAiModels("gemini", geminiKey, setGeminiModels, setGeminiModelsLoading, setGeminiModelsError);
                }
              }}
            />
          </label>
          {geminiEnabled && (
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <div>
                <label className="eyebrow mb-1.5 flex items-center justify-between">
                  <span>Modelo</span>
                  <button
                    type="button"
                    onClick={() =>
                      fetchAiModels("gemini", geminiKey, setGeminiModels, setGeminiModelsLoading, setGeminiModelsError)
                    }
                    disabled={geminiModelsLoading}
                    className="normal-case text-zinc-500 hover:text-white disabled:opacity-40"
                    title="Atualizar lista de modelos"
                  >
                    <IconRefresh size={13} />
                  </button>
                </label>
                {geminiModelsLoading ? (
                  <select className="input" disabled>
                    <option>Carregando modelos…</option>
                  </select>
                ) : (
                  <select className="input" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)}>
                    {geminiOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
                {geminiModelsError && (
                  <p className="mt-1 text-[11px] text-amber-500">
                    Não foi possível carregar a lista ao vivo — mostrando modelos padrão.
                  </p>
                )}
              </div>
              
              <div>
                <label className="eyebrow mb-1.5 block">API key</label>
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
              </div>

              <div className="md:col-span-2">
                <ConnectionBadge
                  testUrl="/api/settings/ai/test"
                  buildBody={() => ({ provider: "gemini", apiKey: geminiKey || undefined })}
                  autoTest={true}
                  enabled={geminiEnabled}
                />
              </div>
            </div>
          )}
        </div>

        {/* Grok (xAI) / OpenRouter */}
        <div className="card p-4">
          <label className="flex items-center justify-between">
            <span className="font-medium text-white">Grok (xAI) / Sem Censura</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-white"
              checked={grokEnabled}
              onChange={(e) => setGrokEnabled(e.target.checked)}
            />
          </label>
          <p className="mt-2 text-xs text-zinc-500">
            Usado exclusivamente como o "Cérebro" sem censura do seu Agente de Vendas no WhatsApp (xAI ou OpenRouter).
          </p>
          {grokEnabled && (
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <div>
                <label className="eyebrow mb-1.5 block">Nome do Modelo</label>
                <input
                  className="input font-mono"
                  type="text"
                  placeholder="Ex: grok-4.20-0309-reasoning"
                  value={grokModel}
                  onChange={(e) => setGrokModel(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow mb-1.5 block">API Key</label>
                <input
                  className="input font-mono"
                  type="password"
                  placeholder={cfg?.grok.hasKey ? "•••••••• (em branco = manter)" : "xoxb-..."}
                  value={grokKey}
                  onChange={(e) => setGrokKey(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="eyebrow mb-1.5 block">Base URL</label>
                <input
                  className="input font-mono"
                  type="text"
                  placeholder="https://api.x.ai/v1/chat/completions"
                  value={grokBaseUrl}
                  onChange={(e) => setGrokBaseUrl(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <ConnectionBadge
                  testUrl="/api/settings/ai/test"
                  buildBody={() => ({ provider: "grok", apiKey: grokKey || undefined, baseUrl: grokBaseUrl || undefined })}
                  autoTest={true}
                  enabled={grokEnabled}
                />
              </div>
            </div>
          )}
        </div>

        {/* Sightengine (Censura de Imagem) */}
        <div className="card p-4">
          <label className="flex items-center justify-between">
            <span className="font-medium text-white">Sightengine (IA de Censura de Imagens)</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-white"
              checked={sightengineEnabled}
              onChange={(e) => setSightengineEnabled(e.target.checked)}
            />
          </label>
          <p className="mt-2 text-xs text-zinc-500">
            Usado exclusivamente para varrer fotos buscando conteúdo adulto (seios e genitálias) para a nossa ferramenta de Censura Interativa do Editor. Essa API é a única sem "filtros morais" que retorna coordenadas (Bounding Boxes).
          </p>
          {sightengineEnabled && (
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <div>
                <label className="eyebrow mb-1.5 block">API User</label>
                <input
                  className="input font-mono"
                  type="text"
                  placeholder={cfg?.sightengine.apiUser ? "•••••••• (em branco = manter)" : "903842..."}
                  value={sightengineUser}
                  onChange={(e) => setSightengineUser(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow mb-1.5 block">API Secret</label>
                <input
                  className="input font-mono"
                  type="password"
                  placeholder={cfg?.sightengine.hasKey ? "•••••••• (em branco = manter)" : "sk_..."}
                  value={sightengineKey}
                  onChange={(e) => setSightengineKey(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <ConnectionBadge
                  testUrl="/api/settings/ai/test"
                  buildBody={() => ({ provider: "sightengine", apiKey: sightengineKey || undefined, apiUser: sightengineUser || undefined })}
                  autoTest={true}
                  enabled={sightengineEnabled}
                />
              </div>
            </div>
          )}
        </div>

        {/* Magnific AI (SeeDream & Kling) */}
        <div className="card p-4">
          <label className="flex items-center justify-between">
            <span className="font-medium text-white">Magnific AI (SeeDream & Kling)</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-white"
              checked={magnificEnabled}
              onChange={(e) => setMagnificEnabled(e.target.checked)}
            />
          </label>
          <p className="mt-2 text-xs text-zinc-500">
            Usado no Estúdio de Criação para edição mágica de fotos com SeeDream (consistência de rosto/corpo) e geração de vídeos/dancinhas com Kling (Motion Control). Ambos são acessados através da API do Magnific.
          </p>
          {magnificEnabled && (
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <div className="md:col-span-2">
                <label className="eyebrow mb-1.5 block">Chave API Magnific</label>
                <input
                  className="input font-mono"
                  type="password"
                  placeholder={cfg?.magnific?.hasKey ? "•••••••• (em branco = manter)" : "sk_..."}
                  value={magnificKey}
                  onChange={(e) => setMagnificKey(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <ConnectionBadge
                  testUrl="/api/settings/ai/test"
                  buildBody={() => ({ provider: "magnific", apiKey: magnificKey || undefined })}
                  autoTest={true}
                  enabled={magnificEnabled}
                />
              </div>
            </div>
          )}
        </div>

        {/* NudeNet (Censura por IA — detecção de partes explícitas) */}
        <div className="card p-4">
          <label className="flex items-center justify-between">
            <span className="font-medium text-white">NudeNet (Censura por IA)</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-white"
              checked={nudenetEnabled}
              onChange={(e) => setNudenetEnabled(e.target.checked)}
            />
          </label>
          <p className="mt-2 text-xs text-zinc-500">
            Motor da <b>Censura de imagem com IA</b>: detecta seios, genitálias, bunda e ânus
            (com coordenadas) para cobrir automaticamente. Agora vem{" "}
            <b>embutido no próprio app</b> (modelo <span className="font-mono">320n.onnx</span>) —
            já funciona de fábrica, <b>sem precisar subir nenhum serviço</b>.
          </p>

          {/* Status do motor embutido — testa mesmo sem URL. */}
          <div className="mt-3">
            <ConnectionBadge
              testUrl="/api/settings/ai/test"
              buildBody={() => ({ provider: "nudenet", baseUrl: nudenetUrl || undefined, apiKey: nudenetToken || undefined })}
              autoTest={true}
              enabled={true}
            />
          </div>

          {nudenetEnabled && (
            <div className="grid gap-4 md:grid-cols-2 mt-4 border-t border-white/10 pt-4">
              <p className="md:col-span-2 text-xs text-zinc-500">
                <b>Avançado (opcional):</b> se preferir, aponte para um serviço{" "}
                <span className="font-mono">nudenet-service</span> externo em vez do motor
                embutido. Deixe a URL em branco para continuar usando o motor embutido.
              </p>
              <div className="md:col-span-2">
                <label className="eyebrow mb-1.5 block">URL do serviço (opcional)</label>
                <input
                  className="input font-mono"
                  type="text"
                  placeholder="http://nudenet-service:8000"
                  value={nudenetUrl}
                  onChange={(e) => setNudenetUrl(e.target.value)}
                />
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Em branco = usa o motor embutido
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="eyebrow mb-1.5 block">Token (opcional)</label>
                <input
                  className="input font-mono"
                  type="password"
                  placeholder={cfg?.nudenet?.hasKey ? "•••••••• (em branco = manter)" : "só se definiu NUDENET_API_KEY no serviço"}
                  value={nudenetToken}
                  onChange={(e) => setNudenetToken(e.target.value)}
                />
              </div>
            </div>
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
    </div>
  );
}
