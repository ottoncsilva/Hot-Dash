"use client";
import { useRef, useState, Fragment, type ReactNode } from "react";

/** Escapa caracteres especiais de HTML (o envio ao Telegram usa parse_mode HTML). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Desescapa as entidades HTML básicas para exibir o texto "cru". */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/**
 * Converte uma legenda com hiperlinks `<a href="url">texto</a>` em nós React,
 * exibindo os links como clicáveis e o restante como texto (quebras de linha
 * preservadas via CSS). SOMENTE a tag <a> é interpretada — nenhum outro HTML é
 * renderizado, então não há risco de XSS (não usa dangerouslySetInnerHTML).
 */
export function renderCaptionWithLinks(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gis;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<Fragment key={key++}>{decodeEntities(text.slice(last, m.index))}</Fragment>);
    }
    nodes.push(
      <a
        key={key++}
        href={decodeEntities(m[1])}
        target="_blank"
        rel="noreferrer"
        className="text-[#3390ec] underline"
      >
        {decodeEntities(m[2])}
      </a>,
    );
    last = regex.lastIndex;
  }
  if (last < text.length) {
    nodes.push(<Fragment key={key++}>{decodeEntities(text.slice(last))}</Fragment>);
  }
  return nodes;
}

/** Prévia da legenda com os hiperlinks já clicáveis (o painel não mostra o HTML cru). */
export function CaptionPreview({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`whitespace-pre-wrap break-words ${className}`}>{renderCaptionWithLinks(text)}</div>;
}

/** Texto puro da legenda para exibição compacta (listas): remove as tags <a>,
 *  mantendo apenas o texto clicável, e desescapa as entidades. */
export function captionPlainText(text: string): string {
  const withoutLinks = text.replace(/<a\s+href="[^"]*"[^>]*>(.*?)<\/a>/gis, "$1");
  return decodeEntities(withoutLinks);
}

/**
 * Editor de legenda com um botão "Inserir link": o usuário digita o texto
 * clicável e a URL, e é inserido um hiperlink HTML (<a href>) na posição do
 * cursor. Como o Telegram envia com parse_mode HTML, o texto vira um link
 * clicável no post (em vez de mostrar a URL crua). Reutilizado na
 * pré-visualização rápida e no formulário completo de postagem.
 */
export default function CaptionEditor({
  value,
  onChange,
  placeholder,
  textAreaClassName = "input min-h-[110px]",
  rootClassName = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textAreaClassName?: string;
  rootClassName?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  function insertLink() {
    const url = linkUrl.trim();
    if (!url) return;
    const text = linkText.trim() || url;
    const safeUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const html = `<a href="${safeUrl}">${esc(text)}</a>`;

    const ta = ref.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + html + value.slice(end);
    onChange(next);

    setOpen(false);
    setLinkText("");
    setLinkUrl("");
    // Reposiciona o cursor logo após o link inserido.
    requestAnimationFrame(() => {
      const pos = start + html.length;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    });
  }

  return (
    <div className={`flex min-h-0 flex-col gap-1.5 ${rootClassName}`}>
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          🔗 Inserir link
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/30 p-2">
          <input
            className="w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-[#3390ec]"
            placeholder="Texto clicável (ex: ACESSAR O VIP 🎁)"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
          />
          <input
            className="w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:ring-1 focus:ring-[#3390ec]"
            placeholder="URL (ex: https://t.me/seubot)"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insertLink();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2 py-1 text-xs text-zinc-400 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={insertLink}
              className="rounded-md bg-[#3390ec] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2f84d9]"
            >
              Inserir
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={ref}
        className={textAreaClassName}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
