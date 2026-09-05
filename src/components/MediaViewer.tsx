"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SaveMediaButton from "@/components/SaveMediaButton";
import CopyLinkButton from "@/components/CopyLinkButton";
import PhotoEditor from "@/components/PhotoEditor";
import VideoEditor from "@/components/VideoEditor";
import ToggleChip from "@/components/ToggleChip";
import MediaStage from "@/components/MediaStage";
import { IconArrowLeft, IconChevronRight, IconClose, IconTrash, IconSparkle } from "@/components/icons";
import {
  marcadaAMaoEm,
  vezesPostadaEm,
  type DestinoPublicacao,
} from "@/lib/destinosPublicacao";
import { exactRatioLabel, mediaFileUrl, mediaThumbUrl, ratioBucket, type MediaItem, type Tag } from "@/lib/types";

/**
 * Visualizador em janela popup (não tela cheia): centralizado, com fundo
 * escurecido ao redor. Clicar fora da janela fecha. Navega por deslizar
 * (swipe) ou teclado. Renderizado via portal em document.body para não
 * ficar preso dentro de ancestrais com transform/animação.
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
  destinos,
  onTogglePostada,
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
  /** Onde esta modelo publica — habilita o "já postei isto" do rodapé. */
  destinos?: DestinoPublicacao[];
  onTogglePostada?: (item: MediaItem, destino: DestinoPublicacao, marcar: boolean) => void;
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
    <>
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm safe-top safe-bottom"
      onClick={onClose}
    >
      <div
        /*
         * EDITANDO, a janela cresce no desktop. Ela nasceu com a largura de
         * leitura (max-w-2xl), que é a certa para VER uma foto no meio da tela
         * — mas editar é outro trabalho: com os controles na coluna da
         * esquerda, tudo o que sobra de largura vira tamanho de imagem. Sem
         * isto, a reorganização em duas colunas deixaria a foto MENOR.
         */
        className={`card flex w-full flex-col overflow-hidden bg-ink-850 ${
          editing
            ? "h-[88dvh] max-w-2xl lg:max-w-[1600px]"
            : "max-w-2xl max-h-[88dvh]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {editing && profileId && onEdited && item.kind === "image" ? (
          <PhotoEditor
            item={item}
            profileId={profileId}
            onClose={() => setEditing(false)}
            onSaved={(newItem) => {
              setEditing(false);
              onEdited(newItem);
              // não fecha o viewer, apenas volta para o preview da nova imagem
            }}
          />
        ) : editing && profileId && onEdited && item.kind === "video" ? (
          <VideoEditor
            item={item}
            profileId={profileId}
            onClose={() => setEditing(false)}
            onSaved={(newItem) => {
              setEditing(false);
              onEdited(newItem);
            }}
          />
        ) : (
          <>
        {/* Topo */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
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
            {profileId && onEdited && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
                aria-label={item.kind === "image" ? "Editar foto" : "Editar vídeo"}
              >
                <IconSparkle size={16} />
                Editar
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
        {/* Área da mídia: `min-h-[45dvh]` garante uma fatia decente da tela
            mesmo quando a lista de etiquetas do rodapé é longa — sem isso a
            mídia (posicionada de forma absoluta) ficaria espremida a nada. */}
        <div className="relative flex min-h-[45dvh] flex-1 items-center justify-center overflow-hidden bg-black">
          {index > 0 && (
            <button
              onClick={goPrev}
              className="absolute left-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/5 p-2 text-zinc-300 hover:bg-white/20 hover:text-white sm:grid sm:place-items-center"
              aria-label="Anterior"
            >
              <IconArrowLeft size={22} />
            </button>
          )}
          {item.kind === "image" ? (
            <MediaStage
              item={item}
              hasPrev={index > 0}
              hasNext={index < items.length - 1}
              onPrev={goPrev}
              onNext={goNext}
            />
          ) : (
            // Vídeo: mantém touch simples (sem zoom/pan) para não atrapalhar
            // os controles nativos (play, barra de progresso).
            <div
              className="absolute inset-0 flex items-center justify-center"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                key={item.id}
                src={mediaFileUrl(item)}
                poster={mediaThumbUrl(item)}
                controls
                playsInline
                autoPlay
                className="h-full w-full object-contain"
              />
            </div>
          )}
          {index < items.length - 1 && (
            <button
              onClick={goNext}
              className="absolute right-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/5 p-2 text-zinc-300 hover:bg-white/20 hover:text-white sm:grid sm:place-items-center"
              aria-label="Próxima"
            >
              <IconChevronRight size={22} />
            </button>
          )}
        </div>

        {/* Rodapé */}
        {/* Rodapé rolável: com muitas etiquetas ele cresceria sem limite e
            comeria a área da mídia. Agora ele rola dentro do próprio espaço. */}
        <div className="min-h-0 space-y-2 overflow-y-auto border-t border-white/[0.06] px-4 py-3">
          <p className="truncate text-center font-mono text-[11px] text-zinc-600">
            {item.filename}
          </p>
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            {item.width && item.height && (
              <>
                <span>
                  {item.width}×{item.height}
                </span>
                <span className="text-zinc-700">·</span>
                <span>
                  {(() => {
                    const bucket = ratioBucket(item.width, item.height);
                    return bucket !== "outra" ? bucket : exactRatioLabel(item.width, item.height);
                  })()}
                </span>
                <span className="text-zinc-700">·</span>
              </>
            )}
            <span>
              {new Date(item.createdAt).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </span>
          </p>
          {/* Histórico de publicação nos grupos do Telegram, com a data da
              última vez que a mídia foi ao ar em cada um. */}
          {(item.postCounts?.previas || item.postCounts?.vip) ? (
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {item.postCounts.previas > 0 && (
                <span>
                  prévias ×{item.postCounts.previas}
                  {item.postCounts.lastPreviasAt
                    ? ` · ${new Date(item.postCounts.lastPreviasAt).toLocaleDateString("pt-BR")}`
                    : ""}
                </span>
              )}
              {item.postCounts.previas > 0 && item.postCounts.vip > 0 && (
                <span className="text-zinc-700">·</span>
              )}
              {item.postCounts.vip > 0 && (
                <span>
                  vip ×{item.postCounts.vip}
                  {item.postCounts.lastVipAt
                    ? ` · ${new Date(item.postCounts.lastVipAt).toLocaleDateString("pt-BR")}`
                    : ""}
                </span>
              )}
            </p>
          ) : null}
          {/* JÁ POSTEI ISTO. Fica junto das etiquetas porque é o mesmo gesto —
              olhar a foto e classificá-la —, e é aqui, com a foto grande na
              frente, que dá para lembrar se ela já saiu.

              O chip aceso mostra a contagem: uma foto que saiu três vezes no
              @conta é diferente de uma que saiu uma. Apagar só é possível no
              que foi marcado à mão (`marcadaAMaoEm`); registro de envio de
              verdade não some por um toque na galeria. */}
          {destinos && destinos.length > 0 && onTogglePostada && (
            <div>
              <p className="text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                já postei em
              </p>
              <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                {destinos.map((d) => {
                  const vezes = vezesPostadaEm(item, d);
                  const daPraDesmarcar = marcadaAMaoEm(item, d);
                  const aceso = vezes > 0;
                  return (
                    <ToggleChip
                      key={d.key}
                      active={aceso}
                      onClick={() => onTogglePostada(item, d, !aceso)}
                      title={
                        aceso && !daPraDesmarcar
                          ? "Publicação registrada pelo sistema — não dá para desmarcar aqui."
                          : aceso
                            ? "Marcada por você. Toque para desmarcar."
                            : "Marcar como já postada aqui."
                      }
                    >
                      {d.label}
                      {vezes > 1 ? ` ×${vezes}` : ""}
                    </ToggleChip>
                  );
                })}
              </div>
            </div>
          )}
          {tags && tags.length > 0 && onToggleTag && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {tags.map((t) => {
                const active = item.tags.some((it) => it.id === t.id);
                return (
                  <ToggleChip
                    key={t.id}
                    active={active}
                    color={t.color}
                    onClick={() => onToggleTag(item, t.id)}
                  >
                    {t.name}
                  </ToggleChip>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <SaveMediaButton
              url={mediaFileUrl(item, { download: true })}
              filename={item.filename}
              mime={item.mime}
              label="Salvar no dispositivo"
              className="btn-primary flex-1"
            />
            <CopyLinkButton
              mediaId={item.id}
              publicToken={item.publicToken}
              className="btn-ghost px-4"
            />
          </div>
          <p className="text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            no iphone/ipad: toque em salvar → escolha &quot;salvar imagem/vídeo&quot;
          </p>
        </div>
          </>
        )}
      </div>

    </div>
    </>,
    document.body,
  );
}
