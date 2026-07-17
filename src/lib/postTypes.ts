import type { SocialNetwork } from "./types";

// Tipos de postagem disponíveis por rede social (máscara do formulário).
// O primeiro item de cada lista é o padrão ao selecionar a rede.
export const POST_TYPES: Record<SocialNetwork, string[]> = {
  instagram: ["Feed", "Carrossel", "Reels", "Stories", "Outro"],
  facebook: ["Post", "Reels", "Stories", "Outro"],
  tiktok: ["Vídeo", "Carrossel", "Stories", "Outro"],
  x: ["Post", "Thread", "Outro"],
  threads: ["Post", "Carrossel", "Outro"],
  youtube: ["Vídeo", "Short", "Outro"],
  onlyfans: ["Post", "Stories", "Mensagem", "Outro"],
  privacy: ["Post", "Mensagem", "Outro"],
  telegram: ["VIP", "Prévias", "Mensagem", "Outro"],
  whatsapp: ["Status", "Mensagem", "Outro"],
  email: ["Campanha", "Outro"],
  outro: ["Publicação"],
};

// Pontinho de cor por rede nos chips do calendário (a UI segue monocromática;
// a cor é só um marcador funcional, como nas etiquetas).
export const NETWORK_DOT_COLORS: Record<SocialNetwork, string> = {
  instagram: "#ec4899",
  facebook: "#3b82f6",
  tiktok: "#22d3ee",
  x: "#a1a1aa",
  threads: "#f4f4f5",
  youtube: "#ef4444",
  onlyfans: "#38bdf8",
  privacy: "#f59e0b",
  telegram: "#0ea5e9",
  whatsapp: "#22c55e",
  email: "#a855f7",
  outro: "#71717a",
};

// Dias da semana, na ordem do Date.getDay() (0=domingo).
export const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Restrição de tipo de mídia num horário do programa semanal. */
export type MediaKindFilter = "any" | "image" | "video";

/**
 * Rede + tipo escolhido para essa rede dentro de um post. `accountId`
 * referencia a conta cadastrada da modelo (permite 2 posts na mesma rede
 * quando há 2 contas, ex.: 2 Instagram) — opcional para não quebrar posts
 * antigos criados antes dessa distinção existir.
 */
export type PostNetwork = {
  network: SocialNetwork;
  postType: string;
  accountId?: string;
  /** Só preenchido ao carregar do servidor, para exibir sem precisar cruzar com o perfil. */
  accountUsername?: string;
};

export type PostStatus = "scheduled" | "posted";

/** Post agendado no cronograma (a publicação em si é feita manualmente). */
export type ScheduledPost = {
  id: string;
  profileId: string;
  profileName?: string;
  networks: PostNetwork[];
  scheduledAt: number;
  caption?: string;
  status: PostStatus;
  media: {
    id: string;
    kind: "image" | "video";
    filename: string;
    updatedAt?: number;
  }[];
  createdAt: number;
  updatedAt: number;
};
