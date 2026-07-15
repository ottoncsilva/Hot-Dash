"use client";

import { useEffect, useState, useRef } from "react";
import { IconArrowLeft, IconSend, IconBot, IconUser } from "@/components/icons";
import { apiGet, apiSend } from "@/lib/api";
import Link from "next/link";

type ChatPreview = {
  id: string;
  profile_name: string;
  remote_jid: string;
  state: "active" | "paused";
  last_interaction_at: number;
  last_message: string;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Carrega a lista de chats
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

  // Carrega mensagens do chat selecionado
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
    } catch {}
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleAi = async () => {
    if (!selectedChatId) return;
    try {
      const d = await apiSend<{ state: "active" | "paused" }>(`/api/whatsapp/chats/${selectedChatId}`, "POST", { action: "toggle_ai" });
      setChatState(d.state);
      setChats(chats.map(c => c.id === selectedChatId ? { ...c, state: d.state } : c));
    } catch (e: any) {
      alert(e.message);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || !selectedChatId || sending) return;
    
    setSending(true);
    try {
      await apiSend(`/api/whatsapp/chats/${selectedChatId}`, "POST", { action: "send_message", content: inputMsg });
      setInputMsg("");
      fetchMessages();
      fetchChats();
    } catch (e: any) {
      alert("Erro ao enviar: " + e.message);
    } finally {
      setSending(false);
    }
  };

  const selectedChat = chats.find(c => c.id === selectedChatId);

  return (
    <div className="flex h-dvh flex-col bg-ink-950 text-white overflow-hidden">
      <div className="flex items-center gap-4 border-b border-white/[0.06] bg-ink-900 p-4">
        <Link href="/dashboard/whatsapp" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors">
          <IconArrowLeft size={16} /> Voltar para WhatsApp
        </Link>
        <h1 className="font-display text-lg font-semibold tracking-tight">Live Chat (WhatsApp)</h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Lista de Chats */}
        <div className="w-80 flex-shrink-0 border-r border-white/[0.06] bg-ink-900/50 flex flex-col overflow-y-auto">
          {chats.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500">Nenhum chat ativo.</div>
          ) : (
            chats.map(chat => (
              <button
                key={chat.id}
                onClick={() => setSelectedChatId(chat.id)}
                className={\`flex flex-col gap-1 border-b border-white/[0.02] p-4 text-left transition-colors hover:bg-white/[0.02] \${selectedChatId === chat.id ? 'bg-white/[0.05]' : ''}\`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-zinc-200">
                    {chat.remote_jid.split('@')[0]}
                  </span>
                  <span className={\`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase \${chat.state === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}\`}>
                    {chat.state === 'active' ? 'IA ON' : 'IA PAUSADA'}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 truncate">{chat.last_message || "Sem mensagens"}</div>
                <div className="text-[10px] text-zinc-600 mt-1">Modelo: {chat.profile_name}</div>
              </button>
            ))
          )}
        </div>

        {/* Janela de Mensagens */}
        <div className="flex flex-1 flex-col bg-ink-950">
          {!selectedChat ? (
            <div className="flex flex-1 items-center justify-center text-zinc-600">
              Selecione um chat para começar.
            </div>
          ) : (
            <>
              {/* Header do Chat Ativo */}
              <div className="flex items-center justify-between border-b border-white/[0.06] bg-ink-900 p-4 shadow-sm">
                <div>
                  <h2 className="font-medium">{selectedChat.remote_jid.split('@')[0]}</h2>
                  <p className="text-xs text-zinc-500">Respondendo por: {selectedChat.profile_name}</p>
                </div>
                <button 
                  onClick={toggleAi} 
                  className={\`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors \${chatState === 'active' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/30 hover:bg-amber-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/20'}\`}
                >
                  <IconBot size={14} />
                  {chatState === 'active' ? 'Pausar IA' : 'Reativar IA'}
                </button>
              </div>

              {/* Lista de Bolhas */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-ink-950/50">
                {messages.map(msg => {
                  const isAssistant = msg.role === "assistant";
                  return (
                    <div key={msg.id} className={\`flex \${isAssistant ? 'justify-end' : 'justify-start'}\`}>
                      <div className={\`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm \${isAssistant ? 'bg-emerald-600 text-white rounded-br-sm' : 'bg-ink-800 text-zinc-200 border border-white/[0.06] rounded-bl-sm'}\`}>
                        {msg.type === "imagem" && (
                          <div className="mb-2 text-xs italic opacity-70">📸 [Imagem enviada pela IA]</div>
                        )}
                        <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <form onSubmit={sendMessage} className="border-t border-white/[0.06] bg-ink-900 p-4">
                {chatState === 'active' && (
                  <div className="mb-2 text-xs text-amber-500">
                    ⚠️ A IA está ativa. Suas mensagens manuais podem se sobrepor às respostas dela.
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputMsg}
                    onChange={(e) => setInputMsg(e.target.value)}
                    placeholder="Digite sua mensagem manual..."
                    className="flex-1 rounded-full border border-white/[0.1] bg-ink-950 px-5 py-3 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button 
                    type="submit" 
                    disabled={sending || !inputMsg.trim()}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50 transition-colors"
                  >
                    <IconSend size={18} />
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
