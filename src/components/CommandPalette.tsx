"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { NAV_ITEMS, type NavKey } from "@/lib/navItems";
import { IconSearch } from "@/components/icons";
import type { Profile } from "@/lib/types";

type Item = { id: string; label: string; group: string; hint?: string; run: () => void };

const NAV_ORDER: NavKey[] = [
  "dashboard", "profiles", "media", "censura", "schedule", "payments", "telegram", "whatsapp", "settings",
];

/**
 * Paleta de comandos global (⌘K / Ctrl+K). Busca modelos, telas e ações
 * rápidas. Montada uma vez no layout do dashboard. Também abre via evento
 * "hotdash:command" (botão Buscar na sidebar).
 */
export default function CommandPalette() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onCustom() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("hotdash:command", onCustom);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hotdash:command", onCustom);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    if (profiles === null) {
      apiGet<{ profiles: Profile[] }>("/api/profiles")
        .then((d) => setProfiles(d.profiles))
        .catch(() => setProfiles([]));
    }
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allItems: Item[] = useMemo(() => {
    const actions: Item[] = [
      { id: "act-new-model", label: "Novo modelo", hint: "criar", group: "Ações", run: () => router.push("/dashboard/profiles?new=1") },
      { id: "act-upload", label: "Enviar mídia", hint: "upload", group: "Ações", run: () => router.push("/dashboard/media") },
      { id: "act-censura", label: "Censurar imagem com IA", hint: "IA", group: "Ações", run: () => router.push("/dashboard/censura") },
    ];
    const nav: Item[] = NAV_ORDER.filter((k) => NAV_ITEMS[k]).map((k) => ({
      id: `nav-${k}`, label: NAV_ITEMS[k].label, group: "Ir para", run: () => router.push(NAV_ITEMS[k].href),
    }));
    const models: Item[] = (profiles || []).map((p) => ({
      id: `model-${p.id}`, label: p.name, group: "Modelos", run: () => router.push(`/dashboard/profiles/${p.id}`),
    }));
    return [...actions, ...nav, ...models];
  }, [profiles, router]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = q
      ? allItems.filter((i) => i.label.toLowerCase().includes(q) || (i.hint || "").includes(q))
      : allItems;
    return list.slice(0, 50);
  }, [allItems, q]);

  useEffect(() => setActive(0), [q]);

  function activate(i: number) {
    const item = filtered[i];
    if (!item) return;
    setOpen(false);
    item.run();
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  if (!mounted || !open) return null;

  let lastGroup = "";
  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        className="card w-full max-w-lg overflow-hidden bg-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Buscar modelos, telas, ações…"
            className="w-full bg-transparent py-3.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-zinc-500">Nada encontrado.</p>
          ) : (
            filtered.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {header && (
                    <p className="px-4 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                      {header}
                    </p>
                  )}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => activate(i)}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                      i === active ? "bg-white/10 text-white" : "text-zinc-300"
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="ml-3 shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                      {item.group === "Modelos" ? "modelo" : item.hint || ""}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
