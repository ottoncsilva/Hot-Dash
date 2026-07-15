"use client";

import { useEffect, useState } from "react";
import { IconSettings, IconProfiles, IconPayments, IconMedia } from "@/components/icons";

const toast = {
  success: (msg: string) => alert("✅ " + msg),
  error: (msg: string) => alert("❌ " + msg),
  warning: (msg: string) => alert("⚠️ " + msg),
};

type Profile = { id: string; name: string };
type Tag = { id: string; name: string; color: string };

type BotConfig = {
  id: string;
  botToken: string;
  idVip: string;
  idAquecimento: string;
  idRegistro?: string;
  supportUsername?: string;
  welcomeMessage: string;
  welcomeMediaTags?: string;
  successMessage: string;
  downsellFunnel?: string;
  upsellFunnel?: string;
};

type Plan = { id: string; name: string; priceCents: number; durationDays: number };
type CustomButton = { id: string; text: string; url: string; sortOrder: number };
type Member = { id: string; telegramUserId: number; telegramUsername?: string; inviteLink?: string; status: "pending" | "active" | "expired" | "blocked"; expiresAt: number; createdAt: number };

type FunnelStep = {
  delayMinutes: number;
  text: string;
  discountPercent?: number;
  mediaTags?: string;
  isLoop?: boolean;
};

