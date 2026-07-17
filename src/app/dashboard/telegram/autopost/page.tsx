"use client";

import { useEffect, useState } from "react";
import { showToast } from "@/lib/toast";

const toast = {
  success: (msg: string) => showToast(msg, "success"),
  error: (msg: string) => showToast(msg, "error"),
  warning: (msg: string) => showToast(msg, "warning"),
};

type Profile = { id: string; name: string };

type AutopostSettings = {
  enabled: boolean;
};

export default function TelegramAutopostPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [autopost, setAutopost] = useState<AutopostSettings>({
    enabled: false,
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
        });
      }
    }).finally(() => setLoading(false));
  }, [selectedProfileId]);

  const toggleAutopost = async (enabled: boolean) => {
    setAutopost({ enabled });
    try {
      // Para manter simples, buscamos as configs atuais primeiro e apenas atualizamos o enabled
      const r = await fetch(`/api/telegram?profileId=${selectedProfileId}`);
      const d = await r.json();
      
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-telegram-config",
          profileId: selectedProfileId,
          botToken: d.bot?.botToken || "",
          idVip: d.bot?.idVip || "",
          idAquecimento: d.bot?.idAquecimento || "",
          enabled,
          vipPostInterval: d.autopost?.vip_post_interval || 12,
          vipTags: d.autopost?.vip_tags || "",
          warmupPostInterval: d.autopost?.warmup_post_interval || 24,
          warmupTags: d.autopost?.warmup_tags || "",
          aiPromptStyle: d.autopost?.ai_prompt_style || "provocante",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao salvar status.");
      }
      toast.success(`Autopost ${enabled ? 'ativado' : 'desativado'}!`);
    } catch (err: any) {
      toast.error(err.message);
      setAutopost({ enabled: !enabled }); // Reverte estado local se falhar
    }
  };

  const forceAutopost = async (target: "vip" | "warmup") => {
    if (!confirm(`Deseja disparar um post imediato no canal ${target.toUpperCase()}?`)) return;
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
    <div className="flex flex-1 flex-col overflow-y-auto bg-ink-950 p-6 text-white pb-20">
      <div className="mb-6 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div>
          <h2 className="text-sm font-bold text-sky-400 uppercase tracking-wider">Modelo em Edição</h2>
          <p className="text-xs text-zinc-400">Controlando a automação para o perfil selecionado.</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)} className="w-full md:w-auto min-w-[250px] rounded-lg border border-sky-500/50 bg-ink-900 px-4 py-2.5 text-base font-semibold text-white shadow-xl focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white/90">Autopost Inteligente</h1>
          <p className="text-sm text-zinc-400">Controle a automação de postagens nos grupos. Certifique-se de preencher as Configurações primeiro.</p>
        </div>
      </div>

      {loading ? (
        <div className="grid flex-1 place-items-center py-20"><div className="h-8 w-8 animate-spin rounded-full border border-white/20 border-t-white" /></div>
      ) : (
        <div className="mt-6 max-w-2xl">
          <div className="space-y-6">
            <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-zinc-900/40 p-5">
              <div>
                <h3 className="font-semibold text-white/90">Status do Autopost</h3>
                <p className="text-xs text-zinc-400">Ative ou desative o motor de postagens automáticas.</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={autopost.enabled}
                  onChange={(e) => toggleAutopost(e.target.checked)}
                />
                <div className="peer h-7 w-14 rounded-full bg-zinc-700 after:absolute after:left-[4px] after:top-[4px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-sky-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-sky-500"></div>
              </label>
            </div>

            <div className="grid gap-6 md:grid-cols-2 mt-8">
              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/20 p-5 space-y-4">
                <h3 className="font-semibold text-sky-400 flex items-center gap-2">Canal VIP</h3>
                <p className="text-xs text-zinc-400">Dispare uma postagem imediata (fora do cronograma) para testes ou engajamento.</p>
                <button type="button" onClick={() => forceAutopost("vip")} className="w-full rounded-lg bg-zinc-800 py-2 text-xs font-semibold hover:bg-zinc-700 border border-white/[0.04] transition-colors">🔥 Disparar Postagem Agora</button>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/20 p-5 space-y-4">
                <h3 className="font-semibold text-orange-400 flex items-center gap-2">Prévias (Aquecimento)</h3>
                <p className="text-xs text-zinc-400">Dispare uma postagem imediata (fora do cronograma) para testes ou engajamento.</p>
                <button type="button" onClick={() => forceAutopost("warmup")} className="w-full rounded-lg bg-zinc-800 py-2 text-xs font-semibold hover:bg-zinc-700 border border-white/[0.04] transition-colors">🔥 Disparar Postagem Agora</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
