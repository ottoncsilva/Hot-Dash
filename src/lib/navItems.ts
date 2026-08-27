// Metadados dos itens de menu (compartilhado servidor/cliente).
// Os ícones são mapeados por `key` no componente de layout.

export type NavKey =
  | "geracao"
  | "ltv"
  | "ltv_chat"
  | "ltv_whatsapp"
  | "ltv_telegram"
  | "ltv_funil"
  | "settings"
  | "dashboard"
  | "profiles"
  | "media"
  | "censura"
  | "firstframe"
  | "caixinha"
  | "imagegen"
  | "videogen"
  | "motion"
  | "payments"
  | "funil"
  | "links"
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
  motion: { key: "motion", label: "Motion Control", href: "/dashboard/motion-control" },
  payments: { key: "payments", label: "Financeiro", href: "/dashboard/payments" },
  funil: { key: "funil", label: "Funil de Vendas", href: "/dashboard/funil" },
  links: { key: "links", label: "Links (bio)", href: "/dashboard/links" },
  telegram: { key: "telegram", label: "Telegram", href: "/dashboard/telegram" },
  // O grupo aponta para o primeiro filho: clicar no cabeçalho abre o submenu,
  // mas o href ainda precisa levar a algum lugar real.
  geracao: { key: "geracao", label: "Geração de Conteúdo", href: "/dashboard/censura" },
  ltv: { key: "ltv", label: "LTV", href: "/dashboard/ltv/chat" },
  ltv_chat: { key: "ltv_chat", label: "Chat ao vivo", href: "/dashboard/ltv/chat" },
  ltv_whatsapp: { key: "ltv_whatsapp", label: "LTV WhatsApp", href: "/dashboard/ltv/whatsapp" },
  ltv_telegram: { key: "ltv_telegram", label: "LTV Telegram", href: "/dashboard/ltv/telegram" },
  ltv_funil: { key: "ltv_funil", label: "Funil de LTV", href: "/dashboard/ltv/funil" },
  schedule: { key: "schedule", label: "Cronograma de postagens", href: "/dashboard/schedule" },
  settings: { key: "settings", label: "Configurações", href: "/dashboard/settings" },
};

// As seis ferramentas de criar conteúdo vivem dentro de "Geração de Conteúdo":
// soltas no topo, elas sozinhas ocupavam metade do menu.
export const DEFAULT_MENU_ORDER: NavKey[] = [
  "dashboard",
  "profiles",
  "media",
  "geracao",
  "schedule",
  "payments",
  "funil",
  "links",
  "telegram",
  "ltv",
  "settings",
];

export type MenuEntry = { key: NavKey; hidden: boolean };

/** Normaliza uma config de menu salva, garantindo que todos os itens existam. */
// Chaves que NÃO aparecem como item de topo (são submenus derivados no layout).
const SUBSECTION_KEYS = new Set<NavKey>([
  "ltv_chat",
  "ltv_whatsapp",
  "ltv_telegram",
  "ltv_funil",
  // Quem tinha uma destas escondida perde a preferência: o grupo é um item só,
  // e agora se esconde (ou reordena) inteiro.
  "censura",
  "firstframe",
  "caixinha",
  "imagegen",
  "videogen",
  "motion",
]);

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
