"use client";

import Link from "next/link";
import { useState, useEffect as import_react_useEffect } from "react";
import { apiSend } from "@/lib/api";
import { IconArrowLeft } from "@/components/icons";

/** Botão "Testar conexão" + luz de status (usado por SyncPay e por cada provedor de IA). */
export function ConnectionBadge({
  testUrl,
  buildBody,
  autoTest,
  enabled,
}: {
  testUrl: string;
  buildBody: () => Record<string, unknown>;
  autoTest?: boolean;
  enabled?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "testing" | "connected" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  import_react_useEffect(() => {
    if (autoTest && enabled && status === "idle") {
      test();
    }
  }, [autoTest, enabled]);

  async function test() {
    setStatus("testing");
    setMessage(null);
    try {
      const res = await apiSend<{ connected: boolean; message?: string }>(testUrl, "POST", buildBody());
      if (res.connected) {
        setStatus("connected");
      } else {
        setStatus("error");
        setMessage(res.message || "Não foi possível conectar.");
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Falha ao testar.");
    }
  }

  const dotClass =
    status === "connected" ? "bg-emerald-400" : status === "error" ? "bg-red-400" : "bg-zinc-600";
  const textClass =
    status === "connected" ? "text-emerald-400" : status === "error" ? "text-red-400" : "text-zinc-500";
  const label =
    status === "connected"
      ? "Conectado"
      : status === "error"
        ? message || "Falha na conexão"
        : status === "testing"
          ? "Testando..."
          : "Não testado";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">

      <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span className={textClass}>{label}</span>
      </span>
    </div>
  );
}

/** Link de volta para a lista de Configurações, usado no topo de cada sub-rota. */
export function BackToSettings() {
  return (
    <Link
      href="/dashboard/settings"
      className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white"
    >
      <IconArrowLeft size={14} /> Configurações
    </Link>
  );
}
