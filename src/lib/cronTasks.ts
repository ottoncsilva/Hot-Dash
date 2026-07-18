import { getDb } from "@/lib/db";
import { sendPushToAll } from "@/lib/push";

export async function processReminders() {
  const db = getDb();
  const now = Date.now();
  const future = now + 15 * 60 * 1000; // 15 minutos

  const posts = db.prepare(`
    SELECT p.id, p.scheduled_at, pr.name as profile_name
    FROM posts p
    JOIN profiles pr ON p.profile_id = pr.id
    WHERE p.status = 'scheduled'
      AND p.scheduled_at <= ?
      AND p.reminded = 0
  `).all(future) as { id: string; scheduled_at: number; profile_name: string }[];

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

  // Envia os web pushes
  for (const p of posts) {
    const dateStr = new Date(p.scheduled_at).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
    const title = `Lembrete: Post para ${p.profile_name}`;
    const body = `O post está agendado para as ${dateStr}. Não esqueça de publicar!`;
    const url = `/dashboard/schedule`; // abre a tela do cronograma
    
    await sendPushToAll(title, body, url);
  }

  return posts.length;
}
