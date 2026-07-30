import "server-only";
import { getDb } from "./db";
import { getTelegramChat, getTelegramChatMemberCount, getTelegramMe } from "./telegramApi";

/**
 * Monitor dos grupos do Telegram — quantos membros o VIP e as Prévias têm.
 *
 * Roda por CONSULTA à API (getChat / getChatMemberCount), não por webhook. É
 * essa a diferença que importa: consulta precisa só do token, então continua
 * funcionando com a "Operação do bot" DESLIGADA, quando o webhook pertence a
 * outro sistema e nenhum update chega até aqui. Assim dá para acompanhar o
 * tamanho dos grupos antes de fazer o cutover.
 *
 * Nunca lança: bot fora do grupo, token trocado ou rede fora do ar viram um
 * `error` guardado na linha, e o último número conhecido continua visível.
 */

const INTERVALO_MS = 10 * 60 * 1000; // 10 min: ritmo de fundo, no agendador
// Piso para a consulta pedida pela tela: mesmo abrindo o painel várias vezes
// seguidas, não consulta o Telegram mais que uma vez a cada 15s por grupo.
const PISO_MS = 15 * 1000;
// Teto de espera de uma consulta pedida pela tela.
const TIMEOUT_PADRAO_MS = 4000;

export type GroupStat = {
  profileId: string;
  kind: "vip" | "previas";
  chatId: string;
  title: string | null;
  memberCount: number | null;
  checkedAt: number;
  error: string | null;
};

type Row = {
  profile_id: string;
  kind: string;
  chat_id: string;
  title: string | null;
  member_count: number | null;
  checked_at: number;
  error: string | null;
};

function toClient(r: Row): GroupStat {
  return {
    profileId: r.profile_id,
    kind: r.kind === "vip" ? "vip" : "previas",
    chatId: r.chat_id,
    title: r.title,
    memberCount: r.member_count,
    checkedAt: r.checked_at,
    error: r.error,
  };
}

/** Último retrato conhecido dos grupos (todos os perfis, ou só um). */
export function listGroupStats(profileId?: string): GroupStat[] {
  const rows = profileId
    ? (getDb()
        .prepare("SELECT * FROM telegram_group_stats WHERE profile_id = ?")
        .all(profileId) as Row[])
    : (getDb().prepare("SELECT * FROM telegram_group_stats").all() as Row[]);
  return rows.map(toClient);
}

/** Soma dos membros por grupo — o número que o Dashboard mostra. */
export function groupTotals(profileId?: string): {
  vip: number | null;
  previas: number | null;
  checkedAt: number | null;
} {
  const stats = listGroupStats(profileId);
  const soma = (kind: "vip" | "previas") => {
    const validos = stats.filter((s) => s.kind === kind && s.memberCount !== null);
    return validos.length === 0 ? null : validos.reduce((n, s) => n + (s.memberCount || 0), 0);
  };
  const datas = stats.map((s) => s.checkedAt).filter(Boolean);
  return {
    vip: soma("vip"),
    previas: soma("previas"),
    checkedAt: datas.length ? Math.max(...datas) : null,
  };
}

function upsert(
  botId: string,
  profileId: string,
  kind: "vip" | "previas",
  chatId: string,
  dados: { title?: string | null; memberCount?: number | null; error?: string | null },
) {
  getDb()
    .prepare(
      `INSERT INTO telegram_group_stats
         (id, bot_id, profile_id, kind, chat_id, title, member_count, checked_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         chat_id = excluded.chat_id,
         -- Em falha, PRESERVA o último título/contagem conhecidos: melhor um
         -- número de 10 minutos atrás do que a tela zerar por um timeout.
         title = COALESCE(excluded.title, telegram_group_stats.title),
         member_count = COALESCE(excluded.member_count, telegram_group_stats.member_count),
         checked_at = excluded.checked_at,
         error = excluded.error`,
    )
    .run(
      `${botId}:${kind}`,
      botId,
      profileId,
      kind,
      chatId,
      dados.title ?? null,
      dados.memberCount ?? null,
      Date.now(),
      dados.error ?? null,
    );
}

/**
 * Atualiza o retrato de todos os bots cadastrados. Roda a cada ciclo do
 * agendador, mas só consulta o Telegram a cada {@link INTERVALO_MS} por grupo.
 */
export async function runTelegramGroupMonitor(opts?: {
  /** Ignora o intervalo normal e consulta agora (usado ao abrir/atualizar a
   *  tela). Ainda respeita {@link PISO_MS} para o painel não martelar a API do
   *  Telegram quando a página recarrega várias vezes seguidas. */
  force?: boolean;
  /** Limita a espera: um Telegram lento não pode segurar o carregamento do
   *  painel. Estourando o tempo, a tela mostra o último retrato conhecido. */
  timeoutMs?: number;
  profileId?: string;
}): Promise<number> {
  const db = getDb();
  const filtro = opts?.profileId ? " AND profile_id = ?" : "";
  const params = opts?.profileId ? [opts.profileId] : [];
  const bots = db
    .prepare(
      `SELECT id, profile_id, bot_token, bot_username, id_vip, id_aquecimento
         FROM telegram_bots WHERE bot_token IS NOT NULL AND bot_token <> ''${filtro}`,
    )
    .all(...params) as {
    id: string;
    profile_id: string;
    bot_token: string;
    bot_username: string | null;
    id_vip: string | null;
    id_aquecimento: string | null;
  }[];

  const agora = Date.now();
  let atualizados = 0;

  for (const bot of bots) {
    const alvos: { kind: "vip" | "previas"; chatId: string | null }[] = [
      { kind: "vip", chatId: bot.id_vip },
      { kind: "previas", chatId: bot.id_aquecimento },
    ];

    for (const alvo of alvos) {
      if (!alvo.chatId) continue;
      const anterior = db
        .prepare("SELECT checked_at FROM telegram_group_stats WHERE id = ?")
        .get(`${bot.id}:${alvo.kind}`) as { checked_at: number } | undefined;
      const minimo = opts?.force ? PISO_MS : INTERVALO_MS;
      if (anterior && agora - anterior.checked_at < minimo) continue;

      try {
        const consulta = Promise.all([
          getTelegramChat(bot.bot_token, alvo.chatId).catch(() => null),
          getTelegramChatMemberCount(bot.bot_token, alvo.chatId),
        ]);
        const [chat, count] = await (opts?.timeoutMs || opts?.force
          ? Promise.race([
              consulta,
              new Promise<never>((_, rej) =>
                setTimeout(
                  () => rej(new Error("Telegram demorou para responder.")),
                  opts?.timeoutMs ?? TIMEOUT_PADRAO_MS,
                ),
              ),
            ])
          : consulta);
        upsert(bot.id, bot.profile_id, alvo.kind, alvo.chatId, {
          title: chat?.title ?? null,
          memberCount: count,
          error: null,
        });
        atualizados++;
      } catch (e) {
        upsert(bot.id, bot.profile_id, alvo.kind, alvo.chatId, {
          error: e instanceof Error ? e.message.slice(0, 200) : "Falha ao consultar o grupo.",
        });
      }
    }

    // @username do bot: útil quando o cadastro veio só com o token.
    if (!bot.bot_username) {
      try {
        const me = await getTelegramMe(bot.bot_token);
        if (me?.username) {
          db.prepare("UPDATE telegram_bots SET bot_username = ? WHERE id = ?").run(
            me.username,
            bot.id,
          );
        }
      } catch {
        /* silencioso: é enfeite, não pode derrubar o monitor */
      }
    }
  }

  return atualizados;
}
