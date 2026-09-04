"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Modal monocromático reutilizável.
 * Renderizado via portal em document.body: evita ficar "preso" dentro de
 * ancestrais com transform/animação (que criam um containing block para
 * position:fixed e quebrariam o overlay em tela cheia).
 *
 * Acessibilidade: role="dialog" + aria-modal, foco levado para dentro ao
 * abrir, preso enquanto aberto (Tab/Shift+Tab circulam), e devolvido ao
 * elemento de origem ao fechar.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Modal({
  open,
  onClose,
  children,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        : [];

    // Leva o foco para o primeiro elemento interativo (ou o próprio diálogo).
    const first = focusables()[0];
    (first || dialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      /* `items-start` + `my-auto` no diálogo, e não `items-center`.
         Um item CENTRALIZADO mais alto que a tela transborda para os dois
         lados, e a rolagem não alcança o que sobra em cima — o topo fica
         inacessível. Era o que acontecia com a correção de uma cobrança que
         tem relatório do Canal de Vendas: a janela abria já no meio, sem
         título, com o começo escondido atrás da barra de status. Alinhado no
         topo, a rolagem chega ao fim dos dois lados, e o `my-auto` mantém a
         centralização de sempre para a janela que cabe na tela.

         O respiro acompanha a área segura: sem isso a janela alta encosta no
         notch em cima e na barra de gestos embaixo. */
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/70 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-sm sm:px-4 sm:pb-4 sm:pt-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`card my-auto w-full ${maxWidth} animate-fade-in bg-ink-850 p-5 outline-none sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
