/**
 * Recursos nativos do Telegram usados nas mensagens do bot de vendas.
 *
 * São duas coisas que só existem do lado do aplicativo e que não dá para
 * imitar com texto:
 *
 *   • BOTÃO NATIVO DE COPIAR (Bot API 8.2): um botão que copia um texto para a
 *     área de transferência no toque, sem ida e volta ao servidor. É a
 *     diferença entre "toque e o código está copiado" e "toque, espere o bot
 *     responder, ache o <code> na tela e toque de novo".
 *
 *   • EFEITOS DE MENSAGEM (Bot API 7.7): a animação de 🎉/🔥 que roda quando a
 *     mensagem chega. Só funcionam em CONVERSA PRIVADA — que é onde o bot de
 *     vendas fala com o lead o tempo todo.
 */

/** Limite do `copy_text` na API. Código maior que isto não cabe no botão. */
export const COPY_TEXT_LIMIT = 256;

/**
 * Monta o botão de copiar.
 *
 * Quando o texto cabe no limite, usa o botão NATIVO (copia no toque). Quando
 * não cabe, cai no botão de callback de sempre, que faz o bot responder com o
 * código num <code>. O copia-e-cola do PIX quase sempre cabe; "quase" não é
 * "sempre", e um botão que não faz nada num caso de borda custaria a venda.
 */
export function botaoCopiar(
  label: string,
  texto: string | undefined,
  callbackData: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const t = (texto || "").trim();
  if (t && t.length <= COPY_TEXT_LIMIT) {
    // `copy_text` e `callback_data` são mutuamente exclusivos: o botão nativo
    // não chama o servidor, então o estilo é o único extra que vai junto.
    return { text: label, copy_text: { text: t }, ...extra };
  }
  return { text: label, callback_data: callbackData, ...extra };
}

/**
 * Efeitos disponíveis. Os IDs são fixos e globais do Telegram — não são nossos
 * e não mudam por bot, por isso ficam aqui em vez de virem do banco.
 */
export const MESSAGE_EFFECTS = [
  { key: "", label: "Sem efeito", emoji: "", id: "" },
  { key: "fire", label: "Fogo", emoji: "🔥", id: "5104841245755180586" },
  { key: "party", label: "Comemoração", emoji: "🎉", id: "5046509860389126442" },
  { key: "heart", label: "Coração", emoji: "❤️", id: "5159385139981059251" },
  { key: "like", label: "Joinha", emoji: "👍", id: "5107584321108051014" },
  { key: "dislike", label: "Negativo", emoji: "👎", id: "5104858069142078462" },
  { key: "poop", label: "Cocô", emoji: "💩", id: "5046589136895476101" },
] as const;

export type MessageEffectKey = (typeof MESSAGE_EFFECTS)[number]["key"];

/**
 * Traduz a escolha da tela no que vai no corpo da chamada.
 *
 * Devolve `{}` quando não há efeito — assim quem chama só espalha o resultado
 * nas opções e não precisa de um `if` em cada envio.
 */
export function efeitoProps(key: string | undefined): Record<string, unknown> {
  const found = MESSAGE_EFFECTS.find((e) => e.key === (key || "").trim());
  return found && found.id ? { message_effect_id: found.id } : {};
}
