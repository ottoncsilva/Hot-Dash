"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import AuthImage from "@/components/AuthImage";
import ToggleChip from "@/components/ToggleChip";
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
} from "@/components/icons";
import { NETWORK_LABELS, mediaFileUrl, mediaThumbUrl, type MediaItem, type Profile, type SocialNetwork } from "@/lib/types";
import {
  NETWORK_DOT_COLORS,
  POST_TYPES,
  type PostNetwork,
  type ScheduledPost,
} from "@/lib/postTypes";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

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

export default function SchedulePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [profileId, setProfileId] = useState("");
  const [networkFilter, setNetworkFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledPost | null>(null);
  const [prefillDate, setPrefillDate] = useState<Date | null>(null);
  const [detailPost, setDetailPost] = useState<ScheduledPost | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  async function load() {
    try {
      const qs = new URLSearchParams();
      if (profileId) qs.set("profileId", profileId);
      if (statusFilter) qs.set("status", statusFilter);
      const d = await apiGet<{ posts: ScheduledPost[] }>(`/api/posts?${qs.toString()}`);
      setPosts(d.posts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar.");
    }
  }

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => setProfiles(d.profiles))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, statusFilter]);

  const filtered = useMemo(() => {
    if (!posts) return [];
    if (!networkFilter) return posts;
    return posts.filter((p) => p.networks.some((n) => n.network === networkFilter));
  }, [posts, networkFilter]);

  async function togglePosted(post: ScheduledPost) {
    const next = post.status === "posted" ? "scheduled" : "posted";
    try {
      const { post: updated } = await apiSend<{ post: ScheduledPost }>(
        `/api/posts/${post.id}`,
        "PATCH",
        { status: next },
      );
      setPosts((ps) => (ps || []).map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao atualizar.");
    }
  }

  async function removePost(post: ScheduledPost): Promise<boolean> {
    if (!(await confirm("Excluir este post agendado?"))) return false;
    try {
      await apiSend(`/api/posts/${post.id}`, "DELETE");
      setPosts((ps) => (ps || []).filter((p) => p.id !== post.id));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao excluir.");
      return false;
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
        </div>
        <button onClick={() => openNew()} className="btn-primary" disabled={profiles.length === 0}>
          <IconPlus size={16} /> Novo post
        </button>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Filtros + abas */}
      <div className="mt-6 card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-white/10 p-1">
            {(
              [
                ["calendar", "Calendário"],
                ["list", "Lista"],
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
            <select className="input py-2 text-sm" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">Todos os perfis</option>
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
              <option value="">Todas as redes</option>
              {Object.entries(NETWORK_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
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
          </div>
        </div>
      </div>

      {view === "calendar" ? (
        <CalendarView
          month={month}
          onMonthChange={setMonth}
          posts={filtered}
          onDayClick={(d) => openNew(d)}
          onPostClick={setDetailPost}
        />
      ) : (
        <ListView
          posts={filtered}
          onToggle={togglePosted}
          onEdit={openEdit}
          onDelete={removePost}
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

      {detailPost && (
        <PostDetail
          post={detailPost}
          onClose={() => setDetailPost(null)}
          onEdit={() => {
            openEdit(detailPost);
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
}: {
  post: ScheduledPost;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <Modal open onClose={onClose} maxWidth="max-w-sm">
      <p className="eyebrow">{fmtDayLong(post.scheduledAt)}</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">{post.profileName}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-zinc-500">{fmtTime(post.scheduledAt)}</span>
        {post.networks.map((n) => (
          <span
            key={n.network}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }} />
            {NETWORK_LABELS[n.network]} · {n.postType}
          </span>
        ))}
      </div>

      {post.media[0] && (
        <div className="relative mt-3 h-32 w-32 overflow-hidden rounded-lg border border-white/10 bg-ink-800">
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
                <IconPlay size={18} className="text-white drop-shadow" />
              </div>
            </>
          )}
          {post.media.length > 1 && (
            <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
              +{post.media.length - 1}
            </span>
          )}
        </div>
      )}

      {post.caption && <p className="mt-3 text-sm text-zinc-400">{post.caption}</p>}

      <div className="mt-5 flex gap-2">
        <button onClick={onToggle} className="btn-ghost flex-1">
          {post.status === "posted" ? "Marcar agendado" : "Marcar postado"}
        </button>
        <button onClick={onEdit} className="btn-primary flex-1">
          <IconEdit size={16} /> Editar
        </button>
      </div>
      <button onClick={onDelete} className="btn-danger mt-2 w-full">
        <IconTrash size={16} /> Excluir
      </button>
    </Modal>
  );
}

// ---- Calendário mensal ----
function CalendarView({
  month,
  onMonthChange,
  posts,
  onDayClick,
  onPostClick,
}: {
  month: { year: number; month: number };
  onMonthChange: (m: { year: number; month: number }) => void;
  posts: ScheduledPost[];
  onDayClick: (d: Date) => void;
  onPostClick: (p: ScheduledPost) => void;
}) {
  const first = new Date(month.year, month.month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // volta até domingo
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  const byDay = new Map<string, ScheduledPost[]>();
  for (const p of posts) {
    const k = new Date(p.scheduledAt).toDateString();
    const list = byDay.get(k) || [];
    list.push(p);
    byDay.set(k, list);
  }

  function shift(delta: number) {
    const d = new Date(month.year, month.month + delta, 1);
    onMonthChange({ year: d.getFullYear(), month: d.getMonth() });
  }

  const monthLabel = first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="mt-4 card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <button
          onClick={() => shift(-1)}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Mês anterior"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-3">
          <p className="font-display text-sm font-semibold capitalize text-white">{monthLabel}</p>
          <button
            onClick={() => {
              const d = new Date();
              onMonthChange({ year: d.getFullYear(), month: d.getMonth() });
            }}
            className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white"
          >
            hoje
          </button>
        </div>
        <button
          onClick={() => shift(1)}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Próximo mês"
        >
          <IconChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-white/[0.06]">
        {WEEKDAYS.map((d) => (
          <p key={d} className="py-2 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            {d}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month.month;
          const isToday = d.getTime() === today.getTime();
          const dayPosts = (byDay.get(d.toDateString()) || []).sort(
            (a, b) => a.scheduledAt - b.scheduledAt,
          );
          return (
            <button
              key={i}
              onClick={() => onDayClick(new Date(d))}
              className={`min-h-[72px] border-b border-r border-white/[0.04] p-1 text-left align-top transition-colors hover:bg-white/[0.03] sm:min-h-[96px] ${
                inMonth ? "" : "opacity-35"
              }`}
            >
              <span
                className={`ml-1 inline-grid h-6 w-6 place-items-center rounded-full font-mono text-[11px] ${
                  isToday ? "bg-white font-bold text-ink-950" : "text-zinc-500"
                }`}
              >
                {d.getDate()}
              </span>
              <div className="mt-0.5 space-y-1">
                {dayPosts.slice(0, 3).map((p) => (
                  <span
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPostClick(p);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        onPostClick(p);
                      }
                    }}
                    className={`block rounded-md border px-1.5 py-1 text-[10px] leading-tight transition-colors ${
                      p.status === "posted"
                        ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200"
                        : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/25"
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      {p.networks.map((n) => (
                        <span
                          key={n.network}
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                        />
                      ))}
                      <span className="font-mono">{fmtTime(p.scheduledAt)}</span>
                    </span>
                    <span className="block truncate text-zinc-400">
                      {p.profileName} · {p.networks[0]?.postType}
                      {p.networks.length > 1 ? ` +${p.networks.length - 1}` : ""}
                    </span>
                  </span>
                ))}
                {dayPosts.length > 3 && (
                  <span className="block px-1.5 font-mono text-[9px] uppercase text-zinc-600">
                    +{dayPosts.length - 3} post(s)
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Lista agrupada por dia ----
function ListView({
  posts,
  onToggle,
  onEdit,
  onDelete,
}: {
  posts: ScheduledPost[];
  onToggle: (p: ScheduledPost) => void;
  onEdit: (p: ScheduledPost) => void;
  onDelete: (p: ScheduledPost) => void;
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
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => onToggle(p)}
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
                      <span key={n.network} className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                        />
                        {NETWORK_LABELS[n.network]} · {n.postType}
                      </span>
                    ))}
                  </p>
                  {p.caption && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{p.caption}</p>
                  )}
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => onEdit(p)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
                    aria-label="Editar"
                  >
                    <IconEdit size={16} />
                  </button>
                  <button
                    onClick={() => onDelete(p)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-red-400"
                    aria-label="Excluir"
                  >
                    <IconTrash size={16} />
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
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Carrega a biblioteca do perfil selecionado (mídias por referência).
  useEffect(() => {
    if (!profileId) return;
    setLibrary(null);
    apiGet<{ media: MediaItem[] }>(`/api/profiles/${profileId}/media`)
      .then((d) => setLibrary(d.media))
      .catch(() => setLibrary([]));
  }, [profileId]);

  function toggleNetwork(net: SocialNetwork) {
    setNetworks((prev) => {
      const exists = prev.find((n) => n.network === net);
      if (exists) return prev.filter((n) => n.network !== net);
      return [...prev, { network: net, postType: POST_TYPES[net][0] }];
    });
  }

  function setType(net: SocialNetwork, postType: string) {
    setNetworks((prev) => prev.map((n) => (n.network === net ? { ...n, postType } : n)));
  }

  function toggleMedia(id: string) {
    setMediaIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }

  async function generate() {
    if (!aiTheme.trim()) {
      setErr("Descreva o tema do post para gerar a legenda.");
      return;
    }
    setAiBusy(true);
    setErr(null);
    try {
      const { caption: generated } = await apiSend<{ caption: string }>(
        "/api/ai/caption",
        "POST",
        { profileId, networks, theme: aiTheme },
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
      if (initial) {
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
        <p className="eyebrow">{initial ? "editar" : "novo"}</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">
          {initial ? "Editar post" : "Novo post"}
        </h2>

        {err && (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        )}

        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="eyebrow mb-1.5 block">Perfil</label>
              <select
                className="input"
                value={profileId}
                onChange={(e) => {
                  setProfileId(e.target.value);
                  setMediaIds([]);
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

          {/* Redes (multi) + tipo por rede */}
          <div>
            <label className="eyebrow mb-1.5 block">Redes sociais (pode marcar várias)</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(NETWORK_LABELS) as SocialNetwork[]).map((net) => (
                <ToggleChip
                  key={net}
                  active={networks.some((n) => n.network === net)}
                  color={NETWORK_DOT_COLORS[net]}
                  onClick={() => toggleNetwork(net)}
                >
                  {NETWORK_LABELS[net]}
                </ToggleChip>
              ))}
            </div>
            {networks.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {networks.map((n) => (
                  <div key={n.network} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                    />
                    <span className="w-24 shrink-0 truncate text-xs text-zinc-300">
                      {NETWORK_LABELS[n.network]}
                    </span>
                    <select
                      className="input flex-1 py-1.5 text-xs"
                      value={n.postType}
                      onChange={(e) => setType(n.network, e.target.value)}
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

          {/* Legenda + IA */}
          <div>
            <label className="eyebrow mb-1.5 block">Legenda</label>
            <textarea
              className="input min-h-[110px]"
              placeholder="Escreva a legenda ou gere com IA abaixo…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1 py-2 text-sm"
                placeholder="Tema p/ IA (ex.: foto na praia ao pôr do sol, tom provocante)"
                value={aiTheme}
                onChange={(e) => setAiTheme(e.target.value)}
              />
              <button
                type="button"
                onClick={generate}
                disabled={aiBusy}
                className="btn-ghost shrink-0 px-3 text-sm"
                title="Gerar legenda com IA (configure a chave em Configurações)"
              >
                <IconSparkle size={15} /> {aiBusy ? "Gerando…" : "Gerar com IA"}
              </button>
            </div>
          </div>

          {/* Mídias da biblioteca (por referência — nada é duplicado) */}
          <div>
            <label className="eyebrow mb-1.5 block">
              Mídias da biblioteca{" "}
              <span className="normal-case text-zinc-600">
                (clique para selecionar; o número indica a ordem no carrossel)
              </span>
            </label>
            {library === null ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/5" />
                ))}
              </div>
            ) : library.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-zinc-600">
                Este perfil ainda não tem mídias na biblioteca.
              </p>
            ) : (
              <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                {library.map((m) => {
                  const idx = mediaIds.indexOf(m.id);
                  const selected = idx !== -1;
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
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={saving}>
            Cancelar
          </button>
          <button type="button" onClick={save} className="btn-primary flex-1" disabled={saving}>
            {saving ? "Salvando…" : initial ? "Salvar alterações" : "Agendar post"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
