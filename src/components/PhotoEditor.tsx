"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiUpload } from "@/lib/api";
import Modal from "@/components/Modal";
import {
  IconClose,
  IconType,
  IconEmoji,
  IconBlur,
  IconQuestion,
  IconUndo,
  IconTrash,
  IconSparkle,
} from "@/components/icons";
import { mediaFileUrl, type MediaItem } from "@/lib/types";
import { EMOJI_CATEGORIES } from "@/lib/emojis";

type TextObject = {
  id: string;
  type: "text";
  x: number;
  y: number;
  size: number;
  text: string;
  color: string;
  bg: boolean;
};
type EmojiObject = {
  id: string;
  type: "emoji";
  x: number;
  y: number;
  size: number;
  emoji: string;
};
type BlurObject = {
  id: string;
  type: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
};
/** Caixinha de pergunta estilo sticker do Instagram — a altura sempre segue
 * do texto (quebrado dentro de `w`), só a largura é redimensionável. */
type QuestionObject = {
  id: string;
  type: "question";
  x: number;
  y: number;
  w: number;
  question: string;
};
type EditorObject = TextObject | EmojiObject | BlurObject | QuestionObject;

const TEXT_COLORS = [
  "#ffffff",
  "#000000",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

const MAX_DIM = 3000;
// Alvo de toque maior (mobile) para a alça de redimensionar.
const HANDLE_SCREEN_PX = 34;
// Margem (em coordenadas do canvas) que a área clicável ganha além do
// contorno exato do objeto — bate com a margem visual do tracejado de
// seleção, para "selecionar" não parecer mais difícil do que "ver selecionado".
const HIT_PADDING = 10;

const QUESTION_TITLE = "Faça uma pergunta";
const QUESTION_PLACEHOLDER = "Digite algo...";

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${current} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Layout em duas camadas, como o sticker de pergunta do Instagram: título
 * fixo em negrito no topo, e abaixo uma pílula cinza separada com a
 * pergunta digitada (ou o placeholder, quando vazia).
 */
function measureQuestionBox(ctx: CanvasRenderingContext2D, o: QuestionObject) {
  const outerPad = o.w * 0.07;
  const titleSize = Math.max(12, o.w * 0.052);
  const titleHeight = titleSize * 1.3;
  const gap = titleSize * 0.55;
  const pillPadX = o.w * 0.05;
  const pillPadY = o.w * 0.035;
  const qSize = Math.max(11, o.w * 0.042);
  const pillWidth = o.w - outerPad * 2;
  const hasQuestion = Boolean(o.question && o.question.trim());
  ctx.font = `600 ${qSize}px sans-serif`;
  const lines = wrapText(ctx, hasQuestion ? o.question : QUESTION_PLACEHOLDER, pillWidth - pillPadX * 2);
  const lineHeight = qSize * 1.3;
  const pillHeight = pillPadY * 2 + lines.length * lineHeight;
  const h = outerPad + titleHeight + gap + pillHeight + outerPad;
  return {
    outerPad,
    titleSize,
    titleHeight,
    gap,
    pillPadX,
    pillPadY,
    qSize,
    pillWidth,
    lines,
    lineHeight,
    pillHeight,
    hasQuestion,
    h,
  };
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function computeBounds(ctx: CanvasRenderingContext2D, o: EditorObject) {
  if (o.type === "blur") return { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.type === "emoji") return { x: o.x, y: o.y, w: o.size, h: o.size };
  if (o.type === "question") {
    const { h } = measureQuestionBox(ctx, o);
    return { x: o.x, y: o.y, w: o.w, h };
  }
  ctx.font = `700 ${o.size}px sans-serif`;
  const w = ctx.measureText(o.text || " ").width;
  return { x: o.x, y: o.y, w: Math.max(w, o.size * 0.5), h: o.size };
}

export default function PhotoEditor({
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
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [objects, setObjects] = useState<EditorObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "blur">("select");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<"new" | "overwrite" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dragRef = useRef<{
    id: string;
    kind: "move" | "resize";
    startX: number;
    startY: number;
    orig: EditorObject;
  } | null>(null);
  const drawingBlurId = useRef<string | null>(null);

  const selected = objects.find((o) => o.id === selectedId) || null;

  // Carrega a imagem original (autenticado) para o canvas.
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(mediaFileUrl(item));
        if (!res.ok) throw new Error("Falha ao carregar imagem.");
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          imgRef.current = img;
          const canvas = canvasRef.current;
          if (!canvas) return;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          if (Math.max(w, h) > MAX_DIM) {
            const s = MAX_DIM / Math.max(w, h);
            w = Math.round(w * s);
            h = Math.round(h * s);
          }
          canvas.width = w;
          canvas.height = h;
          setLoaded(true);
        };
        img.onerror = () => setError("Falha ao carregar imagem.");
        img.src = url;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao carregar imagem.");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id]);

  function renderFrame(ctx: CanvasRenderingContext2D, forExport: boolean) {
    const canvas = ctx.canvas;
    const img = imgRef.current;
    if (!img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const o of objects) {
      if (o.type !== "blur") continue;
      const w = Math.max(1, Math.round(o.w));
      const h = Math.max(1, Math.round(o.h));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const octx = off.getContext("2d");
      if (octx) {
        octx.filter = "blur(16px)";
        octx.drawImage(canvas, o.x, o.y, w, h, -16, -16, w + 32, h + 32);
        ctx.drawImage(off, o.x, o.y);
      }
      if (!forExport && selectedId === o.id) drawSelectionBox(ctx, computeBounds(ctx, o));
    }

    for (const o of objects) {
      if (o.type === "text") {
        ctx.font = `700 ${o.size}px sans-serif`;
        ctx.textBaseline = "top";
        const w = ctx.measureText(o.text || "").width;
        if (o.bg) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(
            o.x - o.size * 0.15,
            o.y - o.size * 0.08,
            w + o.size * 0.3,
            o.size * 1.2,
          );
        }
        ctx.lineWidth = Math.max(2, o.size * 0.08);
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.strokeText(o.text || "", o.x, o.y);
        ctx.fillStyle = o.color;
        ctx.fillText(o.text || "", o.x, o.y);
      } else if (o.type === "emoji") {
        ctx.font = `${o.size}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(o.emoji, o.x, o.y);
      } else if (o.type === "question") {
        const {
          outerPad,
          titleSize,
          titleHeight,
          gap,
          pillPadX,
          pillPadY,
          qSize,
          pillWidth,
          lines,
          lineHeight,
          pillHeight,
          hasQuestion,
          h,
        } = measureQuestionBox(ctx, o);

        // Caixa branca externa
        drawRoundRect(ctx, o.x, o.y, o.w, h, Math.min(20, o.w * 0.05));
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // Título fixo, em negrito
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillStyle = "#050505";
        ctx.font = `700 ${titleSize}px sans-serif`;
        ctx.fillText(QUESTION_TITLE, o.x + outerPad, o.y + outerPad);

        // Pílula cinza separada com a pergunta (ou o placeholder)
        const pillY = o.y + outerPad + titleHeight + gap;
        drawRoundRect(ctx, o.x + outerPad, pillY, pillWidth, pillHeight, Math.min(pillHeight / 2, o.w * 0.035));
        ctx.fillStyle = "#e4e4e7";
        ctx.fill();

        ctx.fillStyle = hasQuestion ? "#18181b" : "#71717a";
        ctx.font = `600 ${qSize}px sans-serif`;
        let ty = pillY + pillPadY;
        for (const line of lines) {
          ctx.fillText(line, o.x + outerPad + pillPadX, ty);
          ty += lineHeight;
        }
      }
      if (!forExport && selectedId === o.id) drawSelectionBox(ctx, computeBounds(ctx, o));
    }
  }

  function drawSelectionBox(
    ctx: CanvasRenderingContext2D,
    b: { x: number; y: number; w: number; h: number },
  ) {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.setLineDash([]);
    const hs = 20;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(b.x + b.w - hs / 2, b.y + b.h - hs / 2, hs, hs);
    ctx.restore();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const ctx = canvas.getContext("2d");
    if (ctx) renderFrame(ctx, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, selectedId, loaded]);

  function toCanvasCoords(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY, scaleX };
  }

  function hitTest(x: number, y: number): EditorObject | null {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return null;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      const b = computeBounds(ctx, o);
      if (
        x >= b.x - HIT_PADDING &&
        x <= b.x + b.w + HIT_PADDING &&
        y >= b.y - HIT_PADDING &&
        y <= b.y + b.h + HIT_PADDING
      )
        return o;
    }
    return null;
  }

  function hitResizeHandle(o: EditorObject, x: number, y: number, scaleX: number): boolean {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return false;
    const b = computeBounds(ctx, o);
    const tol = HANDLE_SCREEN_PX * scaleX;
    return x >= b.x + b.w - tol && x <= b.x + b.w + tol && y >= b.y + b.h - tol && y <= b.y + b.h + tol;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y, scaleX } = toCanvasCoords(e.clientX, e.clientY);

    if (mode === "blur") {
      const id = crypto.randomUUID();
      const obj: BlurObject = { id, type: "blur", x, y, w: 1, h: 1 };
      setObjects((prev) => [...prev, obj]);
      setSelectedId(id);
      drawingBlurId.current = id;
      dragRef.current = { id, kind: "resize", startX: x, startY: y, orig: obj };
      return;
    }

    const hit = hitTest(x, y);
    if (hit) {
      setSelectedId(hit.id);
      const kind = hitResizeHandle(hit, x, y, scaleX) ? "resize" : "move";
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
        // Texto/emoji: cresce com o arraste na diagonal (média de dx e dy),
        // não só na vertical — arrastar pra baixo-direita cresce, pra
        // cima-esquerda encolhe, e arrastar só na horizontal também funciona.
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
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
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
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
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
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
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
      prev.map((o) =>
        o.id === selected.id && o.type === "text" ? { ...o, ...patch } : o,
      ),
    );
  }

  function updateQuestion(patch: Partial<QuestionObject>) {
    if (!selected || selected.type !== "question") return;
    setObjects((prev) =>
      prev.map((o) =>
        o.id === selected.id && o.type === "question" ? { ...o, ...patch } : o,
      ),
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

  async function exportBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível.");
    renderFrame(ctx, true);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Falha ao exportar imagem."))),
        "image/png",
      );
    });
  }

  /** Salvar nova versão: cria outra mídia editada, mantendo a original. */
  async function handleSaveNew() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving("new");
    setError(null);
    setSelectedId(null);
    try {
      const blob = await exportBlob(canvas);
      const baseName = item.filename.replace(/\.[^./\\]+$/, "");
      const form = new FormData();
      form.append("file", new File([blob], `${baseName}-editada.png`, { type: "image/png" }));
      form.append("editedFrom", item.id);
      const { media: newItem } = await apiUpload<{ media: MediaItem }>(
        `/api/profiles/${profileId}/media`,
        form,
      );
      onSaved(newItem);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
      const ctx = canvas.getContext("2d");
      if (ctx) renderFrame(ctx, false);
    } finally {
      setSaving(null);
    }
  }

  /** Salvar: sobrescreve a imagem atual (mesmo id, etiquetas e link público). */
  async function handleOverwrite() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving("overwrite");
    setError(null);
    setSelectedId(null);
    try {
      const blob = await exportBlob(canvas);
      const baseName = item.filename.replace(/\.[^./\\]+$/, "");
      const form = new FormData();
      form.append("file", new File([blob], `${baseName}.png`, { type: "image/png" }));
      const { media: newItem } = await apiUpload<{ media: MediaItem }>(
        `/api/media/${item.id}/replace`,
        form,
      );
      onSaved(newItem);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
      const ctx = canvas.getContext("2d");
      if (ctx) renderFrame(ctx, false);
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

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/95 backdrop-blur-sm"
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
        <span className="eyebrow hidden sm:block">editor de foto</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOverwrite}
            disabled={saving !== null || !loaded}
            className="btn-ghost px-3 py-1.5 text-sm"
            title="Substitui a imagem atual pela versão editada"
          >
            {saving === "overwrite" ? "Salvando..." : "Salvar"}
          </button>
          <button
            onClick={handleSaveNew}
            disabled={saving !== null || !loaded}
            className="btn-primary px-3 py-1.5 text-sm"
            title="Cria uma nova imagem, mantendo a original"
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

      {/* Canvas */}
      <div className="flex flex-1 items-center justify-center overflow-hidden px-3">
        {!loaded && !error && (
          <div className="h-8 w-8 animate-spin rounded-full border border-white/15 border-t-white" />
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMoveCanvas}
          onPointerUp={onPointerUpCanvas}
          onPointerCancel={onPointerUpCanvas}
          className={`rounded-lg ${loaded ? "" : "hidden"}`}
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

      {/* Painel contextual do objeto selecionado — sempre presente (altura
          reservada) para o wrapper do canvas acima não mudar de tamanho
          quando um objeto é selecionado/deselecionado (isso deslocava o
          mapeamento de toque→coordenada do canvas, parecendo que "a foto
          se reposicionava"). */}
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
        salvar = substitui a atual · salvar nova versão = mantém a original
      </p>

      {/* Seletor de emoji (coleção completa, por categoria + busca) */}
      <Modal open={emojiPickerOpen} onClose={() => setEmojiPickerOpen(false)} maxWidth="max-w-md">
        <EmojiPicker onPick={addEmoji} />
      </Modal>
    </div>,
    document.body,
  );
}

function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [cat, setCat] = useState(EMOJI_CATEGORIES[0].id);
  const [query, setQuery] = useState("");

  const active = EMOJI_CATEGORIES.find((c) => c.id === cat) || EMOJI_CATEGORIES[0];
  const q = query.trim();
  // Busca simples: acha a categoria cujo rótulo casa; senão mostra todos.
  const results = q
    ? EMOJI_CATEGORIES.filter((c) =>
        c.label.toLowerCase().includes(q.toLowerCase()),
      ).flatMap((c) => c.emojis)
    : active.emojis;
  const emojis = q && results.length === 0
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis)
    : results;

  return (
    <div>
      <p className="eyebrow">adicionar</p>
      <h2 className="mt-1.5 flex items-center gap-2 font-display text-lg font-semibold">
        <IconSparkle size={16} /> Emoji
      </h2>

      <input
        className="input mt-3"
        placeholder="Buscar categoria (ex.: comida, animais)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!q && (
        <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              title={c.label}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xl transition-colors ${
                cat === c.id ? "bg-white/15" : "hover:bg-white/10"
              }`}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}

      {!q && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {active.label}
        </p>
      )}

      <div className="mt-2 grid max-h-[46vh] grid-cols-8 gap-1 overflow-y-auto text-2xl">
        {emojis.map((e, i) => (
          <button
            key={`${e}-${i}`}
            onClick={() => onPick(e)}
            className="grid aspect-square place-items-center rounded-lg hover:bg-white/10"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-medium uppercase tracking-wider transition-all disabled:opacity-30 ${
        active ? "bg-white text-ink-950" : "text-zinc-300 hover:bg-white/10"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
