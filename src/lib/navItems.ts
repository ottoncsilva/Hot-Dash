// Metadados dos itens de menu (compartilhado servidor/cliente).
// Os ícones são mapeados por `key` no componente de layout.

export type NavKey =
  | "dashboard"
  | "profiles"
  | "media"
  | "schedule"
  | "payments"
  | "settings";

export type NavItem = { key: NavKey; label: string; href: string };

export const NAV_ITEMS: Record<NavKey, NavItem> = {
  dashboard: { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  profiles: { key: "profiles", label: "Modelos", href: "/dashboard/profiles" },
  media: { key: "media", label: "Mídia", href: "/dashboard/media" },
  schedule: {
    key: "schedule",
    label: "Cronograma",
    href: "/dashboard/schedule",
  },
  payments: {
    key: "payments",
    label: "Financeiro",
    href: "/dashboard/payments",
  },
  settings: {
    key: "settings",
    label: "Configurações",
    href: "/dashboard/settings",
  },
};

export const DEFAULT_MENU_ORDER: NavKey[] = [
  "dashboard",
  "profiles",
  "media",
  "schedule",
  "payments",
  "settings",
];

export type MenuEntry = { key: NavKey; hidden: boolean };

/** Normaliza uma config de menu salva, garantindo que todos os itens existam. */
export function normalizeMenu(saved?: MenuEntry[]): MenuEntry[] {
  const result: MenuEntry[] = [];
  const seen = new Set<NavKey>();
  for (const entry of saved || []) {
    if (NAV_ITEMS[entry.key] && !seen.has(entry.key)) {
      result.push({ key: entry.key, hidden: Boolean(entry.hidden) });
      seen.add(entry.key);
    }
  }
  // Acrescenta itens novos (que ainda não estavam salvos) no fim.
  for (const key of DEFAULT_MENU_ORDER) {
    if (!seen.has(key)) result.push({ key, hidden: false });
  }
  return result;
}
