"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pull to refresh (mobile). Quando a página está no topo e o usuário puxa
 * para baixo além do limite, recarrega a página inteira (window.location.reload).
 * Ativa só em telas pequenas (< md) e com toque; no desktop não interfere.
 */
const THRESHOLD = 70; // px para disparar o refresh
const MAX_PULL = 120; // limite visual do arraste

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);

  useEffect(() => {
    const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

    const atTop = () =>
      (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile() || refreshing || !atTop()) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
      active.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        // rolando para cima: cancela
        if (active.current) setPull(0);
        active.current = false;
        return;
      }
      if (!atTop()) return;
      active.current = true;
      // resistência: quanto mais puxa, mais "pesado" fica
      const resisted = Math.min(MAX_PULL, delta * 0.5);
      setPull(resisted);
      // impede o bounce/scroll nativo enquanto puxamos
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (active.current && pull >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        window.location.reload();
      } else {
        setPull(0);
      }
      active.current = false;
    };

    // passive:false para poder chamar preventDefault no move
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pull, refreshing]);

  const progress = Math.min(1, pull / THRESHOLD);
  const ready = pull >= THRESHOLD;

  return (
    <>
      {/* Indicador do gesto — some no desktop pois pull nunca sai de 0 lá */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center md:hidden"
        style={{
          transform: `translateY(${pull - 44}px)`,
          opacity: pull > 4 || refreshing ? 1 : 0,
          transition: startY.current === null ? "transform 0.2s ease, opacity 0.2s ease" : "none",
        }}
      >
        <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-ink-950/90 shadow-lg backdrop-blur">
          <svg
            className={`h-5 w-5 text-sky-400 ${refreshing ? "animate-spin" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
          >
            {refreshing ? (
              <circle cx="12" cy="12" r="9" strokeWidth="2" strokeDasharray="42" strokeLinecap="round" />
            ) : (
              <>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeWidth="2" strokeLinecap="round" />
                <path d="M21 3v6h-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}
          </svg>
        </div>
      </div>

      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: startY.current === null ? "transform 0.2s ease" : "none",
        }}
      >
        {children}
      </div>
    </>
  );
}
