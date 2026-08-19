"use client";

import { useEffect, useRef, useState } from "react";
import { ID_COPIA } from "@/lib/aiMediaOptions";

/**
 * Campo de prompt com CITAÇÃO DE IMAGEM: digite "@" e escolha uma das fotos
 * que já estão na tela.
 *
 * O marcador inserido (`@[foto:id]`) guarda a IDENTIDADE da imagem, não a
 * posição dela. É de propósito: acrescentar ou tirar uma referência depois
 * não invalida o texto — a posição ("a 3ª imagem de referência") só é
 * calculada na hora de enviar, por resolverFotos().
 *
 * Existe porque o Seedream recebe as imagens numa lista sem rótulo: a única
 * forma de dizer "essa aqui" é apontar a posição no texto, e fazer isso na
 * mão dá errado toda vez que a lista muda.
 */

export type FotoCitavel = {
  /** Id da mídia na Galeria, ou ID_COPIA para a imagem a copiar. */
  id: string;
  rotulo: string;
  /** Miniatura para o operador reconhecer a foto de olho. */
  thumbUrl?: string;
};

export default function PromptComFotos({
  value,
  onChange,
  fotos,
  className,
  placeholder,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  fotos: FotoCitavel[];
  className?: string;
  placeholder?: string;
  rows?: number;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [aberto, setAberto] = useState(false);
  const [filtro, setFiltro] = useState("");
  /** Onde começou o "@" que está sendo digitado. */
  const [inicio, setInicio] = useState(0);

  const visiveis = fotos.filter((f) =>
    filtro ? f.rotulo.toLowerCase().includes(filtro.toLowerCase()) : true,
  );

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => {
      if (!areaRef.current?.parentElement?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, [aberto]);

  function aoDigitar(texto: string) {
    onChange(texto);
    const cursor = areaRef.current?.selectionStart ?? texto.length;
    const antes = texto.slice(0, cursor);
    // Um "@" recente, sem espaço depois dele, abre a lista. O marcador já
    // pronto (`@[foto:…]`) não conta — senão reabriria a cada edição.
    const m = /@([^\s@\[\]]*)$/.exec(antes);
    if (m && fotos.length > 0) {
      setInicio(cursor - m[0].length);
      setFiltro(m[1]);
      setAberto(true);
    } else {
      setAberto(false);
    }
  }

  function escolher(foto: FotoCitavel) {
    const area = areaRef.current;
    const cursor = area?.selectionStart ?? value.length;
    const novo = `${value.slice(0, inicio)}@[foto:${foto.id}]${value.slice(cursor)}`;
    onChange(novo);
    setAberto(false);
    // Devolve o cursor para depois do marcador, para seguir escrevendo.
    requestAnimationFrame(() => {
      const pos = inicio + `@[foto:${foto.id}]`.length;
      area?.focus();
      area?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={areaRef}
        className={className}
        placeholder={placeholder}
        rows={rows}
        value={value}
        onChange={(e) => aoDigitar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && aberto) {
            e.preventDefault();
            setAberto(false);
          }
        }}
      />

      {aberto && visiveis.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-[240px] w-full max-w-[340px] overflow-y-auto rounded-xl border border-white/15 bg-ink-850 p-1 shadow-xl">
          <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
            citar imagem
          </p>
          {visiveis.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => escolher(f)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10"
            >
              {f.thumbUrl ? (
                <img src={f.thumbUrl} alt="" className="h-9 w-7 rounded object-cover" />
              ) : (
                <span className="grid h-9 w-7 place-items-center rounded bg-white/10 text-[9px] text-zinc-400">
                  ?
                </span>
              )}
              <span
                className={`text-xs ${f.id === ID_COPIA ? "text-sky-300" : "text-zinc-300"}`}
              >
                {f.rotulo}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
