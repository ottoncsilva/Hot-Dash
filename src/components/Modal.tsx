"use client";

import { useEffect } from "react";

/** Modal monocromático simples e reutilizável. */
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`card w-full ${maxWidth} animate-fade-in bg-ink-900 p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
