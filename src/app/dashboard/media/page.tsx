"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import SaveMediaButton from "@/components/SaveMediaButton";
import MediaViewer from "@/components/MediaViewer";
import Modal from "@/components/Modal";
import TagDots from "@/components/TagDots";
import {
  IconUpload,
  IconTrash,
  IconPlay,
  IconMedia,
  IconDownload,
  IconTag,
} from "@/components/icons";
import type { MediaItem, Profile, Tag } from "@/lib/types";

export default function MediaPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<{ name: string; status: string }[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [filterTagIds, setFilterTagIds] = useState<Set<string>>(new Set());
  const [filterNoTag, setFilterNoTag] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selecting = selected.size > 0;

  // Carrega perfis e pré-seleciona pelo ?profile= da URL.
  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => {
        setProfiles(d.profiles);
        const param = new URLSearchParams(window.location.search).get("profile");
        const initial =
          param && d.profiles.some((p) => p.id === param)
            ? param
            : d.profiles[0]?.id || "";
        setProfileId(initial);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Falha."));
    apiGet<{ tags: Tag[] }>("/api/tags")
      .then((d) => setTags(d.tags))
      .catch(() => {});
  }, []);

  function loadMedia() {
    if (!profileId) {
      setMedia([]);
      return;
    }
    apiGet<{ media: MediaItem[] }>(`/api/profiles/${profileId}/media`)
      .then((d) => setMedia(d.media))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Falha.");
        setMedia([]);
      });
  }

  useEffect(() => {
    setMedia(null);
    setSelected(new Set());
    setFilterTagIds(new Set());
    setFilterNoTag(false);
    loadMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function handleFiles(files: FileList | null) {
    if (!files || !profileId) return;
    for (const file of Array.from(files)) {
      setUploads((u) => [...u, { name: file.name, status: "enviando" }]);
      try {
        const form = new FormData();
        form.append("file", file);
        const { media: item } = await apiUpload<{ media: MediaItem }>(
          `/api/profiles/${profileId}/media`,
          form,
        );
        setMedia((m) => [item, ...(m || [])]);
        setUploads((u) => u.filter((x) => x.name !== file.name));
      } catch (err) {
        setUploads((u) =>
          u.map((x) =>
            x.name === file.name
              ? { ...x, status: err instanceof Error ? err.message : "erro" }
              : x,
          ),
        );
      }
    }
  }

  async function removeOne(item: MediaItem) {
    if (!confirm("Excluir esta mídia?")) return;
    await apiSend(`/api/media/${item.id}`, "DELETE");
    setMedia((m) => (m || []).filter((x) => x.id !== item.id));
    setViewerIndex(null);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(filteredMedia.map((m) => m.id)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function bulkDelete() {
    if (!confirm(`Excluir ${selected.size} item(ns) selecionado(s)?`)) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => apiSend(`/api/media/${id}`, "DELETE")));
      setMedia((m) => (m || []).filter((x) => !selected.has(x.id)));
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDownload() {
    setBulkBusy(true);
    setError(null);
    try {
      const ids = Array.from(selected);
      const res = await fetch("/api/media/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hotdash-midia-${ids.length}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao baixar.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyTagToSelected(tagId: string) {
    try {
      await apiSend("/api/media/tags", "POST", {
        ids: Array.from(selected),
        tagId,
        action: "add",
      });
      loadMedia();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao aplicar etiqueta.");
    }
  }

  async function toggleTagOnItem(item: MediaItem, tagId: string) {
    const hasTag = item.tags.some((t) => t.id === tagId);
    await apiSend("/api/media/tags", "POST", {
      ids: [item.id],
      tagId,
      action: hasTag ? "remove" : "add",
    });
    loadMedia();
  }

  function toggleFilterTag(tagId: string) {
    setFilterTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const filteredMedia = useMemo(() => {
    const list = media || [];
    if (filterTagIds.size === 0 && !filterNoTag) return list;
    return list.filter((m) => {
      if (filterNoTag && m.tags.length === 0) return true;
      return m.tags.some((t) => filterTagIds.has(t.id));
    });
  }, [media, filterTagIds, filterNoTag]);

  const groups = useMemo(() => {
    if (!grouping) return null;
    const sections: { tag: Tag | null; items: MediaItem[] }[] = [];
    for (const tag of tags) {
      const items = filteredMedia.filter((m) => m.tags.some((t) => t.id === tag.id));
      if (items.length > 0) sections.push({ tag, items });
    }
    const untagged = filteredMedia.filter((m) => m.tags.length === 0);
    if (untagged.length > 0) sections.push({ tag: null, items: untagged });
    return sections;
  }, [grouping, tags, filteredMedia]);

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">biblioteca</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Mídia
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Suba fotos e vídeos aqui: todos os metadados são removidos
            automaticamente e o arquivo é salvo já vinculado ao perfil.
          </p>
        </div>
        {profiles.length > 0 && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!profileId}
            className="btn-primary"
          >
            <IconUpload size={16} /> Enviar mídia
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Seletor de perfil */}
      {profiles.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <label className="eyebrow">perfil</label>
          <select
            className="input max-w-xs"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {tags.length > 0 && (
            <button
              onClick={() => setGrouping((g) => !g)}
              className={`ml-auto font-mono text-[11px] uppercase tracking-wider ${
                grouping ? "text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {grouping ? "◉ agrupado por etiqueta" : "○ agrupar por etiqueta"}
            </button>
          )}
        </div>
      )}

      {/* Filtro por etiqueta */}
      {tags.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="eyebrow">filtrar</span>
          {tags.map((t) => {
            const active = filterTagIds.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleFilterTag(t.id)}
                className={`chip transition-all ${
                  active ? "border-white/40 bg-white/10 text-white" : ""
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                {t.name}
              </button>
            );
          })}
          <button
            onClick={() => setFilterNoTag((v) => !v)}
            className={`chip transition-all ${
              filterNoTag ? "border-white/40 bg-white/10 text-white" : ""
            }`}
          >
            sem etiqueta
          </button>
          {(filterTagIds.size > 0 || filterNoTag) && (
            <button
              onClick={() => {
                setFilterTagIds(new Set());
                setFilterNoTag(false);
              }}
              className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-white"
            >
              limpar
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Uploads em andamento */}
      {uploads.length > 0 && (
        <div className="mt-4 space-y-2">
          {uploads.map((u, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              <span className="flex-1 truncate text-zinc-300">{u.name}</span>
              <span className="font-mono uppercase tracking-wider text-zinc-500">
                {u.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Barra de seleção */}
      {selecting && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3">
          <span className="font-mono text-xs text-zinc-300">
            {selected.size} selecionada{selected.size > 1 ? "s" : ""}
          </span>
          <button
            onClick={selectAll}
            className="font-mono text-xs uppercase tracking-wider text-zinc-500 hover:text-white"
          >
            selecionar tudo
          </button>
          <button
            onClick={clearSelection}
            className="font-mono text-xs uppercase tracking-wider text-zinc-500 hover:text-white"
          >
            cancelar
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            {tags.length > 0 && (
              <button
                onClick={() => setTagPickerOpen(true)}
                disabled={bulkBusy}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                <IconTag size={14} /> Etiquetar
              </button>
            )}
            <button
              onClick={bulkDownload}
              disabled={bulkBusy}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              <IconDownload size={14} /> Baixar (.zip)
            </button>
            <button
              onClick={bulkDelete}
              disabled={bulkBusy}
              className="btn-danger px-3 py-1.5 text-xs"
            >
              <IconTrash size={14} /> Excluir
            </button>
          </div>
        </div>
      )}

      {/* Grade */}
      {profiles.length === 0 ? (
        <EmptyState text="Crie um perfil antes de enviar mídias." />
      ) : media === null ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <EmptyState text="Nenhuma mídia neste perfil ainda." />
      ) : filteredMedia.length === 0 ? (
        <EmptyState text="Nenhuma mídia com esse filtro." />
      ) : groups ? (
        <div className="mt-6 space-y-8">
          {groups.map((section) => (
            <div key={section.tag?.id || "sem-etiqueta"}>
              <div className="mb-3 flex items-center gap-2">
                {section.tag ? (
                  <>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: section.tag.color }}
                    />
                    <h3 className="font-medium text-zinc-200">{section.tag.name}</h3>
                  </>
                ) : (
                  <h3 className="font-medium text-zinc-500">Sem etiqueta</h3>
                )}
                <span className="font-mono text-xs text-zinc-600">
                  ({section.items.length})
                </span>
              </div>
              <MediaGrid
                items={section.items}
                allItems={filteredMedia}
                selected={selected}
                selecting={selecting}
                onToggleSelect={toggleSelect}
                onOpen={(item) =>
                  setViewerIndex(filteredMedia.findIndex((m) => m.id === item.id))
                }
                onRemove={removeOne}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <MediaGrid
            items={filteredMedia}
            allItems={filteredMedia}
            selected={selected}
            selecting={selecting}
            onToggleSelect={toggleSelect}
            onOpen={(item) =>
              setViewerIndex(filteredMedia.findIndex((m) => m.id === item.id))
            }
            onRemove={removeOne}
          />
        </div>
      )}

      {/* Visualizador em tela cheia */}
      {viewerIndex !== null && (
        <MediaViewer
          items={filteredMedia}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          onDelete={removeOne}
          tags={tags}
          onToggleTag={toggleTagOnItem}
          profileId={profileId}
          onEdited={(newItem) => setMedia((m) => [newItem, ...(m || [])])}
        />
      )}

      {/* Popover de etiquetar em massa */}
      <Modal open={tagPickerOpen} onClose={() => setTagPickerOpen(false)}>
        <p className="eyebrow">aplicar</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">
          Etiquetar {selected.size} item(ns)
        </h2>
        <div className="mt-4 space-y-1.5">
          {tags.map((t) => (
            <button
              key={t.id}
              onClick={() => applyTagToSelected(t.id)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-white/5"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              {t.name}
            </button>
          ))}
        </div>
        <button
          onClick={() => setTagPickerOpen(false)}
          className="btn-primary mt-4 w-full"
        >
          Concluir
        </button>
      </Modal>
    </div>
  );
}

function MediaGrid({
  items,
  selected,
  selecting,
  onToggleSelect,
  onOpen,
  onRemove,
}: {
  items: MediaItem[];
  allItems: MediaItem[];
  selected: Set<string>;
  selecting: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (item: MediaItem) => void;
  onRemove: (item: MediaItem) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => {
        const isSelected = selected.has(item.id);
        return (
          <div
            key={item.id}
            className={`group relative aspect-square overflow-hidden rounded-xl border bg-ink-850 transition-all ${
              isSelected ? "border-white ring-2 ring-white/70" : "border-white/10"
            }`}
          >
            <button
              onClick={() => (selecting ? onToggleSelect(item.id) : onOpen(item))}
              className="absolute inset-0 h-full w-full"
            >
              {item.kind === "image" ? (
                <AuthImage
                  src={`/api/media/${item.id}/file`}
                  alt={item.filename}
                  className={`h-full w-full object-cover transition-opacity ${
                    isSelected ? "opacity-70" : ""
                  }`}
                  fallback={<div className="h-full w-full bg-ink-800" />}
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-zinc-600">
                  <IconPlay size={30} />
                </div>
              )}
            </button>

            <span className="pointer-events-none absolute left-2 top-2">
              <span className="chip bg-black/50">
                {item.kind === "video" ? "vídeo" : "foto"}
              </span>
            </span>

            {item.tags.length > 0 && (
              <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/50 px-1.5 py-1">
                <TagDots tags={item.tags} />
              </span>
            )}

            {/* Checkbox de seleção */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(item.id);
              }}
              className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border transition-all ${
                isSelected
                  ? "border-white bg-white text-black"
                  : "border-white/50 bg-black/30 text-transparent opacity-0 group-hover:opacity-100"
              }`}
              aria-label="Selecionar"
            >
              {isSelected && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4 10-10"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>

            {!selecting && (
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                <SaveMediaButton
                  url={`/api/media/${item.id}/file?download=1`}
                  filename={item.filename}
                  mime={item.mime}
                  iconOnly
                  label="Salvar"
                  className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20"
                />
                <button
                  onClick={() => onRemove(item)}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-red-500/40"
                  aria-label="Excluir"
                >
                  <IconTrash size={16} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/10 p-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 text-zinc-400">
        <IconMedia size={22} />
      </div>
      <p className="text-sm text-zinc-500">{text}</p>
    </div>
  );
}
