"use client";

import { useEffect, useState, useRef } from "react";
import { IconWhatsapp, IconSettings, IconRefresh } from "@/components/icons";
import { apiGet, apiSend } from "@/lib/api";
import Link from "next/link";

type Profile = { id: string; name: string };
type AgentSettings = { prompt: string; enable_media: boolean; enable_billing: boolean };

export default function WhatsAppVipPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);

  // Instance State
  const [instanceStatus, setInstanceStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Agent State
  const [agent, setAgent] = useState<AgentSettings>({
    prompt: "",
    enable_media: true,
    enable_billing: true,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetch("/api/profiles").then((r) => r.json()).then((d) => {
      if (d.profiles && d.profiles.length > 0) {
        setProfiles(d.profiles);
        setSelectedProfileId(d.profiles[0].id);
      }
    }).catch(console.error);
  }, []);

  const loadInstance = async (profileId: string) => {
    try {
      const d = await apiGet<{ status: "connected" | "connecting" | "disconnected", instance: string | null }>(
        `/api/whatsapp/instances?profileId=${profileId}`
      );
      setInstanceStatus(d.status);
      setInstanceName(d.instance);
      if (d.status === "connected") setQrCode(null);
    } catch {}
  };

  const loadAgent = async (profileId: string) => {
    try {
      const d = await apiGet<{ settings: AgentSettings }>(`/api/whatsapp/agent?profileId=${profileId}`);
      if (d.settings) setAgent(d.settings);
    } catch {}
  };

  useEffect(() => {
    if (!selectedProfileId) return;
    setLoading(true);
    setQrCode(null);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    Promise.all([
      loadInstance(selectedProfileId),
      loadAgent(selectedProfileId)
    ]).finally(() => setLoading(false));

  }, [selectedProfileId]);

  // Polling para checar se conectou quando está exibindo QR code
  useEffect(() => {
    if (instanceStatus === "connecting" && qrCode) {
      pollIntervalRef.current = setInterval(() => {
        loadInstance(selectedProfileId);
      }, 5000);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [instanceStatus, qrCode, selectedProfileId]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const d = await apiSend<{ status: string, qrcode: string | null }>(
        "/api/whatsapp/instances",
        "POST",
        { action: "connect", profileId: selectedProfileId }
      );
      setInstanceStatus("connecting");
      if (d.qrcode) {
        setQrCode(d.qrcode);
      } else {
        setQrCode(null);
        alert("Nenhum QRCode retornado (a instância já pode estar conectada).");
        loadInstance(selectedProfileId);
      }
    } catch (e: any) {
      alert("Erro ao conectar: " + e.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Tem certeza que deseja desconectar e excluir a instância desta modelo?")) return;
    try {
      await apiSend("/api/whatsapp/instances", "POST", { action: "disconnect", profileId: selectedProfileId });
      setInstanceStatus("disconnected");
      setInstanceName(null);
      setQrCode(null);
    } catch (e: any) {
      alert("Erro ao desconectar: " + e.message);
    }
  };

  const saveAgent = async () => {
    setSavingAgent(true);
    try {
      await apiSend("/api/whatsapp/agent", "PATCH", {
        profileId: selectedProfileId,
        ...agent
      });
      alert("Configurações do Agente salvas com sucesso!");
    } catch (e: any) {
      alert("Erro ao salvar: " + e.message);
    } finally {
      setSavingAgent(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-ink-950 p-6 text-white">
      {/* Botão para o Live Chat Global */}
      <div className="mb-6 flex justify-end">
        <Link href="/dashboard/whatsapp/chat" className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white shadow-lg hover:bg-emerald-400 transition-colors">
          <IconWhatsapp size={18} /> Abrir Chat ao Vivo
        </Link>
      </div>

      {/* Seletor de Modelo */}
      <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div>
          <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
            <IconWhatsapp size={16} /> WhatsApp VIP
          </h2>
          <p className="text-xs text-zinc-400">Gerencie a conexão e a Inteligência Artificial (Grok) de cada modelo.</p>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={selectedProfileId} 
            onChange={(e) => setSelectedProfileId(e.target.value)} 
            className="w-full md:w-auto min-w-[250px] rounded-lg border border-emerald-500/50 bg-ink-900 px-4 py-2.5 text-base font-semibold text-white shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            {profiles.length === 0 && <option value="">Sem perfis...</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          
          {/* Coluna 1: Conexão */}
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-white/[0.06] bg-ink-900 p-5">
              <div className="flex items-center gap-3 border-b border-white/[0.06] pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <IconWhatsapp size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Evolution API</h3>
                  <p className="text-xs text-zinc-500">Conexão do WhatsApp da Modelo</p>
                </div>
              </div>
              
              <div className="mt-4 flex flex-col items-center">
                <div className="mb-4 flex items-center gap-2">
                  Status: 
                  {instanceStatus === "connected" && <span className="rounded-full bg-green-500/20 px-2.5 py-0.5 text-xs font-medium text-green-400 border border-green-500/30">Conectado</span>}
                  {instanceStatus === "connecting" && <span className="rounded-full bg-yellow-500/20 px-2.5 py-0.5 text-xs font-medium text-yellow-400 border border-yellow-500/30">Aguardando QR Code</span>}
                  {instanceStatus === "disconnected" && <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400 border border-red-500/30">Desconectado</span>}
                </div>

                {qrCode && instanceStatus === "connecting" && (
                  <div className="mb-4 flex flex-col items-center gap-2">
                    <div className="rounded-xl bg-white p-3 shadow-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="w-52 h-52 object-cover" />
                    </div>
                    <p className="text-xs text-zinc-400 animate-pulse">Aguardando leitura do QR Code pelo celular...</p>
                  </div>
                )}

                {instanceStatus === "disconnected" && (
                  <button onClick={handleConnect} disabled={connecting} className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 transition-colors disabled:opacity-50">
                    {connecting ? "Gerando..." : "Gerar QR Code de Conexão"}
                  </button>
                )}

                {instanceStatus === "connected" && (
                  <button onClick={handleDisconnect} className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/20 transition-colors">
                    Desconectar WhatsApp
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Coluna 2: Agente Grok */}
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-white/[0.06] bg-ink-900 p-5">
              <div className="flex items-center gap-3 border-b border-white/[0.06] pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
                  <IconSettings size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Agente de IA (Grok)</h3>
                  <p className="text-xs text-zinc-500">Personalidade e permissões de Venda</p>
                </div>
              </div>
              
              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Prompt da Persona (Ex: Lara Botelho)
                </label>
                <textarea
                  className="w-full h-64 resize-none rounded-lg border border-white/[0.06] bg-ink-950 p-3 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Você é Lara Botelho. Uma mulher comum de 35 anos... Sua missão é fazer o cliente assinar o Pix..."
                  value={agent.prompt}
                  onChange={(e) => setAgent({ ...agent, prompt: e.target.value })}
                />
                
                <div className="mt-4 flex flex-col gap-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-500"
                      checked={agent.enable_media}
                      onChange={(e) => setAgent({ ...agent, enable_media: e.target.checked })}
                    />
                    <span className="text-sm text-zinc-300">Permitir envio autônomo de Fotos/Vídeos</span>
                  </label>
                  
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-500"
                      checked={agent.enable_billing}
                      onChange={(e) => setAgent({ ...agent, enable_billing: e.target.checked })}
                    />
                    <span className="text-sm text-zinc-300">Permitir cobrança via Pix Integrado</span>
                  </label>
                </div>

                <button onClick={saveAgent} disabled={savingAgent} className="mt-6 w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-zinc-200 transition-colors disabled:opacity-50">
                  {savingAgent ? "Salvando..." : "Salvar Configurações do Agente"}
                </button>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
