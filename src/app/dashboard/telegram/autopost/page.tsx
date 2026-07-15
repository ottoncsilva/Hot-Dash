"use client";

import { useEffect, useState } from "react";
import { IconSettings } from "@/components/icons";

const toast = {
  success: (msg: string) => alert("✅ " + msg),
  error: (msg: string) => alert("❌ " + msg),
  warning: (msg: string) => alert("⚠️ " + msg),
};

type Profile = { id: string; name: string };

type AutopostSettings = {
  enabled: boolean;
  vipPostInterval: number;
  vipTags: string;
  warmupPostInterval: number;
  warmupTags: string;
  aiPromptStyle: string;
};

export default function TelegramAutopostPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [autopost, setAutopost] = useState<AutopostSettings>({
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
      if (d.autopost) {
        setAutopost({
          enabled: Boolean(d.autopost.enabled),
          vipPostInterval: d.autopost.vip_post_interval || 12,
          vipTags: d.autopost.vip_tags || "",
          warmupPostInterval: d.autopost.warmup_post_interval || 24,
          warmupTags: d.autopost.warmup_tags || "",
          aiPromptStyle: d.autopost.ai_prompt_style || "provocante",
        });
      }
    }).finally(() => setLoading(false));
  }, [selectedProfileId]);

  const saveAutopost = async () => {
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-autopost",
          profileId: selectedProfileId,
          ...autopost,
        }),
      });
      if (!res.ok) throw new Error("Erro ao salvar autopost.");
      toast.success("Autopost configurado com sucesso!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const forceAutopost = async (target: "vip" | "warmup") => {
    if (!confirm(`Deseja disparar um post de IA imediato no canal ${target.toUpperCase()}?`)) return;
    try {
      const res = await fetch(`/api/cron/telegram/autopost?token=${process.env.SESSION_SECRET || ""}&forceProfile=${selectedProfileId}&target=${target}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erro ao postar.");
      toast.success("Postagem realizada e enviada ao Telegram!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-ink-950 p-6 text-white">
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
          <h1 className="text-2xl font-bold tracking-tight text-white/90">Autopost VIP & IA</h1>
          <p className="text-sm text-zinc-400">Automatize o envio de mídias usando a inteligência artificial para engajar seus grupos.</p>
        </div>
      </div>

      {loading ? (
        <div className="grid flex-1 place-items-center py-20"><div className="h-8 w-8 animate-spin rounded-full border border-white/20 border-t-white" /></div>
      ) : (
        <div className="mt-6">
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-6">
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-5">
                <input type="checkbox" id="enableAutopost" checked={autopost.enabled} onChange={(e) => setAutopost({ ...autopost, enabled: e.target.checked })} className="h-5 w-5 rounded border-white/[0.2] bg-zinc-900 text-sky-500 focus:ring-sky-500" />
                <div>
                  <label htmlFor="enableAutopost" className="font-semibold text-white/90">Ativar Autopost com IA</label>
                  <p className="text-xs text-zinc-400">Se ativo, o sistema verificará de hora em hora e postará mídias automaticamente.</p>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/20 p-5 space-y-4">
                <h3 className="font-semibold text-sky-400 flex items-center gap-2">Canal VIP</h3>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Intervalo de Postagem (Horas)</label>
                  <input type="number" min={1} value={autopost.vipPostInterval} onChange={(e) => setAutopost({ ...autopost, vipPostInterval: parseInt(e.target.value) || 12 })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiquetas Permitidas (Vírgula)</label>
                  <input type="text" placeholder="Ex: exclusivas, hardcore" value={autopost.vipTags} onChange={(e) => setAutopost({ ...autopost, vipTags: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <button type="button" onClick={() => forceAutopost("vip")} className="w-full rounded-lg bg-zinc-800 py-2 text-xs font-semibold hover:bg-zinc-700 border border-white/[0.04]">🔥 Testar Postagem Imediata no VIP</button>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/20 p-5 space-y-4">
                <h3 className="font-semibold text-orange-400 flex items-center gap-2">Canal de Aquecimento</h3>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Intervalo de Postagem (Horas)</label>
                  <input type="number" min={1} value={autopost.warmupPostInterval} onChange={(e) => setAutopost({ ...autopost, warmupPostInterval: parseInt(e.target.value) || 24 })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiquetas Permitidas (Vírgula)</label>
                  <input type="text" placeholder="Ex: publicas, instagram" value={autopost.warmupTags} onChange={(e) => setAutopost({ ...autopost, warmupTags: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <button type="button" onClick={() => forceAutopost("warmup")} className="w-full rounded-lg bg-zinc-800 py-2 text-xs font-semibold hover:bg-zinc-700 border border-white/[0.04]">🔥 Testar Postagem Imediata no Aquecimento</button>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Diretrizes de Tom da IA (Copywriting)</label>
                <select value={autopost.aiPromptStyle} onChange={(e) => setAutopost({ ...autopost, aiPromptStyle: e.target.value })} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2.5 text-sm text-white focus:outline-none">
                  <option value="provocante">Provocante e Sensual (Padrão)</option>
                  <option value="romantica">Namoradinha / Romântica</option>
                  <option value="fofa">Fofa e Carinhosa</option>
                  <option value="safada">Explícita / Safada (Modelos Sem Censura)</option>
                </select>
              </div>
            </div>
          </div>
          
          <div className="mt-8 border-t border-white/[0.06] pt-6">
            <button type="button" onClick={saveAutopost} className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold hover:bg-sky-500 transition-colors">Salvar Regras de Autopost</button>
          </div>
        </div>
      )}
    </div>
  );
}
