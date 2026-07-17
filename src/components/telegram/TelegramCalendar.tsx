import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import type { ScheduledPost } from "@/lib/postTypes";
import { useConfirm } from "@/hooks/useConfirm";
import { showToast } from "@/lib/toast";

export default function TelegramCalendar({ profileId }: { profileId: string }) {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);

  // Estados de edição
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [saving, setSaving] = useState(false);
  
  const { confirm, ConfirmDialog } = useConfirm();

  async function load() {
    if (!profileId) return;
    setLoading(true);
    try {
      const res = await apiGet<{ posts: ScheduledPost[] }>(`/api/posts?profileId=${profileId}&status=scheduled`);
      // Filtra apenas posts da rede Telegram
      const telegramPosts = (res.posts || []).filter(p => p.networks.some(n => n.network === "telegram"));
      setPosts(telegramPosts);
    } catch (e) {
      console.error("Erro ao carregar calendário:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    
    const handleReload = () => load();
    window.addEventListener("reloadTelegramCalendar", handleReload);
    return () => window.removeEventListener("reloadTelegramCalendar", handleReload);
  }, [profileId]);

  async function deletePost(id: string) {
    if (!(await confirm("Deseja realmente remover este agendamento?"))) return;
    try {
      await apiSend(`/api/posts/${id}`, "DELETE");
      setPosts(ps => ps.filter(p => p.id !== id));
      showToast("Agendamento excluído.", "success");
    } catch (e) {
      showToast("Erro ao excluir.", "error");
    }
  }

  function openEdit(post: ScheduledPost) {
    setEditingPost(post);
    setEditCaption(post.caption || "");
  }

  async function saveEdit() {
    if (!editingPost) return;
    setSaving(true);
    try {
      const res = await apiSend<{ post: ScheduledPost }>(`/api/posts/${editingPost.id}`, "PATCH", { caption: editCaption });
      setPosts(ps => ps.map(p => p.id === res.post.id ? res.post : p));
      setEditingPost(null);
      showToast("Legenda salva com sucesso!", "success");
    } catch (e) {
      showToast("Erro ao salvar edição.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!profileId) return null;

  return (
    <div className="mt-10 mb-8 rounded-xl border border-white/[0.06] bg-zinc-900/30 p-6 shadow-xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">Calendário de Agendamentos (Telegram)</h2>
          <p className="text-xs text-zinc-400">Próximos posts gerados e prontos para envio.</p>
        </div>
        <button onClick={load} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors border border-white/5">
          ↻ Atualizar
        </button>
      </div>

      {loading && posts.length === 0 ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white"></div>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-12 text-center text-zinc-500">
          <p className="text-sm">Nenhum post agendado para o Telegram.</p>
          <p className="text-xs mt-1">Use os botões "✨ Gerar Dias" acima para projetar o cronograma.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
          {posts.map(post => {
            const targetType = post.networks.find(n => n.network === "telegram")?.postType || "Mensagem";
            const isVip = targetType === "VIP";
            const date = new Date(post.scheduledAt);
            const mediaObj = post.media[0];

            return (
              <div 
                key={post.id} 
                onClick={() => openEdit(post)}
                className="cursor-pointer group relative flex flex-col rounded-xl border border-white/[0.08] bg-zinc-950/50 overflow-hidden shadow-md hover:border-white/20 hover:shadow-lg transition-all"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] bg-zinc-900/50">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-white">{date.toLocaleDateString("pt-BR", { weekday: 'short', day: '2-digit', month: '2-digit' }).toUpperCase()}</span>
                    <span className="text-[10px] text-zinc-400">{date.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isVip ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}>
                    {targetType.toUpperCase()}
                  </span>
                </div>
                
                <div className="relative h-32 w-full bg-zinc-900 border-b border-white/5">
                  {mediaObj ? (
                    mediaObj.kind === "video" ? (
                      <video src={`/api/media/${mediaObj.id}/file`} className="h-full w-full object-cover opacity-80" muted playsInline />
                    ) : (
                      <img src={`/api/media/${mediaObj.id}/file`} className="h-full w-full object-cover opacity-80" />
                    )
                  ) : (
                    <div className="flex h-full items-center justify-center text-zinc-700 text-xs">Sem mídia</div>
                  )}
                  
                  {/* Delete overlay button */}
                  <button 
                    onClick={(e) => { e.stopPropagation(); deletePost(post.id); }} 
                    className="absolute top-2 right-2 rounded-md bg-black/60 p-1.5 text-zinc-300 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all z-10"
                    title="Excluir Post"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                
                <div className="p-3 text-xs text-zinc-300 line-clamp-4 leading-relaxed">
                  {post.caption || <span className="italic text-zinc-600">Sem legenda...</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Edição Emulando Telegram */}
      {editingPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-xl bg-[#1e2329] shadow-2xl flex flex-col overflow-hidden border border-white/5">
            {/* Header / Nav do Telegram (Fake) */}
            <div className="flex items-center gap-3 bg-[#242b33] px-4 py-3 shadow-md z-10">
              <button onClick={() => setEditingPost(null)} className="text-[#3390ec] hover:bg-white/5 rounded-full p-1 -ml-2 transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1 flex flex-col">
                <span className="text-white font-semibold text-base leading-tight">Pré-visualização</span>
                <span className="text-[#8e98a3] text-xs">
                  {new Date(editingPost.scheduledAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#0f0f0f] custom-scrollbar flex flex-col relative max-h-[70vh]">
              {/* Media Preview */}
              {editingPost.media?.[0] ? (
                <div className="w-full bg-black flex justify-center items-center overflow-hidden">
                  {editingPost.media[0].kind === "video" ? (
                    <video src={`/api/media/${editingPost.media[0].id}/file`} className="w-full h-auto max-h-[45vh] object-contain" autoPlay muted loop playsInline />
                  ) : (
                    <img src={`/api/media/${editingPost.media[0].id}/file`} className="w-full h-auto max-h-[45vh] object-contain" />
                  )}
                </div>
              ) : (
                <div className="w-full h-32 bg-zinc-900 flex items-center justify-center text-zinc-600 text-sm">
                  Mensagem apenas (Sem Mídia)
                </div>
              )}

              {/* Caption Edit Area (Telegram Input Style) */}
              <div className="p-3 bg-[#1e2329] flex-1 flex flex-col border-t border-white/5">
                <p className="text-xs text-[#8e98a3] mb-2 font-semibold">LEGENDA DO POST:</p>
                <textarea
                  className="w-full flex-1 rounded-lg bg-[#2b313b] px-3 py-3 text-[15px] text-white focus:outline-none focus:ring-1 focus:ring-[#3390ec] resize-none font-sans leading-snug min-h-[120px]"
                  value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)}
                  placeholder="Escreva a mensagem..."
                />
              </div>
            </div>
            
            {/* Footer com botões de ação */}
            <div className="bg-[#1e2329] px-4 py-3 border-t border-white/5 flex justify-between items-center gap-3">
               <button 
                  onClick={() => setEditingPost(null)} 
                  disabled={saving}
                  className="text-[#8e98a3] hover:text-white text-sm font-semibold transition-colors px-2 py-1"
                >
                  Cancelar
                </button>
                <button 
                  onClick={saveEdit} 
                  disabled={saving}
                  className="rounded-full bg-[#3390ec] px-6 py-2 text-sm font-bold text-white hover:bg-[#2f84d9] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? "Salvando..." : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Salvar Alterações
                    </>
                  )}
                </button>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialog}
    </div>
  );
}
