"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RE_CITACAO, TOKEN_COPIA, tokenReferencia } from "@/lib/aiMediaOptions";
import { CitacoesPintadas } from "@/components/TextoComCitacoes";

/**
 * Campo de prompt com CITAÇÃO DE IMAGEM: digite "@" e escolha uma das fotos
 * que já estão na tela.
 *
 * O marcador entra LEGÍVEL no texto ("@referência 2", "@imagem a copiar") e
 * aparece PINTADO, para o operador achar as citações de olho no meio de um
 * prompt de várias páginas.
 *
 * A pintura é feita por uma camada atrás do textarea, com o mesmo texto e a
 * mesma tipografia: o textarea fica com a letra transparente e só o cursor
 * visível. É o jeito de ter cor dentro de um campo de texto comum — textarea
 * não aceita marcação por dentro, e trocar por um editor rico quebraria
 * colar, desfazer e o corretor do navegador.
 */

export type FotoCitavel = {
  /** O marcador que este item insere, já pronto. */
  token: string;
  rotulo: string;
  thumbUrl?: string;
  ehCopia?: boolean;
};

/** Monta a lista de citáveis a partir do que está escolhido na tela. */
export function montarCitaveis(
  referenciaIds: string[],
  thumbDe: (id: string) => string | undefined,
  copiaPreview?: string | null,
): FotoCitavel[] {
  return [
    ...referenciaIds.map((id, i) => ({
      token: tokenReferencia(i + 1),
      rotulo: `referência ${i + 1}`,
      thumbUrl: thumbDe(id),
    })),
    ...(copiaPreview
      ? [{ token: TOKEN_COPIA, rotulo: "imagem a copiar", thumbUrl: copiaPreview, ehCopia: true }]
      : []),
  ];
}

export default function PromptComFotos({
  value,
  onChange,
  fotos,
  className,
  placeholder,
  padrao = RE_CITACAO,
}: {
  value: string;
  onChange: (v: string) => void;
  fotos: FotoCitavel[];
  className?: string;
  placeholder?: string;
  /** O que pintar. O gerador de vídeo passa as variáveis dele. */
  padrao?: RegExp;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const pinturaRef = useRef<HTMLDivElement>(null);
  /** Onde o cursor deve ficar depois que o valor novo chegar do pai. */
  const cursorPendente = useRef<number | null>(null);
  const [aberto, setAberto] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [inicio, setInicio] = useState(0);

  const visiveis = fotos.filter((f) =>
    filtro ? f.rotulo.toLowerCase().includes(filtro.toLowerCase()) : true,
  );

  /**
   * Devolve o cursor para depois do marcador — DEPOIS que o React aplicou o
   * valor novo. Fazer isso antes (ou num rAF) não funciona: o valor ainda é o
   * antigo, o navegador joga o cursor para o fim/começo e o campo rola para o
   * topo, fazendo o operador perder o lugar no meio de um prompt longo.
   */
  useLayoutEffect(() => {
    const pos = cursorPendente.current;
    if (pos === null) return;
    cursorPendente.current = null;
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(pos, pos);
  }, [value]);

  // A camada pintada tem que rolar junto com o texto.
  useEffect(() => {
    const area = areaRef.current;
    const pintura = pinturaRef.current;
    if (!area || !pintura) return;
    const sincronizar = () => {
      pintura.scrollTop = area.scrollTop;
      pintura.scrollLeft = area.scrollLeft;
    };
    sincronizar();
    area.addEventListener("scroll", sincronizar);
    return () => area.removeEventListener("scroll", sincronizar);
  }, [value]);

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
    // "@" recente sem espaço depois abre a lista.
    const m = /@([^\s@]*)$/.exec(antes);
    if (m && fotos.length > 0) {
      setInicio(cursor - m[0].length);
      setFiltro(m[1]);
      setAberto(true);
    } else {
      setAberto(false);
    }
  }

  function escolher(foto: FotoCitavel) {
    const cursor = areaRef.current?.selectionStart ?? value.length;
    const novo = `${value.slice(0, inicio)}${foto.token} ${value.slice(cursor)}`;
    cursorPendente.current = inicio + foto.token.length + 1;
    onChange(novo);
    setAberto(false);
  }

  // Mesma tipografia nas duas camadas, senão o texto pintado sai fora de
  // registro com o que o operador digitou.
  const base = `${className || ""} whitespace-pre-wrap break-words`;

  return (
    <div className="relative">
      <div
        ref={pinturaRef}
        aria-hidden
        className={`${base} pointer-events-none absolute inset-0 overflow-hidden`}
      >
        <CitacoesPintadas texto={value} padrao={padrao} />
        {/* Um espaço no fim para a última linha vazia contar na altura. */}
        {"​"}
      </div>

      <textarea
        ref={areaRef}
        className={`${base} relative bg-transparent`}
        style={{ color: "transparent", caretColor: "#fff" }}
        placeholder={placeholder}
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
        <div className="absolute z-30 mt-1 max-h-[240px] w-full max-w-[320px] overflow-y-auto rounded-xl border border-white/15 bg-ink-850 p-1 shadow-xl">
          <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
            citar imagem
          </p>
          {visiveis.map((f) => (
            <button
              key={f.token}
              type="button"
              onClick={() => escolher(f)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10"
            >
              {/* Sem miniatura quando o item é variável de texto (o gerador de
                  vídeo), em vez de um quadrado com "?" que não diz nada. */}
              {f.thumbUrl && (
                <img src={f.thumbUrl} alt="" className="h-9 w-7 rounded object-cover" />
              )}
              <span className={`text-xs ${f.ehCopia ? "text-sky-300" : "text-zinc-300"}`}>
                {f.rotulo}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
