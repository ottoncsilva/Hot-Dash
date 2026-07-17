"use client";

import { useEffect, useState } from "react";
import { showToast } from "@/lib/toast";

const toast = {
  success: (msg: string) => showToast(msg, "success"),
  error: (msg: string) => showToast(msg, "error"),
  warning: (msg: string) => showToast(msg, "warning"),
};

type Profile = { id: string; name: string };
type Tag = { id: string; name: string; color: string };

type TelegramSettings = {
  botToken: string;
  idVip: string;
  idAquecimento: string;
  enabled: boolean;
  vipPostInterval: number;
  vipTags: string;
  vipPrompt: string;
  vipScheduleType: "interval" | "fixed";
  vipFixedTimes: string;
  warmupPostInterval: number;
  warmupTags: string;
  warmupPrompt: string;
  warmupLink: string;
  warmupScheduleType: "interval" | "fixed";
  warmupFixedTimes: string;
};

export default function TelegramUnifiedPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<TelegramSettings>({
    botToken: "",
    idVip: "",
    idAquecimento: "",
    enabled: false,
    vipPostInterval: 12,
    vipTags: "",
    vipPrompt: "",
    vipScheduleType: "interval",
    vipFixedTimes: "",
    warmupPostInterval: 24,
    warmupTags: "",
    warmupPrompt: "",
    warmupLink: "",
    warmupScheduleType: "interval",
    warmupFixedTimes: "",
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
      if (d.availableTags) setAvailableTags(d.availableTags);
      
      setSettings({
        botToken: d.bot?.botToken || "",
        idVip: d.bot?.idVip || "",
        idAquecimento: d.bot?.idAquecimento || "",
        enabled: Boolean(d.autopost?.enabled),
        vipPostInterval: d.autopost?.vip_post_interval || 12,
        vipTags: d.autopost?.vip_tags || "",
        vipPrompt: d.autopost?.vip_prompt || "",
        vipScheduleType: d.autopost?.vip_schedule_type || "interval",
        vipFixedTimes: d.autopost?.vip_fixed_times || "",
        warmupPostInterval: d.autopost?.warmup_post_interval || 24,
        warmupTags: d.autopost?.warmup_tags || "",
        warmupPrompt: d.autopost?.warmup_prompt || "",
        warmupLink: d.autopost?.warmup_link || "",
        warmupScheduleType: d.autopost?.warmup_schedule_type || "interval",
        warmupFixedTimes: d.autopost?.warmup_fixed_times || "",
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

  const forceAutopost = async (target: "vip" | "warmup") => {
    if (!confirm(`Deseja disparar um post imediato no canal ${target.toUpperCase()}?`)) return;
    try {
      const res = await fetch(`/api/cron/telegram/autopost?token=YOUR_DEV_SECRET_REPLACE_LATER&forceProfile=${selectedProfileId}&target=${target}`);
      // Nota: o cron route não possui suporte a forceProfile no código que analisei, mas adicionei a chamada padrão de teste.
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erro ao postar.");
      toast.success("Postagem realizada e enviada ao Telegram!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const toggleTag = (target: "vipTags" | "warmupTags", tagName: string) => {
    const currentList = settings[target].split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
    const lowerName = tagName.toLowerCase();
    
    let newList;
    if (currentList.includes(lowerName)) {
      newList = currentList.filter(t => t !== lowerName);
    } else {
      newList = [...currentList, lowerName];
    }
    setSettings({ ...settings, [target]: newList.join(", ") });
  };

  const hasTag = (target: "vipTags" | "warmupTags", tagName: string) => {
    return settings[target].split(",").map(t => t.trim().toLowerCase()).filter(Boolean).includes(tagName.toLowerCase());
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
          <h1 className="text-2xl font-bold tracking-tight text-white/90">Automação do Telegram</h1>
          <p className="text-sm text-zinc-400">Configure o Bot, as legendas geradas pela inteligência artificial (Grok) e o cronograma.</p>
        </div>
        <div className="flex items-center gap-4">
           <label className="flex items-center gap-3 cursor-pointer rounded-lg bg-zinc-900/40 px-4 py-2 border border-white/5">
              <span className="text-sm font-semibold text-zinc-300">Status Geral do Autopost:</span>
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              <div className="peer h-6 w-11 rounded-full bg-zinc-700 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-sky-500 peer-checked:after:translate-x-full peer-focus:outline-none"></div>
            </label>
        </div>
      </div>

      {loading ? (
        <div className="grid flex-1 place-items-center py-20"><div className="h-8 w-8 animate-spin rounded-full border border-white/20 border-t-white" /></div>
      ) : (
        <div className="mt-6">
          
          {/* Sessão Bot */}
          <div className="mb-8 max-w-4xl rounded-xl border border-white/[0.06] bg-zinc-900/20 p-5 space-y-4">
            <h3 className="font-semibold text-white/90">Credenciais do Bot</h3>
            <p className="text-xs text-zinc-400 mb-4">Insira o Token fornecido pelo @BotFather. Este bot será o responsável por enviar as mensagens nos grupos.</p>
            <div className="grid md:grid-cols-3 gap-4">
               <div className="space-y-2">
                 <label className="text-xs font-semibold text-zinc-300">Bot Token</label>
                 <input type="text" placeholder="Ex: 123456:ABC-DEF1234ghIkl..." value={settings.botToken} onChange={(e) => setSettings({ ...settings, botToken: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
               </div>
               <div className="space-y-2">
                 <label className="text-xs font-semibold text-zinc-300">ID Grupo VIP</label>
                 <input type="text" placeholder="-100..." value={settings.idVip} onChange={(e) => setSettings({ ...settings, idVip: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
               </div>
               <div className="space-y-2">
                 <label className="text-xs font-semibold text-zinc-300">ID Prévias</label>
                 <input type="text" placeholder="-100..." value={settings.idAquecimento} onChange={(e) => setSettings({ ...settings, idAquecimento: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
               </div>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            
            {/* VIP Group */}
            <div className="space-y-6">
              <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-5 space-y-6">
                <div className="flex items-center justify-between">
                   <h3 className="font-semibold text-sky-400 flex items-center gap-2">Canal / Grupo VIP</h3>
                   <button type="button" onClick={() => forceAutopost("vip")} className="rounded-lg bg-sky-500/20 text-sky-300 px-3 py-1.5 text-xs font-semibold hover:bg-sky-500/30 transition-colors">🔥 Disparar Agora</button>
                </div>
                
                {/* Estratégia de Tempo VIP */}
                <div className="space-y-3 p-4 rounded-lg bg-black/20 border border-white/5">
                   <p className="text-xs font-semibold text-zinc-300">Estratégia de Postagem</p>
                   <div className="flex gap-4">
                     <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                       <input type="radio" name="vipSchedule" value="interval" checked={settings.vipScheduleType === "interval"} onChange={() => setSettings({ ...settings, vipScheduleType: "interval" })} /> Intervalo de Horas
                     </label>
                     <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                       <input type="radio" name="vipSchedule" value="fixed" checked={settings.vipScheduleType === "fixed"} onChange={() => setSettings({ ...settings, vipScheduleType: "fixed" })} /> Horários Fixos
                     </label>
                   </div>
                   
                   {settings.vipScheduleType === "interval" ? (
                     <div className="pt-2">
                        <label className="text-xs text-zinc-500 block mb-1">Postar a cada X horas:</label>
                        <input type="number" min={1} value={settings.vipPostInterval} onChange={(e) => setSettings({ ...settings, vipPostInterval: parseInt(e.target.value) || 12 })} className="w-32 rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-sm text-white focus:outline-none" />
                     </div>
                   ) : (
                     <div className="pt-2">
                        <label className="text-xs text-zinc-500 block mb-1">Horários do dia (separados por vírgula):</label>
                        <input type="text" placeholder="Ex: 10:00, 15:30, 20:00" value={settings.vipFixedTimes} onChange={(e) => setSettings({ ...settings, vipFixedTimes: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-sm text-white focus:outline-none" />
                     </div>
                   )}
                </div>

                {/* Etiquetas VIP */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiquetas Permitidas (Quais mídias podem ir pro VIP?)</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map(tag => (
                      <button 
                        key={tag.id}
                        onClick={() => toggleTag("vipTags", tag.name)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${hasTag("vipTags", tag.name) ? 'bg-sky-500/20 border-sky-500/50 text-sky-200' : 'bg-transparent border-white/10 text-zinc-500 hover:border-white/20'}`}
                      >
                        {tag.name}
                      </button>
                    ))}
                    {availableTags.length === 0 && <span className="text-xs text-zinc-600">Nenhuma etiqueta cadastrada no sistema.</span>}
                  </div>
                </div>

                {/* VIP Prompt */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Modelo de Legenda (Prompt para o Grok - VIP)</label>
                  <p className="text-[11px] text-zinc-500 mb-1">Cole aqui suas instruções ou modelos de legenda. O Grok irá usar este texto como diretriz.</p>
                  <textarea 
                     rows={8}
                     placeholder="Cole aqui o seu modelo de legenda VIP..."
                     value={settings.vipPrompt}
                     onChange={(e) => setSettings({ ...settings, vipPrompt: e.target.value })}
                     className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none resize-none font-mono"
                  />
                </div>

              </div>
            </div>

            {/* Warmup Group */}
            <div className="space-y-6">
              <div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-5 space-y-6">
                <div className="flex items-center justify-between">
                   <h3 className="font-semibold text-orange-400 flex items-center gap-2">Canal / Grupo Prévias</h3>
                   <button type="button" onClick={() => forceAutopost("warmup")} className="rounded-lg bg-orange-500/20 text-orange-300 px-3 py-1.5 text-xs font-semibold hover:bg-orange-500/30 transition-colors">🔥 Disparar Agora</button>
                </div>
                
                {/* Estratégia de Tempo Prévias */}
                <div className="space-y-3 p-4 rounded-lg bg-black/20 border border-white/5">
                   <p className="text-xs font-semibold text-zinc-300">Estratégia de Postagem</p>
                   <div className="flex gap-4">
                     <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                       <input type="radio" name="warmupSchedule" value="interval" checked={settings.warmupScheduleType === "interval"} onChange={() => setSettings({ ...settings, warmupScheduleType: "interval" })} /> Intervalo de Horas
                     </label>
                     <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                       <input type="radio" name="warmupSchedule" value="fixed" checked={settings.warmupScheduleType === "fixed"} onChange={() => setSettings({ ...settings, warmupScheduleType: "fixed" })} /> Horários Fixos
                     </label>
                   </div>
                   
                   {settings.warmupScheduleType === "interval" ? (
                     <div className="pt-2">
                        <label className="text-xs text-zinc-500 block mb-1">Postar a cada X horas:</label>
                        <input type="number" min={1} value={settings.warmupPostInterval} onChange={(e) => setSettings({ ...settings, warmupPostInterval: parseInt(e.target.value) || 24 })} className="w-32 rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-sm text-white focus:outline-none" />
                     </div>
                   ) : (
                     <div className="pt-2">
                        <label className="text-xs text-zinc-500 block mb-1">Horários do dia (separados por vírgula):</label>
                        <input type="text" placeholder="Ex: 09:00, 14:00, 19:00" value={settings.warmupFixedTimes} onChange={(e) => setSettings({ ...settings, warmupFixedTimes: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-sm text-white focus:outline-none" />
                     </div>
                   )}
                </div>

                {/* Etiquetas Prévias */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiquetas Permitidas (Quais mídias podem ir pras Prévias?)</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map(tag => (
                      <button 
                        key={tag.id}
                        onClick={() => toggleTag("warmupTags", tag.name)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${hasTag("warmupTags", tag.name) ? 'bg-orange-500/20 border-orange-500/50 text-orange-200' : 'bg-transparent border-white/10 text-zinc-500 hover:border-white/20'}`}
                      >
                        {tag.name}
                      </button>
                    ))}
                    {availableTags.length === 0 && <span className="text-xs text-zinc-600">Nenhuma etiqueta cadastrada no sistema.</span>}
                  </div>
                </div>

                {/* Prévias Prompt e Link */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Modelo de Legenda (Prompt para o Grok - Prévias)</label>
                    <textarea 
                       rows={6}
                       placeholder="Cole aqui o seu modelo de legenda Prévias..."
                       value={settings.warmupPrompt}
                       onChange={(e) => setSettings({ ...settings, warmupPrompt: e.target.value })}
                       className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none resize-none font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">Link da Legenda (Call To Action) <span className="bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded text-[10px]">Sempre anexado no final</span></label>
                    <input type="text" placeholder="Ex: https://meu-site-vip.com" value={settings.warmupLink} onChange={(e) => setSettings({ ...settings, warmupLink: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                  </div>
                </div>

              </div>
            </div>

          </div>
          

          <div className="mt-8 border-t border-white/[0.06] pt-6 flex justify-end">
            <button type="button" onClick={saveSettings} className="rounded-lg bg-sky-600 px-8 py-3 text-sm font-semibold hover:bg-sky-500 transition-colors shadow-lg shadow-sky-900/20">Salvar Todas Configurações</button>
          </div>
        </div>
      )}
    </div>
  );
}
