"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import AuthImage from "@/components/AuthImage";
import ToggleChip from "@/components/ToggleChip";
import ScheduleTemplateModal from "@/components/schedule/ScheduleTemplateModal";
import GenerateScheduleModal from "@/components/schedule/GenerateScheduleModal";
import CalendarGrid from "@/components/schedule/CalendarGrid";
import { PushNotificationButton } from "./PushNotificationButton";
import { useConfirm } from "@/hooks/useConfirm";
import {
  IconArrowLeft,
  IconChevronRight,
  IconPlus,
  IconEdit,
  IconTrash,
  IconSparkle,
  IconCalendar,
  IconPlay,
  IconCopy,
  IconDownload,
  IconCheck,
  IconEye,
  IconEyeOff,
} from "@/components/icons";
import { NETWORK_LABELS, mediaFileUrl, mediaThumbUrl, type MediaItem, type Profile, type SocialAccount, type SocialNetwork, type Tag } from "@/lib/types";
import { showToast } from "@/lib/toast";
import type { AiProvider } from "@/lib/settings";
import {
  NETWORK_DOT_COLORS,
  POST_TYPES,
  type PostNetwork,
  type ScheduledPost,
} from "@/lib/postTypes";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const ALLOWED_SCHEDULE_NETWORKS = ["instagram", "threads", "tiktok", "facebook", "x", "youtube"];

function mediaUrl(m: { id: string; updatedAt?: number }): string {
  return `/api/media/${m.id}/file?v=${m.updatedAt || 0}`;
}

