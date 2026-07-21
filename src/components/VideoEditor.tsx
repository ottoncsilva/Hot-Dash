"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiUpload } from "@/lib/api";
import Modal from "@/components/Modal";
import ToolButton from "@/components/ToolButton";
import { COMPACT_EMOJIS } from "@/lib/censorEmojis";
import {
  IconClose,
  IconType,
  IconEmoji,
  IconBlur,
  IconQuestion,
  IconUndo,
  IconTrash,
  IconPlay,
  IconScissors,
} from "@/components/icons";
import { mediaFileUrl, type MediaItem } from "@/lib/types";
import {
  type TextObject,
  type EmojiObject,
  type BlurObject,
  type QuestionObject,
  type EditorObject,
  TEXT_COLORS,
  drawBlurObjects,
  drawOverlayObjects,
  hitTestObjects,
  hitResizeHandle,
} from "@/lib/editorObjects";

function formatTime(s: number): string {
  const clamped = Number.isFinite(s) && s > 0 ? s : 0;
  const m = Math.floor(clamped / 60);
  const sec = Math.floor(clamped % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function VideoEditor({
  item,
  profileId,
  onClose,
  onSaved,
}: {
  item: MediaItem;
  profileId: string;
  onClose: () => void;
  onSaved: (newItem: MediaItem) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [objects, setObjects] = useState<EditorObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "blur">("select");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<"new" | "overwrite" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const dragRef = useRef<{
    id: string;
    kind: "move" | "resize";
    startX: number;
    startY: number;
    orig: EditorObject;
  } | null>(null);
  const drawingBlurId = useRef<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const trimDragRef = useRef<"start" | "end" | null>(null);

  const selected = objects.find((o) => o.id === selectedId) || null;

  // Carrega o vídeo original (autenticado) no elemento <video>.
  useEffect(() => {
    let url: string | null = null;
    (async () => {
      try {
        const res = await fetch(mediaFileUrl(item));
        if (!res.ok) throw new Error("Falha ao carregar vídeo.");
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        const video = videoRef.current;
        if (!video) return;
        video.src = url;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao carregar vídeo.");
      }
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id]);

  function drawReferenceFrame() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !canvas.width || !canvas.height) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawBlurObjects(ctx, objects, selectedId, false);
    drawOverlayObjects(ctx, objects, selectedId, false);
  }

  function onLoadedMetadata() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const dur = video.duration || 0;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    setDuration(dur);
    setTrimStart(0);
    setTrimEnd(dur);
    video.currentTime = 0;
  }

  function onSeeked() {
    drawReferenceFrame();
    setLoaded(true);
  }

  // Redesenha o quadro de referência quando os objetos mudam.
  useEffect(() => {
    if (!loaded || previewPlaying) return;
    drawReferenceFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, selectedId, loaded]);

  function toCanvasCoords(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY, scaleX };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y, scaleX } = toCanvasCoords(e.clientX, e.clientY);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    if (mode === "blur") {
      const id = crypto.randomUUID();
      const obj: BlurObject = { id, type: "blur", x, y, w: 1, h: 1 };
      setObjects((prev) => [...prev, obj]);
      setSelectedId(id);
      drawingBlurId.current = id;
      dragRef.current = { id, kind: "resize", startX: x, startY: y, orig: obj };
      return;
    }

    const hit = hitTestObjects(ctx, objects, x, y);
    if (hit) {
      setSelectedId(hit.id);
      const kind = hitResizeHandle(ctx, hit, x, y, scaleX) ? "resize" : "move";
      dragRef.current = { id: hit.id, kind, startX: x, startY: y, orig: { ...hit } };
    } else {
      setSelectedId(null);
    }
  }

  function onPointerMoveCanvas(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    const dx = x - drag.startX;
    const dy = y - drag.startY;

    if (mode === "blur" && drawingBlurId.current === drag.id) {
      const startX = drag.orig.type === "blur" ? drag.orig.x : 0;
      const startY = drag.orig.type === "blur" ? drag.orig.y : 0;
      setObjects((prev) =>
        prev.map((o) =>
          o.id === drag.id && o.type === "blur"
            ? {
                ...o,
                x: Math.min(startX, x),
                y: Math.min(startY, y),
                w: Math.abs(x - startX),
                h: Math.abs(y - startY),
              }
            : o,
        ),
      );
      return;
    }

    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== drag.id) return o;
        if (drag.kind === "move") {
          const orig = drag.orig as { x: number; y: number };
          return { ...o, x: orig.x + dx, y: orig.y + dy };
        }
        // resize
        if (o.type === "blur") {
          const orig = drag.orig as BlurObject;
          return { ...o, w: Math.max(12, orig.w + dx), h: Math.max(12, orig.h + dy) };
        }
        if (o.type === "question") {
          const orig = drag.orig as QuestionObject;
          return { ...o, w: Math.max(100, orig.w + dx) };
        }
        const orig = drag.orig as TextObject | EmojiObject;
        const delta = (dx + dy) / 2;
        const next = Math.max(12, Math.min(400, orig.size + delta));
        return { ...o, size: next };
      }),
    );
  }

  function onPointerUpCanvas() {
    if (drawingBlurId.current) {
      const id = drawingBlurId.current;
      setObjects((prev) =>
        prev.filter((o) => !(o.id === id && o.type === "blur" && (o.w < 10 || o.h < 10))),
      );
      drawingBlurId.current = null;
    }
    dragRef.current = null;
  }

  function addText() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = Math.round(canvas.width * 0.06);
    const id = crypto.randomUUID();
    const obj: TextObject = {
      id,
      type: "text",
      x: canvas.width * 0.15,
      y: canvas.height * 0.45,
      size,
      text: "Texto",
      color: "#ffffff",
      bg: false,
    };
    setObjects((prev) => [...prev, obj]);
    setSelectedId(id);
    setMode("select");
  }

  function addEmoji(emoji: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = Math.round(Math.min(canvas.width, canvas.height) * 0.16);
    const id = crypto.randomUUID();
    const obj: EmojiObject = {
      id,
      type: "emoji",
      x: canvas.width / 2 - size / 2,
      y: canvas.height / 2 - size / 2,
      size,
      emoji,
    };
    setObjects((prev) => [...prev, obj]);
    setSelectedId(id);
    setEmojiPickerOpen(false);
    setMode("select");
  }

  function addQuestionBox() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const id = crypto.randomUUID();
    const obj: QuestionObject = {
      id,
      type: "question",
      x: canvas.width * 0.1,
      y: canvas.height * 0.4,
      w: canvas.width * 0.8,
      question: "",
    };
    setObjects((prev) => [...prev, obj]);
    setSelectedId(id);
    setMode("select");
  }

  function updateSelected(patch: Partial<TextObject>) {
    if (!selected || selected.type !== "text") return;
    setObjects((prev) =>
      prev.map((o) => (o.id === selected.id && o.type === "text" ? { ...o, ...patch } : o)),
    );
  }

  function updateQuestion(patch: Partial<QuestionObject>) {
    if (!selected || selected.type !== "question") return;
    setObjects((prev) =>
      prev.map((o) => (o.id === selected.id && o.type === "question" ? { ...o, ...patch } : o)),
    );
  }

  function removeSelected() {
    if (!selected) return;
    setObjects((prev) => prev.filter((o) => o.id !== selected.id));
    setSelectedId(null);
  }

  function undo() {
    setObjects((prev) => prev.slice(0, -1));
    setSelectedId(null);
  }

  // --- Corte (trim) ---

  function timeFromClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track || duration <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function onTrimPointerDown(handle: "start" | "end", e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    trimDragRef.current = handle;
  }

  function onTrimPointerMove(e: React.PointerEvent) {
    const handle = trimDragRef.current;
    if (!handle || duration <= 0) return;
    const t = timeFromClientX(e.clientX);
    const MIN_GAP = 0.3;
    if (handle === "start") {
      const next = Math.max(0, Math.min(t, trimEnd - MIN_GAP));
      setTrimStart(next);
      const video = videoRef.current;
      if (video) video.currentTime = next;
    } else {
      const next = Math.min(duration, Math.max(t, trimStart + MIN_GAP));
      setTrimEnd(next);
    }
  }

  function onTrimPointerUp() {
    trimDragRef.current = null;
  }

  function togglePreview() {
    const video = videoRef.current;
    if (!video || duration <= 0) return;
    if (previewPlaying) {
      video.pause();
      return;
    }
    video.currentTime = trimStart;
    video.muted = false;
    setPreviewPlaying(true);
    video.play().catch(() => setPreviewPlaying(false));
  }

  function onVideoTimeUpdate() {
    const video = videoRef.current;
    if (!video || !previewPlaying) return;
    if (video.currentTime >= trimEnd) video.pause();
  }

  function onVideoPause() {
    setPreviewPlaying(false);
    const video = videoRef.current;
    if (video) {
      video.muted = true;
      video.currentTime = trimStart;
    }
  }

  // --- Exportar/salvar ---

  async function exportOverlayPng(w: number, h: number): Promise<Blob | null> {
    const hasOverlay = objects.some((o) => o.type !== "blur");
    if (!hasOverlay) return null;
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const octx = off.getContext("2d");
    if (!octx) return null;
    drawOverlayObjects(octx, objects, null, true);
    return new Promise<Blob>((resolve, reject) => {
      off.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Falha ao exportar sobreposição."))),
        "image/png",
      );
    });
  }

  /** Pede ao servidor (ffmpeg) para gravar corte + borrão + sobreposições no vídeo. */
  async function renderEditedVideo(): Promise<Blob> {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("Editor indisponível.");
    const overlayBlob = await exportOverlayPng(canvas.width, canvas.height);
    const blurRects = objects
      .filter((o): o is BlurObject => o.type === "blur")
      .map((o) => ({
        x: Math.round(o.x),
        y: Math.round(o.y),
        w: Math.round(o.w),
        h: Math.round(o.h),
      }));

    const form = new FormData();
    if (trimStart > 0.05) form.append("trimStart", String(trimStart));
    if (duration > 0 && trimEnd < duration - 0.05) form.append("trimEnd", String(trimEnd));
    if (overlayBlob) form.append("overlay", new File([overlayBlob], "overlay.png", { type: "image/png" }));
    if (blurRects.length > 0) form.append("blurRects", JSON.stringify(blurRects));

    const res = await fetch(`/api/media/${item.id}/render-video`, { method: "POST", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Erro ${res.status}`);
    }
    return res.blob();
  }

  /** Salvar nova versão: cria outro vídeo editado, mantendo o original. */
  async function handleSaveNew() {
    setSaving("new");
    setError(null);
    setSelectedId(null);
    try {
      const blob = await renderEditedVideo();
      const baseName = item.filename.replace(/\.[^./\\]+$/, "");
      const form = new FormData();
      form.append("file", new File([blob], `${baseName}-editado.mp4`, { type: "video/mp4" }));
      form.append("editedFrom", item.id);
      const { media: newItem } = await apiUpload<{ media: MediaItem }>(
        `/api/profiles/${profileId}/media`,
        form,
      );
      onSaved(newItem);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(null);
    }
  }

  /** Salvar: sobrescreve o vídeo atual (mesmo id, etiquetas e link público). */
  async function handleOverwrite() {
    setSaving("overwrite");
    setError(null);
    setSelectedId(null);
    try {
      const blob = await renderEditedVideo();
      const baseName = item.filename.replace(/\.[^./\\]+$/, "");
      const form = new FormData();
      form.append("file", new File([blob], `${baseName}.mp4`, { type: "video/mp4" }));
      const { media: newItem } = await apiUpload<{ media: MediaItem }>(
        `/api/media/${item.id}/replace`,
        form,
      );
      onSaved(newItem);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(null);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !emojiPickerOpen) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, emojiPickerOpen]);

  if (!mounted) return null;

  return (
    <div
      className="flex h-full w-full flex-col bg-ink-900 relative"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Topo */}
      <div className="flex items-center justify-between px-4 py-3 safe-top">
        <button
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Fechar"
        >
          <IconClose size={20} />
        </button>
        <span className="eyebrow hidden sm:block">editor de vídeo</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOverwrite}
            disabled={saving !== null || !loaded}
            className="btn-ghost px-3 py-1.5 text-sm"
            title="Substitui o vídeo atual pela versão editada"
          >
            {saving === "overwrite" ? "Salvando..." : "Salvar"}
          </button>
          <button
            onClick={handleSaveNew}
            disabled={saving !== null || !loaded}
            className="btn-primary px-3 py-1.5 text-sm"
            title="Cria um novo vídeo, mantendo o original"
          >
            {saving === "new" ? "Salvando..." : "Salvar nova versão"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mx-4 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 px-4 py-2">
        <ToolButton icon={<IconType size={18} />} label="Texto" onClick={addText} />
        <ToolButton
          icon={<IconEmoji size={18} />}
          label="Emoji"
          onClick={() => setEmojiPickerOpen(true)}
        />
        <ToolButton
          icon={<IconBlur size={18} />}
          label="Borrar"
          active={mode === "blur"}
          onClick={() => {
            setMode((m) => (m === "blur" ? "select" : "blur"));
            setSelectedId(null);
          }}
        />
        <ToolButton icon={<IconQuestion size={18} />} label="Pergunta" onClick={addQuestionBox} />
        <ToolButton
          icon={<IconUndo size={18} />}
          label="Desfazer"
          onClick={undo}
          disabled={objects.length === 0}
        />
      </div>

      {/* Vídeo / canvas de edição */}
      <div className="flex flex-1 items-center justify-center overflow-hidden px-3">
        {!loaded && !error && (
          <div className="h-8 w-8 animate-spin rounded-full border border-white/15 border-t-white" />
        )}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          muted
          playsInline
          onLoadedMetadata={onLoadedMetadata}
          onSeeked={onSeeked}
          onTimeUpdate={onVideoTimeUpdate}
          onPause={onVideoPause}
          className={`rounded-lg ${loaded && previewPlaying ? "" : "hidden"}`}
          style={{ maxWidth: "100%", maxHeight: "60vh", width: "auto", height: "auto" }}
        />
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMoveCanvas}
          onPointerUp={onPointerUpCanvas}
          onPointerCancel={onPointerUpCanvas}
          className={`rounded-lg ${loaded && !previewPlaying ? "" : "hidden"}`}
          style={{
            maxWidth: "100%",
            maxHeight: "60vh",
            width: "auto",
            height: "auto",
            touchAction: "none",
            cursor: mode === "blur" ? "crosshair" : "default",
          }}
        />
      </div>

      {/* Corte (trim) */}
      <div className="px-4 pb-2">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="flex items-center gap-1.5">
            <IconScissors size={13} /> corte
          </span>
          <span>
            {formatTime(trimStart)} – {formatTime(trimEnd)} · {formatTime(trimEnd - trimStart)}
          </span>
        </div>
        <div
          ref={trackRef}
          className="relative h-2 touch-none rounded-full bg-white/10"
          onPointerMove={onTrimPointerMove}
          onPointerUp={onTrimPointerUp}
          onPointerCancel={onTrimPointerUp}
        >
          {duration > 0 && (
            <>
              <div
                className="absolute top-0 h-2 rounded-full bg-white/60"
                style={{
                  left: `${(trimStart / duration) * 100}%`,
                  width: `${Math.max(0, ((trimEnd - trimStart) / duration) * 100)}%`,
                }}
              />
              <button
                onPointerDown={(e) => onTrimPointerDown("start", e)}
                className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-ink-950 bg-white"
                style={{ left: `${(trimStart / duration) * 100}%` }}
                aria-label="Início do corte"
              />
              <button
                onPointerDown={(e) => onTrimPointerDown("end", e)}
                className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-ink-950 bg-white"
                style={{ left: `${(trimEnd / duration) * 100}%` }}
                aria-label="Fim do corte"
              />
            </>
          )}
        </div>
        <div className="mt-1.5 flex justify-center">
          <ToolButton
            icon={<IconPlay size={16} />}
            label={previewPlaying ? "tocando..." : "reproduzir corte"}
            onClick={togglePreview}
            disabled={!loaded || duration <= 0}
          />
        </div>
      </div>

      {/* Painel contextual do objeto selecionado — altura reservada para o
          wrapper acima não mudar de tamanho ao selecionar/deselecionar. */}
      <div className="flex h-[124px] flex-col justify-center gap-2.5 border-t border-white/10 bg-ink-900/80 px-4 py-3 safe-bottom">
        {!selected && (
          <p className="text-center font-mono text-[11px] uppercase tracking-wider text-zinc-600">
            Toque num elemento para editar
          </p>
        )}
        {selected && (
          <>
          {selected.type === "text" && (
            <>
              <input
                className="input"
                value={selected.text}
                onChange={(e) => updateSelected({ text: e.target.value })}
                placeholder="Digite o texto"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-1.5">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => updateSelected({ color: c })}
                      className="h-6 w-6 rounded-full border-2"
                      style={{
                        backgroundColor: c,
                        borderColor: selected.color === c ? "#fff" : "transparent",
                      }}
                      aria-label={c}
                    />
                  ))}
                </div>
                <label className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                  <input
                    type="checkbox"
                    className="accent-white"
                    checked={selected.bg}
                    onChange={(e) => updateSelected({ bg: e.target.checked })}
                  />
                  fundo
                </label>
                <button
                  onClick={removeSelected}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-red-400"
                  aria-label="Excluir"
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </>
          )}
          {(selected.type === "emoji" || selected.type === "blur") && (
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                {selected.type === "emoji" ? "emoji selecionado" : "área borrada"} · arraste o
                canto para redimensionar
              </p>
              <button
                onClick={removeSelected}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-red-400"
                aria-label="Excluir"
              >
                <IconTrash size={16} />
              </button>
            </div>
          )}
          {selected.type === "question" && (
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                value={selected.question}
                onChange={(e) => updateQuestion({ question: e.target.value })}
                placeholder="Digite algo..."
              />
              <button
                onClick={removeSelected}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-red-400"
                aria-label="Excluir"
              >
                <IconTrash size={16} />
              </button>
            </div>
          )}
          </>
        )}
      </div>

      <p className="pb-3 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600 safe-bottom">
        salvar = substitui o atual · salvar nova versão = mantém o original
      </p>

      {/* Seletor de emoji compacto (mesma lista curada do censurador). */}
      <Modal open={emojiPickerOpen} onClose={() => setEmojiPickerOpen(false)} maxWidth="max-w-sm">
        <div>
          <p className="eyebrow">adicionar</p>
          <h2 className="mt-1.5 flex items-center gap-2 font-display text-lg font-semibold">
            <IconEmoji size={16} /> Emoji
          </h2>
          <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
            {COMPACT_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => addEmoji(e)}
                className="grid aspect-square place-items-center rounded-lg text-2xl hover:bg-white/10"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
