"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { CENSOR_EMOJIS } from "@/lib/censorEmojis";
import {
  type EditorObject,
  type EmojiObject,
  type BlurObject,
  type TextObject,
  type QuestionObject,
  drawBlurObjects,
  drawOverlayObjects,
  hitTestObjects,
  hitResizeHandle,
  hitRotateHandle,
  hitDeleteHandle,
  hitMoveHandle,
  computeBounds,
  centerOf,
  rotationOf,
  preloadEmojiImages,
} from "@/lib/editorObjects";
import { IconBlur, IconUndo, IconEmoji } from "@/components/icons";

export type CensorCanvasHandle = {
  export: () => Promise<Blob>;
};

/**
 * Canvas interativo de uma imagem para a página de censura em lote.
 * Reaproveita o mesmo motor de desenho do editor de fotos (emoji nítido,
 * alças de girar/redimensionar/excluir). Controlado: `objects` + `onChange`.
 */
const CensorCanvas = forwardRef<CensorCanvasHandle, {
  image: HTMLImageElement;
  objects: EditorObject[];
  onChange: (next: EditorObject[]) => void;
  maxDim?: number;
}>(function CensorCanvas({ image, objects, onChange, maxDim = 2000 }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"select" | "blur">("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [emojiRowOpen, setEmojiRowOpen] = useState(false);
  const [, setTick] = useState(0);

  const dragRef = useRef<{
    id: string;
    kind: "move" | "resize" | "rotate";
    startX: number;
    startY: number;
    orig: EditorObject;
    cx: number;
    cy: number;
    startAngle: number;
    startDist: number;
  } | null>(null);
  const drawingBlurId = useRef<string | null>(null);

  // Dimensiona o canvas conforme a imagem (com teto).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let w = image.naturalWidth || image.width;
    let h = image.naturalHeight || image.height;
    if (Math.max(w, h) > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    canvas.width = w;
    canvas.height = h;
    setReady(true);
  }, [image, maxDim]);

  function displayScale(canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? canvas.width / rect.width : 1;
  }

  function renderFrame(ctx: CanvasRenderingContext2D, forExport: boolean) {
    const canvas = ctx.canvas;
    const scale = forExport ? 1 : displayScale(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawBlurObjects(ctx, objects, forExport ? null : selectedId, forExport, scale);
    drawOverlayObjects(
      ctx,
      objects,
      forExport ? null : selectedId,
      forExport,
      scale,
      () => setTick((t) => t + 1),
    );
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const ctx = canvas.getContext("2d");
    if (ctx) renderFrame(ctx, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, selectedId, ready]);

  useImperativeHandle(ref, () => ({
    async export() {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Canvas indisponível.");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponível.");
      const keep = selectedId;
      setSelectedId(null);
      await preloadEmojiImages(objects);
      renderFrame(ctx, true);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Falha ao exportar."))),
          "image/png",
        );
      });
      // Restaura a visualização com a seleção anterior.
      setSelectedId(keep);
      const c = canvasRef.current?.getContext("2d");
      if (c) renderFrame(c, false);
      return blob;
    },
  }));

  function toCanvasCoords(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY, scaleX };
  }

  const selected = objects.find((o) => o.id === selectedId) || null;

  function removeSelected() {
    if (!selected) return;
    onChange(objects.filter((o) => o.id !== selected.id));
    setSelectedId(null);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y, scaleX } = toCanvasCoords(e.clientX, e.clientY);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    if (mode === "blur") {
      const id = crypto.randomUUID();
      const obj: BlurObject = { id, type: "blur", x, y, w: 1, h: 1, style: "blur" };
      onChange([...objects, obj]);
      setSelectedId(id);
      drawingBlurId.current = id;
      dragRef.current = { id, kind: "resize", startX: x, startY: y, orig: obj, cx: x, cy: y, startAngle: 0, startDist: 0 };
      return;
    }

    if (selected) {
      const b = computeBounds(ctx, selected);
      const { cx, cy } = centerOf(b);
      if (hitDeleteHandle(ctx, selected, x, y, scaleX)) {
        removeSelected();
        return;
      }
      if (hitRotateHandle(ctx, selected, x, y, scaleX)) {
        dragRef.current = { id: selected.id, kind: "rotate", startX: x, startY: y, orig: { ...selected }, cx, cy, startAngle: Math.atan2(y - cy, x - cx), startDist: 0 };
        return;
      }
      if (hitResizeHandle(ctx, selected, x, y, scaleX)) {
        dragRef.current = { id: selected.id, kind: "resize", startX: x, startY: y, orig: { ...selected }, cx, cy, startAngle: 0, startDist: Math.hypot(x - cx, y - cy) };
        return;
      }
      if (hitMoveHandle(ctx, selected, x, y, scaleX)) {
        dragRef.current = { id: selected.id, kind: "move", startX: x, startY: y, orig: { ...selected }, cx, cy, startAngle: 0, startDist: 0 };
        return;
      }
    }

    const hit = hitTestObjects(ctx, objects, x, y);
    if (hit) {
      setSelectedId(hit.id);
      const b = computeBounds(ctx, hit);
      const { cx, cy } = centerOf(b);
      dragRef.current = { id: hit.id, kind: "move", startX: x, startY: y, orig: { ...hit }, cx, cy, startAngle: 0, startDist: 0 };
    } else {
      setSelectedId(null);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    const dx = x - drag.startX;
    const dy = y - drag.startY;

    if (mode === "blur" && drawingBlurId.current === drag.id) {
      const startX = drag.orig.type === "blur" ? drag.orig.x : 0;
      const startY = drag.orig.type === "blur" ? drag.orig.y : 0;
      onChange(
        objects.map((o) =>
          o.id === drag.id && o.type === "blur"
            ? { ...o, x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(x - startX), h: Math.abs(y - startY) }
            : o,
        ),
      );
      return;
    }

    if (drag.kind === "rotate") {
      const ang = Math.atan2(y - drag.cy, x - drag.cx);
      const next = rotationOf(drag.orig) + (ang - drag.startAngle);
      onChange(objects.map((o) => (o.id === drag.id ? { ...o, rotation: next } : o)));
      return;
    }

    onChange(
      objects.map((o) => {
        if (o.id !== drag.id) return o;
        if (drag.kind === "move") {
          const orig = drag.orig as { x: number; y: number };
          return { ...o, x: orig.x + dx, y: orig.y + dy };
        }
        if (o.type === "blur") {
          const orig = drag.orig as BlurObject;
          return { ...o, w: Math.max(12, orig.w + dx), h: Math.max(12, orig.h + dy) };
        }
        if (o.type === "question") {
          const orig = drag.orig as QuestionObject;
          const rot = rotationOf(orig);
          const localDx = dx * Math.cos(rot) + dy * Math.sin(rot);
          return { ...o, w: Math.max(100, orig.w + localDx) };
        }
        const orig = drag.orig as TextObject | EmojiObject;
        const distNow = Math.hypot(x - drag.cx, y - drag.cy);
        const ratio = drag.startDist > 0 ? distNow / drag.startDist : 1;
        const next = Math.max(12, Math.min(800, orig.size * ratio));
        return { ...o, size: next };
      }),
    );
  }

  function onPointerUp() {
    if (drawingBlurId.current) {
      const id = drawingBlurId.current;
      onChange(objects.filter((o) => !(o.id === id && o.type === "blur" && (o.w < 10 || o.h < 10))));
      drawingBlurId.current = null;
    }
    dragRef.current = null;
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
    onChange([...objects, obj]);
    setSelectedId(id);
    setMode("select");
    setEmojiRowOpen(false);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "blur" ? "select" : "blur"));
            setSelectedId(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
            mode === "blur" ? "bg-white/15 text-white" : "text-zinc-300 hover:bg-white/10"
          }`}
        >
          <IconBlur size={15} /> Borrar
        </button>
        <button
          type="button"
          onClick={() => setEmojiRowOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
            emojiRowOpen ? "bg-white/15 text-white" : "text-zinc-300 hover:bg-white/10"
          }`}
        >
          <IconEmoji size={15} /> Emoji
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(objects.slice(0, -1));
            setSelectedId(null);
          }}
          disabled={objects.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40"
        >
          <IconUndo size={15} /> Desfazer
        </button>
        {selected && (
          <button
            type="button"
            onClick={removeSelected}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
          >
            Excluir seleção
          </button>
        )}
      </div>

      {emojiRowOpen && (
        <div className="mb-2 flex flex-wrap gap-1 rounded-lg border border-white/10 bg-ink-900 p-2">
          {CENSOR_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => addEmoji(e)}
              className="grid h-9 w-9 place-items-center rounded-md text-xl hover:bg-white/10"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="w-full rounded-lg"
        style={{
          touchAction: "none",
          cursor: mode === "blur" ? "crosshair" : "default",
        }}
      />
    </div>
  );
});

export default CensorCanvas;
