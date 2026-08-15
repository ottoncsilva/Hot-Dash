"use client";

import type { RefObject } from "react";

/**
 * Barra de formatação do texto do Telegram.
 *
 * O Telegram recebe as mensagens em HTML (é o `parse_mode` que usamos em todo
 * o envio), então cada botão envolve a seleção na etiqueta correspondente. Sem
 * isto, negrito significava decorar `<b>...</b>` e digitar à mão — e uma
 * etiqueta mal fechada faz o Telegram RECUSAR a mensagem inteira, não só
 * ignorar o formato.
 *
 * `tg-spoiler` é o borrão de spoiler: o texto chega coberto e o leitor toca
 * para revelar.
 */
const BOTOES: { label: string; tag: string; title: string; className?: string }[] = [
  { label: "B", tag: "b", title: "Negrito", className: "font-bold" },
  { label: "I", tag: "i", title: "Itálico", className: "italic" },
  { label: "U", tag: "u", title: "Sublinhado", className: "underline" },
  { label: "S", tag: "s", title: "Riscado", className: "line-through" },
  { label: "</>", tag: "code", title: "Monoespaçado", className: "font-mono text-[10px]" },
  { label: "spoiler", tag: "tg-spoiler", title: "Esconde o texto até tocarem nele" },
  { label: "“", tag: "blockquote", title: "Citação" },
];

export default function FormatToolbar({
  targetRef,
  onChange,
}: {
  targetRef: RefObject<HTMLTextAreaElement>;
  onChange: (next: string) => void;
}) {
  function wrap(tag: string) {
    const el = targetRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const selecionado = el.value.slice(start, end);
    const abre = `<${tag}>`;
    const fecha = `</${tag}>`;
    const next = el.value.slice(0, start) + abre + selecionado + fecha + el.value.slice(end);
    onChange(next);
    // Sem seleção, deixa o cursor ENTRE as etiquetas para já digitar dentro;
    // com seleção, mantém o trecho marcado para poder aplicar outro formato.
    requestAnimationFrame(() => {
      el.focus();
      if (selecionado) {
        el.setSelectionRange(start + abre.length, start + abre.length + selecionado.length);
      } else {
        const pos = start + abre.length;
        el.setSelectionRange(pos, pos);
      }
    });
  }

  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {BOTOES.map((b) => (
        <button
          key={b.tag}
          type="button"
          title={b.title}
          onClick={() => wrap(b.tag)}
          className={`min-w-[28px] rounded-md border border-white/10 bg-ink-850 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 ${b.className || ""}`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
