"use client";

import { useEffect, useRef, useState } from "react";
import { IconSearch } from "@/components/icons";

/**
 * A BUSCA como lupa, que vira campo ao clicar — a mesma da barra lateral,
 * agora em toda tela que filtra por texto.
 *
 * Um campo de busca aberto o tempo todo cobra a largura dele em toda visita,
 * e quem filtra por texto é a minoria das visitas. Numa fila de filtros era
 * ele que estourava a linha: no tablet, o Financeiro espremia os cinco
 * seletores até saírem "Bot: todo", "Métc" e "Geração (m".
 *
 * Fica aberto enquanto houver termo digitado, mesmo sem foco: filtro ligado
 * escondido atrás de um ícone é filtro que ninguém lembra que ligou, e a
 * lista apareceria cortada sem explicação na tela.
 */
export default function BuscaRecolhivel({
  valor,
  onChange,
  placeholder = "Buscar...",
  classeCampo = "w-full sm:w-44",
  className = "",
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Largura do campo ABERTO. */
  classeCampo?: string;
  /** Classe do envoltório, para encaixar na fila de cada tela. */
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const mostrarCampo = aberta || Boolean(valor);

  // Termo limpo POR FORA (a tela zerando o filtro) recolhe a lupa de volta.
  // Sem isto o campo ficava aberto e vazio depois. Só quando ele não está com
  // o foco: quem está digitando e apagou tudo continua digitando.
  useEffect(() => {
    if (!valor && document.activeElement !== ref.current) setAberta(false);
  }, [valor]);

  if (!mostrarCampo) {
    return (
      <button
        type="button"
        onClick={() => {
          setAberta(true);
          // Depois do campo existir no DOM.
          setTimeout(() => ref.current?.focus(), 0);
        }}
        aria-label="Buscar"
        aria-expanded={false}
        title={placeholder}
        className={`grid h-9 w-9 shrink-0 place-items-center text-zinc-400 transition-colors hover:text-white ${className}`}
      >
        <IconSearch size={16} />
      </button>
    );
  }

  return (
    <input
      ref={ref}
      type="text"
      className={`input py-1.5 text-xs ${classeCampo} ${className}`}
      placeholder={placeholder}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      // Sai vazia, recolhe. Com termo digitado continua aberta, mostrando o
      // que está filtrando.
      onBlur={() => !valor && setAberta(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onChange("");
          setAberta(false);
        }
      }}
    />
  );
}
