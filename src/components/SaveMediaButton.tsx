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
    // Sem Web Share: deixa o <a target="_blank"> abrir o arquivo em NOVA aba
    // (o app não é substituído). No iOS, navegar a própria página para um
    // vídeo abre o preview "abrir com…" e TRAVA o app até fechar/reabrir.
    if (!nav.share || !nav.canShare) return;

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

/** Abre o arquivo numa nova aba/janela — NUNCA navega a página atual, para
 *  não trocar o app pela tela de preview do iOS (que trava até reabrir). */
function openInNewTab(url: string) {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  // Se o popup for bloqueado, o usuário ainda pode usar o botão de novo; não
  // caímos para navegação na mesma aba (que era o que travava).
  if (w) w.opener = null;
}
