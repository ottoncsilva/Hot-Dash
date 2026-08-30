import "server-only";
import { createHash } from "node:crypto";
import { getAppTimeZone } from "./settings";
import { partsInTimeZone } from "./timezone";

/**
 * PROVA SOCIAL do bot de vendas — os números que aparecem na linha
 * "🔥 {vendas_hoje} pessoa(s) garantiram o acesso hoje".
 *
 * O PROBLEMA QUE ISTO RESOLVE: a linha saía com ZERO. O portão era
 * `hoje > 0 || assinantes > 0`, então um bot com assinantes ativos e nenhuma
 * venda no dia mandava "0 pessoa(s) garantiram o acesso hoje" — para o lead,
 * isso não é neutro, é a prova de que ninguém está comprando. Prova social
 * negativa vende MENOS que prova social nenhuma, e toda manhã até a primeira
 * venda o bot trabalhava contra si.
 *
 * A DECISÃO, do operador: a linha passa a ter um PISO. Abaixo dele, mostra o
 * piso; acima, mostra o número real. Vale registrar com todas as letras o que
 * isso significa — o número deixa de ser sempre real. Onde o real supera o
 * piso (o que acontece cedo num dia normal), é o real que sai.
 *
 * POR QUE O PISO VARIA POR DIA: um "11" fixo toda manhã é reconhecível. Quem
 * abre o bot dois dias seguidos vê o mesmo número e entende o mecanismo — e aí
 * a prova social vira o contrário do que ela existe para ser. O piso é
 * sorteado dentro da faixa, mas de forma DETERMINÍSTICA por bot e por dia:
 * o mesmo lead vendo a mensagem duas vezes no mesmo dia vê o mesmo número.
 * Um número que muda entre duas visitas seguidas denuncia tudo.
 */

/** Faixa do piso de vendas do dia. Escolhida pelo operador. */
const PISO_VENDAS_MIN = 11;
const PISO_VENDAS_MAX = 12;

/**
 * Sorteio estável: mesma entrada, mesmo número, sempre. Não é para segurança —
 * é só para o piso não se repetir entre bots e entre dias.
 */
function sorteioEstavel(semente: string, min: number, max: number): number {
  const n = parseInt(createHash("sha256").update(semente).digest("hex").slice(0, 8), 16);
  return min + (n % (max - min + 1));
}

/** Dia corrente no fuso da operação — a mesma virada de dia que o resto do painel usa. */
function diaAtual(): string {
  const p = partsInTimeZone(Date.now(), getAppTimeZone());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export type NumerosDaProva = { vendasHoje: number; assinantes: number };

/**
 * Os números que VÃO PARA A MENSAGEM, a partir dos reais.
 *
 * `assinantes` nunca sai menor que as vendas do dia: "12 hoje · 3 assinantes"
 * é uma frase que se contradiz sozinha e chama atenção justamente para o que
 * não se quer olhar. Quando o real já é maior (o caso normal), ele manda.
 */
export function numerosDaProvaSocial(
  botId: string,
  reais: NumerosDaProva,
  dia = diaAtual(),
): NumerosDaProva {
  const piso = sorteioEstavel(`prova:${botId}:${dia}`, PISO_VENDAS_MIN, PISO_VENDAS_MAX);
  const vendasHoje = Math.max(reais.vendasHoje, piso);
  // Margem também sorteada: assinantes travado em "vendas + 1" todo dia seria
  // outro padrão reconhecível, só que mais óbvio.
  const margem = sorteioEstavel(`prova-assin:${botId}:${dia}`, 3, 9);
  return { vendasHoje, assinantes: Math.max(reais.assinantes, vendasHoje + margem) };
}

/**
 * Troca os marcadores pelo que vai à tela do lead. Ponto ÚNICO de
 * substituição: os dois lugares que mandavam a prova social (abertura em
 * português e abertura internacional) faziam o `replace` cada um por conta, e
 * foi assim que o piso ficou faltando nos dois ao mesmo tempo.
 */
export function aplicarProvaSocial(texto: string, botId: string, reais: NumerosDaProva): string {
  const n = numerosDaProvaSocial(botId, reais);
  return texto
    .replace(/{vendas_hoje}/gi, String(n.vendasHoje))
    .replace(/{assinantes}/gi, String(n.assinantes));
}
