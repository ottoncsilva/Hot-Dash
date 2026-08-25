import "server-only";
import { getDb } from "./db";

/**
 * Trava de execução por chave, apoiada no banco (não em memória) — o que
 * importa aqui é impedir que a MESMA tarefa rode duas vezes ao mesmo tempo,
 * não importa se as duas chamadas vieram do mesmo processo (o ticker interno
 * de `instrumentation.ts` sobrepondo a rota HTTP `/api/cron/telegram/...`) ou
 * de processos diferentes.
 *
 * `tryAcquireCronLock` é ATÔMICA: o UPDATE com WHERE é uma única instrução do
 * better-sqlite3 (síncrono), sem janela entre "ler se tá livre" e "escrever
 * que agora tá ocupado" — duas chamadas concorrentes não podem as duas
 * pensarem que ganharam a trava.
 */

/** Adquire a trava. `false` = já tem outra execução em andamento (chamador
 *  deve desistir/pular esta rodada, não esperar). */
export function tryAcquireCronLock(key: string, ttlMs = 10 * 60 * 1000): boolean {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO cron_locks (key, running, started_at) VALUES (?, 0, NULL)
     ON CONFLICT(key) DO NOTHING`,
  ).run(key);
  // O TTL destrava sozinha se uma execução anterior morreu no meio sem
  // liberar (queda do processo, etc.) — sem isso, uma falha travaria a
  // tarefa para sempre.
  const res = db
    .prepare(
      `UPDATE cron_locks SET running = 1, started_at = ?
        WHERE key = ? AND (running = 0 OR started_at < ?)`,
    )
    .run(now, key, now - ttlMs);
  return res.changes > 0;
}

/** Libera a trava — sempre chamada num `finally`, mesmo se a tarefa falhar. */
export function releaseCronLock(key: string): void {
  getDb().prepare(`UPDATE cron_locks SET running = 0 WHERE key = ?`).run(key);
}
