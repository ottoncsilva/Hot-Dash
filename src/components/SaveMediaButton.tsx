"use client";

import { useState } from "react";
import { IconDownload } from "@/components/icons";

type Props = {
  url: string;
  filename: string;
  mime?: string;
  className?: string;
  label?: string;
  iconOnly?: boolean;
  iconSize?: number;
};

/**
 * Botão de salvar mídia. No iPhone/iPad, usa a Web Share API para abrir a
 * folha nativa de compartilhamento — que tem "Salvar Imagem"/"Salvar Vídeo",
 * indo direto para o app Fotos (não para Arquivos). Em navegadores sem
 * suporte, cai no download comum.
 */
export default function SaveMediaButton({
  url,
  filename,
  mime,
  className,
  label = "Salvar no dispositivo",
  iconOnly = false,
  iconSize = 16,
}: Props) {
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (!nav.share || !nav.canShare) return; // deixa o <a> normal agir (fallback)

    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], filename, {
        type: mime || blob.type || "application/octet-stream",
      });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file] });
      } else {
        // Dispositivo não aceita compartilhar este arquivo: baixa normalmente.
        triggerDownload(url, filename);
      }
    } catch (err) {
      // Usuário cancelou a folha de compartilhamento, ou falhou: tenta o download comum.
      if ((err as Error)?.name !== "AbortError") {
        triggerDownload(url, filename);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <a
      href={url}
      download={filename}
      onClick={handleClick}
      className={className}
      aria-label={label}
      title={label}
    >
      <IconDownload size={iconSize} />
      {!iconOnly && (busy ? "Preparando..." : label)}
    </a>
  );
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
