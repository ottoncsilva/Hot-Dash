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
 * O LIMITE DE LEGENDA também mora aqui: uma mensagem de texto vai a 4096
 * caracteres, mas a legenda de uma mídia para em 1024. Passando disso, o
 * Telegram recusa o envio inteiro — a mídia não vai, o texto não vai, e o
 * lead não recebe nada. Então texto longo com mídia sai em DUAS partes, com
 * os botões na segunda. Isto existia só no Mailing; o /start, a Recuperação e
 * as sequências de aprovação estouravam calados.
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

/** Legenda de mídia no Telegram. A mensagem de texto vai a 4096. */
const LIMITE_LEGENDA = 1024;

export async function enviarMensagemDoBot(m: EnvioMensagem): Promise<void> {
  const opcoesTexto = { ...(m.replyMarkup ? { reply_markup: m.replyMarkup } : {}), ...(m.extra || {}) };
  const texto = m.text || "";
  // Texto que não cabe na legenda vira uma segunda mensagem. Os botões vão
  // com ELA, não com a mídia: o teclado tem que ficar colado no texto que
  // pede a ação.
  const textoSeparado = texto.length > LIMITE_LEGENDA;

  const caminhos = (m.mediaIds || [])
    .map((id) => getMediaRow(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => r.path);

  if (caminhos.length > 0) {
    if (m.mode === "separate" || caminhos.length === 1) {
      for (let i = 0; i < caminhos.length; i++) {
        const ultima = i === caminhos.length - 1 && !textoSeparado;
        await sendTelegramMedia(
          m.botToken,
          m.chatId,
          caminhos[i],
          ultima ? texto || undefined : undefined,
          ultima ? opcoesTexto : {},
        );
      }
    } else {
      await sendTelegramMediaGroup(m.botToken, m.chatId, caminhos);
    }
    // Álbum nunca leva legenda (o Telegram não aceita botão em álbum), e o
    // texto longo também não coube — nos dois casos ele vem aqui.
    const precisaDeMensagem =
      textoSeparado || (m.mode !== "separate" && caminhos.length > 1);
    if (precisaDeMensagem && (texto.trim() || m.replyMarkup)) {
      await sendTelegramMessage(m.botToken, m.chatId, texto, opcoesTexto);
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
        if (textoSeparado) {
          await sendTelegramMedia(m.botToken, m.chatId, row.path, undefined);
          await sendTelegramMessage(m.botToken, m.chatId, texto, opcoesTexto);
        } else {
          await sendTelegramMedia(m.botToken, m.chatId, row.path, texto || undefined, opcoesTexto);
        }
        return;
      }
    }
  }

  await sendTelegramMessage(m.botToken, m.chatId, texto, opcoesTexto);
}
