"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiUpload } from "@/lib/api";
import Modal from "@/components/Modal";
import ToolButton from "@/components/ToolButton";
import EmojiPicker from "@/components/EmojiPicker";
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
    drawBlurObjects(ctx, objects, selectedId, forExport);
    drawOverlayObjects(ctx, objects, selectedId, forExport);
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

  async function autoCensor() {
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
      const img = imgRef.current;
      if (!canvas || !img) return;
      
      const w = canvas.width;
      const h = canvas.height;

      const newObjs = data.boxes.map((b: any) => {
        let bx = b.left;
        let by = b.top;
        let bw = b.width;
        let bh = b.height;
        // Se a API retornar pixels absolutos, convertemos pra relativo.
        if (bx > 1 || bw > 1) { 
          bx = bx / img.naturalWidth;
          by = by / img.naturalHeight;
          bw = bw / img.naturalWidth;
          bh = bh / img.naturalHeight;
        }
        
        // Agora convertemos a coordenada relativa para o tamanho escalado no Canvas
        // Multiplicamos a caixa em 15% pra garantir que o blur cubra com folga
        const finalW = bw * w * 1.15;
        const finalH = bh * h * 1.15;
        
        return {
          id: crypto.randomUUID(),
          type: "blur",
          x: (bx * w) - ((finalW - (bw * w))/2),
          y: (by * h) - ((finalH - (bh * h))/2),
          w: finalW,
          h: finalH
        };
      }) as BlurObject[];

      if (newObjs.length === 0) {
         alert("Nenhum conteúdo adulto (ou compatível com a censura) foi encontrado.");
      } else {
         setObjects(prev => [...prev, ...newObjs]);
      }
    } catch(e) {
      setError(e instanceof Error ? e.message : "Falha na censura com IA.");
    } finally {
      setCensoring(false);
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
          onClick={autoCensor} 
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
    </div>
  );
}
