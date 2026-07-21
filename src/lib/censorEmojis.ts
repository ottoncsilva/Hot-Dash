// Conjunto CURADO e COMPACTO de emojis. Usado tanto no seletor de censura
// (por parte do corpo) quanto no editor de fotos — em vez da coleção gigante.
// Para adicionar/remover, edite apenas esta lista.
//
// A opção "Nenhum" (não censurar aquela parte) é tratada à parte na UI
// como string vazia "".

export const COMPACT_EMOJIS = [
  "🔞",
  "🔥",
  "🍑",
  "🍆",
  "💦",
  "💧",
  "⭐",
  "🌟",
  "✨",
  "🌸",
  "🌺",
  "🌙",
  "🖤",
  "💗",
  "❤️‍🔥",
  "🙈",
  "🚫",
  "❌",
  "🍾",
] as const;

// Alias histórico — a censura importava CENSOR_EMOJIS.
export const CENSOR_EMOJIS = COMPACT_EMOJIS;

export type CompactEmoji = (typeof COMPACT_EMOJIS)[number];
export type CensorEmoji = CompactEmoji;
