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

/**
 * Escolhe `count` frases da lista para os hiperlinks do fim da legenda das
 * Prévias. Sem repetir enquanto houver frase nova; lista curta repete para
 * completar as linhas. Não trunca: o limite de {@link CTA_BUTTON_MAX} é do
 * BOTÃO do Telegram, um hiperlink na legenda não tem esse teto.
 */
export function pickCtaLinkTexts(list: string, count = 3): string[] {
  const lines = list
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  // Fisher-Yates (embaralhar com sort(() => Math.random() - 0.5) enviesa a
  // ordem e faria as mesmas frases caírem juntas com frequência).
  const pool = [...lines];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
}

/**
 * Bloco de convite ao VIP do fim da legenda das Prévias: uma linha por frase,
 * cada uma hiperlinkada para o grupo.
 *
 * O texto da frase vai ESCAPADO: uma frase com `<` ou `&` quebraria o
 * `parse_mode: HTML` e o Telegram recusaria a mensagem inteira.
 */
export function buildVipCtaLines(vipLink: string, texts: string[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const href = vipLink.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const lines = texts.length > 0 ? texts : ["ACESSAR O VIP 🎁"];
  return lines.map((t) => `👉 <a href="${href}">${esc(t)}</a>`).join("\n");
}

/** Cola o bloco de convite ao fim de uma legenda já escrita. */
export function appendVipCtaLines(
  caption: string,
  vipLink: string,
  texts: string[],
): string {
  const body = (caption || "").trimEnd();
  const block = buildVipCtaLines(vipLink, texts);
  return body ? `${body}\n\n${block}` : block;
}

/** A legenda já carrega um hiperlink para este link do VIP? É o que evita o
 *  convite sair duplicado quando o gerador já gravou as linhas na legenda. */
export function captionHasVipLink(caption: string, vipLink: string): boolean {
  if (!caption || !vipLink) return false;
  const escaped = vipLink.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return caption.includes(`href="${vipLink}"`) || caption.includes(`href="${escaped}"`);
}

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
