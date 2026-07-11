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
  tags: Tag[];
  editedFrom?: string;
};

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
