"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import SaveMediaButton from "@/components/SaveMediaButton";
import CopyLinkButton from "@/components/CopyLinkButton";
import MediaViewer from "@/components/MediaViewer";
import Modal from "@/components/Modal";
import TagDots from "@/components/TagDots";
import ToggleChip from "@/components/ToggleChip";
import { useConfirm } from "@/hooks/useConfirm";
import {
  IconUpload,
  IconTrash,
  IconPlay,
  IconMedia,
  IconDownload,
  IconTag,
} from "@/components/icons";
import { mediaFileUrl, mediaThumbUrl, type MediaItem, type Profile, type Tag } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import PeriodPicker, { type PeriodState } from "@/components/PeriodPicker";
import FilterDropdown from "@/components/FilterDropdown";
import { resolvePeriodLocal } from "@/lib/periods";
import { showToast } from "@/lib/toast";
import { limiteUploadBytes, limiteUploadMb } from "@/lib/uploadLimit";
import Link from "next/link";


type SortKey = "date_desc" | "date_asc" | "size_desc" | "size_asc" | "tag_asc" | "file_date_desc" | "file_date_asc";

/** Estado inicial do filtro de data: tudo, sem recorte de período. */
const NO_PERIOD: PeriodState = { period: "all", from: "", to: "" };

/** Recortes por tipo de mídia. Os rótulos são em português; a chave é o `kind`
 *  do banco ("image"/"video"). */
type MediaKind = MediaItem["kind"];
const KIND_FILTERS: { key: MediaKind; label: string }[] = [
  { key: "image", label: "foto" },
  { key: "video", label: "vídeo" },
];

/** Recortes por histórico de publicação nos grupos do Telegram. */
type PostedFilter = "never" | "previas" | "vip";
const POSTED_FILTERS: { key: PostedFilter; label: string }[] = [
  { key: "never", label: "nunca postada" },
  { key: "previas", label: "postada nas prévias" },
  { key: "vip", label: "postada no vip" },
];

/**
 * Colunas da grade. O quadro é 3:4 (o formato predominante do acervo, junto com
 * o 9:16) e a miniatura aparece INTEIRA dentro dele — sem recorte.
 *
 * As faixas foram escolhidas para o item ficar sempre em torno de 170–220px de
 * largura (~230–290px de altura): é o tamanho em que dá para reconhecer a foto
 * sem abrir. Com 4 colunas fixas no desktop cada foto passava de 380px e
 * cabiam pouquíssimas por tela. No celular continuam 2 por linha (~173px).
 * Em `lg` a barra lateral aparece e come 256px da largura, por isso as colunas
 * só voltam a subir em `xl`.
 */
const MEDIA_GRID_COLS =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 3xl:grid-cols-8";

