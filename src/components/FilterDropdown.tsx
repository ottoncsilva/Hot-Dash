"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@/components/icons";

/**
 * Filtro que vive dentro de um menu suspenso, em vez de ocupar linhas inteiras
 * do cabeçalho. Nasceu para as etiquetas da Galeria: com uma dúzia delas os
 * chips tomavam duas linhas cheias e, no celular, empurravam a grade para fora
 * da primeira tela.
 *
 * O gatilho mostra quantos filtros estão ativos, então dá para saber que há
 * seleção sem abrir. Fecha ao clicar fora ou com Esc.
 */
export default function FilterDropdown({
  label,
  count = 0,
  children,
  align = "left",
}: {
  label: string;
  /** Quantos itens estão selecionados — aparece como contador no gatilho. */
  count?: number;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // Mesmo piso de 44px do ToggleChip: o gatilho fica ao lado deles.
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4 ${
          count > 0 || open
            ? "border-white/40 bg-white/10 text-white"
            : "border-white/15 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:bg-white/10 hover:text-zinc-100"
        }`}
      >
        {label}
        {count > 0 && (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-white px-1 text-[9px] text-ink-950">
            {count}
          </span>
        )}
        <IconChevronDown size={12} />
      </button>

      {open && (
        // O menu é absoluto para não empurrar a grade ao abrir. `max-h` + scroll
        // porque a lista de etiquetas cresce sem teto e no celular passaria da
        // altura da tela.
        <div
          className={`absolute z-40 mt-2 max-h-[60vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-ink-900 p-3 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
