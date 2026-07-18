import { useEffect, useState, useMemo } from "react";
import { apiGet, apiSend } from "@/lib/api";
import type { ScheduledPost } from "@/lib/postTypes";
import type { Profile } from "@/lib/types";
import { useConfirm } from "@/hooks/useConfirm";
import { showToast } from "@/lib/toast";
import CalendarGrid from "@/components/schedule/CalendarGrid";
import TelegramPostForm from "@/components/telegram/TelegramPostForm";
import { IconCalendar, IconList, IconPlus, IconTrash, IconEdit, IconCheck } from "@/components/icons";

export default function TelegramCalendar({ profileId, profiles }: { profileId: string, profiles: Profile[] }) {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Estados de edição (preview do telegram)
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [saving, setSaving] = useState(false);
  
  // Estados do formulário completo
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<ScheduledPost | null>(null);

  const { confirm, ConfirmDialog } = useConfirm();

  async function load() {
    if (!profileId) return;
    setLoading(true);
    try {
      const res = await apiGet<{ posts: ScheduledPost[] }>(`/api/posts?profileId=${profileId}`);
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
      setEditingPost(null);
      showToast("Agendamento excluído.", "success");
    } catch (e) {
      showToast("Erro ao excluir.", "error");
    }
  }

  async function movePost(postId: string, newDate: Date) {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    const oldD = new Date(post.scheduledAt);
    const updatedDate = new Date(
      newDate.getFullYear(),
      newDate.getMonth(),
      newDate.getDate(),
      oldD.getHours(),
      oldD.getMinutes()
    );
    try {
      const res = await apiSend<{ post: ScheduledPost }>(
        `/api/posts/${post.id}`,
        "PATCH",
        { scheduledAt: updatedDate.getTime() }
      );
      setPosts((ps) => ps.map((p) => (p.id === res.post.id ? res.post : p)));
      showToast("Reagendado para " + updatedDate.toLocaleDateString("pt-BR"), "success");
    } catch (e) {
      showToast("Falha ao reagendar.", "error");
    }
  }

  function openPreview(post: ScheduledPost) {
    setEditingPost(post);
    setEditCaption(post.caption || "");
  }

  async function saveCaptionEdit() {
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
  
  async function togglePostedStatus(post: ScheduledPost) {
    const next = post.status === "posted" ? "scheduled" : "posted";
    try {
      const res = await apiSend<{ post: ScheduledPost }>(`/api/posts/${post.id}`, "PATCH", { status: next });
      setPosts((ps) => ps.map((p) => (p.id === res.post.id ? res.post : p)));
      showToast(`Marcado como ${next === "posted" ? "postado" : "agendado"}.`, "success");
    } catch (e) {
      showToast("Falha ao atualizar status.", "error");
    }
  }

  const filtered = useMemo(() => {
    return posts.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (typeFilter) {
        const net = p.networks.find(n => n.network === "telegram");
        if (net && net.postType !== typeFilter) return false;
      }
      return true;
    });
  }, [posts, statusFilter, typeFilter]);

  if (!profileId) return null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/30 p-6 shadow-xl">
      <div className="mb-6 flex flex-col gap-4">
        {/* Barra superior estilo Schedule */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex rounded-lg border border-white/10 bg-black/20 p-1">
            <button
              onClick={() => setView("calendar")}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "calendar" ? "bg-white text-ink-950" : "text-zinc-400 hover:text-white"
              }`}
            >
              <IconCalendar size={14} /> Calendário
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "list" ? "bg-white text-ink-950" : "text-zinc-400 hover:text-white"
              }`}
            >
              <IconList size={14} /> Lista
            </button>
          </div>
          
          <div className="flex flex-1 justify-end gap-2">
            <select
              className="input py-2 text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">Todos os tipos</option>
              <option value="VIP">VIP</option>
              <option value="Aquecimento">Aquecimento</option>
            </select>
            <select
              className="input py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Todos os status</option>
              <option value="scheduled">Agendados</option>
              <option value="posted">Postados</option>
            </select>
            <button
              onClick={() => { setFormInitial(null); setFormOpen(true); }}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm ml-2"
            >
              <IconPlus size={16} /> Postagem Manual
            </button>
          </div>
        </div>
      </div>

      {loading && filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-12 text-center text-zinc-500">
          <p className="text-sm">Nenhum post encontrado com esses filtros.</p>
        </div>
      ) : view === "calendar" ? (
        <CalendarGrid
          month={month}
          onMonthChange={setMonth}
          posts={filtered}
          onDayClick={(d) => { /* Não preencher formulário no clique do dia por enquanto */ }}
          onPostClick={openPreview}
          onPostMove={movePost}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 mt-4">
          {filtered.sort((a,b) => a.scheduledAt - b.scheduledAt).map(post => (
            <div key={post.id} onClick={() => openPreview(post)} className="card p-3 cursor-pointer hover:border-white/20 transition-colors">
               <div className="flex justify-between items-start mb-2">
                 <div className="flex flex-col">
                   <span className="text-xs font-semibold text-white">
                     {new Date(post.scheduledAt).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                     {" às "}
                     {new Date(post.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                   </span>
                   <span className="text-[10px] text-[#3390ec] font-bold uppercase tracking-wider mt-0.5">
                     {post.networks.find(n => n.network === "telegram")?.postType || "Telegram"}
                   </span>
                 </div>
                 {post.status === "posted" ? (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                      <IconCheck size={10} /> Postado
                    </span>
                 ) : (
                    <span className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                      Agendado
                    </span>
                 )}
               </div>
               {post.media && post.media.length > 0 && (
                 <div className="w-full h-24 bg-black rounded overflow-hidden mb-2 relative">
                    <img src={`/api/media/${post.media[0].id}/thumbnail`} className="w-full h-full object-cover opacity-70" />
                    <div className="absolute inset-0 flex items-center justify-center text-white/80 font-semibold text-xs">
                       {post.media.length} mídia(s)
                    </div>
                 </div>
               )}
               {post.caption && <p className="text-xs text-zinc-400 line-clamp-3">{post.caption}</p>}
               
               <div className="mt-3 flex justify-between gap-2 border-t border-white/5 pt-2">
                 <button onClick={(e) => { e.stopPropagation(); togglePostedStatus(post); }} className="text-xs text-zinc-500 hover:text-white px-2 py-1">
                   {post.status === "posted" ? "Desmarcar" : "Marcar Postado"}
                 </button>
                 <button onClick={(e) => { e.stopPropagation(); setFormInitial(post); setFormOpen(true); }} className="text-xs text-zinc-300 hover:text-white px-2 py-1">
                   Editar
                 </button>
               </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Edição Emulando Telegram (Pré-visualização rápida) */}
      {editingPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-xl bg-[#1e2329] shadow-2xl flex flex-col overflow-hidden border border-white/5">
            {/* Header / Nav do Telegram */}
            <div className="flex items-center justify-between gap-3 bg-[#242b33] px-4 py-3 shadow-md z-10">
              <div className="flex items-center gap-2">
                <button onClick={() => setEditingPost(null)} className="text-[#3390ec] hover:bg-white/5 rounded-full p-1 transition-colors">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="flex flex-col">
                  <span className="text-white font-semibold text-base leading-tight">Pré-visualização</span>
                  <span className="text-[#8e98a3] text-xs">
                    {new Date(editingPost.scheduledAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => { setFormInitial(editingPost); setFormOpen(true); setEditingPost(null); }} className="text-zinc-400 hover:text-white p-1" title="Editar post completo">
                   <IconEdit size={16} />
                 </button>
                 <button onClick={() => deletePost(editingPost.id)} className="text-red-400 hover:text-red-300 p-1" title="Excluir">
                   <IconTrash size={16} />
                 </button>
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

              {/* Caption Edit Area */}
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
            
            {/* Footer */}
            <div className="bg-[#1e2329] px-4 py-3 border-t border-white/5 flex justify-end gap-3">
               <button 
                  onClick={() => setEditingPost(null)} 
                  disabled={saving}
                  className="text-[#8e98a3] hover:text-white text-sm font-semibold transition-colors px-2 py-1"
                >
                  Cancelar
                </button>
                <button 
                  onClick={saveCaptionEdit} 
                  disabled={saving}
                  className="rounded-full bg-[#3390ec] px-5 py-2 text-sm font-bold text-white hover:bg-[#2f84d9] transition-colors disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar Legenda"}
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Formulário Completo (Postagem Manual / Editar) */}
      {formOpen && (
        <TelegramPostForm
          profiles={profiles}
          initial={formInitial}
          defaultProfileId={profileId}
          onClose={() => setFormOpen(false)}
          onSaved={(saved, isNew) => {
            setFormOpen(false);
            setPosts((ps) =>
              isNew
                ? [...(ps || []), saved].sort((a, b) => a.scheduledAt - b.scheduledAt)
                : (ps || []).map((p) => (p.id === saved.id ? saved : p))
            );
          }}
        />
      )}

      {ConfirmDialog}
    </div>
  );
}
