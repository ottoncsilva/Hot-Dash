"use client";

import { useRef } from "react";
import FormatToolbar from "./FormatToolbar";
import VarChips from "./VarChips";
import MediaPicker from "./MediaPicker";

/**
 * O editor de UMA mensagem do bot — o mesmo em todo lugar.
 *
 * Antes cada tela tinha a sua versão: a de boas-vindas ganhava barra de
 * formatação, chips de variável e escolha de mídia; os passos da Recuperação e
 * das sequências de aprovação ficavam com um textarea pelado e um campo de
 * etiquetas. Mesma coisa sendo escrita, três formas diferentes de escrever —
 * e as duas piores eram justamente as das mensagens que mais se repetem.
 *
 * A mídia aqui é sempre ESCOLHIDA A DEDO. O sorteio por etiqueta saiu da
 * interface: numa sequência de recuperação, a mídia faz parte da mensagem, e
 * sortear significava não saber o que o lead ia ver.
 */
export default function MessageEditor({
  profileId,
  text,
  onText,
  mediaIds,
  onMediaIds,
  mode,
  onMode,
  vars,
  placeholder = "Texto da mensagem",
  minHeight = 110,
  max = 4096,
  maxMedia = 10,
}: {
  profileId: string;
  text: string;
  onText: (v: string) => void;
  mediaIds: string[];
  onMediaIds: (v: string[]) => void;
  /** Como enviar quando há mais de uma mídia. Omitido = sempre álbum. */
  mode?: "album" | "separate";
  onMode?: (v: "album" | "separate") => void;
  vars: [string, string][];
  placeholder?: string;
  minHeight?: number;
  max?: number;
  maxMedia?: number;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div>
      <FormatToolbar targetRef={areaRef} onChange={onText} />
      <textarea
        ref={areaRef}
        className="input"
        style={{ minHeight }}
        placeholder={placeholder}
        maxLength={max}
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <VarChips vars={vars} targetRef={areaRef} onChange={onText} />
        </div>
        {/* O contador importa: o Telegram corta a mensagem no limite, e quem
            escreve sem ver o número só descobre no envio. */}
        <span
          className={`shrink-0 pt-1.5 font-mono text-[11px] ${
            text.length > max * 0.9 ? "text-amber-400" : "text-zinc-600"
          }`}
        >
          {text.length}/{max}
        </span>
      </div>

      <label className="eyebrow mt-3 block">Mídias · até {maxMedia}</label>
      <div className="mt-1.5">
        <MediaPicker profileId={profileId} selected={mediaIds} onChange={onMediaIds} max={maxMedia} />
      </div>

      {onMode && mediaIds.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-500">Enviar as {mediaIds.length}:</span>
          {(
            [
              ["album", "em álbum"],
              ["separate", "uma por mensagem"],
            ] as const
          ).map(([k, rotulo]) => (
            <button
              key={k}
              type="button"
              onClick={() => onMode(k)}
              className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                (mode || "album") === k
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-white/10 bg-ink-850 text-zinc-400 hover:border-white/20"
              }`}
            >
              {rotulo}
            </button>
          ))}
          {/* O álbum não aceita botão — quem escolhe "em álbum" precisa saber
              que os botões vêm numa mensagem à parte, senão parece defeito. */}
          <span className="w-full text-[11px] text-zinc-600">
            {(mode || "album") === "album"
              ? "Em álbum os botões vêm logo abaixo, numa mensagem própria — o Telegram não deixa colar botão em álbum."
              : "O texto e os botões vão na última mídia."}
          </span>
        </div>
      )}
    </div>
  );
}

/** As variáveis que valem em qualquer mensagem do bot. */
export const VARS_PADRAO: [string, string][] = [["{nome}", "primeiro nome do lead no Telegram"]];
