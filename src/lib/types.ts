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

/** Item de mídia (foto ou vídeo) vinculado a um perfil. */
export type MediaItem = {
  id: string;
  profileId: string;
  filename: string;
  kind: "image" | "video";
  mime?: string;
  size: number;
  createdAt: number;
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
