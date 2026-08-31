"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tabela larga que rola na horizontal no celular, com a máscara avisando que
 * ainda tem coluna do lado.
 *
 * O aviso é ESTADO, não decoração: a máscara some quando a rolagem chega ao
 * fim. Uma sombra fixa na borda mentiria — continuaria dizendo "tem mais" com
 * a última coluna já na tela, e quem confia nela para de rolar cedo demais.
 *
 * Mesmo comportamento da tabela do Financeiro. Está aqui em componente próprio
 * porque agora são duas telas usando: repetir o `useRef` + o cálculo em cada
 * uma é o caminho para as duas divergirem na primeira correção.
 */
export default function TabelaRolante({
  larguraMinima,
  children,
}: {
  /** Largura em px abaixo da qual a tabela rola em vez de espremer as colunas. */
  larguraMinima: number;
  children: React.ReactNode;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [temMaisAoLado, setTemMaisAoLado] = useState(false);

  const verSeAindaRola = useCallback(() => {
    const el = caixa.current;
    if (!el) return;
    setTemMaisAoLado(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Também no redimensionamento: girar o celular pode fazer a tabela caber
  // inteira, e a máscara ficaria acesa sem ter o que esconder.
  useEffect(() => {
    verSeAindaRola();
    window.addEventListener("resize", verSeAindaRola);
    return () => window.removeEventListener("resize", verSeAindaRola);
  }, [verSeAindaRola, children]);

  return (
    <div
      ref={caixa}
      onScroll={verSeAindaRola}
      className={`mt-4 card overflow-x-auto ${
        temMaisAoLado
          ? "[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]"
          : ""
      }`}
    >
      <table
        className="w-full border-collapse text-left text-sm"
        style={{ minWidth: `${larguraMinima}px` }}
      >
        {children}
      </table>
    </div>
  );
}
