// Metadados dos itens de menu (compartilhado servidor/cliente).
// Os ícones são mapeados por `key` no componente de layout.

export type NavKey =
  | "whatsapp"
  | "whatsapp_settings"
  | "whatsapp_chat"
  | "settings"
  | "dashboard"
  | "profiles"
  | "media"
  | "censura"
  | "firstframe"
  | "caixinha"
  | "imagegen"
  | "videogen"
  | "payments"
  | "funil"
  | "telegram"
  | "schedule";

export type NavItem = { key: NavKey; label: string; href: string };

export const NAV_ITEMS: Record<NavKey, NavItem> = {
  dashboard: { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  profiles: { key: "profiles", label: "Modelos", href: "/dashboard/profiles" },
  media: { key: "media", label: "Galeria", href: "/dashboard/media" },
  censura: { key: "censura", label: "Censura com IA", href: "/dashboard/censura" },
  firstframe: { key: "firstframe", label: "First Frame", href: "/dashboard/first-frame" },
  caixinha: { key: "caixinha", label: "Caixinha de perguntas", href: "/dashboard/caixinha" },
  imagegen: { key: "imagegen", label: "Gerador de Imagem", href: "/dashboard/gerador-imagem" },
  videogen: { key: "videogen", label: "Gerador de Vídeo", href: "/dashboard/gerador-video" },
  payments: { key: "payments", label: "Financeiro", href: "/dashboard/payments" },
  funil: { key: "funil", label: "Funil de Vendas", href: "/dashboard/funil" },
  telegram: { key: "telegram", label: "Telegram", href: "/dashboard/telegram" },
  whatsapp: { key: "whatsapp", label: "WhatsApp", href: "/dashboard/whatsapp" },
  whatsapp_settings: { key: "whatsapp_settings", label: "Configurações LTV", href: "/dashboard/whatsapp/settings" },
  whatsapp_chat: { key: "whatsapp_chat", label: "Chat LTV", href: "/dashboard/whatsapp/chat" },
  schedule: { key: "schedule", label: "Cronograma de postagens", href: "/dashboard/schedule" },
  settings: { key: "settings", label: "Configurações", href: "/dashboard/settings" },
};

// "Galeria" e "Censura com IA" são itens de topo independentes — não existe
// mais um menu "Mídia" agrupando os dois.
export const DEFAULT_MENU_ORDER: NavKey[] = [
  "dashboard",
  "profiles",
  "media",
  "censura",
  "firstframe",
  "caixinha",
  "imagegen",
  "videogen",
  "schedule",
  "payments",
  "funil",
  "telegram",
  "whatsapp",
  "settings",
];

export type MenuEntry = { key: NavKey; hidden: boolean };

/** Normaliza uma config de menu salva, garantindo que todos os itens existam. */
// Chaves que NÃO aparecem como item de topo (são submenus derivados no layout).
const SUBSECTION_KEYS = new Set<NavKey>(["whatsapp_settings", "whatsapp_chat"]);

export function normalizeMenu(saved?: MenuEntry[]): MenuEntry[] {
  const result: MenuEntry[] = [];
  const seen = new Set<NavKey>();
  for (const entry of saved || []) {
    if (SUBSECTION_KEYS.has(entry.key)) continue; // ignora chaves de submenu salvas
    if (NAV_ITEMS[entry.key] && !seen.has(entry.key)) {
      result.push({ key: entry.key, hidden: Boolean(entry.hidden) });
      seen.add(entry.key);
    }
  }
  // Acrescenta os itens que ainda não estavam salvos na posição que ocupam na
  // ordem padrão (logo depois do item anterior que já está na lista), e não no
  // fim — assim um item novo, como a Censura, nasce ao lado da Galeria mesmo
  // para quem já tinha um menu salvo.
  DEFAULT_MENU_ORDER.forEach((key, i) => {
    if (seen.has(key)) return;
    const previousIndex = DEFAULT_MENU_ORDER.slice(0, i)
      .reverse()
      .map((k) => result.findIndex((e) => e.key === k))
      .find((index) => index >= 0);
    result.splice(previousIndex === undefined ? 0 : previousIndex + 1, 0, {
      key,
      hidden: false,
    });
    seen.add(key);
  });
  return result;
}
