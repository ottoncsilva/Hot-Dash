"use client";

import { useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronUp } from "@/components/icons";

/**
 * Linha colapsada de configuração: título, um RESUMO do que está salvo e um
 * botão Abrir/Fechar.
 *
 * A tela do bot era uma rolagem com todos os formulários abertos ao mesmo
 * tempo — para trocar o preço de um plano você passava por quatro caixas de
 * texto. Aqui o estado de cada assunto fica legível de relance (o resumo é o
 * próprio conteúdo salvo) e só o que se vai editar ocupa espaço.
 *
 * `status` é o diagnóstico na PRÓPRIA linha: é onde um problema aparece, em
 * vez de num toast que some antes de ser lido.
 */
export type SectionStatus = { label: string; tone: "ok" | "warn" | "error" };

const TONE: Record<SectionStatus["tone"], string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  error: "border-red-500/30 bg-red-500/10 text-red-300",
};

export default function SectionRow({
  icon,
  title,
  summary,
  status,
  defaultOpen = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** O que está salvo hoje, em uma linha. Mostrado só quando fechado. */
  summary?: string;
  status?: SectionStatus;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`card overflow-hidden ${open ? "border-emerald-500/25" : ""}`}>
      <div className="flex items-center gap-3 p-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-850 text-zinc-400">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          {!open && summary && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">{summary}</p>
          )}
        </div>
        {status && (
          <span className={`chip shrink-0 border ${TONE[status.tone]}`}>{status.label}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
          aria-expanded={open}
        >
          {open ? "Fechar" : "Abrir"}
          {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>
      {open && <div className="border-t border-white/10 p-4 pt-4">{children}</div>}
    </div>
  );
}

/** Corta um texto salvo para caber no resumo da linha, sem quebrar linha. */
export function resumo(text: string | undefined, max = 90): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
