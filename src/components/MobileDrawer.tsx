"use client";

import { useEffect, useRef } from "react";

/** Largura da faixa, na borda esquerda, que inicia o gesto de abrir. */
const EDGE_ZONE = 30;
/** Fração da largura do painel que confirma abrir/fechar ao soltar o dedo. */
const COMMIT_RATIO = 0.35;
/** Velocidade (px/ms) que confirma o gesto mesmo sem arrastar até o limite. */
const FLING_SPEED = 0.4;

/**
 * Menu lateral TEMPORÁRIO do mobile.
 *
 * Antes o menu era um overlay de tela cheia (`fixed inset-0`), que tomava a tela
 * inteira. Aqui ele é um painel estreito que desliza por cima do conteúdo, com
 * um véu (scrim) atrás: some por completo quando fechado, sem ocupar espaço
 * horizontal nem vertical.
 *
 * Gestos: arrastar da borda esquerda para dentro abre; arrastar para a esquerda
 * fecha. O painel acompanha o dedo em tempo real e completa a animação ao soltar.
 */
export default function MobileDrawer({
  open,
  onOpenChange,
  children,
  className = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // Trava a rolagem do fundo enquanto o menu está aberto (senão o conteúdo
  // "corre" atrás do painel no iOS).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc fecha (teclado físico / iPad com teclado).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // ---- Gestos de arrastar (abrir da borda / fechar para a esquerda) ----
  useEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;

    // Só habilita o gesto onde o drawer existe (abaixo de lg). Em telas grandes
    // a barra lateral é fixa e arrastar não deve fazer nada.
    const mq = window.matchMedia("(min-width: 1024px)");

    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let dragging = false; // gesto horizontal confirmado
    let decided = false; // já decidimos se é horizontal ou vertical
    let fromEdge = false; // começou na borda (abrindo)

    const width = () => panel.offsetWidth || 320;

    /** Aplica a posição do painel (0 = aberto, -largura = fechado). */
    function paint(x: number, animate: boolean) {
      if (!panel || !scrim) return;
      const w = width();
      const clamped = Math.max(-w, Math.min(0, x));
      panel.style.transition = animate ? "transform 220ms cubic-bezier(0.4,0,0.2,1)" : "none";
      panel.style.transform = `translate3d(${clamped}px,0,0)`;
      // O véu escurece conforme o painel entra.
      const p = 1 + clamped / w; // 0 fechado, 1 aberto
      scrim.style.transition = animate ? "opacity 220ms ease" : "none";
      scrim.style.opacity = String(p);
      scrim.style.pointerEvents = p > 0.05 ? "auto" : "none";
    }

    /** Devolve o controle ao CSS (classes) depois da animação. */
    function release() {
      if (!panel || !scrim) return;
      panel.style.transition = "";
      panel.style.transform = "";
      scrim.style.transition = "";
      scrim.style.opacity = "";
      scrim.style.pointerEvents = "";
    }

    function onTouchStart(e: TouchEvent) {
      if (mq.matches || e.touches.length !== 1) return;
      const t = e.touches[0];
      // Abrindo: precisa começar na borda esquerda. Fechando: em qualquer ponto.
      fromEdge = t.clientX <= EDGE_ZONE;
      if (!openRef.current && !fromEdge) return;
      startX = t.clientX;
      startY = t.clientY;
      startedAt = Date.now();
      decided = false;
      dragging = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (mq.matches || (!openRef.current && !fromEdge) || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!decided) {
        // Espera um movimento mínimo para saber a intenção; se for vertical,
        // desiste e deixa a página rolar normalmente.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = true;
        dragging = Math.abs(dx) > Math.abs(dy);
        if (!dragging) return;
      }
      if (!dragging) return;

      // Impede a página de rolar/dar "bounce" durante o arrasto horizontal.
      if (e.cancelable) e.preventDefault();
      const w = width();
      paint(openRef.current ? dx : -w + dx, false);
    }

    function onTouchEnd(e: TouchEvent) {
      if (!dragging) {
        decided = false;
        return;
      }
      dragging = false;
      decided = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const w = width();
      const speed = Math.abs(dx) / Math.max(1, Date.now() - startedAt);

      let next: boolean;
      if (openRef.current) {
        // Estava aberto: fecha se arrastou o bastante para a esquerda.
        next = !(dx < -w * COMMIT_RATIO || (dx < -10 && speed > FLING_SPEED));
      } else {
        // Estava fechado: abre se arrastou o bastante para a direita.
        next = dx > w * COMMIT_RATIO || (dx > 10 && speed > FLING_SPEED);
      }

      paint(next ? 0 : -w, true);
      // Sincroniza o estado do React e devolve o controle ao CSS.
      window.setTimeout(() => {
        release();
        if (next !== openRef.current) onOpenChange(next);
      }, 220);
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onOpenChange]);

  return (
    <>
      {/* Véu: escurece o conteúdo e fecha ao toque. Sem `hidden`, para poder
          animar a opacidade; quando fechado fica invisível e sem cliques. */}
      <div
        ref={scrimRef}
        onClick={() => onOpenChange(false)}
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Painel deslizante. Fora da tela quando fechado (não ocupa espaço). */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-[82%] max-w-[320px] flex-col overscroll-contain border-r border-white/[0.06] bg-ink-950 shadow-2xl transition-transform duration-200 ease-out will-change-transform lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${className}`}
      >
        {children}
      </aside>
    </>
  );
}
