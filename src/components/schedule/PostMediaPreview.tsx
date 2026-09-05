"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import AuthImage from "@/components/AuthImage";
import { IconArrowLeft, IconChevronRight, IconClose } from "@/components/icons";

/**
 * PREVIEW da mídia de um post do Cronograma.
 *
 * A janela do post mostra as mídias como quadradinhos recortados (`aspect-square
 * object-cover`) — bom para saber QUANTAS são e reconhecer de relance, inútil
 * para conferir. Um vídeo então não mostrava nada além do primeiro quadro.
 * Aqui a mídia aparece inteira, e vídeo toca.
 *
 * Componente próprio e não o `MediaViewer` da Galeria: aquele trabalha com
 * `MediaItem` (etiquetas, tamanho, histórico de publicação, editor) e o post
 * carrega uma versão enxuta da mídia — id, tipo e nome. Passar por ali exigiria
 * buscar a galeria inteira só para ver uma foto que já está na tela.
 */
export default function PostMediaPreview({
  media,
  index,
  onIndexChange,
  onClose,
}: {
  media: { id: string; kind: "image" | "video"; filename: string; updatedAt?: number }[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const item = media[index];
  const temAnterior = index > 0;
  const temProxima = index < media.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < media.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, media.length, onClose, onIndexChange]);

  if (!item || !mounted) return null;

  return createPortal(
    // z-[95]: acima da janela do post (z-90), que continua aberta por baixo —
    // fechar o preview devolve a pessoa exatamente onde ela estava.
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-lg text-zinc-300 hover:bg-white/10 hover:text-white"
        aria-label="Fechar"
      >
        <IconClose size={22} />
      </button>

      {temAnterior && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index - 1);
          }}
          className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-zinc-200 hover:bg-white/20 hover:text-white"
          aria-label="Anterior"
        >
          <IconArrowLeft size={20} />
        </button>
      )}

      <div
        className="flex max-h-full max-w-4xl flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {item.kind === "image" ? (
          <AuthImage
            src={`/api/media/${item.id}/file?v=${item.updatedAt || 0}`}
            alt={item.filename}
            className="max-h-[82dvh] w-auto max-w-full rounded-lg object-contain"
            fallback={<div className="h-64 w-48 rounded-lg bg-white/5" />}
          />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={item.id}
            src={`/api/media/${item.id}/file?v=${item.updatedAt || 0}`}
            poster={`/api/media/${item.id}/thumbnail?v=${item.updatedAt || 0}`}
            controls
            autoPlay
            playsInline
            className="max-h-[82dvh] w-auto max-w-full rounded-lg"
          />
        )}
        <p className="font-mono text-[11px] text-zinc-500">
          {media.length > 1 ? `${index + 1} / ${media.length} · ` : ""}
          {item.filename}
        </p>
      </div>

      {temProxima && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index + 1);
          }}
          className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-zinc-200 hover:bg-white/20 hover:text-white"
          aria-label="Próxima"
        >
          <IconChevronRight size={20} />
        </button>
      )}
    </div>,
    document.body,
  );
}
