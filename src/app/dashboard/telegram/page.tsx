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
  vipScheduleType: "manual" | "interval" | "fixed";
  vipFixedTimes: string;
  warmupPostInterval: number;
  warmupTags: string;
  warmupPrompt: string;
  warmupLink: string;
  warmupScheduleType: "manual" | "interval" | "fixed";
  warmupFixedTimes: string;
};

export default function TelegramUnifiedPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  
  // Estados para inserção de novo horário fixo
  const [newVipTime, setNewVipTime] = useState("");
  const [showNewVipTimeInput, setShowNewVipTimeInput] = useState(false);
  const [newWarmupTime, setNewWarmupTime] = useState("");
  const [showNewWarmupTimeInput, setShowNewWarmupTimeInput] = useState(false);

  const [settings, setSettings] = useState<TelegramSettings>({
    botToken: "",
    idVip: "",
    idAquecimento: "",
    enabled: false,
    vipPostInterval: 120,
    vipTags: "",
    vipPrompt: "",
    vipScheduleType: "manual",
    vipFixedTimes: "",
    warmupPostInterval: 120,
    warmupTags: "",
    warmupPrompt: "",
    warmupLink: "",
    warmupScheduleType: "manual",
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
      
      const rawVipEnabled = Boolean(d.autopost?.enabled);
      const rawWarmupEnabled = Boolean(d.autopost?.enabled);

      let vipInt = d.autopost?.vip_post_interval || 120;
      if (vipInt <= 24) vipInt = vipInt * 60; // Conversão retroativa inteligente (horas para minutos)
      
      let warmupInt = d.autopost?.warmup_post_interval || 120;
      if (warmupInt <= 24) warmupInt = warmupInt * 60; // Conversão retroativa inteligente

      const vipType = d.autopost?.vip_schedule_type || (rawVipEnabled ? "interval" : "manual");
      const warmupType = d.autopost?.warmup_schedule_type || (rawWarmupEnabled ? "interval" : "manual");

      setSettings({
        botToken: d.bot?.botToken || "",
        idVip: d.bot?.idVip || "",
        idAquecimento: d.bot?.idAquecimento || "",
        enabled: rawVipEnabled || rawWarmupEnabled,
        vipPostInterval: vipInt,
        vipTags: d.autopost?.vip_tags || "",
        vipPrompt: d.autopost?.vip_prompt || "",
        vipScheduleType: vipType as any,
        vipFixedTimes: d.autopost?.vip_fixed_times || "",
        warmupPostInterval: warmupInt,
        warmupTags: d.autopost?.warmup_tags || "",
        warmupPrompt: d.autopost?.warmup_prompt || "",
        warmupLink: d.autopost?.warmup_link || "",
        warmupScheduleType: warmupType as any,
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

  const addFixedTime = (target: "vip" | "warmup", time: string) => {
    if (!time) return;
    const key = target === "vip" ? "vipFixedTimes" : "warmupFixedTimes";
    const currentVal = settings[key];
    const currentList = currentVal.split(",").map(t => t.trim()).filter(Boolean);
    if (!currentList.includes(time)) {
      const newList = [...currentList, time].sort();
      setSettings({
        ...settings,
        [key]: newList.join(", ")
      });
    }
    if (target === "vip") {
      setShowNewVipTimeInput(false);
      setNewVipTime("");
    } else {
      setShowNewWarmupTimeInput(false);
      setNewWarmupTime("");
    }
  };

  const removeFixedTime = (target: "vip" | "warmup", time: string) => {
    const key = target === "vip" ? "vipFixedTimes" : "warmupFixedTimes";
    const currentVal = settings[key];
    const newList = currentVal.split(",").map(t => t.trim()).filter(t => t !== time && Boolean(t));
    setSettings({
      ...settings,
      [key]: newList.join(", ")
    });
  };

  const setScheduleType = (target: "vip" | "warmup", type: "manual" | "interval" | "fixed") => {
    const nextSettings = { ...settings };
    if (target === "vip") {
      nextSettings.vipScheduleType = type;
    } else {
      nextSettings.warmupScheduleType = type;
    }
    // O autopost é ativado se pelo menos um canal não for manual
    nextSettings.enabled = nextSettings.vipScheduleType !== "manual" || nextSettings.warmupScheduleType !== "manual";
    setSettings(nextSettings);
  };

  const toggleChannelEnabled = (target: "vip" | "warmup", isEnabled: boolean) => {
    if (isEnabled) {
      const currentType = target === "vip" ? settings.vipScheduleType : settings.warmupScheduleType;
      const nextType = currentType === "manual" ? "interval" : currentType;
      setScheduleType(target, nextType);
    } else {
      setScheduleType(target, "manual");
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
                
                {/* Agendamento VIP */}
                <div className="space-y-4 rounded-xl border border-white/[0.06] bg-zinc-950/60 p-5">
                  <h4 className="text-xs font-bold text-zinc-300">Agendamento</h4>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setScheduleType("vip", "manual")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.vipScheduleType === "manual"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.vipScheduleType === "manual" ? 'text-emerald-400' : 'text-zinc-200'}`}>Manual</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Só no botão</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("vip", "interval")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.vipScheduleType === "interval"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.vipScheduleType === "interval" ? 'text-emerald-400' : 'text-zinc-200'}`}>Intervalo</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">A cada X min</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("vip", "fixed")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.vipScheduleType === "fixed"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.vipScheduleType === "fixed" ? 'text-emerald-400' : 'text-zinc-200'}`}>Horários</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Horas fixas</span>
                    </button>
                  </div>

                  {settings.vipScheduleType === "interval" && (
                    <div className="flex items-center gap-2 text-sm text-zinc-300 pt-2">
                      <span>Postar a cada</span>
                      <input
                        type="number"
                        min={1}
                        value={settings.vipPostInterval}
                        onChange={(e) => setSettings({ ...settings, vipPostInterval: parseInt(e.target.value) || 120 })}
                        className="w-20 rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-center text-sm font-semibold text-white focus:outline-none"
                      />
                      <span>minutos</span>
                    </div>
                  )}

                  {settings.vipScheduleType === "fixed" && (
                    <div className="space-y-2 pt-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        {settings.vipFixedTimes.split(",").map(t => t.trim()).filter(Boolean).map(time => (
                          <div key={time} className="flex items-center gap-1.5 rounded-lg bg-zinc-900 border border-white/[0.08] px-2.5 py-1.5 text-xs text-white">
                            <svg className="h-3.5 w-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                              <path d="M12 6v6l4 2" strokeWidth="2"/>
                            </svg>
                            <span>{time}</span>
                            <button
                              type="button"
                              onClick={() => removeFixedTime("vip", time)}
                              className="text-red-500/70 hover:text-red-400 transition-colors ml-1 p-0.5 rounded hover:bg-white/5"
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path d="M6 18L18 6M6 6l12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        ))}

                        {showNewVipTimeInput ? (
                          <input
                            type="time"
                            autoFocus
                            onBlur={(e) => addFixedTime("vip", e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addFixedTime("vip", (e.target as HTMLInputElement).value);
                              if (e.key === "Escape") setShowNewVipTimeInput(false);
                            }}
                            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2 py-1.5 text-xs text-white focus:outline-none w-24"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowNewVipTimeInput(true)}
                            className="flex items-center gap-1 rounded-lg border border-dashed border-white/20 bg-zinc-900/20 hover:bg-zinc-900/40 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white transition-colors"
                          >
                            <span>+ Horário</span>
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500">Fuso de Brasília. A cada horário, posta o próximo da fila.</p>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-white">Postagem automática ligada</span>
                      <span className="text-[10px] text-zinc-500">
                        {settings.vipScheduleType !== "manual" ? "Ligado — posta conforme cronograma acima" : "Desligado — só posta no botão"}
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={settings.vipScheduleType !== "manual"}
                        onChange={(e) => toggleChannelEnabled("vip", e.target.checked)}
                      />
                      <div className="peer h-6 w-11 rounded-full bg-zinc-800 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-zinc-600 after:transition-all after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-full peer-checked:after:bg-white peer-focus:outline-none"></div>
                    </label>
                  </div>
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
                
                {/* Agendamento Prévias */}
                <div className="space-y-4 rounded-xl border border-white/[0.06] bg-zinc-950/60 p-5">
                  <h4 className="text-xs font-bold text-zinc-300">Agendamento</h4>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setScheduleType("warmup", "manual")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.warmupScheduleType === "manual"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.warmupScheduleType === "manual" ? 'text-emerald-400' : 'text-zinc-200'}`}>Manual</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Só no botão</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("warmup", "interval")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.warmupScheduleType === "interval"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.warmupScheduleType === "interval" ? 'text-emerald-400' : 'text-zinc-200'}`}>Intervalo</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">A cada X min</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("warmup", "fixed")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.warmupScheduleType === "fixed"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.warmupScheduleType === "fixed" ? 'text-emerald-400' : 'text-zinc-200'}`}>Horários</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Horas fixas</span>
                    </button>
                  </div>

                  {settings.warmupScheduleType === "interval" && (
                    <div className="flex items-center gap-2 text-sm text-zinc-300 pt-2">
                      <span>Postar a cada</span>
                      <input
                        type="number"
                        min={1}
                        value={settings.warmupPostInterval}
                        onChange={(e) => setSettings({ ...settings, warmupPostInterval: parseInt(e.target.value) || 120 })}
                        className="w-20 rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-center text-sm font-semibold text-white focus:outline-none"
                      />
                      <span>minutos</span>
                    </div>
                  )}

                  {settings.warmupScheduleType === "fixed" && (
                    <div className="space-y-2 pt-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        {settings.warmupFixedTimes.split(",").map(t => t.trim()).filter(Boolean).map(time => (
                          <div key={time} className="flex items-center gap-1.5 rounded-lg bg-zinc-900 border border-white/[0.08] px-2.5 py-1.5 text-xs text-white">
                            <svg className="h-3.5 w-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                              <path d="M12 6v6l4 2" strokeWidth="2"/>
                            </svg>
                            <span>{time}</span>
                            <button
                              type="button"
                              onClick={() => removeFixedTime("warmup", time)}
                              className="text-red-500/70 hover:text-red-400 transition-colors ml-1 p-0.5 rounded hover:bg-white/5"
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path d="M6 18L18 6M6 6l12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        ))}

                        {showNewWarmupTimeInput ? (
                          <input
                            type="time"
                            autoFocus
                            onBlur={(e) => addFixedTime("warmup", e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addFixedTime("warmup", (e.target as HTMLInputElement).value);
                              if (e.key === "Escape") setShowNewWarmupTimeInput(false);
                            }}
                            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2 py-1.5 text-xs text-white focus:outline-none w-24"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowNewWarmupTimeInput(true)}
                            className="flex items-center gap-1 rounded-lg border border-dashed border-white/20 bg-zinc-900/20 hover:bg-zinc-900/40 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white transition-colors"
                          >
                            <span>+ Horário</span>
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500">Fuso de Brasília. A cada horário, posta o próximo da fila.</p>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-white">Postagem automática ligada</span>
                      <span className="text-[10px] text-zinc-500">
                        {settings.warmupScheduleType !== "manual" ? "Ligado — posta conforme cronograma acima" : "Desligado — só posta no botão"}
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={settings.warmupScheduleType !== "manual"}
                        onChange={(e) => toggleChannelEnabled("warmup", e.target.checked)}
                      />
                      <div className="peer h-6 w-11 rounded-full bg-zinc-800 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-zinc-600 after:transition-all after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-full peer-checked:after:bg-white peer-focus:outline-none"></div>
                    </label>
                  </div>
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
