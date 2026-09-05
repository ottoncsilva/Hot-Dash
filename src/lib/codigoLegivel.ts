import "server-only";
import { randomInt } from "node:crypto";

/**
 * Alfabeto dos códigos que alguém LÊ na tela do painel e DIGITA no celular.
 *
 * Sem os caracteres que se confundem nessa travessia: 0/O, 1/I/L, 2/Z, 5/S.
 * Quem digita está olhando para o painel e batendo no teclado do telefone — um
 * "0" que vira "O" só produz um "código inválido" sem explicação.
 */
export const ALFABETO_LEGIVEL = "ABCDEFGHJKMNPQRTUVWXY346789";

/** Sorteia um código com esse alfabeto. Sem garantia de unicidade: quem
 *  precisa disso confere na tabela (ver `deliveryTargets.gerarPairCode`). */
export function gerarCodigoLegivel(tamanho = 6): string {
  let code = "";
  for (let i = 0; i < tamanho; i++) code += ALFABETO_LEGIVEL[randomInt(ALFABETO_LEGIVEL.length)];
  return code;
}
