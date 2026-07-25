import { getDb } from "@/lib/db";
import { sendPushEvent } from "@/lib/push";
import { getAppTimeZone } from "@/lib/settings";
import { partsInTimeZone } from "@/lib/timezone";

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Lembrete dos posts que VOCÊ precisa publicar na mão (tela Cronograma).
 *
 * Três coisas que estavam erradas e geravam avisos que não batiam com a tela:
 *  1. Posts do TELEGRAM entravam na conta. Eles são publicados sozinhos pela
 *     automação — e o Método MK cria 20 a 35 por dia, então chovia "não esqueça
 *     de publicar" para post nenhum que exigisse ação. Agora só entram posts com
 *     pelo menos uma rede publicada manualmente.
 *  2. Sem limite inferior: `scheduled_at <= agora+15min` também pegava TODO post
 *     atrasado do passado. Agora a janela é fechada dos dois lados.
 *  3. O horário na mensagem saía no fuso do servidor (UTC) — um post das 07:53
 *     de Brasília aparecia como "10:53". Agora usa o fuso da operação.
 */
export async function processReminders() {
  const db = getDb();
  const now = Date.now();

  const posts = db
    .prepare(
      `
    SELECT p.id, p.scheduled_at, pr.name as profile_name
    FROM posts p
    JOIN profiles pr ON p.profile_id = pr.id
    WHERE p.status = 'scheduled'
      AND p.scheduled_at <= ?
      AND p.scheduled_at >= ?
      AND p.reminded = 0
      AND EXISTS (
        SELECT 1 FROM post_networks pn
        WHERE pn.post_id = p.id AND pn.network <> 'telegram'
      )
  `,
    )
    .all(now + WINDOW_MS, now - WINDOW_MS) as {
    id: string;
    scheduled_at: number;
    profile_name: string;
  }[];

  if (posts.length === 0) {
    return 0;
  }

  // Marca os posts como lembrados para não enviar de novo
  const updateStmt = db.prepare(`UPDATE posts SET reminded = 1 WHERE id = ?`);
  db.transaction(() => {
    for (const p of posts) {
      updateStmt.run(p.id);
    }
  })();

  const tz = getAppTimeZone();

  // Envia os web pushes
  for (const p of posts) {
    const t = partsInTimeZone(p.scheduled_at, tz);
    const dateStr = `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
    const title = `Lembrete: Post para ${p.profile_name}`;
    const body = `O post está agendado para as ${dateStr}. Não esqueça de publicar!`;
    const url = `/dashboard/schedule`; // abre a tela do cronograma

    await sendPushEvent("scheduleReminder", title, body, url);
  }

  return posts.length;
}
