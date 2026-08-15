import "server-only";

/**
 * Roda `fn` sobre os itens com no máximo `limite` em voo ao mesmo tempo,
 * devolvendo os resultados NA ORDEM DE ENTRADA.
 *
 * Existe porque os geradores do Método MK faziam as chamadas de IA em fila:
 * 8 chamadas com imagem, uma esperando a outra, passando de 60s por lote —
 * enquanto o limite da xAI é de 1.800 requisições por minuto. O gargalo era
 * inteiramente nosso.
 *
 * Por que não `Promise.all` puro: sem teto, um dia inteiro de posts abriria
 * dezenas de chamadas simultâneas, esbarraria no limite do provedor (e no
 * Gemini, que é o fallback, o limite é bem menor) e ainda concorreria com o
 * próprio painel pela CPU do VPS na hora de renderizar as imagens.
 *
 * A ordem do retorno importa: o calendário mostra os posts na sequência dos
 * horários, então quem chama grava os resultados em ordem depois do fan-out.
 */
export async function mapLimit<T, R>(
  items: T[],
  limite: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const teto = Math.max(1, Math.floor(limite));
  const out = new Array<R>(items.length);
  let proximo = 0;

  async function worker() {
    for (;;) {
      const i = proximo++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }

  // Nunca mais workers que itens — com 2 itens e teto 6, quatro workers
  // nasceriam só para sair no primeiro `if`.
  await Promise.all(Array.from({ length: Math.min(teto, items.length) }, worker));
  return out;
}

/**
 * Igual a `mapLimit`, mas um item que falha não derruba os demais: devolve
 * `{ ok }` ou `{ erro }` por item.
 *
 * É o que o lote do Método MK precisa — uma legenda recusada pela IA não pode
 * cancelar as outras sete, que é o que `Promise.all` faria ao rejeitar no
 * primeiro erro.
 */
export async function mapLimitSettled<T, R>(
  items: T[],
  limite: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<({ ok: R; erro?: undefined } | { ok?: undefined; erro: unknown })[]> {
  return mapLimit(items, limite, async (item, i) => {
    try {
      return { ok: await fn(item, i) };
    } catch (erro) {
      return { erro };
    }
  });
}

/**
 * Quantas chamadas de IA e quantas renderizações de mídia rodam ao mesmo tempo.
 *
 * São números diferentes de propósito. A chamada de IA passa o tempo quase
 * todo esperando a rede, então dá para ter várias em voo sem custo local. Já a
 * mídia (ffmpeg para o quadro do vídeo, sharp para a imagem de visão) é CPU
 * pura NO MESMO PROCESSO do painel — exagerar aqui deixa o Hot-Dash sem
 * resposta enquanto a geração roda.
 *
 * Ajustáveis por variável de ambiente para dar para subir sem rebuild caso a
 * VPS aguente mais.
 */
function envNum(nome: string, padrao: number, max: number): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v >= 1 ? Math.min(Math.floor(v), max) : padrao;
}

export const AI_CONCURRENCY = envNum("AI_CONCURRENCY", 6, 30);
export const MEDIA_CONCURRENCY = envNum("MEDIA_CONCURRENCY", 3, 12);