export default function MediaPage() {
  // Modelo escolhida no menu — vale para o painel inteiro.
  const { profileId, profiles, setProfileId } = useProfile();
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Id da mídia editada que o viewer deve continuar mostrando depois que a
  // lista for atualizada (evita "pular" para outra foto ao salvar).
  const pendingFocusId = useRef<string | null>(null);
  const [uploads, setUploads] = useState<{ name: string; status: string; progress?: number }[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [filterTagIds, setFilterTagIds] = useState<Set<string>>(new Set());
  const [filterNoTag, setFilterNoTag] = useState(false);
  // Filtro por tipo de mídia (vazio = tudo). Substituiu o filtro por proporção,
  // que ninguém usava — o acervo é praticamente todo 3:4 e 9:16.
  const [filterKinds, setFilterKinds] = useState<Set<MediaKind>>(new Set());
  // Filtro por data de INSERÇÃO na galeria (createdAt) — "Máximo" = sem filtro.
  const [filterPeriod, setFilterPeriod] = useState<PeriodState>(NO_PERIOD);
  // Filtro por histórico de publicação nos grupos do Telegram (vazio = tudo).
  const [filterPosted, setFilterPosted] = useState<Set<PostedFilter>>(new Set());
  const [grouping, setGrouping] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("date_desc");
  const fileRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const { confirm, ConfirmDialog } = useConfirm();
  const selecting = selectMode || selected.size > 0;
  const [dragging, setDragging] = useState(false);

  function onDragOverFiles(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    if (profileId) setDragging(true);
  }
  function onDragLeaveFiles(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragging(false);
  }
  function onDropFiles(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(false);
    if (profileId) handleFiles(e.dataTransfer.files);
  }

  // `?profile=` na URL (links de outras telas) semeia a escolha global.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("profile");
    if (param && profiles.some((p) => p.id === param)) setProfileId(param);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  useEffect(() => {
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
    setFilterKinds(new Set());
    setFilterPeriod(NO_PERIOD);
    setFilterPosted(new Set());
    loadMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function handleFiles(files: FileList | null) {
    if (!files || !profileId) return;
    setError(null);
    
    for (const file of Array.from(files)) {
      // Pré-validação de tamanho no frontend
      if (file.size > limiteUploadBytes()) {
        setError(`O arquivo "${file.name}" excede o limite de ${limiteUploadMb()} MB.`);
        continue;
      }
      // Pré-validação de extensão
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const isImg = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tiff", ".tif", ".gif"].includes(ext);
      const isVid = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg"].includes(ext);
      if (!isImg && !isVid) {
        setError(`Formato de arquivo não suportado para "${file.name}".`);
        continue;
      }

      setUploads((u) => [...u, { name: file.name, status: "enviando", progress: 0 }]);
      try {
        const form = new FormData();
        form.append("file", file);
        if (file.lastModified) {
          form.append("fileCreatedAt", file.lastModified.toString());
        }
        const { media: item } = await apiUpload<{ media: MediaItem }>(
          `/api/profiles/${profileId}/media`,
          form,
          (percent) => {
            setUploads((u) =>
              u.map((x) => (x.name === file.name ? { ...x, progress: percent } : x))
            );
          }
        );
        setMedia((m) => [item, ...(m || [])]);
        setUploads((u) => u.filter((x) => x.name !== file.name));
      } catch (err) {
        setUploads((u) =>
          u.map((x) =>
            x.name === file.name
              ? { ...x, status: err instanceof Error ? err.message : "erro" }
              : x
          )
        );
      }
    }
  }

  // Os três callbacks abaixo saem de `useCallback` porque descem para cada
  // quadro da grade: se a identidade deles mudasse a cada render, o `memo` do
  // `MediaTile` não seguraria nada e o acervo inteiro voltaria a re-renderizar.
  const removeOne = useCallback(
    async (item: MediaItem) => {
      if (!(await confirm("Excluir esta mídia? Ela será removida do servidor."))) return;
      try {
        await apiSend(`/api/media/${item.id}`, "DELETE");
        setMedia((m) => (m || []).filter((x) => x.id !== item.id));
        setViewerIndex(null);
        showToast("Mídia excluída.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Falha ao excluir.", "error");
      }
    },
    [confirm],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  function selectAll() {
    setSelected(new Set(sortedMedia.map((m) => m.id)));
  }
  function clearSelection() {
    setSelected(new Set());
    setSelectMode(false);
  }

  async function bulkDelete() {
    if (
      !(await confirm(
        `Excluir ${selected.size} item(ns) selecionado(s)? Serão removidos do servidor.`,
      ))
    )
      return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => apiSend(`/api/media/${id}`, "DELETE")));
      setMedia((m) => (m || []).filter((x) => !selected.has(x.id)));
      showToast(`${ids.length} mídia(s) excluída(s).`);
      clearSelection();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Falha ao excluir.", "error");
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Salva todos os itens selecionados direto no dispositivo. No iPhone/iPad,
   * abre a folha nativa de compartilhamento com todos os arquivos juntos —
   * "Salvar N Imagens" vai direto para o app Fotos (não precisa baixar um
   * .zip e extrair). Se o navegador não suportar compartilhar vários
   * arquivos de uma vez, cai automaticamente para o download em .zip.
   */
  async function bulkSave() {
    setError(null);
    const ids = Array.from(selected);
    const items = (media || []).filter((m) => ids.includes(m.id));
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (!nav.share || !nav.canShare) {
      await bulkDownload();
      return;
    }
    setBulkBusy(true);
    try {
      const files = await Promise.all(
        items.map(async (item) => {
          const res = await fetch(mediaFileUrl(item));
          const blob = await res.blob();
          return new File([blob], item.filename, {
            type: item.mime || blob.type || "application/octet-stream",
          });
        }),
      );
      if (!nav.canShare({ files })) {
        setBulkBusy(false);
        await bulkDownload();
        return;
      }
      await nav.share({ files });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setBulkBusy(false);
        await bulkDownload();
        return;
      }
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

  /** "all" = todos os selecionados têm essa etiqueta, "none" = nenhum, "some" = mistura. */
  function tagStateForSelection(tagId: string): "all" | "some" | "none" {
    const items = (media || []).filter((m) => selected.has(m.id));
    if (items.length === 0) return "none";
    const withTag = items.filter((m) => m.tags.some((t) => t.id === tagId)).length;
    if (withTag === 0) return "none";
    if (withTag === items.length) return "all";
    return "some";
  }

  async function toggleTagForSelection(tagId: string) {
    const state = tagStateForSelection(tagId);
    const action = state === "all" ? "remove" : "add";
    try {
      await apiSend("/api/media/tags", "POST", {
        ids: Array.from(selected),
        tagId,
        action,
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

  function toggleFilterKind(kind: MediaKind) {
    setFilterKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const filteredMedia = useMemo(() => {
    const list = media || [];
    const { since, until } = resolvePeriodLocal(
      filterPeriod.period,
      filterPeriod.from,
      filterPeriod.to,
    );
    return list.filter((m) => {
      const tagOk =
        filterTagIds.size === 0 && !filterNoTag
          ? true
          : (filterNoTag && m.tags.length === 0) ||
            m.tags.some((t) => filterTagIds.has(t.id));
      const kindOk = filterKinds.size === 0 ? true : filterKinds.has(m.kind);
      // Data de inserção: `until` é exclusivo (começo do dia seguinte ao "até").
      const dateOk =
        (since === null || m.createdAt >= since) && (until === null || m.createdAt < until);
      const previas = m.postCounts?.previas || 0;
      const vip = m.postCounts?.vip || 0;
      const postedOk =
        filterPosted.size === 0 ||
        (filterPosted.has("never") && previas === 0 && vip === 0) ||
        (filterPosted.has("previas") && previas > 0) ||
        (filterPosted.has("vip") && vip > 0);
      return tagOk && kindOk && dateOk && postedOk;
    });
  }, [media, filterTagIds, filterNoTag, filterKinds, filterPeriod, filterPosted]);

  const sortedMedia = useMemo(() => {
    const list = [...filteredMedia];
    switch (sortBy) {
      case "date_asc":
        list.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case "file_date_desc":
        list.sort((a, b) => (b.fileCreatedAt || b.createdAt) - (a.fileCreatedAt || a.createdAt));
        break;
      case "file_date_asc":
        list.sort((a, b) => (a.fileCreatedAt || a.createdAt) - (b.fileCreatedAt || b.createdAt));
        break;
      case "size_desc":
        list.sort((a, b) => b.size - a.size);
        break;
      case "size_asc":
        list.sort((a, b) => a.size - b.size);
        break;
      case "tag_asc":
        list.sort((a, b) => {
          const an = a.tags[0]?.name || "￿";
          const bn = b.tags[0]?.name || "￿";
          return an.localeCompare(bn) || b.createdAt - a.createdAt;
        });
        break;
      default:
        list.sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
  }, [filteredMedia, sortBy]);

  // Mesmo motivo dos outros dois: precisa de identidade estável para o `memo`
  // do quadro valer. Só muda quando a própria lista ordenada muda.
  const abrirNoVisualizador = useCallback(
    (item: MediaItem) => {
      setViewerIndex(sortedMedia.findIndex((m) => m.id === item.id));
    },
    [sortedMedia],
  );

  // Depois de editar (sobrescrever ou salvar nova versão), a lista é
  // reordenada por createdAt e a mídia editada pode mudar de posição — segue
  // o índice do viewer até ela em vez de deixar o número da posição fixo
  // (o que fazia o viewer mostrar outra foto).
  useEffect(() => {
    if (pendingFocusId.current === null) return;
    const idx = sortedMedia.findIndex((m) => m.id === pendingFocusId.current);
    if (idx >= 0) {
      setViewerIndex(idx);
      pendingFocusId.current = null;
    }
  }, [sortedMedia]);

  const groups = useMemo(() => {
    if (!grouping) return null;
    const sections: { tag: Tag | null; items: MediaItem[] }[] = [];
    for (const tag of tags) {
      const items = sortedMedia.filter((m) => m.tags.some((t) => t.id === tag.id));
      if (items.length > 0) sections.push({ tag, items });
    }
    const untagged = sortedMedia.filter((m) => m.tags.length === 0);
    if (untagged.length > 0) sections.push({ tag: null, items: untagged });
    return sections;
  }, [grouping, tags, sortedMedia]);

  function onResultsMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    marqueeStartRef.current = start;
    setMarqueeRect({ x: start.x, y: start.y, w: 0, h: 0 });

    function onMove(ev: MouseEvent) {
      const s = marqueeStartRef.current;
      if (!s) return;
      setMarqueeRect({
        x: Math.min(s.x, ev.clientX),
        y: Math.min(s.y, ev.clientY),
        w: Math.abs(ev.clientX - s.x),
        h: Math.abs(ev.clientY - s.y),
      });
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const s = marqueeStartRef.current;
      marqueeStartRef.current = null;
      setMarqueeRect(null);
      if (!s) return;
      const x1 = Math.min(s.x, ev.clientX);
      const x2 = Math.max(s.x, ev.clientX);
      const y1 = Math.min(s.y, ev.clientY);
      const y2 = Math.max(s.y, ev.clientY);
      const moved = x2 - x1 > 4 || y2 - y1 > 4;
      if (moved && resultsRef.current) {
        const nodes = resultsRef.current.querySelectorAll<HTMLElement>("[data-media-id]");
        const ids: string[] = [];
        nodes.forEach((node) => {
          const r = node.getBoundingClientRect();
          if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) {
            ids.push(node.dataset.mediaId as string);
          }
        });
        if (ids.length > 0) {
          setSelected((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.add(id));
            return next;
          });
        }
        // Evita que o "click" fantasma do mouseup abra o visualizador ou
        // desmarque o item que ficou embaixo do cursor.
        window.addEventListener(
          "click",
          (ce) => {
            ce.stopPropagation();
            ce.preventDefault();
          },
          { capture: true, once: true },
        );
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Esc limpa a seleção (quando não há modal/visualizador aberto).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !tagPickerOpen && viewerIndex === null) {
        setSelected((prev) => (prev.size > 0 ? new Set() : prev));
        setSelectMode(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagPickerOpen, viewerIndex]);

  // Colar (Ctrl/Cmd+V) uma imagem envia direto para o modelo selecionado.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!profileId) return;
      const files = e.clipboardData?.files;
      if (files && files.length > 0 && Array.from(files).some((f) => f.type.startsWith("image/"))) {
        handleFiles(files);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // A galeria é sempre de UMA modelo (as mídias pertencem a ela). Com
  // "Todas" no menu não há biblioteca para mostrar.
  if (!profileId) {
    return (
      <div className="page">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Galeria</h1>
        <PrecisaDeModelo oQue="ver e enviar mídias" />
      </div>
    );
  }

  return (
    <div
      className="page pb-20"
      onDragOver={onDragOverFiles}
      onDragLeave={onDragLeaveFiles}
      onDrop={onDropFiles}
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-ink-950/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-white/40 bg-ink-850/60 px-10 py-8 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-lg border border-white/15 text-zinc-200">
              <IconUpload size={22} />
            </div>
            <p className="mt-3 text-sm text-zinc-200">Solte para enviar ao modelo selecionado</p>
          </div>
        </div>
      )}
      {/* Cabeçalho enxuto: só o título e o "Enviar mídia", na mesma linha. O
          eyebrow "biblioteca" e o parágrafo de instruções saíram — no celular
          eles sozinhos comiam meia tela antes da primeira foto aparecer. O
          "Selecionar" desceu para a barra fixa, junto das ações de seleção. */}
      <PageHeader
        title="Galeria"
        actions={
          profiles.length > 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!profileId}
              className="btn-primary"
            >
              <IconUpload size={16} /> Enviar mídia
            </button>
          ) : null
        }
      />
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

      {/* A DATA VEM PRIMEIRO. É o filtro que corta mais mídia de uma vez
          ("o que entrou hoje"), e era o terceiro da fila — depois de duas
          linhas de etiquetas e publicação. Agora abre a peneira. */}
      {media && media.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="eyebrow">inserção</span>
          <PeriodPicker value={filterPeriod} onChange={setFilterPeriod} />
          {filterPeriod.period !== "all" && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              {filteredMedia.length} de {media.length}
            </span>
          )}
        </div>
      )}

      {/* Etiquetas, publicação, agrupamento e ordenação — a linha de
          refino, depois da data.

          PUBLICAÇÃO virou menu suspenso, como as etiquetas. Eram três chips
          longos ("postada nas prévias", "postada no vip") soltos na tela:
          duas linhas inteiras no celular para um filtro que se usa de vez em
          quando. Fechado, o gatilho ocupa uma palavra e ainda diz quantos
          estão ativos.

          Desktop: tudo numa linha, com agrupar/ordenar empurrados para a
          direita. Celular: os gatilhos ficam lado a lado e o par
          agrupar/ordenar cai para a linha de baixo (`w-full sm:w-auto`). */}
      {profiles.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          {tags.length > 0 && (
            <FilterDropdown label="etiquetas" count={filterTagIds.size + (filterNoTag ? 1 : 0)}>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <ToggleChip
                    key={t.id}
                    active={filterTagIds.has(t.id)}
                    color={t.color}
                    onClick={() => toggleFilterTag(t.id)}
                  >
                    {t.name}
                  </ToggleChip>
                ))}
                <ToggleChip active={filterNoTag} onClick={() => setFilterNoTag((v) => !v)}>
                  sem etiqueta
                </ToggleChip>
              </div>
              {(filterTagIds.size > 0 || filterNoTag) && (
                <button
                  onClick={() => {
                    setFilterTagIds(new Set());
                    setFilterNoTag(false);
                  }}
                  className="mt-3 font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-white"
                >
                  limpar etiquetas
                </button>
              )}
            </FilterDropdown>
          )}

          <FilterDropdown label="publicação" count={filterPosted.size}>
            <div className="flex flex-wrap gap-2">
              {POSTED_FILTERS.map((f) => (
                <ToggleChip
                  key={f.key}
                  active={filterPosted.has(f.key)}
                  onClick={() =>
                    setFilterPosted((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.key)) next.delete(f.key);
                      else next.add(f.key);
                      return next;
                    })
                  }
                >
                  {f.label}
                </ToggleChip>
              ))}
            </div>
            {filterPosted.size > 0 && (
              <button
                onClick={() => setFilterPosted(new Set())}
                className="mt-3 font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-white"
              >
                limpar publicação
              </button>
            )}
          </FilterDropdown>

          <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
            {tags.length > 0 && (
              <button
                onClick={() => setGrouping((g) => !g)}
                // Sem moldura, o alvo era só a altura do texto (17px). No dedo
                // ganha os 44px de sempre; no mouse continua sendo só o texto.
                className={`shrink-0 font-mono text-[11px] uppercase tracking-wider [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:items-center ${
                  grouping ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {grouping ? "◉ agrupado" : "○ agrupar"}
                <span className="hidden sm:inline"> por etiqueta</span>
              </button>
            )}
            {media && media.length > 0 && (
              <select
                className="input ml-auto max-w-[180px] py-1.5 text-xs sm:ml-0"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
              >
                <option value="date_desc">Inserção (recente)</option>
                <option value="date_asc">Inserção (antiga)</option>
                <option value="file_date_desc">Arquivo (recente)</option>
                <option value="file_date_asc">Arquivo (antiga)</option>
                <option value="size_desc">Maior tamanho</option>
                <option value="size_asc">Menor tamanho</option>
                {tags.length > 0 && <option value="tag_asc">Etiqueta (A-Z)</option>}
              </select>
            )}
          </div>
        </div>
      )}

      {/* TIPO fica em chips: são dois, curtos, e ligar/desligar "vídeo" é o
          gesto mais repetido da tela — esconder isso atrás de um menu custaria
          um clique a mais toda vez. */}
      {media && media.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="eyebrow">tipo</span>
          {KIND_FILTERS.map((k) => (
            <ToggleChip
              key={k.key}
              active={filterKinds.has(k.key)}
              onClick={() => toggleFilterKind(k.key)}
            >
              {k.label}
            </ToggleChip>
          ))}
          {filterKinds.size > 0 && (
            <button
              onClick={() => setFilterKinds(new Set())}
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
              className="flex items-center gap-3 card rounded-lg px-3 py-2 text-xs"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              <span className="flex-1 truncate text-zinc-300">{u.name}</span>
              <span className="font-mono uppercase tracking-wider text-zinc-500">
                {u.progress !== undefined ? `${u.progress}%` : u.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Barra de seleção — FIXA na rolagem.
          O "Selecionar" morava lá em cima, ao lado do "Enviar mídia", longe das
          ações que ele destrava; no celular era preciso rolar até o topo para
          entrar no modo e rolar de novo até a foto. Agora ele e as ações de
          seleção ocupam a MESMA barra, colada logo acima da grade e grudada no
          topo enquanto se rola.

          O `top` no celular desvia do botão de menu flutuante (fixo em
          `env(safe-area-inset-top) + 0.5rem`, 2,75rem de altura). Os `_` no
          valor viram espaços no Tailwind, e são obrigatórios: `calc()` exige
          espaço em volta do `+`. O Chrome perdoa a falta; o Safari do iPhone
          descarta a regra inteira — e o alvo aqui é justamente o celular.

          No desktop o `top` é NEGATIVO de propósito. `sticky` mede o
          deslocamento a partir da caixa de CONTEÚDO do contêiner de rolagem, e
          o <main> tem `lg:py-10`: com `top-0` a barra grudava 2,5rem abaixo do
          topo visível e as fotos rolavam nessa fresta. `-top-10` desconta
          exatamente esse padding e a barra encosta no topo.

          Não tente tapar essa fresta com um pseudo-elemento acima da barra: ele
          existe também quando a barra NÃO está grudada, e aí pinta por cima dos
          filtros logo acima. Com `env(safe-area-inset-top)` na altura, no
          iPhone isso virava ~115px de preto engolindo Publicação e Tipo.

          As margens negativas + padding fazem o fundo cobrir a largura toda,
          senão as fotos apareceriam pelas beiradas ao passar por baixo. */}
      {profiles.length > 0 && (
        <div className="sticky top-[calc(env(safe-area-inset-top)_+_3.5rem)] z-30 -mx-4 mt-5 bg-ink-950 px-4 py-3 lg:-top-10 lg:-mx-10 lg:px-10">
          {selecting ? (
            <div className="flex flex-wrap items-center gap-3 card px-4 py-3">
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
                  onClick={bulkSave}
                  disabled={bulkBusy}
                  className="btn-ghost px-3 py-1.5 text-xs"
                >
                  <IconDownload size={14} /> Salvar no dispositivo
                </button>
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
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => setSelectMode(true)} className="btn-ghost">
                Selecionar
              </button>
              {media && media.length > 0 && (
                <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                  {filteredMedia.length === media.length
                    ? `${media.length} mídias`
                    : `${filteredMedia.length} de ${media.length}`}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Grade */}
      {profiles.length === 0 ? (
        <EmptyState
          text="Crie um modelo antes de enviar mídias."
          action={
            <Link href="/dashboard/profiles" className="btn-primary">
              Criar modelo
            </Link>
          }
        />
      ) : media === null ? (
        <div className={`mt-6 ${MEDIA_GRID_COLS}`}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <EmptyState
          text="Nenhuma mídia neste modelo ainda."
          action={
            <button onClick={() => fileRef.current?.click()} disabled={!profileId} className="btn-primary">
              <IconUpload size={16} /> Enviar mídia
            </button>
          }
        />
      ) : filteredMedia.length === 0 ? (
        <EmptyState text="Nenhuma mídia com esse filtro." />
      ) : groups ? (
        <div ref={resultsRef} onMouseDown={onResultsMouseDown} className="mt-6 space-y-8">
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
                allItems={sortedMedia}
                selected={selected}
                selecting={selecting}
                onToggleSelect={toggleSelect}
                onOpen={abrirNoVisualizador}
                onRemove={removeOne}
              />
            </div>
          ))}
        </div>
      ) : (
        <div ref={resultsRef} onMouseDown={onResultsMouseDown} className="mt-6">
          <MediaGrid
            items={sortedMedia}
            allItems={sortedMedia}
            selected={selected}
            selecting={selecting}
            onToggleSelect={toggleSelect}
            onOpen={abrirNoVisualizador}
            onRemove={removeOne}
          />
        </div>
      )}

      {/* Retângulo de seleção (Ctrl + arrastar) */}
      {marqueeRect && (
        <div
          className="pointer-events-none fixed z-40 border border-white/70 bg-white/10"
          style={{
            left: marqueeRect.x,
            top: marqueeRect.y,
            width: marqueeRect.w,
            height: marqueeRect.h,
          }}
        />
      )}

      {/* Visualizador em tela cheia */}
      {viewerIndex !== null && (
        <MediaViewer
          items={sortedMedia}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          onDelete={removeOne}
          tags={tags}
          onToggleTag={toggleTagOnItem}
          profileId={profileId}
          onEdited={(newItem) => {
            // Marca para o viewer seguir essa mídia quando a lista reordenar
            // (sem isso, "Salvar nova versão" trocava para a foto vizinha).
            pendingFocusId.current = newItem.id;
            setMedia((m) => {
              const list = m || [];
              // Sobrescrever (mesmo id) substitui no lugar; nova versão entra no topo.
              return list.some((x) => x.id === newItem.id)
                ? list.map((x) => (x.id === newItem.id ? newItem : x))
                : [newItem, ...list];
            });
          }}
        />
      )}

      {/* Popover de etiquetar em massa */}
      <Modal open={tagPickerOpen} onClose={() => setTagPickerOpen(false)}>
        <p className="eyebrow">aplicar</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">
          Etiquetar {selected.size} item(ns)
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Marque para aplicar a todos os selecionados, desmarque para remover.
        </p>
        <div className="mt-4 space-y-1.5">
          {tags.map((t) => {
            const state = tagStateForSelection(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleTagForSelection(t.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-white/5"
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-all ${
                    state === "none"
                      ? "border-white/30 bg-transparent"
                      : "border-white bg-white text-black"
                  }`}
                >
                  {state === "all" && (
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
                  {state === "some" && <span className="h-0.5 w-2.5 rounded-full bg-black" />}
                </span>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                {t.name}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setTagPickerOpen(false)}
          className="btn-primary mt-4 w-full"
        >
          Concluir
        </button>
      </Modal>

      {ConfirmDialog}
    </div>
  );
}

/**
 * Um quadro da grade. Sai `memo` de propósito: sem isso QUALQUER mudança de
 * estado da página (entrar no modo seleção, marcar uma foto, arrastar o
 * retângulo de seleção, que troca de estado a cada movimento do mouse)
 * re-renderizava os N quadros do acervo inteiro — no iPad isso é o que
 * travava a galeria. As props são todas primitivas ou estáveis (`isSelected`
 * é booleano, não o Set; os callbacks vêm de `useCallback`), então marcar uma
 * foto re-renderiza exatamente 1 quadro.
 */
const MediaTile = memo(function MediaTile({
  item,
  isSelected,
  selecting,
  acimaDaDobra,
  onToggleSelect,
  onOpen,
  onRemove,
}: {
  item: MediaItem;
  isSelected: boolean;
  selecting: boolean;
  /** Está na primeira tela: carrega já, sem lazy. */
  acimaDaDobra: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (item: MediaItem) => void;
  onRemove: (item: MediaItem) => void;
}) {
  return (
    <div
      data-media-id={item.id}
      className={`group relative aspect-[3/4] overflow-hidden rounded-xl border bg-ink-850 transition-all ${
        isSelected ? "border-white ring-2 ring-white/70" : "border-white/10"
      }`}
      // Virtualização a custo zero, feita pelo próprio navegador: quadro fora
      // da tela não é medido, nem pintado, nem mantém a imagem decodificada na
      // memória (uma miniatura de 360×480 ocupa ~0,7 MB depois de decodificada,
      // independente de o JPEG ter só 50 KB — é isso que estoura a memória do
      // Safari no iPad com um acervo grande). A altura do quadro pulado não
      // colapsa nem faz a rolagem pular porque o `aspect-[3/4]` já a define a
      // partir da largura da coluna, sem depender do conteúdo — por isso não
      // precisa de `contain-intrinsic-size`. Navegador sem suporte (Safari
      // anterior ao 18) simplesmente ignora e nada muda.
      style={{ contentVisibility: "auto" }}
    >
      <button
        onClick={() => (selecting ? onToggleSelect(item.id) : onOpen(item))}
        className="absolute inset-0 h-full w-full"
      >
        <AuthImage
          src={mediaThumbUrl(item)}
          alt={item.filename}
          loading={acimaDaDobra ? "eager" : "lazy"}
          fetchPriority={acimaDaDobra ? "high" : "auto"}
          className={`h-full w-full object-contain transition-opacity ${
            isSelected ? "opacity-70" : ""
          }`}
          fallback={<div className="h-full w-full bg-ink-800" />}
        />
        {item.kind === "video" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm">
              <IconPlay size={16} />
            </span>
          </div>
        )}
      </button>

      <span className="pointer-events-none absolute left-2 top-2">
        <span className="chip bg-black/50">
          {item.kind === "video" ? "vídeo" : "foto"}
        </span>
      </span>

      {/* Quantas vezes já foi ao ar em cada canal do Telegram. Some no
          modo seleção, onde o canto é do indicador de marcado. */}
      {!selecting && (item.postCounts?.previas || item.postCounts?.vip) ? (
        <span className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
          {item.postCounts.previas > 0 && (
            <span className="chip bg-black/60" title="Vezes publicada no canal de Prévias">
              prévias ×{item.postCounts.previas}
            </span>
          )}
          {item.postCounts.vip > 0 && (
            <span className="chip bg-black/60" title="Vezes publicada no canal VIP">
              vip ×{item.postCounts.vip}
            </span>
          )}
        </span>
      ) : null}

      {item.tags.length > 0 && (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/50 px-1.5 py-1">
          <TagDots tags={item.tags} />
        </span>
      )}

      {/* Indicador de seleção (estilo Fotos da Apple): visível em toda
          mídia assim que o modo seleção está ativo, não só no hover —
          essencial no toque, onde não existe estado de hover. */}
      {selecting && (
        <span
          className={`pointer-events-none absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border transition-all ${
            isSelected ? "border-white bg-white text-black" : "border-white/70 bg-black/40 text-transparent"
          }`}
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
        </span>
      )}

      {!selecting && (
        // No dedo os três alvos tinham 32px e ficavam a menos de 6px um
        // do outro — e um deles apaga a foto. Aqui eles crescem para 44px
        // e o EXCLUIR ganha uma folga extra à esquerda, para o erro custar
        // um movimento, não um pixel.
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-100 pointer-events-auto transition-opacity [@media(pointer:coarse)]:gap-2 md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto">
          <CopyLinkButton
            mediaId={item.id}
            publicToken={item.publicToken}
            iconOnly
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          />
          <SaveMediaButton
            url={mediaFileUrl(item, { download: true })}
            filename={item.filename}
            mime={item.mime}
            iconOnly
            label="Salvar"
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          />
          <button
            onClick={() => onRemove(item)}
            className="ml-1 grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-red-500/40 [@media(pointer:coarse)]:ml-4 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            aria-label="Excluir"
          >
            <IconTrash size={16} />
          </button>
        </div>
      )}
    </div>
  );
});

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
    <div className={MEDIA_GRID_COLS}>
      {items.map((item, index) => (
        <MediaTile
          key={item.id}
          item={item}
          isSelected={selected.has(item.id)}
          selecting={selecting}
          // A primeira tela cabe em ~12 quadros (2 colunas no celular, até 8
          // no desktop largo). Essas o navegador busca com prioridade e sem
          // lazy — `loading="lazy"` atrasa justamente o que já está visível.
          // Da 13ª em diante volta o lazy, que é o que segura o acervo inteiro.
          acimaDaDobra={index < 12}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}


function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/10 p-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 text-zinc-400">
        <IconMedia size={22} />
      </div>
      <p className="text-sm text-zinc-500">{text}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
