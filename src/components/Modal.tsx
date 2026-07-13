"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Modal monocromático simples e reutilizável.
 * Renderizado via portal em document.body: evita ficar "preso" dentro de
 * ancestrais com transform/animação (que criam um containing block para
 * position:fixed e quebrariam o overlay em tela cheia).
 */
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
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`card w-full ${maxWidth} animate-fade-in bg-ink-900 p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
