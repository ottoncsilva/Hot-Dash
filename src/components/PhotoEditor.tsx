"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiUpload } from "@/lib/api";
import { showToast } from "@/lib/toast";
import Modal from "@/components/Modal";
import ToolButton from "@/components/ToolButton";
import { COMPACT_EMOJIS } from "@/lib/censorEmojis";
import {
  BODY_PARTS,
  BODY_PART_LABELS,
  DEFAULT_PART_EMOJI,
  type BodyPart,
} from "@/lib/bodyParts";
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
  hitRotateHandle,
  hitDeleteHandle,
  computeBounds,
  centerOf,
  rotationOf,
  preloadEmojiImages,
} from "@/lib/editorObjects";

const MAX_DIM = 3000;

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
  const [censoring, setCensoring] = useState(false);
  const [censorMenuOpen, setCensorMenuOpen] = useState(false);
  // Emoji escolhido por parte do corpo (∅ = não cobrir aquela parte).
  const [partEmoji, setPartEmoji] = useState<Record<BodyPart, string>>({ ...DEFAULT_PART_EMOJI });
  // Contador que força re-render quando a imagem de um emoji termina de
  // carregar (o desenho é síncrono; a imagem chega depois).
  const [emojiTick, setEmojiTick] = useState(0);

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

  /** Escala px-do-canvas por px-de-tela — mantém alças e tracejado com
   *  tamanho visual constante independente do zoom de exibição. */
  function displayScale(canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? canvas.width / rect.width : 1;
  }

  function renderFrame(ctx: CanvasRenderingContext2D, forExport: boolean) {
    const canvas = ctx.canvas;
    const img = imgRef.current;
    if (!img) return;
    const scale = forExport ? 1 : displayScale(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawBlurObjects(ctx, objects, selectedId, forExport, scale);
    drawOverlayObjects(ctx, objects, selectedId, forExport, scale, () =>
      setEmojiTick((t) => t + 1),
    );
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const ctx = canvas.getContext("2d");
    if (ctx) renderFrame(ctx, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, selectedId, loaded, emojiTick]);

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
      dragRef.current = {
        id, kind: "resize", startX: x, startY: y, orig: obj,
        cx: x, cy: y, startAngle: 0, startDist: 0,
      };
      return;
    }

    // As alças (girar/redimensionar/excluir) pertencem ao objeto selecionado e
    // podem ficar FORA do seu contorno (a de girar fica acima) — por isso são
    // testadas antes do hit-test do corpo.
    if (selected) {
      const b = computeBounds(ctx, selected);
      const { cx, cy } = centerOf(b);
      if (hitDeleteHandle(ctx, selected, x, y, scaleX)) {
        removeSelected();
        return;
      }
      if (hitRotateHandle(ctx, selected, x, y, scaleX)) {
        dragRef.current = {
          id: selected.id, kind: "rotate", startX: x, startY: y, orig: { ...selected },
          cx, cy, startAngle: Math.atan2(y - cy, x - cx), startDist: 0,
        };
        return;
      }
      if (hitResizeHandle(ctx, selected, x, y, scaleX)) {
        dragRef.current = {
          id: selected.id, kind: "resize", startX: x, startY: y, orig: { ...selected },
          cx, cy, startAngle: 0, startDist: Math.hypot(x - cx, y - cy),
        };
        return;
      }
    }

    const hit = hitTestObjects(ctx, objects, x, y);
    if (hit) {
      setSelectedId(hit.id);
      const b = computeBounds(ctx, hit);
      const { cx, cy } = centerOf(b);
      dragRef.current = {
        id: hit.id, kind: "move", startX: x, startY: y, orig: { ...hit },
        cx, cy, startAngle: 0, startDist: 0,
      };
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

    if (drag.kind === "rotate") {
      const ang = Math.atan2(y - drag.cy, x - drag.cx);
      const next = rotationOf(drag.orig) + (ang - drag.startAngle);
      setObjects((prev) =>
        prev.map((o) => (o.id === drag.id ? { ...o, rotation: next } : o)),
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
          // Cresce ao longo do eixo horizontal LOCAL (respeitando a rotação).
          const orig = drag.orig as QuestionObject;
          const rot = rotationOf(orig);
          const localDx = dx * Math.cos(rot) + dy * Math.sin(rot);
          return { ...o, w: Math.max(100, orig.w + localDx) };
        }
        // Texto/emoji: escala pela razão de distância do ponteiro ao centro —
        // funciona igual em qualquer ângulo de rotação.
        const orig = drag.orig as TextObject | EmojiObject;
        const distNow = Math.hypot(x - drag.cx, y - drag.cy);
        const ratio = drag.startDist > 0 ? distNow / drag.startDist : 1;
        const next = Math.max(12, Math.min(600, orig.size * ratio));
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
    // Garante que os emojis saiam nítidos (imagem) e não no fallback de fonte.
    await preloadEmojiImages(objects);
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
      // Se cobriu algo (borrão/emoji), marca como censurada.
      if (objects.some((o) => o.type === "blur" || o.type === "emoji")) {
        form.append("tags", "Censurada");
      }
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
      // Se cobriu algo (borrão/emoji), marca como censurada.
      if (objects.some((o) => o.type === "blur" || o.type === "emoji")) {
        form.append("tags", "Censurada");
      }
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

  /**
   * Censura por IA: detecta as regiões explícitas e cobre com BORRÃO ou EMOJI,
   * conforme o modo escolhido. O emoji usado depende da parte do corpo
   * (DEFAULT_PART_EMOJI); partes sem emoji definido caem no 🔞.
   */
  async function autoCensor(mode: "blur" | "emoji") {
    setCensorMenuOpen(false);
    setCensoring(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/censor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: item.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao censurar.");

      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = canvas.width;
      const h = canvas.height;

      // A rota devolve regiões em coordenadas RELATIVAS (0..1). Aplicamos uma
      // folga de 12% ao redor para cobrir com margem.
      const PAD = 0.12;
      const regions = (data.regions || []) as {
        part: BodyPart;
        x: number;
        y: number;
        w: number;
        h: number;
      }[];

      let newObjs: EditorObject[];
      if (mode === "blur") {
        newObjs = regions.map((r): BlurObject => {
          const finalW = r.w * (1 + PAD) * w;
          const finalH = r.h * (1 + PAD) * h;
          return {
            id: crypto.randomUUID(),
            type: "blur",
            style: "pixelate",
            x: r.x * w - (finalW - r.w * w) / 2,
            y: r.y * h - (finalH - r.h * h) / 2,
            w: finalW,
            h: finalH,
          };
        });
      } else {
        newObjs = regions
          .map((r): EmojiObject | null => {
            const emoji = partEmoji[r.part];
            if (!emoji) return null; // ∅ → não cobrir essa parte
            const cx = (r.x + r.w / 2) * w;
            const cy = (r.y + r.h / 2) * h;
            // Emoji quadrado que cobre a maior dimensão da região (com folga).
            const base = Math.max(r.w * w, r.h * h);
            const size = Math.max(24, base * (1 + PAD));
            return {
              id: crypto.randomUUID(),
              type: "emoji",
              emoji,
              size,
              x: cx - size / 2,
              y: cy - size / 2,
            };
          })
          .filter((o): o is EmojiObject => o !== null);
      }

      if (regions.length === 0) {
        showToast("Nenhuma parte explícita foi encontrada pela IA.", "warning");
      } else if (newObjs.length === 0) {
        showToast("As partes encontradas estão marcadas como ∅ (não cobrir).", "warning");
      } else {
        setObjects((prev) => [...prev, ...newObjs]);
      }
    } catch(e) {
      setError(e instanceof Error ? e.message : "Falha na censura com IA.");
    } finally {
      setCensoring(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !emojiPickerOpen && !censorMenuOpen) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, emojiPickerOpen, censorMenuOpen]);

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
        <ToolButton
          icon={<IconSparkle size={18} />}
          label={censoring ? "Analisando..." : "Censura IA"}
          active={censorMenuOpen}
          onClick={() => setCensorMenuOpen(true)}
          disabled={censoring}
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
                {selected.type === "emoji"
                  ? "emoji · canto p/ redimensionar, alça de cima p/ girar"
                  : "área borrada · arraste o canto para redimensionar"}
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

      {/* Censura por IA: escolha entre borrar ou cobrir com emoji. */}
      <Modal open={censorMenuOpen} onClose={() => setCensorMenuOpen(false)} maxWidth="max-w-sm">
        <div>
          <p className="eyebrow">censura com IA</p>
          <h2 className="mt-1.5 flex items-center gap-2 font-display text-lg font-semibold">
            <IconSparkle size={16} /> Como cobrir?
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            A IA detecta as partes explícitas e cobre automaticamente. Escolha o estilo:
          </p>

          {/* Emoji por parte do corpo (usado ao clicar em "Emojis"). */}
          <p className="eyebrow mt-4">Emoji por parte do corpo</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {BODY_PARTS.map((part) => (
              <label
                key={part}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                  {BODY_PART_LABELS[part]}
                </span>
                <select
                  value={partEmoji[part]}
                  onChange={(e) => setPartEmoji((p) => ({ ...p, [part]: e.target.value }))}
                  className="shrink-0 rounded bg-ink-850 px-1 py-0.5 text-lg outline-none"
                >
                  <option value="">∅</option>
                  {COMPACT_EMOJIS.map((em) => (
                    <option key={em} value={em}>
                      {em}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => autoCensor("blur")}
              className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-ink-900 px-4 py-5 text-center hover:border-white/25 hover:bg-white/5"
            >
              <IconBlur size={24} />
              <span className="text-sm font-medium text-zinc-100">Borrar</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                pixelado
              </span>
            </button>
            <button
              type="button"
              onClick={() => autoCensor("emoji")}
              className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-ink-900 px-4 py-5 text-center hover:border-white/25 hover:bg-white/5"
            >
              <span className="text-2xl leading-none">🔞</span>
              <span className="text-sm font-medium text-zinc-100">Emojis</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                por parte
              </span>
            </button>
          </div>
        </div>
      </Modal>

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
