import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiSend } from "@/lib/api";
import type { ScheduledPost } from "@/lib/postTypes";
import type { Profile } from "@/lib/types";
import { useConfirm } from "@/hooks/useConfirm";
import { showToast } from "@/lib/toast";
import CalendarGrid from "@/components/schedule/CalendarGrid";
import TelegramPostForm from "@/components/telegram/TelegramPostForm";
import CaptionEditor, { CaptionPreview, captionPlainText } from "@/components/telegram/CaptionEditor";
import { IconCalendar, IconList, IconPlus, IconTrash, IconEdit, IconCheck, IconEye, IconEyeOff } from "@/components/icons";

/** Classifica o post pelo TIPO DE CONTEÚDO (enquete, vídeo, foto ou texto). */
function contentKind(post: ScheduledPost): { label: string; cls: string } {
  if (post.poll) return { label: "Enquete", cls: "bg-purple-500/10 text-purple-300 border-purple-500/20" };
  if (post.media?.some((m) => m.kind === "video"))
    return { label: "Vídeo", cls: "bg-blue-500/10 text-blue-300 border-blue-500/20" };
  if (post.media && post.media.length > 0)
    return { label: "Foto", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" };
  return { label: "Texto", cls: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20" };
}

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
  const [hidePosted, setHidePosted] = useState(false);

  // Seleção múltipla para exclusão em lote
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);

  // Estados de edição (preview do telegram)
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [saving, setSaving] = useState(false);
  
  // Estados do formulário completo
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<ScheduledPost | null>(null);

  // Necessário para renderizar o modal via portal (document.body só existe no cliente).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Trava a rolagem do fundo enquanto a pré-visualização está aberta.
  useEffect(() => {
    if (!editingPost) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [editingPost]);

  const { confirm, ConfirmDialog } = useConfirm();

  async function load() {
    if (!profileId) return;
    setLoading(true);
    try {
      const res = await apiGet<{ posts: ScheduledPost[] }>(`/api/posts?profileId=${profileId}`);
      // Filtra apenas posts da rede Telegram
      const telegramPosts = (res.posts || []).filter(p => p.networks.some(n => n.network === "telegram"));
      setPosts(telegramPosts);
      setSelectedPostIds([]); // Limpa seleções ao recarregar
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
      setSelectedPostIds(prev => prev.filter(x => x !== id));
      setEditingPost(null);
      showToast("Agendamento excluído.", "success");
    } catch (e) {
      showToast("Erro ao excluir.", "error");
    }
  }

  async function deleteSelected() {
    if (selectedPostIds.length === 0) return;
    if (!(await confirm(`Deseja realmente excluir os ${selectedPostIds.length} agendamentos selecionados?`))) return;
    try {
      await Promise.all(selectedPostIds.map(id => apiSend(`/api/posts/${id}`, "DELETE")));
      setPosts(ps => ps.filter(p => !selectedPostIds.includes(p.id)));
      setSelectedPostIds([]);
      showToast(`${selectedPostIds.length} agendamentos excluídos com sucesso.`, "success");
    } catch (e) {
      showToast("Erro ao excluir alguns posts.", "error");
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
      if (hidePosted && p.status === "posted") return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (typeFilter) {
        const net = p.networks.find(n => n.network === "telegram");
        if (net && net.postType !== typeFilter) return false;
      }
      return true;
    });
  }, [posts, statusFilter, typeFilter, hidePosted]);

  const allSelected = filtered.length > 0 && selectedPostIds.length === filtered.length;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedPostIds([]);
    } else {
      setSelectedPostIds(filtered.map(p => p.id));
    }
  }

  function toggleSelectPost(id: string) {
    setSelectedPostIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

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
              <option value="Prévias">Prévias</option>
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
              type="button"
              onClick={() => setHidePosted((v) => !v)}
              title={hidePosted ? "Mostrar também os já postados" : "Ocultar os já postados"}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                hidePosted
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-white/10 text-zinc-300 hover:bg-white/5"
              }`}
            >
              {hidePosted ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              <span className="hidden sm:inline">{hidePosted ? "Postados ocultos" : "Ocultar postados"}</span>
            </button>
            <button
              onClick={() => { setFormInitial(null); setFormOpen(true); }}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm ml-2"
            >
              <IconPlus size={16} /> Postagem Manual
            </button>
          </div>
        </div>

        {/* Barra de Ações em Lote */}
        {selectedPostIds.length > 0 && (
          <div className="flex items-center justify-between bg-sky-500/10 border border-sky-500/20 rounded-lg p-3 animate-fade-in">
            <span className="text-xs font-semibold text-sky-200">
              {selectedPostIds.length} agendamento(s) selecionado(s)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedPostIds([])}
                className="text-xs text-zinc-400 hover:text-white px-2 py-1"
              >
                Limpar Seleção
              </button>
              <button
                onClick={deleteSelected}
                className="btn-danger flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                <IconTrash size={14} /> Excluir Selecionados
              </button>
            </div>
          </div>
        )}
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
          defaultView="week"
        />
      ) : (
        /* Modo Lista Verdadeira */
        <div className="mt-4 overflow-hidden rounded-lg border border-white/5 bg-black/10">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02] text-zinc-400 uppercase text-[10px] tracking-wider font-bold">
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-white/10 bg-zinc-900 text-sky-500 focus:ring-sky-500"
                  />
                </th>
                <th className="p-3 w-16">Miniatura</th>
                <th className="p-3 w-28">Tipo</th>
                <th className="p-3 w-28">Conteúdo</th>
                <th className="p-3 w-40">Agendado Para</th>
                <th className="p-3">Legenda</th>
                <th className="p-3 w-28 text-center">Status</th>
                <th className="p-3 w-36 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filtered.sort((a,b) => a.scheduledAt - b.scheduledAt).map(post => {
                const isSelected = selectedPostIds.includes(post.id);
                return (
                  <tr
                    key={post.id}
                    onClick={() => openPreview(post)}
                    className={`hover:bg-white/[0.01] cursor-pointer transition-colors ${
                      isSelected ? "bg-sky-500/[0.02]" : ""
                    }`}
                  >
                    <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectPost(post.id)}
                        className="rounded border-white/10 bg-zinc-900 text-sky-500 focus:ring-sky-500"
                      />
                    </td>
                    <td className="p-3">
                      {post.media && post.media.length > 0 ? (
                        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded bg-ink-800 border border-white/5">
                          <img
                            src={`/api/media/${post.media[0].id}/thumbnail`}
                            className="h-full w-full object-cover"
                            alt="Preview"
                            loading="lazy"
                          />
                          {post.media.length > 1 && (
                            <span className="absolute bottom-0 right-0 bg-black/80 text-[8px] px-1 rounded-tl text-white font-bold">
                              +{post.media.length - 1}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="h-11 w-11 rounded border border-dashed border-white/10 flex items-center justify-center text-zinc-600 bg-zinc-900/50">
                          <IconCalendar size={14} />
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-semibold">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        (post.networks.find(n => n.network === "telegram")?.postType || "Telegram") === "VIP"
                          ? "bg-sky-500/10 text-sky-400"
                          : "bg-orange-500/10 text-orange-400"
                      }`}>
                        {post.networks.find(n => n.network === "telegram")?.postType || "Telegram"}
                      </span>
                    </td>
                    <td className="p-3">
                      {(() => {
                        const k = contentKind(post);
                        return (
                          <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${k.cls}`}>
                            {k.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="p-3 font-mono text-xs text-zinc-300">
                      {new Date(post.scheduledAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </td>
                    <td className="p-3 text-zinc-400 truncate max-w-[200px] sm:max-w-xs md:max-w-md lg:max-w-lg">
                      {post.caption ? captionPlainText(post.caption) : <span className="text-zinc-600 italic">Sem legenda</span>}
                    </td>
                    <td className="p-3 text-center">
                      {post.status === "posted" ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                          <IconCheck size={8} /> Postado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                          Agendado
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => togglePostedStatus(post)}
                          className="p-1.5 rounded hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
                          title={post.status === "posted" ? "Marcar como agendado" : "Marcar como postado"}
                        >
                          <IconCheck size={14} />
                        </button>
                        <button
                          onClick={() => { setFormInitial(post); setFormOpen(true); }}
                          className="p-1.5 rounded hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
                          title="Editar"
                        >
                          <IconEdit size={14} />
                        </button>
                        <button
                          onClick={() => deletePost(post.id)}
                          className="p-1.5 rounded hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition-colors"
                          title="Excluir"
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Edição Emulando Telegram (Pré-visualização rápida).
          Renderizado via portal em document.body: evita ficar preso dentro de
          ancestrais com transform/animação (que quebram o position:fixed e
          jogavam a janela para fora da área visível). */}
      {editingPost && mounted && createPortal(
        (
        <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/90 p-4 backdrop-blur-md">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-white/5 bg-[#1e2329] shadow-2xl">
            {/* Header / Nav do Telegram */}
            <div className="flex shrink-0 items-center justify-between gap-3 bg-[#242b33] px-4 py-3 shadow-md">
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

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#0f0f0f] custom-scrollbar">
              {editingPost.poll ? (
                /* ENQUETE — pré-visualização estilo Telegram (só leitura) */
                <div className="p-4">
                  <div className="rounded-xl border border-white/5 bg-[#1e2329] p-4">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-purple-300">📊 Enquete</p>
                    <p className="mb-3 text-[15px] font-semibold leading-snug text-white">{editingPost.poll.question}</p>
                    <div className="space-y-2">
                      {editingPost.poll.options.map((o, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0f0f0f] px-3 py-2.5 text-sm text-zinc-200">
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/25" />
                          <span>{o}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] text-[#8e98a3]">Enviada como enquete nativa do Telegram. Para alterar as opções, use “Editar post completo”.</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Media Preview */}
                  {editingPost.media?.[0] ? (
                    <div className="flex w-full shrink-0 items-center justify-center overflow-hidden bg-black">
                      {editingPost.media[0].kind === "video" ? (
                        <video src={`/api/media/${editingPost.media[0].id}/file`} className="h-auto w-full max-h-[45vh] object-contain" autoPlay muted loop playsInline />
                      ) : (
                        <img src={`/api/media/${editingPost.media[0].id}/file`} className="h-auto w-full max-h-[45vh] object-contain" />
                      )}
                    </div>
                  ) : (
                    <div className="flex h-24 w-full shrink-0 items-center justify-center gap-2 bg-zinc-900 text-sm text-zinc-500">
                      <span className="text-lg">💬</span> Mensagem de texto (sem mídia)
                    </div>
                  )}

                  {/* Caption Edit Area */}
                  <div className="flex flex-1 flex-col border-t border-white/5 bg-[#1e2329] p-3">
                    <p className="mb-2 text-xs font-semibold text-[#8e98a3]">
                      {editingPost.media?.[0] ? "LEGENDA DO POST:" : "TEXTO DA MENSAGEM:"}
                    </p>
                    {/(<a\s)/i.test(editCaption) && (
                      <div className="mb-2 rounded-lg border border-white/5 bg-[#0f0f0f] px-3 py-2">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#8e98a3]">Como vai aparecer</p>
                        <CaptionPreview text={editCaption} className="text-[13px] leading-snug text-zinc-200" />
                      </div>
                    )}
                    <CaptionEditor
                      value={editCaption}
                      onChange={setEditCaption}
                      placeholder="Escreva a mensagem..."
                      rootClassName="flex-1"
                      textAreaClassName="w-full flex-1 rounded-lg bg-[#2b313b] px-3 py-3 text-[15px] text-white focus:outline-none focus:ring-1 focus:ring-[#3390ec] resize-none font-sans leading-snug min-h-[120px]"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 justify-end gap-3 border-t border-white/5 bg-[#1e2329] px-4 py-3">
               <button
                  onClick={() => setEditingPost(null)}
                  disabled={saving}
                  className="text-[#8e98a3] hover:text-white text-sm font-semibold transition-colors px-2 py-1"
                >
                  {editingPost.poll ? "Fechar" : "Cancelar"}
                </button>
                {!editingPost.poll && (
                <button
                  onClick={saveCaptionEdit}
                  disabled={saving}
                  className="rounded-full bg-[#3390ec] px-5 py-2 text-sm font-bold text-white hover:bg-[#2f84d9] transition-colors disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar Legenda"}
                </button>
                )}
            </div>
          </div>
        </div>
        ),
        document.body,
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
