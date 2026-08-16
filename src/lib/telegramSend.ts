import "server-only";
import { getMediaRow, listMedia } from "./media";
import { sendTelegramMessage, sendTelegramMedia, sendTelegramMediaGroup } from "./telegramApi";

/**
 * Envia UMA mensagem do bot — texto, mídias escolhidas e botões — do mesmo
 * jeito em todo lugar.
 *
 * Esta lógica existia só dentro do /start. Os passos da Recuperação e das
 * sequências de aprovação tinham a sua própria versão, mais pobre: uma mídia
 * só, sorteada por etiqueta. Resultado: a mesma configuração na tela produzia
 * envios diferentes dependendo de onde a mensagem estava.
 *
 * As duas formas de mandar mais de uma mídia não são preferência de estilo:
 *   • ÁLBUM  — uma mensagem só, e o Telegram NÃO aceita botão em álbum, então
 *     texto e botões vão numa mensagem logo abaixo;
 *   • SEPARADAS — uma mensagem por mídia, com texto e botões na última, que é
 *     o que deixa o teclado colado no texto.
 */
export type EnvioMensagem = {
  botToken: string;
  chatId: string;
  text: string;
  /** Ids da Galeria, na ordem de envio. Vazio = mensagem só de texto. */
  mediaIds?: string[];
  mode?: "album" | "separate";
  /** Etiquetas — LEGADO. Só é olhado quando não há mídia escolhida, para não
   *  apagar em silêncio a configuração de quem usava o sorteio antes de ele
   *  sair da tela. Sorteia UMA mídia, como sempre fez. */
  mediaTags?: string;
  profileId: string;
  replyMarkup?: unknown;
  /** Espalhado na chamada do sendMessage (efeito de mensagem, por exemplo). */
  extra?: Record<string, unknown>;
};

export async function enviarMensagemDoBot(m: EnvioMensagem): Promise<void> {
  const opcoesTexto = { ...(m.replyMarkup ? { reply_markup: m.replyMarkup } : {}), ...(m.extra || {}) };

  const caminhos = (m.mediaIds || [])
    .map((id) => getMediaRow(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => r.path);

  if (caminhos.length > 0) {
    if (m.mode === "separate" || caminhos.length === 1) {
      for (let i = 0; i < caminhos.length; i++) {
        const ultima = i === caminhos.length - 1;
        await sendTelegramMedia(
          m.botToken,
          m.chatId,
          caminhos[i],
          ultima ? m.text || undefined : undefined,
          ultima ? opcoesTexto : {},
        );
      }
    } else {
      await sendTelegramMediaGroup(m.botToken, m.chatId, caminhos);
      if (m.text?.trim() || m.replyMarkup) {
        await sendTelegramMessage(m.botToken, m.chatId, m.text, opcoesTexto);
      }
    }
    return;
  }

  // LEGADO: sorteio por etiqueta. Some da tela, mas continua valendo para quem
  // já tinha etiquetas salvas.
  const tags = (m.mediaTags || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tags.length > 0) {
    const candidatas = listMedia(m.profileId).filter((x) =>
      x.tags.some((t) => tags.includes(t.name.toLowerCase())),
    );
    if (candidatas.length > 0) {
      const escolhida = candidatas[Math.floor(Math.random() * candidatas.length)];
      const row = getMediaRow(escolhida.id);
      if (row) {
        await sendTelegramMedia(m.botToken, m.chatId, row.path, m.text || undefined, opcoesTexto);
        return;
      }
    }
  }

  await sendTelegramMessage(m.botToken, m.chatId, m.text, opcoesTexto);
}
