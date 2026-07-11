"use client";

import { useCallback, useRef, useState } from "react";
import Modal from "@/components/Modal";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  /** false = ação neutra (botão branco); true (padrão) = ação destrutiva (botão vermelho). */
  danger?: boolean;
};

/**
 * Popup de confirmação no estilo do app, no lugar do window.confirm() nativo
 * do navegador. Uso: `if (!(await confirm("Excluir X?"))) return;`
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const options = typeof opts === "string" ? { message: opts } : opts;
    setState(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function handle(result: boolean) {
    setState(null);
    resolver.current?.(result);
    resolver.current = null;
  }

  const ConfirmDialog = (
    <Modal open={state !== null} onClose={() => handle(false)} maxWidth="max-w-sm">
      {state && (
        <div>
          <p className="eyebrow">confirmar</p>
          <h2 className="mt-1.5 font-display text-lg font-semibold">
            {state.title || "Tem certeza?"}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">{state.message}</p>
          <div className="mt-5 flex gap-3">
            <button onClick={() => handle(false)} className="btn-ghost flex-1">
              Cancelar
            </button>
            <button
              onClick={() => handle(true)}
              className={state.danger === false ? "btn-primary flex-1" : "btn-danger flex-1"}
            >
              {state.confirmLabel || "Excluir"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );

  return { confirm, ConfirmDialog };
}
