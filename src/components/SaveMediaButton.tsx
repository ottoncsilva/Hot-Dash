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
 * Botão de salvar mídia.
 *
 * - Celular/tablet (iOS/Android): usa a Web Share API para abrir a folha nativa
 *   de compartilhamento — que tem "Salvar Imagem"/"Salvar Vídeo", indo direto
 *   para o app Fotos (não para Arquivos).
 * - Desktop: download direto. O Chrome/Edge no Windows também expõem
 *   `navigator.share`, mas ali a folha de compartilhamento do sistema não é o
 *   que o usuário quer — a rota já responde com `Content-Disposition:
 *   attachment`, então um clique em <a download> baixa o arquivo na hora.
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

    // Desktop: baixa direto, sem folha de compartilhamento e sem nova aba.
    if (!isMobileDevice() || !nav.share || !nav.canShare) {
      e.preventDefault();
      downloadDirect(url, filename);
      return;
    }

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
        // Dispositivo não aceita compartilhar este arquivo: abre em nova aba.
        openInNewTab(url);
      }
    } catch (err) {
      // Usuário cancelou a folha de compartilhamento (AbortError): não faz nada.
      // Outra falha: abre em nova aba (sem travar o app).
      if ((err as Error)?.name !== "AbortError") {
        openInNewTab(url);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <a
      href={url}
      download={filename}
      target="_blank"
      rel="noopener noreferrer"
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

/** iPhone/iPad/Android — únicos casos em que a folha de compartilhamento nativa
 *  é o caminho certo (salvar direto no app Fotos/Galeria). O iPad moderno se
 *  identifica como "Macintosh", daí o teste por toque. */
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS em modo desktop: Mac com tela sensível ao toque não existe.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Dispara o download nativo do navegador: a rota manda
 *  `Content-Disposition: attachment`, então o arquivo cai direto na pasta de
 *  downloads, sem abrir aba nem trocar a página atual. */
function downloadDirect(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Abre o arquivo numa nova aba/janela — NUNCA navega a página atual, para
 *  não trocar o app pela tela de preview do iOS (que trava até reabrir). */
function openInNewTab(url: string) {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  // Se o popup for bloqueado, o usuário ainda pode usar o botão de novo; não
  // caímos para navegação na mesma aba (que era o que travava).
  if (w) w.opener = null;
}
