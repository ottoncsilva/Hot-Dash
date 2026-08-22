"use client";

import { useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronUp } from "@/components/icons";

/**
 * Bloco recolhível das telas de LTV. A configuração é longa (persona,
 * produtos, áudios, limites) e no celular ela vira uma rolagem sem fim —
 * fechado, cada bloco mostra num resumo o que está valendo ali dentro, e só
 * quem vai mexer abre.
 */
export default function LtvBlock({
  icon,
  title,
  summary,
  badge,
  defaultOpen,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** O que está configurado, em uma linha. Aparece só com o bloco fechado. */
  summary?: ReactNode;
  /** Etiqueta de estado à direita do título (ex.: "Conectado"). */
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-3 p-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          {/* O título QUEBRA em vez de truncar: no celular "Recebimento e
              produtos (LTV)" virava "Recebimento e produtos (LT…", que não
              diz o que o bloco faz. Quem trunca é só o resumo, que é
              descartável. */}
          <h2 className="font-semibold leading-tight text-white">{title}</h2>
          {!open && summary && (
            <p className="truncate text-xs text-zinc-500">{summary}</p>
          )}
        </div>
        {badge}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/5 [@media(pointer:coarse)]:min-h-[44px]"
        >
          {open ? "Fechar" : "Abrir"}
          {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </button>
      </div>
      {open && <div className="border-t border-white/[0.06] p-4">{children}</div>}
    </section>
  );
}
