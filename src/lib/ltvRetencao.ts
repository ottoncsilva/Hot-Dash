import "server-only";
import { getDb } from "./db";
import { DIAS_DE_MEMORIA, limparMensagensAntigas } from "./ltvDb";

/**
 * Faxina diária da memória de conversa do LTV.
 *
 * Guardamos {@link DIAS_DE_MEMORIA} dias por lead e apagamos o que passa disso
 * DE VEZ — nada de arquivo morto que ninguém lê e que só faz o banco crescer.
 * A linha do chat continua de pé com o quanto o lead já gastou, então o Funil
 * de LTV e a etiqueta de valor não perdem nada; o que se esquece é o que foi
 * conversado.
 *
 * Roda no ciclo de 1 minuto do `instrumentation.ts`, mas age só uma vez por
 * dia: varrer a tabela a cada minuto seria trabalho jogado fora, e a memória
 * não fica "errada" por algumas horas a mais.
 */

const CHAVE = "ltv_ultima_limpeza_memoria";
const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** Devolve quantas mensagens foram apagadas (0 quando não era hora ainda). */
export function runLtvRetencao(): number {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(CHAVE) as
    | { value: string }
    | undefined;
  const ultima = Number(row?.value) || 0;
  if (Date.now() - ultima < UM_DIA_MS) return 0;

  const apagadas = limparMensagensAntigas();

  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(CHAVE, String(Date.now()));

  return apagadas;
}
