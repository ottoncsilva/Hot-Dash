"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AuthImage from "@/components/AuthImage";
import SaveMediaButton from "@/components/SaveMediaButton";
import PhotoEditor from "@/components/PhotoEditor";
import { IconArrowLeft, IconChevronRight, IconClose, IconTrash, IconSparkle } from "@/components/icons";
import type { MediaItem, Tag } from "@/lib/types";

/**
 * Visualizador em tela cheia com navegação por deslizar (swipe) ou teclado.
 * Renderizado via portal em document.body para não ficar preso dentro de
 * ancestrais com transform/animação (containing block de position:fixed).
 */
export default function MediaViewer({
  items,
  index,
  onClose,
  onIndexChange,
  onDelete,
  tags,
  onToggleTag,
  profileId,
  onEdited,
}: {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  onDelete: (item: MediaItem) => void;
  tags?: Tag[];
  onToggleTag?: (item: MediaItem, tagId: string) => void;
  profileId?: string;
  onEdited?: (newItem: MediaItem) => void;
}) {
  const item = items[index];
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => setMounted(true), []);

  const goPrev = () => index > 0 && onIndexChange(index - 1);
  const goNext = () => index < items.length - 1 && onIndexChange(index + 1);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  if (!item || !mounted) return null;

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) goPrev();
      else goNext();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95 backdrop-blur-sm">
      {/* Topo */}
      <div className="flex items-center justify-between px-4 py-3 safe-top">
        <button
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Fechar"
        >
          <IconClose size={20} />
        </button>
        <span className="font-mono text-xs text-zinc-500">
          {index + 1} / {items.length}
        </span>
        <div className="flex items-center gap-1">
          {item.kind === "image" && profileId && onEdited && (
            <button
              onClick={() => setEditing(true)}
              className="grid h-9 w-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
              aria-label="Editar foto"
            >
              <IconSparkle size={18} />
            </button>
          )}
          <button
            onClick={() => onDelete(item)}
            className="grid h-9 w-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-red-400"
            aria-label="Excluir"
          >
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      {/* Mídia */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {index > 0 && (
          <button
            onClick={goPrev}
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/5 p-2 text-zinc-300 hover:bg-white/20 hover:text-white sm:grid sm:place-items-center"
            aria-label="Anterior"
          >
            <IconArrowLeft size={22} />
          </button>
        )}
        {item.kind === "image" ? (
          <AuthImage
            key={item.id}
            src={`/api/media/${item.id}/file`}
            alt={item.filename}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={item.id}
            src={`/api/media/${item.id}/file`}
            controls
            playsInline
            autoPlay
            className="max-h-full max-w-full"
          />
        )}
        {index < items.length - 1 && (
          <button
            onClick={goNext}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/5 p-2 text-zinc-300 hover:bg-white/20 hover:text-white sm:grid sm:place-items-center"
            aria-label="Próxima"
          >
            <IconChevronRight size={22} />
          </button>
        )}
      </div>

      {/* Rodapé */}
      <div className="space-y-2 px-4 pb-4 safe-bottom">
        <p className="truncate text-center font-mono text-[11px] text-zinc-600">
          {item.filename}
        </p>
        {tags && tags.length > 0 && onToggleTag && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {tags.map((t) => {
              const active = item.tags.some((it) => it.id === t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => onToggleTag(item, t.id)}
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
          </div>
        )}
        <SaveMediaButton
          url={`/api/media/${item.id}/file?download=1`}
          filename={item.filename}
          mime={item.mime}
          label="Salvar no dispositivo"
          className="btn-primary w-full"
        />
        <p className="text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          no iphone/ipad: toque em salvar → escolha &quot;salvar imagem/vídeo&quot;
        </p>
      </div>

      {editing && profileId && onEdited && (
        <PhotoEditor
          item={item}
          profileId={profileId}
          onClose={() => setEditing(false)}
          onSaved={(newItem) => {
            setEditing(false);
            onEdited(newItem);
            onClose();
          }}
        />
      )}
    </div>,
    document.body,
  );
}
