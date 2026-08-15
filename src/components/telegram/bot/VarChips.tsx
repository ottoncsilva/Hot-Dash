"use client";

import type { RefObject } from "react";

/**
 * Chips clicáveis que INSEREM a variável na posição do cursor.
 *
 * Antes as variáveis só existiam como texto de ajuda ("use {nome}") embaixo do
 * campo — dava para digitar `{Nome}`, `{ nome }` ou esquecer a chave e só
 * descobrir o erro quando o lead recebia a mensagem com o marcador cru. Clicar
 * insere exatamente a forma que o servidor troca.
 */
export default function VarChips({
  vars,
  targetRef,
  onChange,
}: {
  /** Pares [marcador, o que ele vira]. O segundo é só a dica do title. */
  vars: [string, string][];
  targetRef: RefObject<HTMLTextAreaElement | HTMLInputElement>;
  onChange: (next: string) => void;
}) {
  function insert(token: string) {
    const el = targetRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    onChange(next);
    // Devolve o foco com o cursor DEPOIS do marcador inserido, para continuar
    // escrevendo — sem isso o cursor voltava para o começo do campo.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-zinc-500">Variáveis (clique para inserir):</span>
      {vars.map(([token, hint]) => (
        <button
          key={token}
          type="button"
          title={hint}
          onClick={() => insert(token)}
          className="rounded-md border border-white/10 bg-ink-850 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
        >
          {token}
        </button>
      ))}
    </div>
  );
}
