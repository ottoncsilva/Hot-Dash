// Conjunto CURADO de emojis usados na censura (seletor por parte do corpo).
// Só estes aparecem — o seletor de censura NÃO usa a coleção completa de
// emojis. Para adicionar/remover, edite apenas esta lista.
//
// A opção "Nenhum" (não censurar aquela parte) é tratada à parte na UI
// como string vazia "".

export const CENSOR_EMOJIS = [
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

export type CensorEmoji = (typeof CENSOR_EMOJIS)[number];