export default function TelegramBotPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("config");

  const [bot, setBot] = useState<BotConfig | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [customButtons, setCustomButtons] = useState<CustomButton[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);

  // Config States
  const [newBotToken, setNewBotToken] = useState("");
  const [newIdVip, setNewIdVip] = useState("");
  const [newIdAquecimento, setNewIdAquecimento] = useState("");
  const [newIdRegistro, setNewIdRegistro] = useState("");
  const [newSupport, setNewSupport] = useState("");
  const [newWelcome, setNewWelcome] = useState("");
  const [newWelcomeMediaTags, setNewWelcomeMediaTags] = useState("");
  const [newSuccess, setNewSuccess] = useState("");

  // Plans States
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanPrice, setNewPlanPrice] = useState("");
  const [newPlanDuration, setNewPlanDuration] = useState("30");
  const [newBtnText, setNewBtnText] = useState("");
  const [newBtnUrl, setNewBtnUrl] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  // Funnel States
  const [downsellFunnel, setDownsellFunnel] = useState<FunnelStep[]>([]);
  const [upsellFunnel, setUpsellFunnel] = useState<FunnelStep[]>([]);

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
      setBot(d.bot);
      setPlans(d.plans || []);
      setCustomButtons(d.customButtons || []);
      setMembers(d.members || []);
      setAvailableTags(d.availableTags || []);

      if (d.bot) {
        setNewBotToken(d.bot.botToken);
        setNewIdVip(d.bot.idVip);
        setNewIdAquecimento(d.bot.idAquecimento);
        setNewIdRegistro(d.bot.idRegistro || "");
        setNewSupport(d.bot.supportUsername || "");
        setNewWelcome(d.bot.welcomeMessage);
        setNewWelcomeMediaTags(d.bot.welcomeMediaTags || "");
        setNewSuccess(d.bot.successMessage);

        try { setDownsellFunnel(d.bot.downsellFunnel ? JSON.parse(d.bot.downsellFunnel) : []); } catch (e) { setDownsellFunnel([]); }
        try { setUpsellFunnel(d.bot.upsellFunnel ? JSON.parse(d.bot.upsellFunnel) : []); } catch (e) { setUpsellFunnel([]); }
      } else {
        setNewBotToken("");
        setNewIdVip("");
        setNewIdAquecimento("");
        setNewIdRegistro("");
        setNewSupport("");
        setNewWelcome("Oii {nome}! ❤️\n\nQue bom ter você aqui! Escolha uma das ofertas abaixo:");
        setNewWelcomeMediaTags("");
        setNewSuccess("✅ Pagamento aprovado!\n\n{link_vip}");
        setDownsellFunnel([]);
        setUpsellFunnel([]);
      }
    }).finally(() => setLoading(false));
  }, [selectedProfileId]);

  const saveBot = async (e?: React.FormEvent, customDownsell?: FunnelStep[], customUpsell?: FunnelStep[]) => {
    if (e) e.preventDefault();
    try {
      const payload = {
        action: "save-bot",
        profileId: selectedProfileId,
        botToken: newBotToken,
        idVip: newIdVip,
        idAquecimento: newIdAquecimento,
        idRegistro: newIdRegistro,
        supportUsername: newSupport,
        welcomeMessage: newWelcome,
        welcomeMediaTags: newWelcomeMediaTags,
        successMessage: newSuccess,
        downsellFunnel: JSON.stringify(customDownsell || downsellFunnel),
        upsellFunnel: JSON.stringify(customUpsell || upsellFunnel),
      };
      const res = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erro ao salvar bot.");
      setBot(d.bot);
      toast.success("Configurações do Bot salvas com sucesso!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const addPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bot) return toast.warning("Cadastre e salve o bot primeiro.");
    const priceCents = Math.round(parseFloat(newPlanPrice.replace(",", ".")) * 100);
    if (isNaN(priceCents) || priceCents <= 0) return toast.warning("Informe um preço válido.");

    try {
      const res = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-plan", botId: bot.id, name: newPlanName, priceCents, durationDays: parseInt(newPlanDuration) }) });
      if (!res.ok) throw new Error("Erro ao adicionar plano.");
      setNewPlanName(""); setNewPlanPrice("");
      setSelectedProfileId(""); setTimeout(() => setSelectedProfileId(p => p || selectedProfileId), 10);
      toast.success("Plano cadastrado com sucesso!");
    } catch (err: any) { toast.error(err.message); }
  };

  const removePlan = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este plano?")) return;
    try {
      const res = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete-plan", id }) });
      if (!res.ok) throw new Error("Erro ao excluir.");
      setPlans(plans.filter((p) => p.id !== id));
      toast.success("Excluído!");
    } catch (err: any) { toast.error(err.message); }
  };

  const addButton = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bot) return toast.warning("Cadastre e salve o bot primeiro.");
    try {
      const res = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-button", botId: bot.id, text: newBtnText, url: newBtnUrl }) });
      if (!res.ok) throw new Error("Erro ao adicionar botão.");
      setNewBtnText(""); setNewBtnUrl("");
      setSelectedProfileId(""); setTimeout(() => setSelectedProfileId(p => p || selectedProfileId), 10);
      toast.success("Cadastrado!");
    } catch (err: any) { toast.error(err.message); }
  };

  const removeButton = async (id: string) => {
    if (!confirm("Deseja excluir?")) return;
    try {
      const res = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete-button", id }) });
      if (!res.ok) throw new Error("Erro.");
      setCustomButtons(customButtons.filter((b) => b.id !== id));
      toast.success("Excluído!");
    } catch (err: any) { toast.error(err.message); }
  };

  const FunnelEditor = ({ funnel, setFunnel, title, description }: { funnel: FunnelStep[], setFunnel: any, title: string, description: string }) => {
    const addStep = () => setFunnel([...funnel, { delayMinutes: 60, text: "Nova mensagem de oferta...", discountPercent: 0, mediaTags: "", isLoop: false }]);
    const updateStep = (index: number, key: keyof FunnelStep, value: any) => {
      const newF = [...funnel];
      newF[index] = { ...newF[index], [key]: value };
      setFunnel(newF);
    };
    const removeStep = (index: number) => {
      const newF = [...funnel];
      newF.splice(index, 1);
      setFunnel(newF);
    };
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-white/90">{title}</h2>
          <p className="text-sm text-zinc-400">{description}</p>
        </div>
        <div className="space-y-4">
          {funnel.map((step, idx) => (
            <div key={idx} className="relative rounded-xl border border-white/[0.08] bg-zinc-900/40 p-5 shadow-lg">
              <button onClick={() => removeStep(idx)} className="absolute right-4 top-4 text-red-400 hover:text-red-300">Excluir</button>
              <h3 className="text-sm font-semibold text-zinc-200 mb-4">Etapa {idx + 1} {step.isLoop ? "(Looping)" : ""}</h3>
              <div className="grid gap-4 md:grid-cols-3 mb-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Atraso (Minutos após anterior)</label>
                  <input type="number" value={step.delayMinutes} onChange={e => updateStep(idx, "delayMinutes", parseInt(e.target.value) || 0)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Desconto Extra (%)</label>
                  <input type="number" value={step.discountPercent} onChange={e => updateStep(idx, "discountPercent", parseInt(e.target.value) || 0)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiqueta de Mídia (Opcional)</label>
                  <input type="text" placeholder="Ex: exclusivas, bunda" value={step.mediaTags || ""} onChange={e => updateStep(idx, "mediaTags", e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
              </div>
              <div className="space-y-2 mb-4">
                <label className="text-xs font-semibold text-zinc-300">Texto da Mensagem</label>
                <textarea rows={3} value={step.text} onChange={e => updateStep(idx, "text", e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none font-sans" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={step.isLoop} onChange={e => updateStep(idx, "isLoop", e.target.checked)} className="rounded border-white/[0.2] bg-zinc-900 text-sky-500 focus:ring-sky-500" />
                <label className="text-xs text-zinc-400">Repetir esta etapa infinitamente a cada ciclo de atraso (Útil para a última etapa).</label>
              </div>
            </div>
          ))}
          <button onClick={addStep} className="w-full rounded-lg border border-dashed border-white/[0.2] py-4 text-sm font-semibold text-zinc-400 hover:border-sky-500 hover:text-sky-400 transition-colors">
            + Adicionar Nova Mensagem ao Funil
          </button>
        </div>
        <button onClick={() => saveBot(undefined, title.includes("Downsell") ? funnel : undefined, title.includes("Upsell") ? funnel : undefined)} className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold hover:bg-sky-500 transition-colors">
          Salvar Funil
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-ink-950 p-6 text-white">
      <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white/90">Bot VIP & Funis</h1>
          <p className="text-sm text-zinc-400">Gerencie seu robô, planos e sequências dinâmicas de venda e remarketing.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-zinc-300">Modelo:</label>
          <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)} className="rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid flex-1 place-items-center py-20"><div className="h-8 w-8 animate-spin rounded-full border border-white/20 border-t-white" /></div>
      ) : (
        <div className="mt-6 flex flex-1 flex-col gap-6">
          <div className="flex gap-2 border-b border-white/[0.06] overflow-x-auto pb-[2px]">
            {[
              { id: "config", label: "Geral & Boas-Vindas" },
              { id: "plans", label: "Planos & Botões" },
              { id: "downsell", label: "Downsell (Remarketing)" },
              { id: "upsell", label: "Upsell (Pós-Venda)" },
              { id: "members", label: "Membros do Bot" },
            ].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[2px] ${activeTab === tab.id ? "border-sky-500 text-sky-400" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}>{tab.label}</button>
            ))}
          </div>

          <div className="flex-1">
            {activeTab === "config" && (
              <form onSubmit={saveBot} className="max-w-4xl space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">Token do Bot (@BotFather)</label>
                    <input type="text" required value={newBotToken} onChange={e => setNewBotToken(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">Suporte (@username)</label>
                    <input type="text" value={newSupport} onChange={e => setNewSupport(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">ID Canal VIP</label>
                    <input type="text" required value={newIdVip} onChange={e => setNewIdVip(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">ID Canal de Aquecimento</label>
                    <input type="text" required value={newIdAquecimento} onChange={e => setNewIdAquecimento(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Mensagem de Boas-Vindas (/start)</label>
                  <textarea required rows={4} value={newWelcome} onChange={e => setNewWelcome(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-sans" />
                  <p className="text-xs text-zinc-500">Dica: Use <b>{`{nome}`}</b> para inserir o primeiro nome.</p>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Etiqueta de Mídia para Boas-Vindas</label>
                  <input type="text" placeholder="Ex: capa, boasvindas (Deixe vazio para enviar só texto)" value={newWelcomeMediaTags} onChange={e => setNewWelcomeMediaTags(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  <p className="text-xs text-zinc-500">Se preenchido, o bot enviará uma mídia aleatória da biblioteca com esta tag na mensagem de start.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Mensagem de Sucesso (Pagamento Confirmado)</label>
                  <textarea required rows={3} value={newSuccess} onChange={e => setNewSuccess(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-sans" />
                </div>
                <button type="submit" className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold hover:bg-sky-500 transition-colors">Salvar Configurações</button>
              </form>
            )}

            {activeTab === "plans" && (
              <div className="grid gap-8 md:grid-cols-2">
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-white/90">Planos de Assinatura</h2>
                  <form onSubmit={addPlan} className="grid gap-4 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-5">
                    <div className="space-y-2"><label className="text-xs font-semibold text-zinc-300">Nome</label><input type="text" required value={newPlanName} onChange={e=>setNewPlanName(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white border border-white/[0.08]" /></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><label className="text-xs font-semibold text-zinc-300">Preço (R$)</label><input type="text" required value={newPlanPrice} onChange={e=>setNewPlanPrice(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white border border-white/[0.08]" /></div>
                      <div className="space-y-2"><label className="text-xs font-semibold text-zinc-300">Duração (Dias)</label><input type="number" required value={newPlanDuration} onChange={e=>setNewPlanDuration(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white border border-white/[0.08]" /></div>
                    </div>
                    <button type="submit" className="w-full rounded-lg bg-sky-600 py-2 text-sm font-semibold hover:bg-sky-500">Adicionar Plano</button>
                  </form>
                  <div className="space-y-2">
                    {plans.map((p) => (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-zinc-900/25 px-4 py-3 text-sm">
                        <div><span className="font-semibold">{p.name}</span><span className="ml-2 text-zinc-400">R$ {(p.priceCents/100).toFixed(2)} - {p.durationDays} dias</span></div>
                        <button onClick={()=>removePlan(p.id)} className="text-red-400 hover:text-red-300 text-xs">Excluir</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-white/90">Botões Externos Extras</h2>
                  <form onSubmit={addButton} className="grid gap-4 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-5">
                     <div className="space-y-2"><label className="text-xs font-semibold text-zinc-300">Texto</label><input type="text" required value={newBtnText} onChange={e=>setNewBtnText(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white border border-white/[0.08]" /></div>
                     <div className="space-y-2"><label className="text-xs font-semibold text-zinc-300">URL</label><input type="url" required value={newBtnUrl} onChange={e=>setNewBtnUrl(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white border border-white/[0.08]" /></div>
                     <button type="submit" className="w-full rounded-lg bg-zinc-700 py-2 text-sm font-semibold hover:bg-zinc-600">Adicionar Botão</button>
                  </form>
                  <div className="space-y-2">
                    {customButtons.map((b) => (
                      <div key={b.id} className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-zinc-900/25 px-4 py-3 text-sm">
                        <span className="font-semibold truncate max-w-[200px]">{b.text}</span>
                        <button onClick={()=>removeButton(b.id)} className="text-red-400 hover:text-red-300 text-xs">Excluir</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "downsell" && (
              <FunnelEditor 
                title="Funil de Downsell (Remarketing)" 
                description="Acionado quando um lead clica em /start e não compra. Dispara ofertas e mídias no intervalo definido após a última interação."
                funnel={downsellFunnel} 
                setFunnel={setDownsellFunnel} 
              />
            )}

            {activeTab === "upsell" && (
              <FunnelEditor 
                title="Funil de Upsell (Pós-Venda)" 
                description="Acionado imediatamente quando o lead aprova um Pix e assina o VIP. Ofereça extensões de plano, materiais extras, ou pacotes vitalícios com desconto."
                funnel={upsellFunnel} 
                setFunnel={setUpsellFunnel} 
              />
            )}

            {activeTab === "members" && (
              <div className="space-y-6">
                <input type="text" placeholder="Pesquisar por ID..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)} className="w-full max-w-md rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none" />
                <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-zinc-900/10">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead><tr className="border-b border-white/[0.06] bg-zinc-900/40 text-zinc-400"><th className="px-6 py-4">User ID</th><th className="px-6 py-4">Username</th><th className="px-6 py-4">Status</th></tr></thead>
                    <tbody>
                      {members.filter(m => String(m.telegramUserId).includes(memberSearch)).map(m => (
                        <tr key={m.id} className="border-b border-white/[0.04]">
                          <td className="px-6 py-4">{m.telegramUserId}</td>
                          <td className="px-6 py-4">{m.telegramUsername}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-xs ${m.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{m.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
