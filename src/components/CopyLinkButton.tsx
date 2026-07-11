"use client";

import { useState } from "react";
import { apiSend } from "@/lib/api";
import { IconLink } from "@/components/icons";

/**
 * Copia o link PÚBLICO (sem login) do arquivo de mídia — para usar em
 * automações externas (Make, n8n). Gera o token na primeira vez; depois
 * disso o link é sempre o mesmo.
 */
export default function CopyLinkButton({
  mediaId,
  publicToken,
  iconOnly,
  className,
}: {
  mediaId: string;
  publicToken?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      let token = publicToken;
      if (!token) {
        const data = await apiSend<{ token: string }>(
          `/api/media/${mediaId}/public-link`,
          "POST",
        );
        token = data.token;
      }
      const url = `${window.location.origin}/api/public/media/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silencioso: usuário pode tentar de novo */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={className}
      aria-label="Copiar link público"
      title="Copiar link público (Make/n8n)"
    >
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4 10-10"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <IconLink size={16} />
      )}
      {!iconOnly && (copied ? "Copiado!" : "Copiar link")}
    </button>
  );
}
