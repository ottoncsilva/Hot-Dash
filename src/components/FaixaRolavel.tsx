"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Quanto do conteúdo some na ponta — o bastante para ler como "tem mais". */
const FADE = "1.75rem";

/**
 * Tira que rola de lado — com a ponta esmaecida avisando que ainda tem coisa.
 *
 * O gráfico de faturamento, a semana do Cronograma e a fila de períodos já
 * rolavam; o que faltava era o aviso. Numa tela sem barra de rolagem visível
 * (todo celular, todo trackpad) o conteúdo cortado no talo parece o fim da
 * página, e ninguém arrasta o que não sabe que existe.
 *
 * O esmaecido é uma MÁSCARA, não um degradê por cima. Um degradê precisaria
 * saber a cor do fundo, e estas tiras aparecem tanto sobre o preto da página
 * quanto sobre o grafite de um card — erraria num dos dois. A máscara apaga o
 * próprio conteúdo, então acerta em qualquer fundo. E só entra do lado em que
 * de fato há mais conteúdo: chegou na ponta, a ponta volta a ficar nítida.
 */
export default function FaixaRolavel({
  children,
  className = "",
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pontas, setPontas] = useState({ esq: false, dir: false });

  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 1px de folga: larguras fracionárias fariam a máscara piscar na ponta.
    const sobraDir = el.scrollWidth - el.clientWidth - el.scrollLeft;
    setPontas((p) => {
      const novo = { esq: el.scrollLeft > 1, dir: sobraDir > 1 };
      return p.esq === novo.esq && p.dir === novo.dir ? p : novo;
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    // O conteúdo muda de largura sozinho — trocar de período redesenha o
    // gráfico —, então observamos o tamanho em vez de medir só na montagem.
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", medir);
      ro.disconnect();
    };
  }, [medir]);

  const mascara =
    pontas.esq || pontas.dir
      ? `linear-gradient(to right, transparent 0, #000 ${pontas.esq ? FADE : "0"}, #000 calc(100% - ${
          pontas.dir ? FADE : "0px"
        }), transparent 100%)`
      : undefined;

  const rola = pontas.esq || pontas.dir;

  return (
    <div
      ref={ref}
      className={`overflow-x-auto ${className}`}
      // Rolável pelo teclado também: sem isso, quem navega por Tab não alcança
      // a parte escondida quando lá dentro não há nada focável. Só vira parada
      // do Tab quando há mesmo o que rolar — no desktop, onde tudo cabe, seria
      // uma parada a mais sem função.
      tabIndex={rola ? 0 : undefined}
      role={rola ? "group" : undefined}
      aria-label={rola ? ariaLabel : undefined}
      style={mascara ? { maskImage: mascara, WebkitMaskImage: mascara } : undefined}
    >
      {children}
    </div>
  );
}
