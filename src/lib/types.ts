// Tipos compartilhados entre frontend e backend.

export type SocialNetwork =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "whatsapp"
  | "telegram"
  | "x"
  | "onlyfans"
  | "privacy"
  | "threads"
  | "youtube"
  | "email"
  | "outro";

/** Conta em uma rede social (com credenciais). */
export type SocialAccount = {
  id: string;
  network: SocialNetwork;
  username: string;
  url?: string;
  login?: string;
  /** true se há uma senha guardada (a senha em si nunca é enviada ao cliente). */
  hasPassword: boolean;
  notes?: string;
};

/** Perfil = uma personagem de IA (ex.: Adriana Queiroz). */
export type Profile = {
  id: string;
  name: string;
  avatarPath: string | null;
  notes?: string;
  accounts: SocialAccount[];
  mediaCount?: number;
  createdAt: number;
  updatedAt: number;
};

/** Etiqueta para categorizar mídia. */
export type Tag = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
};

/** Paleta de cores disponível para etiquetas (pontinho de cor, UI segue monocromática). */
export const TAG_COLORS = [
  "#a1a1aa", // zinc
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
] as const;

/** Item de mídia (foto ou vídeo) vinculado a um perfil. */
export type MediaItem = {
  id: string;
  profileId: string;
  filename: string;
  kind: "image" | "video";
  mime?: string;
  size: number;
  createdAt: number;
  /** Última modificação do conteúdo (usado para cache-busting da imagem). */
  updatedAt?: number;
  tags: Tag[];
  editedFrom?: string;
  width?: number;
  height?: number;
  publicToken?: string;
};

/** URL do arquivo de mídia com cache-busting por updatedAt (reflete edições sobrescritas). */
export function mediaFileUrl(item: MediaItem, opts?: { download?: boolean }): string {
  const v = item.updatedAt || item.createdAt;
  const dl = opts?.download ? "&download=1" : "";
  return `/api/media/${item.id}/file?v=${v}${dl}`;
}

/** URL da miniatura (primeiro frame) de um vídeo — só faz sentido para kind === "video". */
export function mediaThumbUrl(item: MediaItem): string {
  const v = item.updatedAt || item.createdAt;
  return `/api/media/${item.id}/thumbnail?v=${v}`;
}

/** Proporções padrão reconhecidas pelo filtro de formato de imagem. */
export const RATIO_BUCKETS = ["1:1", "3:4", "4:3", "9:16", "16:9", "3:2", "2:3"] as const;
export type RatioBucket = (typeof RATIO_BUCKETS)[number] | "outra";

/** Classifica width/height na proporção padrão mais próxima (tolerância ~4%). */
export function ratioBucket(width?: number, height?: number): RatioBucket {
  if (!width || !height) return "outra";
  const targets: [RatioBucket, number][] = [
    ["1:1", 1 / 1],
    ["3:4", 3 / 4],
    ["4:3", 4 / 3],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
  ];
  const ratio = width / height;
  let best: RatioBucket = "outra";
  let bestDiff = Infinity;
  for (const [label, target] of targets) {
    const diff = Math.abs(ratio - target) / target;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = label;
    }
  }
  return bestDiff < 0.04 ? best : "outra";
}

/** Proporção exata simplificada (ex.: 1920x1080 -> "16:9"), via MDC. */
export function exactRatioLabel(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

export const NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  x: "X (Twitter)",
  onlyfans: "OnlyFans",
  privacy: "Privacy",
  threads: "Threads",
  youtube: "YouTube",
  email: "E-mail",
  outro: "Outro",
};
