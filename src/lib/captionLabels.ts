/**
 * RÓTULO na frente da legenda — o vício mais teimoso dos modelos de IA.
 *
 * O prompt pede "responda SOMENTE com o texto da legenda" e mesmo assim a
 * resposta abre anunciando o que vem a seguir. E o rótulo raramente é a palavra
 * seca: ele COPIA o alvo que o prompt pediu ("Escreva UMA legenda … para:
 * Telegram (VIP)") e devolve `Legenda para Telegram (VIP):`, ou marca o fim do
 * raciocínio com `Legenda final:`. A limpeza anterior só reconhecia a palavra
 * colada nos dois-pontos (`Legenda:`), então qualquer coisa no meio passava
 * batido — e o título foi ao ar dentro dos posts do canal.
 *
 * Duas formas são tratadas aqui:
 *   • rótulo INLINE — palavra de rótulo + até 40 caracteres de complemento +
 *     dois-pontos, com ou sem markdown em volta;
 *   • rótulo SOZINHO na primeira linha, com a legenda começando na de baixo.
 *
 * O complemento não pode conter `, . ! ?`: é isso que separa um rótulo de uma
 * legenda de verdade que por acaso começa com uma dessas palavras. E a limpeza
 * só vale se sobrar texto — legenda vazia é pior que legenda com título.
 *
 * Fica em módulo próprio, sem dependência nenhuma, porque roda em três lugares:
 * na geração (`ai.cleanCaption`), no envio (`telegramCron`) e no backfill do
 * banco (`db.ts`) — e importar `ai.ts` do `db.ts` fecharia um ciclo.
 */

const PALAVRAS_DE_ROTULO =
  "legendas?|captions?|texto do post|texto|copy|posts?|publica[çc][ãa]o|sugest[ãa]o|op[çc][ãa]o|vers[ãa]o|resposta|resultado";
/** "Aqui está a legenda:", "Segue a copy pro Telegram:" */
const ABERTURAS = "aqui (?:est[áa]|v[aã]o|vai)|segue(?: abaixo)?";

const ROTULO_INLINE = new RegExp(
  `^[*_\`#>"'“«\\s]*(?:(?:${ABERTURAS})[^\\n:,.!?]{0,60}|(?:${PALAVRAS_DE_ROTULO})\\b[^\\n:,.!?]{0,60})[*_\`"'\\s]*[:：][*_\`\\s]*`,
  "i",
);
const ROTULO_SOZINHO = new RegExp(
  `^[*_\`#>"'“«\\s]*(?:${PALAVRAS_DE_ROTULO})\\b[^\\n:,.!?]{0,60}[*_\`\\s]*$`,
  "i",
);

export function stripCaptionLabels(raw: string): string {
  let t = (raw || "").replace(/^\s+/, "");
  // Repete porque os rótulos empilham: "Aqui está a legenda:\n\nLegenda final:".
  for (let i = 0; i < 3; i++) {
    const antes = t;

    const semInline = t.replace(ROTULO_INLINE, "");
    if (semInline.trim()) t = semInline;

    const linhas = t.split("\n");
    if (linhas.length > 1 && ROTULO_SOZINHO.test(linhas[0])) {
      const resto = linhas.slice(1).join("\n");
      if (resto.trim()) t = resto;
    }

    t = t.replace(/^\s+/, "");
    if (t === antes) break;
  }
  return t;
}
