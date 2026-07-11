import type { Tag } from "@/lib/types";

/** Pontinhos de cor indicando as etiquetas de um item (até 4 visíveis). */
export default function TagDots({ tags, size = 6 }: { tags: Tag[]; size?: number }) {
  if (!tags.length) return null;
  return (
    <div className="flex items-center gap-1">
      {tags.slice(0, 4).map((t) => (
        <span
          key={t.id}
          title={t.name}
          className="rounded-full ring-1 ring-black/40"
          style={{ width: size, height: size, backgroundColor: t.color }}
        />
      ))}
      {tags.length > 4 && (
        <span className="font-mono text-[9px] text-zinc-400">+{tags.length - 4}</span>
      )}
    </div>
  );
}
