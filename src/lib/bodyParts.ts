// Constantes client-safe das partes do corpo censuráveis. Ficam separadas do
// nudenet.ts (que é "server-only") para poderem ser usadas na UI.

export type BodyPart = "seios" | "vagina" | "penis" | "bunda" | "anus";

export const BODY_PARTS: BodyPart[] = ["seios", "vagina", "penis", "bunda", "anus"];

export const BODY_PART_LABELS: Record<BodyPart, string> = {
  seios: "Seios",
  vagina: "Vagina",
  penis: "Pênis",
  bunda: "Bunda",
  anus: "Ânus",
};

/** Emoji sugerido por padrão para cada parte. Todos precisam existir em
 *  CENSOR_EMOJIS (src/lib/censorEmojis.ts). */
export const DEFAULT_PART_EMOJI: Record<BodyPart, string> = {
  seios: "🍑",
  vagina: "🌸",
  penis: "🍆",
  bunda: "🍑",
  anus: "🔥",
};
