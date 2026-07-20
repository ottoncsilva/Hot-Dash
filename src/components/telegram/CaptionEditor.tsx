"use client";
import { useRef, useState } from "react";

/** Escapa caracteres especiais de HTML (o envio ao Telegram usa parse_mode HTML). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
