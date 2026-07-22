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

/** Enquete de um post (Telegram sendPoll). Sem mídia. */
export type PostPoll = { question: string; options: string[] };

/** Limite do Telegram para o texto de um botão inline. */
export const CTA_BUTTON_MAX = 25;

/** Frases-modelo dos "Botões da copy" das Prévias (1 por linha). A IA/sistema
 *  escolhe 1 por post e anexa como botão com o link do VIP. Editável na UI. */
export const DEFAULT_CTA_BUTTONS = [
  "VEM PRO MEU VIP AGORA",
  "VEM ME VER SEM CENSURA",
  "VEM PRO MEU VIP ME SENTIR",
  "VEM FICAR COMIGO NO VIP",
  "VEM PRO MEU CANTINHO SECRETO",
  "VEM DESCOBRIR MEU LADO PROIBIDO",
  "VEM ME DEIXAR MOLHADINHA NO VIP",
  "VEM ME DOMINAR NO VIP",
  "VEM SER MEU DONO NO VIP",
  "VEM ME TER DE VERDADE",
  "VEM BRINCAR COMIGO NO VIP",
  "VEM ME PROVAR AGORA",
].join("\n");

/** Escolhe uma frase de CTA aleatória da lista, respeitando o limite de
 *  caracteres (trunca com reticências se passar). Retorna null se lista vazia. */
export function pickCtaButtonText(list: string, max = CTA_BUTTON_MAX): string | null {
  const lines = list
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const chosen = lines[Math.floor(Math.random() * lines.length)];
  return chosen.length > max ? chosen.slice(0, max - 1).trimEnd() + "…" : chosen;
}

/** Post agendado no cronograma (a publicação em si é feita manualmente). */
export type ScheduledPost = {
  id: string;
  profileId: string;
  profileName?: string;
  networks: PostNetwork[];
  scheduledAt: number;
  caption?: string;
  poll?: PostPoll;
  /** true = leva o botão/link do VIP no envio; false = não; undefined = legado. */
  cta?: boolean;
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
