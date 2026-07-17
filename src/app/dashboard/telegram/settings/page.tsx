"use client";

import { useEffect, useState } from "react";
import { showToast } from "@/lib/toast";

const toast = {
  success: (msg: string) => showToast(msg, "success"),
  error: (msg: string) => showToast(msg, "error"),
  warning: (msg: string) => showToast(msg, "warning"),
};

type Profile = { id: string; name: string };

type TelegramSettings = {
  botToken: string;
  idVip: string;
  idAquecimento: string;
  enabled: boolean;
  vipPostInterval: number;
  vipTags: string;
  warmupPostInterval: number;
  warmupTags: string;
  aiPromptStyle: string;
};

export default function TelegramSettingsPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<TelegramSettings>({
    botToken: "",
    idVip: "",
    idAquecimento: "",
    enabled: false,
    vipPostInterval: 12,
    vipTags: "",
    warmupPostInterval: 24,
    warmupTags: "",
    aiPromptStyle: "provocante",
  });

  useEffect(() => {
    fetch("/api/profiles").then((r) => r.json()).then((d) => {
      if (d.profiles && d.profiles.length > 0) {
        setProfiles(d.profiles);
        setSelectedProfileId(d.profiles[0].id);
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedProfileId) return;
    setLoading(true);
    fetch(`/api/telegram?profileId=${selectedProfileId}`).then((r) => r.json()).then((d) => {
      setSettings({
        botToken: d.bot?.botToken || "",
        idVip: d.bot?.idVip || "",
        idAquecimento: d.bot?.idAquecimento || "",
        enabled: Boolean(d.autopost?.enabled),
        vipPostInterval: d.autopost?.vip_post_interval || 12,
        vipTags: d.autopost?.vip_tags || "",
        warmupPostInterval: d.autopost?.warmup_post_interval || 24,
        warmupTags: d.autopost?.warmup_tags || "",
        aiPromptStyle: d.autopost?.ai_prompt_style || "provocante",
      });
    }).finally(() => setLoading(false));
  }, [selectedProfileId]);

  const saveSettings = async () => {
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-telegram-config",
          profileId: selectedProfileId,
          ...settings,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao salvar configurações.");
      }
      toast.success("Configurações salvas com sucesso!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-ink-950 p-6 text-white pb-20">
      <div className="mb-6 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div>
          <h2 className="text-sm font-bold text-sky-400 uppercase tracking-wider">Modelo em Edição</h2>
          <p className="text-xs text-zinc-400">Todas as configurações desta página serão aplicadas ao perfil selecionado.</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)} className="w-full md:w-auto min-w-[250px] rounded-lg border border-sky-500/50 bg-ink-900 px-4 py-2.5 text-base font-semibold text-white shadow-xl focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white/90">Configurações do Telegram</h1>
          <p className="text-sm text-zinc-400">Configure o Token do Bot e as regras de automação para os grupos VIP e Prévias.</p>
        </div>
      </div>

      {loading ? (
        <div className="grid flex-1 place-items-center py-20"><div className="h-8 w-8 animate-spin rounded-full border border-white/20 border-t-white" /></div>
      ) : (
        <div className="mt-6 max-w-4xl">
          
          {/* Sessão Bot */}
          <div className="mb-8 rounded-xl border border-white/[0.06] bg-zinc-900/20 p-5 space-y-4">
            <h3 className="font-semibold text-white/90">Credenciais do Bot</h3>
            <p className="text-xs text-zinc-400 mb-4">Insira o Token fornecido pelo @BotFather. Este bot será o responsável por enviar as mensagens nos grupos.</p>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300">Bot Token</label>
              <input type="text" placeholder="Ex: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" value={settings.botToken} onChange={(e) => setSettings({ ...settings, botToken: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {/* VIP Group */}
            <div className="space-y-6">
              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/20 p-5 space-y-4">
                <h3 className="font-semibold text-sky-400 flex items-center gap-2">Canal / Grupo VIP</h3>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">ID do Grupo VIP</label>
                  <input type="text" placeholder="-100..." value={settings.idVip} onChange={(e) => setSettings({ ...settings, idVip: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div className="space-y-2 pt-2">
                  <label className="text-xs font-semibold text-zinc-300">Intervalo de Postagem (Horas)</label>
                  <input type="number" min={1} value={settings.vipPostInterval} onChange={(e) => setSettings({ ...settings, vipPostInterval: parseInt(e.target.value) || 12 })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiquetas Permitidas (Vírgula)</label>
                  <input type="text" placeholder="Ex: exclusivas, hardcore" value={settings.vipTags} onChange={(e) => setSettings({ ...settings, vipTags: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
              </div>
            </div>

            {/* Warmup Group */}
            <div className="space-y-6">
              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/20 p-5 space-y-4">
                <h3 className="font-semibold text-orange-400 flex items-center gap-2">Canal / Grupo de Prévias</h3>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">ID do Grupo de Prévias</label>
                  <input type="text" placeholder="-100..." value={settings.idAquecimento} onChange={(e) => setSettings({ ...settings, idAquecimento: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div className="space-y-2 pt-2">
                  <label className="text-xs font-semibold text-zinc-300">Intervalo de Postagem (Horas)</label>
                  <input type="number" min={1} value={settings.warmupPostInterval} onChange={(e) => setSettings({ ...settings, warmupPostInterval: parseInt(e.target.value) || 24 })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiquetas Permitidas (Vírgula)</label>
                  <input type="text" placeholder="Ex: publicas, instagram" value={settings.warmupTags} onChange={(e) => setSettings({ ...settings, warmupTags: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-8 space-y-2">
            <label className="text-sm font-medium text-zinc-300">Diretrizes de Tom da IA (Copywriting)</label>
            <select value={settings.aiPromptStyle} onChange={(e) => setSettings({ ...settings, aiPromptStyle: e.target.value })} className="max-w-md w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2.5 text-sm text-white focus:outline-none">
              <option value="provocante">Provocante e Sensual (Padrão)</option>
              <option value="romantica">Namoradinha / Romântica</option>
              <option value="fofa">Fofa e Carinhosa</option>
              <option value="safada">Explícita / Safada (Modelos Sem Censura)</option>
            </select>
          </div>

          <div className="mt-8 border-t border-white/[0.06] pt-6">
            <button type="button" onClick={saveSettings} className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold hover:bg-sky-500 transition-colors">Salvar Configurações</button>
          </div>
        </div>
      )}
    </div>
  );
}
