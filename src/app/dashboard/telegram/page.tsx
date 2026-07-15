"use client";

import { useEffect, useState } from "react";
import { toast } from "react-toastify";

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
  successMessage: string;
};

type Plan = {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
};

type CustomButton = {
  id: string;
  text: string;
  url: string;
  sortOrder: number;
};

type Member = {
  id: string;
  telegramUserId: number;
  telegramUsername?: string;
  inviteLink?: string;
  status: "pending" | "active" | "expired" | "blocked";
  expiresAt: number;
  createdAt: number;
};

type AutopostSettings = {
  enabled: boolean;
  vipPostInterval: number;
  vipTags: string;
  warmupPostInterval: number;
  warmupTags: string;
  aiPromptStyle: string;
};

export default function TelegramPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("config");

  // Dados do Bot selecionado
  const [bot, setBot] = useState<BotConfig | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [customButtons, setCustomButtons] = useState<CustomButton[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [autopost, setAutopost] = useState<AutopostSettings>({
    enabled: false,
    vipPostInterval: 12,
    vipTags: "",
    warmupPostInterval: 24,
    warmupTags: "",
    aiPromptStyle: "provocante",
  });
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);

  // States para novos cadastros
  const [newBotToken, setNewBotToken] = useState("");
  const [newIdVip, setNewIdVip] = useState("");
  const [newIdAquecimento, setNewIdAquecimento] = useState("");
  const [newIdRegistro, setNewIdRegistro] = useState("");
  const [newSupport, setNewSupport] = useState("");
  const [newWelcome, setNewWelcome] = useState("Oii {nome}! ❤️\n\nQue bom ter você aqui! Escolha uma das ofertas abaixo para acessar todo o meu conteúdo exclusivo:");
  const [newSuccess, setNewSuccess] = useState("✅ Pagamento aprovado! Clique no link abaixo para entrar no meu grupo VIP:\n\n{link_vip}");

  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanPrice, setNewPlanPrice] = useState("");
  const [newPlanDuration, setNewPlanDuration] = useState("30");

  const [newBtnText, setNewBtnText] = useState("");
  const [newBtnUrl, setNewBtnUrl] = useState("");

  const [memberSearch, setMemberSearch] = useState("");

  // Carrega lista de modelos
  useEffect(() => {
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => {
        if (d.profiles && d.profiles.length > 0) {
          setProfiles(d.profiles);
          setSelectedProfileId(d.profiles[0].id);
        }
      })
      .catch((err) => console.error("Erro ao carregar perfis:", err));
  }, []);

  // Carrega configurações da modelo selecionada
  useEffect(() => {
    if (!selectedProfileId) return;
    setLoading(true);
    fetch(`/api/telegram?profileId=${selectedProfileId}`)
      .then((r) => r.json())
      .then((d) => {
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
          setNewSuccess(d.bot.successMessage);
        } else {
          setNewBotToken("");
          setNewIdVip("");
          setNewIdAquecimento("");
          setNewIdRegistro("");
          setNewSupport("");
          setNewWelcome("Oii {nome}! ❤️\n\nQue bom ter você aqui! Escolha uma das ofertas abaixo para acessar todo o meu conteúdo exclusivo:");
          setNewSuccess("✅ Pagamento aprovado! Clique no link abaixo para entrar no meu grupo VIP:\n\n{link_vip}");
        }

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
      })
      .catch((err) => console.error("Erro ao carregar dados do Telegram:", err))
      .finally(() => setLoading(false));
  }, [selectedProfileId]);

  const saveBot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-bot",
          profileId: selectedProfileId,
          botToken: newBotToken,
          idVip: newIdVip,
          idAquecimento: newIdAquecimento,
          idRegistro: newIdRegistro,
          supportUsername: newSupport,
          welcomeMessage: newWelcome,
          successMessage: newSuccess,
        }),
      });
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
    try {
      const priceCents = Math.round(parseFloat(newPlanPrice.replace(",", ".")) * 100);
      if (isNaN(priceCents) || priceCents <= 0) return toast.warning("Informe um preço válido.");

      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-plan",
          botId: bot.id,
          name: newPlanName,
          priceCents,
          durationDays: parseInt(newPlanDuration),
        }),
      });
      if (!res.ok) throw new Error("Erro ao adicionar plano.");
      setNewPlanName("");
      setNewPlanPrice("");
      // Recarrega dados
      setSelectedProfileId("");
      setTimeout(() => setSelectedProfileId(profileId => profileId || selectedProfileId), 10);
      toast.success("Plano cadastrado com sucesso!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const removePlan = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este plano?")) return;
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-plan", id }),
      });
      if (!res.ok) throw new Error("Erro ao excluir plano.");
      setPlans(plans.filter((p) => p.id !== id));
      toast.success("Plano excluído!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const addButton = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bot) return toast.warning("Cadastre e salve o bot primeiro.");
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-button",
          botId: bot.id,
          text: newBtnText,
          url: newBtnUrl,
        }),
      });
      if (!res.ok) throw new Error("Erro ao adicionar botão.");
      setNewBtnText("");
      setNewBtnUrl("");
      // Recarrega
      setSelectedProfileId("");
      setTimeout(() => setSelectedProfileId(profileId => profileId || selectedProfileId), 10);
      toast.success("Botão personalizado cadastrado!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const removeButton = async (id: string) => {
    if (!confirm("Deseja excluir este botão?")) return;
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-button", id }),
      });
      if (!res.ok) throw new Error("Erro ao excluir botão.");
      setCustomButtons(customButtons.filter((b) => b.id !== id));
      toast.success("Botão excluído!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

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

  const expireMember = async (id: string) => {
    if (!confirm("Expulsar este membro do grupo VIP e marcar como Expirado?")) return;
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "member-expire", id, profileId: selectedProfileId }),
      });
      if (!res.ok) throw new Error("Erro ao alterar membro.");
      setMembers(members.map((m) => (m.id === id ? { ...m, status: "expired" } : m)));
      toast.success("Acesso expirado e banimento disparado.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const activateMember = async (id: string) => {
    if (!confirm("Reativar acesso e gerar novo convite?")) return;
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "member-activate", id, profileId: selectedProfileId }),
      });
      if (!res.ok) throw new Error("Erro ao reativar membro.");
      // Recarrega
      setSelectedProfileId("");
      setTimeout(() => setSelectedProfileId(profileId => profileId || selectedProfileId), 10);
      toast.success("Membro reativado!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filteredMembers = members.filter((m) => {
    if (!memberSearch) return true;
    const term = memberSearch.toLowerCase();
    return (
      String(m.telegramUserId).includes(term) ||
      m.telegramUsername?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-ink-950 p-6 text-white">
      {/* Header com Dropdown de Modelo */}
      <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white/90">Automação Telegram VIP</h1>
          <p className="text-sm text-zinc-400">Substitua o Apexvips gerenciando bots, assinaturas e postagens com IA.</p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-zinc-300">Modelo:</label>
          <select
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid flex-1 place-items-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border border-white/20 border-t-white" />
        </div>
      ) : (
        <div className="mt-6 flex flex-1 flex-col gap-6">
          {/* Navegação por Abas */}
          <div className="flex gap-2 border-b border-white/[0.06]">
            {[
              { id: "config", label: "Geral & Boas-Vindas" },
              { id: "plans", label: "Planos & Botões" },
              { id: "autopost", label: "Autopost VIP & IA" },
              { id: "members", label: "Membros do Bot" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[2px] ${
                  activeTab === tab.id
                    ? "border-sky-500 text-sky-400"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Conteúdo das Abas */}
          <div className="flex-1">
            {/* 1. Configuração Geral */}
            {activeTab === "config" && (
              <form onSubmit={saveBot} className="max-w-4xl space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">Token do Bot (Telegram @BotFather)</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                      value={newBotToken}
                      onChange={(e) => setNewBotToken(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">Suporte (@username ou link)</label>
                    <input
                      type="text"
                      placeholder="Ex: @suporte_adriana"
                      value={newSupport}
                      onChange={(e) => setNewSupport(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">ID Canal VIP (Canal Privado de Conteúdo)</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: -1001234567890"
                      value={newIdVip}
                      onChange={(e) => setNewIdVip(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">ID Canal de Aquecimento (Público/Prévias)</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: -1001987654321"
                      value={newIdAquecimento}
                      onChange={(e) => setNewIdAquecimento(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-zinc-300">ID Canal de Auditoria (Notificação de Vendas)</label>
                    <input
                      type="text"
                      placeholder="Ex: -1002345678901 (Deixe em branco se não quiser notificações)"
                      value={newIdRegistro}
                      onChange={(e) => setNewIdRegistro(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Mensagem de Boas-Vindas (/start)</label>
                  <textarea
                    required
                    rows={4}
                    value={newWelcome}
                    onChange={(e) => setNewWelcome(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-sans"
                  />
                  <p className="text-xs text-zinc-500">Dica: Use <b>{`{nome}`}</b> para inserir o primeiro nome do lead dinamicamente.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Mensagem de Sucesso (Pagamento Confirmado)</label>
                  <textarea
                    required
                    rows={3}
                    value={newSuccess}
                    onChange={(e) => setNewSuccess(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-sans"
                  />
                  <p className="text-xs text-zinc-500">Importante: Mantenha a tag <b>{`{link_vip}`}</b> para que o link dinâmico seja exibido.</p>
                </div>

                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold hover:bg-sky-500 transition-colors"
                >
                  Salvar Configurações
                </button>
              </form>
            )}

            {/* 2. Planos e Botões */}
            {activeTab === "plans" && (
              <div className="grid gap-8 md:grid-cols-2">
                {/* Gestão de Planos */}
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-white/90">Planos de Assinatura</h2>
                  <form onSubmit={addPlan} className="grid gap-4 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-5">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Nome do Plano</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Assinatura Mensal VIP"
                        value={newPlanName}
                        onChange={(e) => setNewPlanName(e.target.value)}
                        className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-300">Preço (R$)</label>
                        <input
                          type="text"
                          required
                          placeholder="Ex: 49,90"
                          value={newPlanPrice}
                          onChange={(e) => setNewPlanPrice(e.target.value)}
                          className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-300">Duração (Dias)</label>
                        <input
                          type="number"
                          required
                          value={newPlanDuration}
                          onChange={(e) => setNewPlanDuration(e.target.value)}
                          className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-sky-600 py-2 text-sm font-semibold hover:bg-sky-500"
                    >
                      Adicionar Plano
                    </button>
                  </form>

                  <div className="space-y-2">
                    {plans.length === 0 ? (
                      <p className="text-sm text-zinc-500">Nenhum plano cadastrado ainda.</p>
                    ) : (
                      plans.map((p) => (
                        <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-zinc-900/25 px-4 py-3 text-sm">
                          <div>
                            <span className="font-semibold">{p.name}</span>
                            <span className="ml-2 text-xs text-zinc-400">({p.durationDays} dias)</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="font-medium text-sky-400">
                              {(p.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                            <button
                              onClick={() => removePlan(p.id)}
                              className="text-red-500 hover:text-red-400"
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Botões Personalizados */}
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-white/90">Botões Personalizados (Menu)</h2>
                  <form onSubmit={addButton} className="grid gap-4 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-5">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Texto do Botão</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: 📸 Meu Instagram"
                        value={newBtnText}
                        onChange={(e) => setNewBtnText(e.target.value)}
                        className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Link de Destino</label>
                      <input
                        type="url"
                        required
                        placeholder="Ex: https://instagram.com/..."
                        value={newBtnUrl}
                        onChange={(e) => setNewBtnUrl(e.target.value)}
                        className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-sky-600 py-2 text-sm font-semibold hover:bg-sky-500"
                    >
                      Adicionar Botão
                    </button>
                  </form>

                  <div className="space-y-2">
                    {customButtons.length === 0 ? (
                      <p className="text-sm text-zinc-500">Nenhum botão de menu configurado.</p>
                    ) : (
                      customButtons.map((b) => (
                        <div key={b.id} className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-zinc-900/25 px-4 py-3 text-sm">
                          <span className="font-semibold">{b.text}</span>
                          <div className="flex items-center gap-4">
                            <span className="truncate max-w-[150px] text-xs text-zinc-500">{b.url}</span>
                            <button
                              onClick={() => removeButton(b.id)}
                              className="text-red-500 hover:text-red-400"
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 3. Autopost VIP */}
            {activeTab === "autopost" && (
              <div className="max-w-4xl space-y-6">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="autopostEnabled"
                    checked={autopost.enabled}
                    onChange={(e) => setAutopost({ ...autopost, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-sky-600 focus:ring-sky-500"
                  />
                  <label htmlFor="autopostEnabled" className="text-sm font-medium text-white/95 cursor-pointer">
                    Habilitar Rotina de Postagem Automática para esta Modelo
                  </label>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  {/* VIP Settings */}
                  <div className="rounded-xl border border-white/[0.06] bg-zinc-900/30 p-5 space-y-4">
                    <h3 className="font-semibold text-sky-400">Postagem no Grupo VIP</h3>
                    
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Intervalo de Postagem (Horas)</label>
                      <input
                        type="number"
                        value={autopost.vipPostInterval}
                        onChange={(e) => setAutopost({ ...autopost, vipPostInterval: parseInt(e.target.value) || 1 })}
                        className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Selecionar Etiquetas Permitidas (VIP)</label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {availableTags.map((tag) => {
                          const active = autopost.vipTags.split(",").includes(tag.name);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => {
                                const current = autopost.vipTags.split(",").filter(Boolean);
                                const next = active ? current.filter((x) => x !== tag.name) : [...current, tag.name];
                                setAutopost({ ...autopost, vipTags: next.join(",") });
                              }}
                              className={`rounded-full px-3 py-1 text-xs transition-all ${
                                active
                                  ? "bg-sky-500 text-white"
                                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                              }`}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => forceAutopost("vip")}
                      className="w-full rounded-lg bg-zinc-800 py-2 text-xs font-semibold hover:bg-zinc-700 border border-white/[0.04]"
                    >
                      🚀 Testar Postagem Imediata no VIP
                    </button>
                  </div>

                  {/* Warmup Settings */}
                  <div className="rounded-xl border border-white/[0.06] bg-zinc-900/30 p-5 space-y-4">
                    <h3 className="font-semibold text-orange-400">Postagem no Grupo de Aquecimento</h3>
                    
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Intervalo de Postagem (Horas)</label>
                      <input
                        type="number"
                        value={autopost.warmupPostInterval}
                        onChange={(e) => setAutopost({ ...autopost, warmupPostInterval: parseInt(e.target.value) || 1 })}
                        className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Selecionar Etiquetas Permitidas (Aquecimento)</label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {availableTags.map((tag) => {
                          const active = autopost.warmupTags.split(",").includes(tag.name);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => {
                                const current = autopost.warmupTags.split(",").filter(Boolean);
                                const next = active ? current.filter((x) => x !== tag.name) : [...current, tag.name];
                                setAutopost({ ...autopost, warmupTags: next.join(",") });
                              }}
                              className={`rounded-full px-3 py-1 text-xs transition-all ${
                                active
                                  ? "bg-orange-500 text-white"
                                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                              }`}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => forceAutopost("warmup")}
                      className="w-full rounded-lg bg-zinc-800 py-2 text-xs font-semibold hover:bg-zinc-700 border border-white/[0.04]"
                    >
                      🔥 Testar Postagem Imediata no Aquecimento
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-w-lg">
                  <label className="text-sm font-medium text-zinc-300">Diretrizes de Tom da IA (Copywriting)</label>
                  <select
                    value={autopost.aiPromptStyle}
                    onChange={(e) => setAutopost({ ...autopost, aiPromptStyle: e.target.value })}
                    className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2.5 text-sm text-white focus:outline-none"
                  >
                    <option value="provocante">Provocante e Sensual (Padrão)</option>
                    <option value="romantica">Namoradinha / Romântica</option>
                    <option value="fofa">Fofa e Carinhosa</option>
                    <option value="safada">Explícita / Safada (Modelos Sem Censura)</option>
                  </select>
                  <p className="text-xs text-zinc-500">
                    💡 Certifique-se de configurar a API de IA em Configurações → Conexão com IA. Se usar chaves sem censura (ex: OpenRouter), o tom Safado é recomendado.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={saveAutopost}
                  className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold hover:bg-sky-500 transition-colors"
                >
                  Salvar Regras de Autopost
                </button>
              </div>
            )}

            {/* 4. Usuários do Bot */}
            {activeTab === "members" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 max-w-md">
                    <input
                      type="text"
                      placeholder="Pesquisar por username ou chat ID..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  
                  <div className="text-sm text-zinc-400">
                    Total filtrado: <b>{filteredMembers.length}</b> usuários
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-zinc-900/10">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-zinc-900/40 text-zinc-400">
                        <th className="px-6 py-4 font-medium">Telegram User ID</th>
                        <th className="px-6 py-4 font-medium">Username</th>
                        <th className="px-6 py-4 font-medium">Link de Convite</th>
                        <th className="px-6 py-4 font-medium">Status</th>
                        <th className="px-6 py-4 font-medium">Expira em</th>
                        <th className="px-6 py-4 font-medium text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {filteredMembers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-10 text-center text-zinc-500">
                            Nenhum usuário correspondente encontrado.
                          </td>
                        </tr>
                      ) : (
                        filteredMembers.map((m) => (
                          <tr key={m.id} className="hover:bg-zinc-900/20">
                            <td className="px-6 py-4 font-mono text-zinc-300">{m.telegramUserId}</td>
                            <td className="px-6 py-4 text-zinc-200">
                              {m.telegramUsername ? `@${m.telegramUsername}` : "N/D"}
                            </td>
                            <td className="px-6 py-4">
                              {m.inviteLink ? (
                                <a
                                  href={m.inviteLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-sky-400 hover:underline truncate max-w-[120px] inline-block"
                                >
                                  {m.inviteLink}
                                </a>
                              ) : (
                                <span className="text-xs text-zinc-600">Não gerado</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                m.status === "active"
                                  ? "bg-green-500/10 text-green-400"
                                  : m.status === "expired"
                                  ? "bg-red-500/10 text-red-400"
                                  : "bg-yellow-500/10 text-yellow-400"
                              }`}>
                                {m.status === "active" ? "Ativo" : m.status === "expired" ? "Expirado" : "Pendente"}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-zinc-400">
                              {m.status === "active" && m.expiresAt > 0
                                ? new Date(m.expiresAt).toLocaleDateString("pt-BR")
                                : "-"}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex justify-end gap-2">
                                {m.status === "active" ? (
                                  <button
                                    onClick={() => expireMember(m.id)}
                                    className="rounded bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/30"
                                  >
                                    Expirar Acesso
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => activateMember(m.id)}
                                    className="rounded bg-green-500/20 px-2 py-1 text-xs font-semibold text-green-400 hover:bg-green-500/30"
                                  >
                                    Reativar VIP
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
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
