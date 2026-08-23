"use client";

import Link from "next/link";
import { IconChevronDown, IconChevronUp } from "@/components/icons";

export type NavSubItem = { label: string; href: string };

/**
 * Item de menu que abre submenu dentro da própria barra.
 *
 * Existia como um bloco `if (key === …)` repetido dentro do layout, uma vez
 * para o desktop e outra para o menu do celular — três grupos viravam seis
 * cópias do mesmo JSX, e cada grupo novo somava mais duas. O que muda entre os
 * dois lugares é só o espaçamento vertical e o fechar o menu ao navegar.
 */
export default function NavGroup({
  label,
  icon,
  items,
  open,
  onToggle,
  active,
  pathname,
  compact,
  onNavigate,
}: {
  label: string;
  icon: React.ReactNode;
  items: NavSubItem[];
  open: boolean;
  onToggle: () => void;
  /** O grupo inteiro está na tela aberta (destaca o cabeçalho). */
  active: boolean;
  pathname: string;
  /** `true` na sidebar do desktop; o menu do celular usa alvos maiores. */
  compact?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div>
      {/* A estrutura copia a do item simples do menu — ícone, rótulo, na mesma
          ordem e com o mesmo gap — mais a seta no fim. O `text-left` não é
          detalhe: <button> vem com text-align:center do navegador, e era isso
          que jogava os rótulos com submenu para o meio enquanto os itens
          simples, que são <a>, ficavam à esquerda. */}
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors ${
          compact ? "py-2" : "py-2.5"
        } ${
          active
            ? "bg-white/10 text-white shadow-[inset_2px_0_0_0_#ffffff]"
            : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
        }`}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">{label}</span>
        <span className="shrink-0">
          {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </span>
      </button>
      {open && (
        <div className="mt-1 flex flex-col border-l border-white/10 pl-4">
          {items.map((sub) => (
            <Link
              key={sub.href}
              href={sub.href}
              onClick={onNavigate}
              className={`px-3 text-xs transition-colors ${compact ? "py-1.5" : "py-2"} ${
                pathname === sub.href ? "text-white" : "text-zinc-500 hover:text-white"
              }`}
            >
              {sub.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
