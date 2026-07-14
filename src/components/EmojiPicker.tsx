"use client";

import { useState } from "react";
import { IconSparkle } from "@/components/icons";
import { EMOJI_CATEGORIES } from "@/lib/emojis";

export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [cat, setCat] = useState(EMOJI_CATEGORIES[0].id);
  const [query, setQuery] = useState("");

  const active = EMOJI_CATEGORIES.find((c) => c.id === cat) || EMOJI_CATEGORIES[0];
  const q = query.trim();
  // Busca simples: acha a categoria cujo rótulo casa; senão mostra todos.
  const results = q
    ? EMOJI_CATEGORIES.filter((c) =>
        c.label.toLowerCase().includes(q.toLowerCase()),
      ).flatMap((c) => c.emojis)
    : active.emojis;
  const emojis = q && results.length === 0
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis)
    : results;

  return (
    <div>
      <p className="eyebrow">adicionar</p>
      <h2 className="mt-1.5 flex items-center gap-2 font-display text-lg font-semibold">
        <IconSparkle size={16} /> Emoji
      </h2>

      <input
        className="input mt-3"
        placeholder="Buscar categoria (ex.: comida, animais)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!q && (
        <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              title={c.label}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xl transition-colors ${
                cat === c.id ? "bg-white/15" : "hover:bg-white/10"
              }`}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}

      {!q && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {active.label}
        </p>
      )}

      <div className="mt-2 grid max-h-[46vh] grid-cols-8 gap-1 overflow-y-auto text-2xl">
        {emojis.map((e, i) => (
          <button
            key={`${e}-${i}`}
            onClick={() => onPick(e)}
            className="grid aspect-square place-items-center rounded-lg hover:bg-white/10"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
