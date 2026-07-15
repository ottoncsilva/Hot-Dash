"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconChevronUp, IconChevronDown, IconEye, IconEyeOff } from "@/components/icons";
import { NAV_ITEMS, normalizeMenu, type MenuEntry } from "@/lib/navItems";
import { BackToSettings } from "../_shared";

export default function MenuSettingsPage() {
  const [menu, setMenu] = useState<MenuEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{ menu: MenuEntry[] }>("/api/settings/menu")
      .then((d) => setMenu(normalizeMenu(d.menu)))
      .catch(() => {});
  }, []);

  function move(index: number, dir: -1 | 1) {
    const next = [...menu];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setMenu(next);
    setSaved(false);
  }
  function toggleHidden(index: number) {
    const next = menu.map((m, i) =>
      i === index ? { ...m, hidden: !m.hidden } : m,
    );
    setMenu(next);
    setSaved(false);
  }
  async function save() {
    setSaving(true);
    try {
      await apiSend("/api/settings/menu", "PATCH", { menu });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackToSettings />
      <p className="eyebrow mt-4">menu</p>
      <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Ordem do menu</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Reordene ou oculte itens. O Dashboard não pode ser ocultado.
      </p>

      <div className="mt-4 card divide-y divide-white/[0.06]">
        {menu.map((entry, i) => {
          const item = NAV_ITEMS[entry.key];
          const isSettings = entry.key === "settings";
          return (
            <div key={entry.key} className="flex items-center gap-3 px-4 py-3">
              <span className="font-mono text-xs text-zinc-600">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={`flex-1 text-sm ${
                  entry.hidden ? "text-zinc-600 line-through" : "text-zinc-200"
                }`}
              >
                {item.label}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-30"
                  aria-label="Subir"
                >
                  <IconChevronUp size={16} />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === menu.length - 1}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-30"
                  aria-label="Descer"
                >
                  <IconChevronDown size={16} />
                </button>
                <button
                  onClick={() => toggleHidden(i)}
                  disabled={isDashboard}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-20"
                  aria-label="Mostrar/ocultar"
                >
                  {entry.hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Salvando..." : "Salvar menu"}
        </button>
        {saved && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            salvo ✓
          </span>
        )}
      </div>
    </div>
  );
}
