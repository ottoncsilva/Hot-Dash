"use client";

/**
 * Chip clicável (alternável) com estados claros de não-selecionado, hover e
 * selecionado — usado para filtros e para marcar/desmarcar etiquetas.
 * Selecionado = pílula branca sólida; não-selecionado = discreto, com
 * destaque visível ao passar o mouse.
 */
export default function ToggleChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? "border-white bg-white text-ink-950"
          : "border-white/15 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:bg-white/10 hover:text-zinc-100"
      }`}
    >
      {color && (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "ring-1 ring-black/20" : ""}`}
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </button>
  );
}
