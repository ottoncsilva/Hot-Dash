import type { SocialAccount, SocialNetwork } from "./types";

/**
 * Máscaras de link por rede social: dado o usuário/identificador, monta a URL
 * do perfil. Também define o placeholder e o rótulo do campo de usuário para
 * cada rede. Usado no cadastro de contas do perfil para preencher o link
 * automaticamente e abrir a rede no navegador.
 */

type NetworkMeta = {
  /** Rótulo do campo de identificador (ex.: "Usuário", "Telefone", "E-mail"). */
  userLabel: string;
  /** Placeholder do campo de identificador. */
  userPlaceholder: string;
  /** Prefixo/base da URL (o identificador limpo é anexado). */
  base?: string;
  /** Constrói a URL a partir do identificador (sobrepõe base quando presente). */
  build?: (handle: string) => string;
};

/** Remove @ e espaços do início/fim do identificador. */
function cleanHandle(v: string): string {
  return v.trim().replace(/^@+/, "");
}

/** Só os dígitos (para telefone/WhatsApp). */
function digits(v: string): string {
  return v.replace(/\D/g, "");
}

const META: Record<SocialNetwork, NetworkMeta> = {
  instagram: {
    userLabel: "Usuário",
    userPlaceholder: "@usuario",
    base: "https://instagram.com/",
  },
  facebook: {
    userLabel: "Usuário / página",
    userPlaceholder: "usuario ou página",
    base: "https://facebook.com/",
  },
  tiktok: {
    userLabel: "Usuário",
    userPlaceholder: "@usuario",
    build: (h) => `https://tiktok.com/@${cleanHandle(h)}`,
  },
  whatsapp: {
    userLabel: "Telefone (com DDI)",
    userPlaceholder: "5511999998888",
    build: (h) => `https://wa.me/${digits(h)}`,
  },
  telegram: {
    userLabel: "Usuário",
    userPlaceholder: "@usuario",
    base: "https://t.me/",
  },
  x: {
    userLabel: "Usuário",
    userPlaceholder: "@usuario",
    base: "https://x.com/",
  },
  onlyfans: {
    userLabel: "Usuário",
    userPlaceholder: "usuario",
    base: "https://onlyfans.com/",
  },
  privacy: {
    userLabel: "Usuário",
    userPlaceholder: "usuario",
    base: "https://privacy.com.br/",
  },
  threads: {
    userLabel: "Usuário",
    userPlaceholder: "@usuario",
    build: (h) => `https://threads.net/@${cleanHandle(h)}`,
  },
  youtube: {
    userLabel: "Canal (@handle)",
    userPlaceholder: "@canal",
    build: (h) => {
      const c = cleanHandle(h);
      return `https://youtube.com/@${c}`;
    },
  },
  email: {
    userLabel: "E-mail",
    userPlaceholder: "voce@exemplo.com",
    build: (h) => `mailto:${h.trim()}`,
  },
  outro: {
    userLabel: "Identificador",
    userPlaceholder: "usuário, link ou identificador",
  },
};

export function networkMeta(network: SocialNetwork): NetworkMeta {
  return META[network] || META.outro;
}

/**
 * As contas de WhatsApp da modelo, na ordem do cadastro e já com o link pronto.
 *
 * É esta a lista que alimenta o "qual WhatsApp enviar" dos posts do VIP: o
 * número é cadastrado uma vez em Modelos → a modelo → Contas e serve para
 * qualquer geração. Contas sem link montável ficam de fora — não teriam para
 * onde apontar o botão.
 */
export function whatsappAccounts(
  accounts: SocialAccount[] | undefined,
): { id: string; label: string; url: string }[] {
  return (accounts || [])
    .filter((a) => a.network === "whatsapp")
    .map((a) => ({
      id: a.id,
      label: a.notes?.trim() ? `${a.username} — ${a.notes.trim()}` : a.username,
      url: (a.url || "").trim() || buildSocialUrl("whatsapp", a.username),
    }))
    .filter((a) => Boolean(a.url));
}

/** Monta a URL do perfil a partir da rede + identificador. Vazio se não der. */
export function buildSocialUrl(network: SocialNetwork, handle: string): string {
  const h = handle.trim();
  if (!h) return "";
  // Se já for uma URL completa, respeita.
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  const meta = networkMeta(network);
  if (meta.build) return meta.build(h);
  if (meta.base) return `${meta.base}${cleanHandle(h)}`;
  return "";
}
