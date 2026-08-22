"use client";

import type { ReactNode } from "react";

/**
 * Escolha em cartão — o formato usado onde a diferença entre as opções PRECISA
 * ser lida antes de escolher (abordagem do lead, ritmo das respostas). Um
 * <select> esconderia exatamente a explicação que faz a pessoa acertar.
 */
export default function OpcaoCartao({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full flex-col gap-1 rounded-xl border p-4 text-left transition-colors ${
        active
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/5"
      }`}
    >
      <span className="flex items-center gap-2 font-semibold text-white">
        {active && <span className="text-emerald-400">✓</span>}
        {title}
      </span>
      <span className="text-xs leading-relaxed text-zinc-400">{children}</span>
    </button>
  );
}
