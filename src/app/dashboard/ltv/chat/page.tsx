"use client";

import { useEffect, useState, useRef } from "react";
import { IconArrowLeft, IconSend, IconBot, IconUser } from "@/components/icons";
import { apiGet, apiSend } from "@/lib/api";
import Link from "next/link";
import { showToast } from "@/lib/toast";

type ChatPreview = {
  id: string;
  profile_id: string;
  profile_name: string;
  remote_jid: string;
  state: "active" | "paused";
  last_interaction_at: number;
  last_message: string;
};

type MediaItem = {
  id: string;
  kind: string;
  url: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  type: string;
  created_at: number;
};

export default function LiveChatPage() {
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatState, setChatState] = useState<"active" | "paused">("active");
  const [inputMsg, setInputMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat list
  useEffect(() => {
    fetchChats();
    const interval = setInterval(fetchChats, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchChats = async () => {
    try {
      const d = await apiGet<{ chats: ChatPreview[] }>("/api/whatsapp/chats");
      setChats(d.chats || []);
    } catch {}
  };

  // Load selected chat messages
  useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      return;
    }
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [selectedChatId]);

  const fetchMessages = async () => {
    if (!selectedChatId) return;
    try {
      const d = await apiGet<{ chat: any, messages: ChatMessage[] }>(`/api/whatsapp/chats/${selectedChatId}`);
      setMessages(d.messages || []);
      setChatState(d.chat.state);
      if (d.chat.profile_id) {
        apiGet<{ media: MediaItem[] }>(`/api/profiles/${d.chat.profile_id}/media`)
          .then(res => setMediaList(res.media || []))
          .catch(() => {});
      }
    } catch {}
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleAi = async () => {
    if (!selectedChatId) return;
    try {
      const action = chatState === "active" ? "paused" : "active";
      // Optimistic update for UI feel
      setChatState(action);
      setChats(chats.map(c => c.id === selectedChatId ? { ...c, state: action } : c));
      
      const d = await apiSend<{ state: "active" | "paused" }>(`/api/whatsapp/chats/${selectedChatId}`, "POST", { action: "toggle_ai" });
      setChatState(d.state);
      setChats(chats.map(c => c.id === selectedChatId ? { ...c, state: d.state } : c));
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || !selectedChatId || sending) return;
    
    setSending(true);
    const textToSend = inputMsg;
    setInputMsg("");
    
    try {
      await apiSend(`/api/whatsapp/chats/${selectedChatId}`, "POST", { action: "send_message", content: textToSend });
      fetchMessages();
      fetchChats();
    } catch (e: any) {
      showToast("Erro ao enviar: " + e.message, "error");
      setInputMsg(textToSend); // restore on error
    } finally {
      setSending(false);
    }
  };

  const sendMedia = async (mediaId: string) => {
    if (!selectedChatId || sending) return;
    setSending(true);
    setShowMediaPicker(false);
    try {
      await apiSend(`/api/whatsapp/chats/${selectedChatId}`, "POST", { action: "send_media", mediaId });
      fetchMessages();
      fetchChats();
    } catch (e: any) {
      showToast("Erro ao enviar mídia: " + e.message, "error");
    } finally {
      setSending(false);
    }
  };

  const selectedChat = chats.find(c => c.id === selectedChatId);

  return (
    // `h-dvh` cortava a barra do topo: o <main> do painel já põe 3,5rem em cima
    // e 2rem embaixo no celular (2,5rem de cada lado em telas grandes), então a
    // tela inteira somava mais que a janela e a página rolava por baixo do
    // cabeçalho. Aqui a altura desconta essa folga.
    <div className="flex h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col overflow-hidden bg-ink-950 font-sans text-zinc-100 lg:h-[calc(100dvh-5rem)]">
      {/* Barra superior. `pl-20` no celular porque o botão de menu do painel é
          flutuante e cairia bem em cima do voltar; no desktop não existe. */}
      <div className="z-10 flex items-center gap-3 border-b border-white/[0.04] bg-ink-900/80 py-3 pl-20 pr-4 shadow-sm backdrop-blur-md lg:gap-4 lg:px-6 lg:py-4">
        {/* UM voltar só, e ele muda de destino conforme o que está na tela.
            No celular com uma conversa aberta, ele devolve para a lista — que
            é onde o dedo espera voltar; nos demais casos sai da tela. */}
        {selectedChatId ? (
          <>
            <button
              type="button"
              onClick={() => setSelectedChatId(null)}
              aria-label="Voltar para as conversas"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.03] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white md:hidden"
            >
              <IconArrowLeft size={16} />
            </button>
            <Link
              href="/dashboard/ltv/whatsapp"
              aria-label="Sair do Live Chat"
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.03] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white md:flex"
            >
              <IconArrowLeft size={16} />
            </Link>
          </>
        ) : (
          <Link
            href="/dashboard/ltv/whatsapp"
            aria-label="Sair do Live Chat"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.03] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <IconArrowLeft size={16} />
          </Link>
        )}
        <h1 className="truncate font-display text-lg font-medium tracking-tight lg:text-xl">Live Chat</h1>
      </div>

      {/* UMA COLUNA DE CADA VEZ NO CELULAR.
          A tela era feita de duas colunas fixas — 320px travados para a lista
          e o resto para a conversa. Num iPhone sobravam 68px para ler e
          responder, com 14px ainda fora da tela: era a tela com mais motivo
          para existir no celular (atender um lead) e a única que não existia
          lá. Agora a lista ocupa a tela inteira, escolher uma conversa troca
          para ela, e um voltar devolve à lista. De `md` para cima nada muda:
          as duas colunas lado a lado, como sempre. */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar - Chats List */}
        <div
          className={`w-full min-w-0 flex-shrink-0 flex-col overflow-y-auto border-r border-white/[0.04] bg-ink-900 md:flex md:w-80 ${
            selectedChatId ? "hidden" : "flex"
          }`}
        >
          {chats.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500 mt-10">Nenhum chat ativo no momento.</div>
          ) : (
            <div className="flex flex-col py-2">
              {chats.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => setSelectedChatId(chat.id)}
                  className={`group flex flex-col gap-1 px-5 py-4 text-left transition-all hover:bg-white/[0.02] ${selectedChatId === chat.id ? 'bg-white/[0.04] border-l-2 border-emerald-500' : 'border-l-2 border-transparent'}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-medium text-[15px] text-zinc-200 truncate">
                      +{chat.remote_jid.split('@')[0]}
                    </span>
                    {chat.state === 'active' ? (
                      <span className="flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                    ) : (
                      <span className="flex h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 truncate w-full group-hover:text-zinc-400 transition-colors">
                    {chat.last_message || "Sem mensagens..."}
                  </div>
                  <div className="text-[10px] text-emerald-500/70 uppercase tracking-wider font-semibold mt-1.5 flex items-center gap-1.5">
                    <IconBot size={10} /> {chat.profile_name}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chat Window */}
        <div
          // `min-w-0`: item de flex não encolhe abaixo do próprio conteúdo por
          // padrão, e a barra de digitação segurava o painel em 414px numa tela
          // de 390 — o pai cortava o excedente e a conversa saía torta.
          className={`relative min-w-0 flex-1 flex-col bg-ink-950 md:flex ${
            selectedChatId ? "flex" : "hidden"
          }`}
        >
          {/* Textura de fundo.
              Era um PNG buscado em transparenttextures.com — dependência
              externa num painel auto-hospedado, uma visita a terceiro a cada
              abertura da tela, e a 2% de opacidade. Agora é gradiente,
              nenhuma requisição. */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.035),transparent_55%),radial-gradient(circle_at_85%_100%,rgba(16,185,129,0.03),transparent_55%)]"></div>
          
          {!selectedChat ? (
            <div className="flex flex-1 items-center justify-center flex-col gap-4 text-zinc-600">
              <div className="h-16 w-16 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <p className="text-sm tracking-wide">Selecione uma conversa ao lado.</p>
            </div>
          ) : (
            <>
              {/* Active Chat Header */}
              <div className="flex items-center justify-between border-b border-white/[0.04] bg-ink-900/90 backdrop-blur-md px-4 py-4 shadow-sm z-10 md:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/[0.1] text-zinc-300">
                    <IconUser size={18} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate font-medium text-[15px] tracking-wide">+{selectedChat.remote_jid.split('@')[0]}</h2>
                    <p className="truncate text-[11px] text-zinc-400 mt-0.5">IA assumindo como <span className="text-emerald-400 font-medium">{selectedChat.profile_name}</span></p>
                  </div>
                </div>
                
                {/* Modern Toggle Switch */}
                <button 
                  onClick={toggleAi} 
                  aria-label={chatState === 'active' ? "Desligar a IA nesta conversa" : "Religar a IA nesta conversa"}
                  className={`relative flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors duration-300 ${chatState === 'active' ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <div className={`h-6 w-6 rounded-full bg-white shadow-md transform transition-transform duration-300 flex items-center justify-center ${chatState === 'active' ? 'translate-x-6' : 'translate-x-0'}`}>
                    {chatState === 'active' ? <IconBot size={12} className="text-emerald-500" /> : <IconUser size={12} className="text-zinc-500" />}
                  </div>
                </button>
              </div>

              {/* Chat Bubbles Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-5 z-0 md:p-6 md:space-y-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {messages.map(msg => {
                  const isAssistant = msg.role === "assistant";
                  return (
                    <div key={msg.id} className={`flex ${isAssistant ? 'justify-end' : 'justify-start'} group animate-in slide-in-from-bottom-2 duration-300`}>
                      <div className={`relative max-w-[85%] px-4 py-3 text-[15px] sm:max-w-[75%] sm:px-5 sm:py-3.5 md:max-w-[65%] shadow-sm backdrop-blur-sm 
                        ${isAssistant 
                          ? 'bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-2xl rounded-tr-sm' 
                          : 'bg-ink-850 text-zinc-200 border border-white/[0.04] rounded-2xl rounded-tl-sm'
                        }`}
                      >
                        {msg.type === "imagem" && (
                          <div className="mb-2.5 flex items-center gap-2 w-fit rounded-md bg-black/20 px-3 py-1.5 backdrop-blur-md border border-white/10">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-100"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <span className="text-[11px] font-medium text-emerald-50 tracking-wide uppercase">Mídia Enviada</span>
                          </div>
                        )}
                        <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} className="h-2" />
              </div>

              {/* Input Area */}
              <div className="bg-ink-900 border-t border-white/[0.04] p-4 z-10">
                <form onSubmit={sendMessage} className="relative page-narrow">
                  <div className="flex items-center gap-3 rounded-full bg-ink-950 border border-white/[0.08] p-1.5 pl-4 focus-within:border-emerald-500/50 focus-within:bg-ink-900 transition-all shadow-inner">
                    <button 
                      type="button" 
                      onClick={() => setShowMediaPicker(!showMediaPicker)}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.03] text-zinc-400 hover:bg-white/[0.1] hover:text-white transition-colors shrink-0"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </button>
                    
                    <input
                      type="text"
                      value={inputMsg}
                      onChange={(e) => setInputMsg(e.target.value)}
                      placeholder={chatState === 'active' ? "Escreva algo (a IA será ignorada neste envio)..." : "Digite sua mensagem..."}
                      className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[15px] text-white placeholder-zinc-600 focus:outline-none"
                    />
                    
                    <button 
                      type="submit" 
                      disabled={sending || !inputMsg.trim()}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-400 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 transition-all shrink-0 shadow-lg shadow-emerald-500/20"
                    >
                      <IconSend size={18} className="translate-x-[1px]" />
                    </button>
                  </div>

                  {/* Media Picker Popup */}
                  {showMediaPicker && (
                    <div className="absolute bottom-full left-0 mb-4 w-[min(320px,calc(100vw-2.5rem))] rounded-2xl border border-white/[0.08] bg-ink-900/95 backdrop-blur-xl shadow-2xl p-4 max-h-80 overflow-y-auto z-20 animate-in fade-in slide-in-from-bottom-4 duration-200">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Mídias do Perfil</span>
                        <button type="button" onClick={() => setShowMediaPicker(false)} className="text-zinc-500 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2">
                        {mediaList.length === 0 ? (
                          <div className="col-span-3 text-sm text-zinc-500 text-center py-6 bg-white/[0.02] rounded-xl border border-white/[0.02] border-dashed">
                            O arquivo da modelo está vazio.
                          </div>
                        ) : (
                          mediaList.map(m => (
                            <button 
                              key={m.id} 
                              type="button" 
                              onClick={() => sendMedia(m.id)}
                              className="group aspect-square relative rounded-xl bg-ink-950 overflow-hidden border border-white/[0.04] hover:border-emerald-500 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all"
                            >
                              {m.kind === 'image' ? (
                                <>
                                  <img src={m.url} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300" />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <IconSend size={16} className="text-white" />
                                  </div>
                                </>
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 group-hover:text-emerald-400 transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                </div>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
