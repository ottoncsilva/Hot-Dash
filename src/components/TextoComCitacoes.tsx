"use client";

import type { ReactNode } from "react";

/**
 * Pinta as citações (@) dentro de um texto.
 *
 * Serve tanto ao campo editável (por baixo do textarea) quanto à exibição do
 * prompt já salvo — o destaque tem que ser o mesmo nos dois, senão o operador
 * perde de vista onde estão as citações justamente quando só está conferindo.
 */
export function pedacosCitados(
  texto: string,
  padrao: RegExp,
): { txt: string; marcado: boolean }[] {
  const saida: { txt: string; marcado: boolean }[] = [];
  let ultimo = 0;
  // `matchAll` exige a flag global; recria para não depender do lastIndex de
  // um regex compartilhado entre chamadas.
  const re = new RegExp(padrao.source, padrao.flags.includes("g") ? padrao.flags : `${padrao.flags}g`);
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > ultimo) saida.push({ txt: texto.slice(ultimo, i), marcado: false });
    saida.push({ txt: m[0], marcado: true });
    ultimo = i + m[0].length;
  }
  saida.push({ txt: texto.slice(ultimo), marcado: false });
  return saida;
}

export function CitacoesPintadas({ texto, padrao }: { texto: string; padrao: RegExp }): ReactNode {
  return pedacosCitados(texto, padrao).map((p, i) =>
    p.marcado ? (
      <mark key={i} className="rounded bg-emerald-500/25 px-0.5 text-emerald-200">
        {p.txt}
      </mark>
    ) : (
      <span key={i}>{p.txt}</span>
    ),
  );
}