function thumbUrl(m: { id: string; updatedAt?: number }): string {
  return `/api/media/${m.id}/thumbnail?v=${m.updatedAt || 0}`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDayLong(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

// O Telegram (VIP/Prévias) é uma atividade à parte, gerida no menu Telegram —
// não faz parte do Cronograma de postagens (redes sociais / captação).
const isTelegramPost = (p: ScheduledPost) => p.networks.some((n) => n.network === "telegram");

/** Post "pronto" para postar = tem mídia E legenda. */
const isReady = (p: ScheduledPost) => p.media.length > 0 && Boolean(p.caption && p.caption.trim());

/** Atrasado = ainda agendado e o horário já passou. */
const isOverdue = (p: ScheduledPost) => p.status === "scheduled" && p.scheduledAt < Date.now();

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Salva/compartilha a mídia do post no dispositivo (Web Share no iPhone → Fotos;
 *  fallback baixa arquivo único ou .zip). Compartilhado entre o detalhe e a fila. */
async function sharePostMedia(post: ScheduledPost): Promise<void> {
  if (post.media.length === 0) return;
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  const fallback = async () => {
    if (post.media.length === 1) {
      const m = post.media[0];
      const res = await fetch(mediaUrl(m));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }
    const res = await fetch("/api/media/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: post.media.map((m) => m.id) }),
    });
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hotdash-post-${post.media.length}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  if (!nav.share || !nav.canShare) {
    await fallback();
    return;
  }
  const files = await Promise.all(
    post.media.map(async (m) => {
      const res = await fetch(mediaUrl(m));
      const blob = await res.blob();
      return new File([blob], m.filename, { type: blob.type || "application/octet-stream" });
    }),
  );
  if (!nav.canShare({ files })) {
    await fallback();
    return;
  }
  try {
    await nav.share({ files });
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") await fallback();
  }
}

/** Selo de prontidão (pronto = mídia + legenda). */
function ReadyBadge({ post }: { post: ScheduledPost }) {
  const ready = isReady(post);
  return (
    <span
      className={`chip ${
        ready
          ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300"
          : "border-amber-500/30 bg-amber-500/[0.08] text-amber-300"
      }`}
    >
      {ready ? "pronto" : "incompleto"}
    </span>
  );
}

export default function SchedulePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[] | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [view, setView] = useState<"calendar" | "list" | "queue">("calendar");
  const [profileId, setProfileId] = useState("");
  const [networkFilter, setNetworkFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [hidePosted, setHidePosted] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledPost | null>(null);
  const [prefillDate, setPrefillDate] = useState<Date | null>(null);
  const [detailPost, setDetailPost] = useState<ScheduledPost | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  async function load() {
    try {
      const qs = new URLSearchParams();
      if (profileId) qs.set("profileId", profileId);
      if (statusFilter) qs.set("status", statusFilter);
      const d = await apiGet<{ posts: ScheduledPost[] }>(`/api/posts?${qs.toString()}`);
      setPosts(d.posts);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao carregar.", "error");
    }
  }

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => setProfiles(d.profiles))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, statusFilter]);

  const selectedProfile = profiles.find((p) => p.id === profileId);

  // Opções do filtro de rede: quando há uma modelo selecionada, mostra as
  // CONTAS dela (permite escolher um Instagram específico entre vários); com
  // "Todos os modelos", mostra as redes em uso. Telegram fica sempre de fora.
  const filterOptions = useMemo(() => {
    if (selectedProfile) {
      return selectedProfile.accounts
        .filter((a) => ALLOWED_SCHEDULE_NETWORKS.includes(a.network))
        .map((a) => ({ value: a.id, label: `${NETWORK_LABELS[a.network]} · @${a.username}` }));
    }
    const nets = new Set<SocialNetwork>();
    (posts || []).forEach((p) =>
      p.networks.forEach((n) => {
        if (ALLOWED_SCHEDULE_NETWORKS.includes(n.network)) nets.add(n.network);
      }),
    );
    return Array.from(nets).map((n) => ({ value: n, label: NETWORK_LABELS[n] }));
  }, [selectedProfile, posts]);

  const filtered = useMemo(() => {
    if (!posts) return [];
    // Telegram é gerido no menu Telegram — não aparece no Cronograma.
    let list = posts.filter((p) => !isTelegramPost(p));
    if (hidePosted) list = list.filter((p) => p.status !== "posted");
    if (networkFilter) {
      list = profileId
        ? list.filter((p) => p.networks.some((n) => n.accountId === networkFilter))
        : list.filter((p) => p.networks.some((n) => n.network === networkFilter));
    }
    return list;
  }, [posts, networkFilter, profileId, hidePosted]);

  async function togglePosted(post: ScheduledPost) {
    const next = post.status === "posted" ? "scheduled" : "posted";
    try {
      const { post: updated } = await apiSend<{ post: ScheduledPost }>(
        `/api/posts/${post.id}`,
        "PATCH",
        { status: next },
      );
      setPosts((ps) => (ps || []).map((p) => (p.id === updated.id ? updated : p)));
      showToast(updated.status === "posted" ? "Marcado como postado." : "Voltou para agendado.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao atualizar.", "error");
    }
  }

  async function removePost(post: ScheduledPost): Promise<boolean> {
    if (!(await confirm("Excluir este post agendado?"))) return false;
    try {
      await apiSend(`/api/posts/${post.id}`, "DELETE");
      setPosts((ps) => (ps || []).filter((p) => p.id !== post.id));
      showToast("Post excluído.");
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao excluir.", "error");
      return false;
    }
  }

  async function movePost(postId: string, newDate: Date) {
    if (!posts) return;
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
      const { post: updated } = await apiSend<{ post: ScheduledPost }>(
        `/api/posts/${post.id}`,
        "PATCH",
        { scheduledAt: updatedDate.getTime() }
      );
      setPosts((ps) => (ps || []).map((p) => (p.id === updated.id ? updated : p)));
      showToast("Reagendado para " + updatedDate.toLocaleDateString("pt-BR"));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao reagendar.", "error");
    }
  }

  function openNew(date?: Date) {
    setEditing(null);
    setPrefillDate(date || null);
    setFormOpen(true);
  }
  function openEdit(post: ScheduledPost) {
    setEditing(post);
    setPrefillDate(null);
    setFormOpen(true);
  }
  function openDuplicate(post: ScheduledPost) {
    setEditing({ ...post, id: "" });
    setPrefillDate(null);
    setFormOpen(true);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">planejamento</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Cronograma
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Planeje as postagens de cada personagem — a publicação é feita
            manualmente no celular de cada perfil.
          </p>
          <div className="mt-3">
            <PushNotificationButton />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setTemplateOpen(true)} className="btn-ghost">
            <IconCalendar size={16} /> Programa
          </button>
          <button
            onClick={() => setGenerateOpen(true)}
            className="btn-ghost"
            disabled={profiles.length === 0}
          >
            <IconSparkle size={16} /> Gerar com IA
          </button>
          <button onClick={() => openNew()} className="btn-primary" disabled={profiles.length === 0}>
            <IconPlus size={16} /> Novo post
          </button>
        </div>
      </div>

      {/* Filtros + abas */}
      <div className="mt-6 card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-white/10 p-1">
            {(
              [
                ["calendar", "Calendário"],
                ["list", "Lista"],
                ["queue", "Para postar"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === key ? "bg-white text-ink-950" : "text-zinc-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3 sm:justify-end">
            <select
              className="input py-2 text-sm"
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
                setNetworkFilter(""); // as contas mudam de modelo p/ modelo
              }}
            >
              <option value="">Todos os modelos</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="input py-2 text-sm"
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
            >
              <option value="">{selectedProfile ? "Todas as contas" : "Todas as redes"}</option>
              {filterOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
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
          </div>
        </div>
      </div>

      {view === "calendar" ? (
        <CalendarGrid
          month={month}
          onMonthChange={setMonth}
          posts={filtered}
          onDayClick={(d) => openNew(d)}
          onPostClick={(p) => setDetailPost(p)}
          onPostMove={movePost}
          defaultView="week"
        />
      ) : view === "list" ? (
        <ListView
          posts={filtered}
          onToggle={togglePosted}
          onEdit={openEdit}
          onDelete={removePost}
          onDetail={setDetailPost}
          onDuplicate={openDuplicate}
        />
      ) : (
        <PostQueue
          posts={filtered}
          onToggle={togglePosted}
          onDetail={setDetailPost}
        />
      )}

      {formOpen && (
        <PostForm
          profiles={profiles}
          initial={editing}
          prefillDate={prefillDate}
          defaultProfileId={profileId}
          onClose={() => setFormOpen(false)}
          onSaved={(saved, isNew) => {
            setFormOpen(false);
            setPosts((ps) =>
              isNew
                ? [...(ps || []), saved].sort((a, b) => a.scheduledAt - b.scheduledAt)
                : (ps || []).map((p) => (p.id === saved.id ? saved : p)),
            );
          }}
        />
      )}

      {templateOpen && <ScheduleTemplateModal onClose={() => setTemplateOpen(false)} />}

      {generateOpen && (
        <GenerateScheduleModal
          profiles={profiles}
          defaultProfileId={profileId}
          onClose={() => setGenerateOpen(false)}
          onCreated={(created) => {
            setPosts((ps) => [...(ps || []), ...created].sort((a, b) => a.scheduledAt - b.scheduledAt));
          }}
        />
      )}

      {detailPost && (
        <PostDetail
          post={detailPost}
          onClose={() => setDetailPost(null)}
          onEdit={() => {
            openEdit(detailPost);
            setDetailPost(null);
          }}
          onDuplicate={() => {
            openDuplicate(detailPost);
            setDetailPost(null);
          }}
          onDelete={async () => {
            if (await removePost(detailPost)) setDetailPost(null);
          }}
          onToggle={async () => {
            await togglePosted(detailPost);
            setDetailPost(null);
          }}
        />
      )}

      {ConfirmDialog}
    </div>
  );
}

// ---- Detalhe rápido de um post (calendário): evita abrir a edição direto ----
function PostDetail({
  post,
  onClose,
  onEdit,
  onDelete,
  onToggle,
  onDuplicate,
}: {
  post: ScheduledPost;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function copyCaption() {
    if (!post.caption) return;
    try {
      await navigator.clipboard.writeText(post.caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silencioso: usuário pode tentar de novo */
    }
  }

  /** Fallback sem Web Share API: baixa arquivo único ou .zip (vários). */
  async function downloadFallback() {
    if (post.media.length === 1) {
      const m = post.media[0];
      const res = await fetch(mediaUrl(m));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }
    const res = await fetch("/api/media/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: post.media.map((m) => m.id) }),
    });
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hotdash-post-${post.media.length}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Salva direto no dispositivo. No iPhone/iPad, abre a folha nativa de
   * compartilhamento com todas as fotos juntas — "Salvar N Imagens" vai
   * direto para o app Fotos (sem precisar baixar/extrair um .zip). Cai no
   * fallback (arquivo único ou .zip) se o navegador não suportar.
   */
  async function downloadMedia() {
    if (post.media.length === 0) return;
    setDownloading(true);
    try {
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (!nav.share || !nav.canShare) {
        await downloadFallback();
        return;
      }
      const files = await Promise.all(
        post.media.map(async (m) => {
          const res = await fetch(mediaUrl(m));
          const blob = await res.blob();
          return new File([blob], m.filename, { type: blob.type || "application/octet-stream" });
        }),
      );
      if (!nav.canShare({ files })) {
        await downloadFallback();
        return;
      }
      await nav.share({ files });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        try {
          await downloadFallback();
        } catch {
          /* silencioso: usuário pode tentar de novo */
        }
      }
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-sm">
      <p className="eyebrow">{fmtDayLong(post.scheduledAt)}</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">{post.profileName}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-zinc-500">{fmtTime(post.scheduledAt)}</span>
        {post.networks.map((n) => (
          <span
            key={n.accountId || n.network}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }} />
            {NETWORK_LABELS[n.network]}
            {n.accountUsername ? ` (@${n.accountUsername})` : ""} · {n.postType}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {isOverdue(post) && (
          <span className="chip border-amber-500/30 bg-amber-500/[0.08] text-amber-300">atrasado</span>
        )}
        <ReadyBadge post={post} />
      </div>

      {post.media.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {post.media.map((m) => (
            <div
              key={m.id}
              className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-ink-800"
            >
              {m.kind === "image" ? (
                <AuthImage
                  src={mediaUrl(m)}
                  alt={m.filename}
                  className="h-full w-full object-cover"
                  fallback={<div className="h-full w-full bg-ink-800" />}
                />
              ) : (
                <>
                  <AuthImage
                    src={thumbUrl(m)}
                    alt={m.filename}
                    className="h-full w-full object-cover"
                    fallback={<div className="h-full w-full bg-ink-800" />}
                  />
                  <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <IconPlay size={18} className="text-white drop-shadow" />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {post.caption && <p className="mt-3 text-sm text-zinc-400">{post.caption}</p>}

      <div className="mt-3 flex gap-2">
        {post.caption && (
          <button onClick={copyCaption} className="btn-ghost flex-1 text-xs">
            <IconCopy size={14} /> {copied ? "Copiado!" : "Copiar legenda"}
          </button>
        )}
        {post.media.length > 0 && (
          <button onClick={downloadMedia} disabled={downloading} className="btn-ghost flex-1 text-xs">
            <IconDownload size={14} />
            {downloading ? "Baixando..." : post.media.length > 1 ? "Baixar imagens" : "Baixar imagem"}
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={onToggle} className="btn-ghost flex-1">
          {post.status === "posted" ? "Marcar agendado" : "Marcar postado"}
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={onEdit} className="btn-primary flex-1">
          <IconEdit size={16} /> Editar
        </button>
        <button onClick={onDuplicate} className="btn-ghost flex-1">
          <IconCopy size={16} /> Duplicar
        </button>
      </div>
      <button onClick={onDelete} className="btn-danger mt-2 w-full">
        <IconTrash size={16} /> Excluir
      </button>
    </Modal>
  );
}


function ListView({
  posts,
  onToggle,
  onEdit,
  onDelete,
  onDetail,
  onDuplicate,
}: {
  posts: ScheduledPost[];
  onToggle: (p: ScheduledPost) => void;
  onEdit: (p: ScheduledPost) => void;
  onDelete: (p: ScheduledPost) => void;
  onDetail: (p: ScheduledPost) => void;
  onDuplicate: (p: ScheduledPost) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { day: number; items: ScheduledPost[] }>();
    for (const p of [...posts].sort((a, b) => a.scheduledAt - b.scheduledAt)) {
      const d = new Date(p.scheduledAt);
      d.setHours(0, 0, 0, 0);
      const k = String(d.getTime());
      const g = map.get(k) || { day: d.getTime(), items: [] };
      g.items.push(p);
      map.set(k, g);
    }
    return Array.from(map.values());
  }, [posts]);

  if (posts.length === 0) {
    return (
      <div className="mt-4 card flex flex-col items-center gap-2 p-10 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 text-zinc-500">
          <IconCalendar size={20} />
        </div>
        <p className="text-sm text-zinc-500">Nenhum post agendado com esses filtros.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      {groups.map((g) => (
        <div key={g.day}>
          <p className="eyebrow capitalize">{fmtDayLong(g.day)}</p>
          <div className="mt-2 card divide-y divide-white/[0.06] overflow-hidden">
            {g.items.map((p) => (
              <div
                key={p.id}
                onClick={() => onDetail(p)}
                className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white/[0.02]"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(p);
                  }}
                  title={p.status === "posted" ? "Marcar como agendado" : "Marcar como postado"}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
                    p.status === "posted"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "border border-white/15 text-zinc-500 hover:border-white/40 hover:text-zinc-300"
                  }`}
                >
                  {p.status === "posted" ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M5 13l4 4 10-10" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} />
                      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                    </svg>
                  )}
                </button>

                {p.media[0] ? (
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-ink-800">
                    {p.media[0].kind === "image" ? (
                      <AuthImage
                        src={mediaUrl(p.media[0])}
                        alt={p.media[0].filename}
                        className="h-full w-full object-cover"
                        fallback={<div className="h-full w-full bg-ink-800" />}
                      />
                    ) : (
                      <>
                        <AuthImage
                          src={thumbUrl(p.media[0])}
                          alt={p.media[0].filename}
                          className="h-full w-full object-cover"
                          fallback={<div className="h-full w-full bg-ink-800" />}
                        />
                        <div className="pointer-events-none absolute inset-0 grid place-items-center">
                          <IconPlay size={14} className="text-white drop-shadow" />
                        </div>
                      </>
                    )}
                    {p.media.length > 1 && (
                      <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/70 px-1 font-mono text-[9px] text-white">
                        +{p.media.length - 1}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-dashed border-white/10 text-zinc-700">
                    <IconCalendar size={16} />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-zinc-200">
                    <span className="font-mono text-xs text-zinc-500">{fmtTime(p.scheduledAt)}</span>
                    <span className="font-medium">{p.profileName}</span>
                    {p.networks.map((n) => (
                      <span key={n.accountId || n.network} className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                        />
                        {NETWORK_LABELS[n.network]}
                        {n.accountUsername ? ` (@${n.accountUsername})` : ""} · {n.postType}
                      </span>
                    ))}
                    {isOverdue(p) && (
                      <span className="chip border-amber-500/30 bg-amber-500/[0.08] text-amber-300">atrasado</span>
                    )}
                    <ReadyBadge post={p} />
                  </p>
                  {p.caption && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{p.caption}</p>
                  )}
                </div>

                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onDuplicate(p)}
                    className="grid h-7 w-7 place-items-center rounded hover:bg-white/10 hover:text-white text-zinc-400"
                    title="Duplicar"
                  >
                    <IconCopy size={14} />
                  </button>
                  <button
                    onClick={() => onEdit(p)}
                    className="grid h-7 w-7 place-items-center rounded hover:bg-white/10 hover:text-white text-zinc-400"
                    title="Editar"
                  >
                    <IconEdit size={14} />
                  </button>
                  <button
                    onClick={() => onDelete(p)}
                    className="grid h-7 w-7 place-items-center rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-400"
                    title="Excluir"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Fila "Para postar" (operação diária, mobile-first) ----
function PostQueue({
  posts,
  onToggle,
  onDetail,
}: {
  posts: ScheduledPost[];
  onToggle: (p: ScheduledPost) => void;
  onDetail: (p: ScheduledPost) => void;
}) {
  const scheduled = useMemo(
    () =>
      posts.filter((p) => p.status === "scheduled").sort((a, b) => a.scheduledAt - b.scheduledAt),
    [posts],
  );
  const overdue = scheduled.filter(isOverdue);
  const upcoming = scheduled.filter((p) => !isOverdue(p));

  if (scheduled.length === 0) {
    return (
      <div className="mt-4 card flex flex-col items-center gap-2 p-10 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 text-zinc-500">
          <IconCalendar size={20} />
        </div>
        <p className="text-sm text-zinc-500">
          Nada na fila — tudo com esses filtros já foi postado.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      {overdue.length > 0 && (
        <div>
          <p className="eyebrow text-amber-400">atrasados · {overdue.length}</p>
          <div className="mt-2 space-y-2">
            {overdue.map((p) => (
              <QueueCard key={p.id} post={p} onToggle={onToggle} onDetail={onDetail} overdue />
            ))}
          </div>
        </div>
      )}
      {upcoming.length > 0 && (
        <div>
          <p className="eyebrow">próximos · {upcoming.length}</p>
          <div className="mt-2 space-y-2">
            {upcoming.map((p) => (
              <QueueCard key={p.id} post={p} onToggle={onToggle} onDetail={onDetail} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QueueCard({
  post,
  onToggle,
  onDetail,
  overdue,
}: {
  post: ScheduledPost;
  onToggle: (p: ScheduledPost) => void;
  onDetail: (p: ScheduledPost) => void;
  overdue?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function prepare() {
    setBusy(true);
    try {
      const copied = post.caption && post.caption.trim() ? await copyText(post.caption) : false;
      await sharePostMedia(post);
      if (copied && post.media.length > 0) showToast("Legenda copiada e mídia pronta para salvar.");
      else if (copied) showToast("Legenda copiada.");
      else if (post.media.length > 0) showToast("Mídia pronta para salvar.");
      else showToast("Este post está sem legenda e sem mídia.", "warning");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao preparar.", "error");
    } finally {
      setBusy(false);
    }
  }

  const when = new Date(post.scheduledAt).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });

  return (
    <div className={`card p-3 ${overdue ? "border-amber-500/30" : ""}`}>
      <div className="flex gap-3">
        {post.media[0] ? (
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-ink-800">
            {post.media[0].kind === "image" ? (
              <AuthImage
                src={mediaUrl(post.media[0])}
                alt={post.media[0].filename}
                className="h-full w-full object-cover"
                fallback={<div className="h-full w-full bg-ink-800" />}
              />
            ) : (
              <>
                <AuthImage
                  src={thumbUrl(post.media[0])}
                  alt={post.media[0].filename}
                  className="h-full w-full object-cover"
                  fallback={<div className="h-full w-full bg-ink-800" />}
                />
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <IconPlay size={16} className="text-white drop-shadow" />
                </div>
              </>
            )}
            {post.media.length > 1 && (
              <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/70 px-1 font-mono text-[9px] text-white">
                +{post.media.length - 1}
              </span>
            )}
          </div>
        ) : (
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-dashed border-white/10 text-zinc-700">
            <IconCalendar size={18} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`font-mono text-xs ${overdue ? "text-amber-400" : "text-zinc-400"}`}>
              {when} · {fmtTime(post.scheduledAt)}
            </span>
            <ReadyBadge post={post} />
          </div>
          <p className="mt-1 truncate text-sm font-medium text-zinc-200">{post.profileName}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {post.networks.map((n) => (
              <span
                key={n.accountId || n.network}
                className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }} />
                {NETWORK_LABELS[n.network]}
                {n.accountUsername ? ` @${n.accountUsername}` : ""} · {n.postType}
              </span>
            ))}
          </div>
          {post.caption && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{post.caption}</p>}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={prepare} disabled={busy} className="btn-primary flex-1 px-3 py-2 text-xs">
          <IconDownload size={14} /> {busy ? "Preparando…" : "Preparar para postar"}
        </button>
        <button onClick={() => onToggle(post)} className="btn-ghost px-3 py-2 text-xs">
          Marcar postado
        </button>
        <button
          onClick={() => onDetail(post)}
          className="btn-ghost shrink-0 px-2.5 py-2"
          aria-label="Detalhes"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ---- Formulário de post (criar/editar) ----
function PostForm({
  profiles,
  initial,
  prefillDate,
  defaultProfileId,
  onClose,
  onSaved,
}: {
  profiles: Profile[];
  initial: ScheduledPost | null;
  prefillDate: Date | null;
  defaultProfileId: string;
  onClose: () => void;
  onSaved: (post: ScheduledPost, isNew: boolean) => void;
}) {
  const base = prefillDate || (initial ? new Date(initial.scheduledAt) : new Date());
  const [profileId, setProfileId] = useState(
    initial?.profileId || defaultProfileId || profiles[0]?.id || "",
  );
  const [date, setDate] = useState(() => {
    const d = base;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [time, setTime] = useState(() =>
    initial ? fmtTime(initial.scheduledAt) : "12:00",
  );
  const [networks, setNetworks] = useState<PostNetwork[]>(initial?.networks || []);
  const [caption, setCaption] = useState(initial?.caption || "");
  const [mediaIds, setMediaIds] = useState<string[]>(initial?.media.map((m) => m.id) || []);
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  const [aiTheme, setAiTheme] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider | "">("");
  const [aiOptions, setAiOptions] = useState<AiProvider[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [mediaTagFilter, setMediaTagFilter] = useState<string>("");
  const [mediaSortOrder, setMediaSortOrder] = useState<"desc" | "asc">("desc");
  const [usedMedia, setUsedMedia] = useState<Set<string>>(new Set());
  const [reusableBlocks, setReusableBlocks] = useState<{ id: string; name: string; content: string }[]>([]);

  // Carrega a biblioteca do perfil selecionado (mídias por referência).
  useEffect(() => {
    if (!profileId) return;
    setLibrary(null);
    setUsedMedia(new Set());
    apiGet<{ media: MediaItem[]; usedMediaIds?: string[] }>(`/api/profiles/${profileId}/media`)
      .then((d) => {
        setLibrary(d.media);
        if (d.usedMediaIds) setUsedMedia(new Set(d.usedMediaIds));
      })
      .catch(() => setLibrary([]));
  }, [profileId]);

  useEffect(() => {
    apiGet<{ blocks: { id: string; name: string; content: string }[] }>("/api/settings/reusable-blocks")
      .then((d) => setReusableBlocks(d.blocks))
      .catch(() => {});
  }, []);

  // Provedores de IA conectados (ativado + chave salva) — a escolha é feita
  // aqui, na hora de gerar, não há mais um "provedor ativo" fixo.
  useEffect(() => {
    apiGet<{ settings: { openai: { enabled: boolean; hasKey: boolean }; gemini: { enabled: boolean; hasKey: boolean } } }>(
      "/api/settings/ai",
    )
      .then((d) => {
        const opts: AiProvider[] = [];
        if (d.settings.openai.enabled && d.settings.openai.hasKey) opts.push("openai");
        if (d.settings.gemini.enabled && d.settings.gemini.hasKey) opts.push("gemini");
        setAiOptions(opts);
        setAiProvider(opts[0] || "");
      })
      .catch(() => setAiOptions([]));
  }, []);

  useEffect(() => {
    apiGet<{ tags: Tag[] }>("/api/tags")
      .then((d) => setTags(d.tags))
      .catch(() => {});
  }, []);

  const selectedProfile = profiles.find((p) => p.id === profileId);
  // Apenas redes permitidas para o cronograma
  const accounts = (selectedProfile?.accounts || []).filter((a) => ALLOWED_SCHEDULE_NETWORKS.includes(a.network));

  const filteredLibrary = useMemo(() => {
    if (!library) return null;
    let list = library;
    if (mediaTagFilter) {
      list = list.filter((m) => m.tags?.some((t) => t.id === mediaTagFilter));
    }
    list = [...list].sort((a, b) => {
      if (mediaSortOrder === "asc") return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [library, mediaTagFilter, mediaSortOrder]);

  function toggleAccount(acc: SocialAccount) {
    setNetworks((prev) => {
      const exists = prev.find((n) => n.accountId === acc.id);
      if (exists) return prev.filter((n) => n.accountId !== acc.id);
      return [
        ...prev,
        { network: acc.network, postType: POST_TYPES[acc.network][0], accountId: acc.id, accountUsername: acc.username },
      ];
    });
  }

  function setType(accountId: string | undefined, postType: string) {
    setNetworks((prev) => prev.map((n) => (n.accountId === accountId ? { ...n, postType } : n)));
  }

  function toggleMedia(id: string) {
    setMediaIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }

  async function generate() {
    if (mediaIds.length === 0) {
      setErr("Selecione ao menos uma mídia para gerar a legenda.");
      return;
    }
    if (!aiProvider) {
      setErr("Nenhum provedor de IA conectado. Configure em Configurações → Conexão com IA.");
      return;
    }
    setAiBusy(true);
    setErr(null);
    try {
      const { caption: generated } = await apiSend<{ caption: string }>(
        "/api/ai/caption",
        "POST",
        { provider: aiProvider, profileId, networks, theme: aiTheme, mediaIds },
      );
      setCaption(generated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao gerar legenda.");
    } finally {
      setAiBusy(false);
    }
  }

  async function save() {
    setErr(null);
    if (!profileId) return setErr("Selecione o perfil.");
    if (networks.length === 0) return setErr("Selecione ao menos uma rede social.");
    const [h, m] = time.split(":").map(Number);
    const [yy, mm, dd] = date.split("-").map(Number);
    const scheduledAt = new Date(yy, mm - 1, dd, h || 0, m || 0).getTime();
    setSaving(true);
    try {
      if (initial && initial.id) {
        const { post } = await apiSend<{ post: ScheduledPost }>(
          `/api/posts/${initial.id}`,
          "PATCH",
          { profileId, networks, scheduledAt, caption, mediaIds },
        );
        onSaved(post, false);
      } else {
        const { post } = await apiSend<{ post: ScheduledPost }>("/api/posts", "POST", {
          profileId,
          networks,
          scheduledAt,
          caption,
          mediaIds,
        });
        onSaved(post, true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl">
      <div className="max-h-[80vh] overflow-y-auto pr-1">
        <p className="eyebrow">{initial?.id ? "editar" : "novo"}</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">
          {initial?.id ? "Editar post" : "Novo post"}
        </h2>

        {err && (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        )}

        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="eyebrow mb-1.5 block">Modelo</label>
              <select
                className="input"
                value={profileId}
                onChange={(e) => {
                  setProfileId(e.target.value);
                  setMediaIds([]);
                  setNetworks([]);
                }}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Data</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Hora</label>
              <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          {/* Redes (multi) + tipo por rede — só as contas cadastradas na modelo */}
          <div>
            <label className="eyebrow mb-1.5 block">Redes sociais (pode marcar várias)</label>
            {accounts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-zinc-500">
                Nenhuma rede cadastrada para esta modelo.{" "}
                <a href={`/dashboard/profiles/${profileId}`} className="underline hover:text-zinc-300">
                  Cadastrar conta
                </a>
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {accounts.map((acc) => (
                  <ToggleChip
                    key={acc.id}
                    active={networks.some((n) => n.accountId === acc.id)}
                    color={NETWORK_DOT_COLORS[acc.network]}
                    onClick={() => toggleAccount(acc)}
                  >
                    {NETWORK_LABELS[acc.network]} · @{acc.username}
                  </ToggleChip>
                ))}
              </div>
            )}
            {networks.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {networks.map((n) => (
                  <div key={n.accountId || n.network} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                    />
                    <span className="w-28 shrink-0 truncate text-xs text-zinc-300">
                      {NETWORK_LABELS[n.network]}
                      {n.accountUsername ? ` · @${n.accountUsername}` : ""}
                    </span>
                    <select
                      className="input flex-1 py-1.5 text-xs"
                      value={n.postType}
                      onChange={(e) => setType(n.accountId, e.target.value)}
                    >
                      {POST_TYPES[n.network].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mídias da biblioteca (por referência — nada é duplicado) */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="eyebrow block">
                Mídias da biblioteca{" "}
                <span className="normal-case text-zinc-600">
                  (clique para selecionar; o número indica a ordem no carrossel)
                </span>
              </label>
              <div className="flex gap-2">
                <select
                  className="input py-1 text-xs"
                  value={mediaTagFilter}
                  onChange={(e) => setMediaTagFilter(e.target.value)}
                >
                  <option value="">Todas as etiquetas</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input py-1 text-xs"
                  value={mediaSortOrder}
                  onChange={(e) => setMediaSortOrder(e.target.value as "desc" | "asc")}
                >
                  <option value="desc">Mais recentes</option>
                  <option value="asc">Mais antigas</option>
                </select>
              </div>
            </div>
            {filteredLibrary === null ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/5" />
                ))}
              </div>
            ) : filteredLibrary.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-zinc-600">
                Nenhuma mídia encontrada com os filtros atuais.
              </p>
            ) : (
              <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                {filteredLibrary.map((m) => {
                  const idx = mediaIds.indexOf(m.id);
                  const selected = idx !== -1;
                  const used = usedMedia.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMedia(m.id)}
                      className={`relative aspect-square overflow-hidden rounded-lg border bg-ink-850 transition-all ${
                        selected ? "border-white ring-2 ring-white/60" : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      {m.kind === "image" ? (
                        <AuthImage
                          src={mediaFileUrl(m)}
                          alt={m.filename}
                          className={`h-full w-full object-cover ${selected ? "opacity-80" : ""}`}
                          fallback={<div className="h-full w-full bg-ink-800" />}
                        />
                      ) : (
                        <>
                          <AuthImage
                            src={mediaThumbUrl(m)}
                            alt={m.filename}
                            className={`h-full w-full object-cover ${selected ? "opacity-80" : ""}`}
                            fallback={<div className="h-full w-full bg-ink-800" />}
                          />
                          <div className="pointer-events-none absolute inset-0 grid place-items-center">
                            <span className="grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white">
                              <IconPlay size={14} />
                            </span>
                          </div>
                        </>
                      )}
                      {selected && (
                        <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-white font-mono text-[10px] font-bold text-ink-950">
                          {idx + 1}
                        </span>
                      )}
                      {used && !selected && (
                        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-white" title="Mídia já utilizada por este perfil">
                          <IconCheck size={10} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Legenda + IA — a IA analisa a(s) mídia(s) selecionada(s) acima */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="eyebrow block">Legenda</label>
              {reusableBlocks.length > 0 && (
                <select
                  className="input py-1 text-xs w-48"
                  value=""
                  onChange={(e) => {
                    const block = reusableBlocks.find(b => b.id === e.target.value);
                    if (block) setCaption(prev => prev ? prev + "\n" + block.content : block.content);
                  }}
                >
                  <option value="" disabled>Inserir Bloco...</option>
                  {reusableBlocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            <textarea
              className="input min-h-[110px]"
              placeholder="Escreva a legenda ou selecione mídias acima e gere com IA…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="input min-w-[180px] flex-1 py-2 text-sm"
                placeholder="Contexto extra p/ IA (opcional — tom, ocasião...)"
                value={aiTheme}
                onChange={(e) => setAiTheme(e.target.value)}
              />
              {aiOptions && aiOptions.length > 0 && (
                <select
                  className="input w-auto py-2 text-sm"
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value as AiProvider)}
                >
                  {aiOptions.map((p) => (
                    <option key={p} value={p}>
                      {p === "openai" ? "OpenAI" : "Gemini"}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={generate}
                disabled={aiBusy}
                className="btn-ghost shrink-0 px-3 text-sm"
                title="Gera a legenda analisando a(s) mídia(s) selecionada(s)"
              >
                <IconSparkle size={15} /> {aiBusy ? "Gerando…" : "Gerar com IA"}
              </button>
            </div>
            {aiOptions && aiOptions.length === 0 && (
              <p className="mt-1.5 text-xs text-zinc-600">
                Nenhum provedor de IA conectado — configure em Configurações → Conexão com IA.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={saving}>
            Cancelar
          </button>
          <button type="button" onClick={save} className="btn-primary flex-1" disabled={saving}>
            {saving ? "Salvando…" : initial?.id ? "Salvar alterações" : "Agendar post"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
