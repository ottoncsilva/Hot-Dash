"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { IconChevronRight, IconUndo } from "@/components/icons";
import { captureFrame, formatTimecode, type FrameFormat } from "@/lib/videoFrame";

export type FramePickerHandle = {
  /** Gera a imagem do frame que está na tela. */
  capture: (format: FrameFormat, quality: number) => Promise<Blob | null>;
  /** Segundo exato do frame escolhido (para o nome do arquivo). */
  currentTime: () => number;
  /** Volta para o primeiro frame. */
  reset: () => void;
};

export type FrameStatusPatch = {
  status?: "pronto" | "erro";
  error?: string;
  duration?: number;
  time?: number;
};

type Props = {
  url: string;
  /** Quadros por segundo usados como PASSO das setas — não é o fps real do
   *  arquivo (o navegador não expõe isso), é só o tamanho do pulo. */
  fps: number;
  onStatus: (patch: FrameStatusPatch) => void;
};

/**
 * Prévia de um vídeo com navegação frame a frame. O `<video>` fica visível e
 * é ele mesmo que mostra o frame — buscar (`currentTime`) já pinta o quadro na
 * tela, e a exportação copia esse mesmo quadro para um canvas.
 */
const FramePicker = forwardRef<FramePickerHandle, Props>(function FramePicker(
  { url, fps, onStatus },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // O último frame não fica exatamente em `duration`: buscar o fim costuma
  // devolver quadro preto, então o limite é um passo antes.
  const maxSeek = duration > 0 ? Math.max(0, duration - 1 / fps) : 0;

  function applyTime(value: number) {
    const video = videoRef.current;
    const next = Math.min(Math.max(value, 0), maxSeek);
    setTime(next);
    onStatus({ time: next });
    if (video) video.currentTime = next;
  }

  useImperativeHandle(
    ref,
    () => ({
      capture: (format, quality) => {
        const video = videoRef.current;
        if (!video || !ready) return Promise.resolve(null);
        return captureFrame(video, format, quality);
      },
      currentTime: () => time,
      reset: () => applyTime(0),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, time, maxSeek],
  );

  return (
    <div>
      <div className="relative grid min-h-[180px] place-items-center overflow-hidden rounded-xl border border-white/[0.06] bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          preload="auto"
          className="block max-h-[60vh] w-auto max-w-full"
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          }}
          onLoadedData={(e) => {
            const video = e.currentTarget;
            const dur = Number.isFinite(video.duration) ? video.duration : 0;
            setDuration(dur);
            setTime(video.currentTime || 0);
            setReady(true);
            onStatus({ status: "pronto", duration: dur, time: video.currentTime || 0 });
          }}
          onSeeked={(e) => {
            const video = e.currentTarget;
            setTime(video.currentTime);
            onStatus({ time: video.currentTime });
          }}
          onError={() => {
            setFailed(true);
            onStatus({
              status: "erro",
              error: "O navegador não conseguiu abrir este vídeo (codec não suportado).",
            });
          }}
        />

        {!ready && !failed && (
          <div className="absolute inset-0 grid place-items-center bg-black/60">
            <div className="h-7 w-7 animate-spin rounded-full border border-white/15 border-t-white" />
          </div>
        )}
      </div>

      {/* Barra de navegação: arraste para girar os frames, setas para o passo
          fino. As setas do teclado também funcionam com o slider focado. */}
      <div className="mt-3 flex items-center gap-2">
        <StepButton label="1 segundo atrás" dir="back" big onClick={() => applyTime(time - 1)} disabled={!ready} />
        <StepButton label="Frame anterior" dir="back" onClick={() => applyTime(time - 1 / fps)} disabled={!ready} />
        <input
          type="range"
          min={0}
          max={maxSeek || 0}
          step={1 / fps}
          value={Math.min(time, maxSeek || 0)}
          disabled={!ready}
          onChange={(e) => applyTime(Number(e.target.value))}
          aria-label="Escolher frame"
          className="min-w-0 flex-1 accent-white disabled:opacity-40"
        />
        <StepButton label="Próximo frame" dir="fwd" onClick={() => applyTime(time + 1 / fps)} disabled={!ready} />
        <StepButton label="1 segundo à frente" dir="fwd" big onClick={() => applyTime(time + 1)} disabled={!ready} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-zinc-400">
          {formatTimecode(time)}
          <span className="text-zinc-600"> / {formatTimecode(duration)}</span>
        </span>
        <span className="chip">quadro ~{Math.round(time * fps) + 1}</span>
        {time > 0 && (
          <button
            onClick={() => applyTime(0)}
            disabled={!ready}
            className="inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-white"
          >
            <IconUndo size={13} /> Primeiro frame
          </button>
        )}
      </div>
    </div>
  );
});

function StepButton({
  label,
  dir,
  big,
  onClick,
  disabled,
}: {
  label: string;
  dir: "back" | "fwd";
  big?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30"
    >
      <span className={`flex ${dir === "back" ? "rotate-180" : ""} ${big ? "-space-x-1.5" : ""}`}>
        <IconChevronRight size={14} />
        {big && <IconChevronRight size={14} />}
      </span>
    </button>
  );
}

export default FramePicker;
