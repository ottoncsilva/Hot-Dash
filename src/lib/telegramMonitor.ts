import "server-only";
import { getDb } from "./db";
import { getTelegramChat, getTelegramChatMemberCount, getTelegramMe } from "./telegramApi";
import { getAppTimeZone, getFixedGroupMembers } from "./settings";
import { partsInTimeZone } from "./timezone";

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

/**
 * Desconta os ocupantes fixos de cada grupo (você, o bot, outros admins) do
 * total que a API do Telegram devolveu.
 *
 * Quantos são vem de Configurações → Geral (`getFixedGroupMembers`), lido a
 * cada chamada: como o banco guarda o número CRU, mudar a configuração
 * reajusta na hora até o histórico, sem migração.
 *
 * Sem deixar o total ir a negativo — um grupo em montagem pode responder 1
 * antes de o bot entrar, e o painel não pode mostrar "−1 membro".
 */
function semOcupantesFixos(total: number, grupos: number): number {
  return Math.max(0, total - grupos * getFixedGroupMembers());
}

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

/** Soma dos membros por grupo, já SEM os ocupantes fixos (você e o bot) — é o
 *  número de inscritos de verdade, que o Funil mostra. */
export function groupTotals(profileId?: string): {
  vip: number | null;
  previas: number | null;
  checkedAt: number | null;
} {
  const stats = listGroupStats(profileId);
  const soma = (kind: "vip" | "previas") => {
    const validos = stats.filter((s) => s.kind === kind && s.memberCount !== null);
    if (validos.length === 0) return null;
    const bruto = validos.reduce((n, s) => n + (s.memberCount || 0), 0);
    // Desconta POR GRUPO: cada grupo tem o seu par (você + bot).
    return semOcupantesFixos(bruto, validos.length);
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

  // Histórico do dia: guarda a ÚLTIMA medição de cada dia. A diferença entre
  // dois dias é o crescimento líquido do grupo. Sem contagem (falha), não
  // grava — melhor um dia sem ponto do que um ponto errado.
  if (typeof dados.memberCount === "number") {
    const p = partsInTimeZone(Date.now(), getAppTimeZone());
    const dia = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    getDb()
      .prepare(
        `INSERT INTO telegram_group_history (id, bot_id, profile_id, kind, day, member_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET member_count = excluded.member_count, updated_at = excluded.updated_at`,
      )
      .run(`${botId}:${kind}:${dia}`, botId, profileId, kind, dia, dados.memberCount, Date.now());
  }
}

/**
 * Série diária de crescimento dos grupos: tamanho no fim de cada dia e a
 * VARIAÇÃO em relação ao dia anterior (entrou menos saiu).
 *
 * Enquanto outro sistema opera o bot, só dá para saber o líquido — o Telegram
 * não entrega os eventos de entrada/saída para quem não consome os updates, e
 * não existe método para listar membros. Quando o Hot-Dash assumir a operação,
 * a mesma tela pode passar a separar entradas de saídas.
 */
/** Dia corrente no fuso da operação, no mesmo formato usado pelo histórico. */
function diaAtual(): string {
  const p = partsInTimeZone(Date.now(), getAppTimeZone());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Conta UMA entrada ou saída de grupo no dia de hoje.
 *
 * Quem chama é o webhook, e só quando a pessoa REALMENTE mudou de estado — o
 * mesmo evento pode chegar duas vezes (mensagem de serviço + chat_member), e
 * contar os dois inflaria o gráfico. Nunca lança: um erro aqui não pode
 * derrubar o processamento do update.
 */
export function recordGroupMembershipChange(
  botId: string,
  profileId: string,
  kind: "vip" | "previas",
  entrou: boolean,
): void {
  try {
    const dia = diaAtual();
    const coluna = entrou ? "joined" : "left_count";
    getDb()
      .prepare(
        `INSERT INTO telegram_group_events (id, bot_id, profile_id, kind, day, joined, left_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ${coluna} = telegram_group_events.${coluna} + 1,
           updated_at = excluded.updated_at`,
      )
      .run(
        `${botId}:${kind}:${dia}`,
        botId,
        profileId,
        kind,
        dia,
        entrou ? 1 : 0,
        entrou ? 0 : 1,
        Date.now(),
      );
  } catch (err) {
    console.error("Erro ao contar entrada/saída de grupo:", err);
  }
}

export type GroupGrowthPoint = {
  day: string;
  /** Total de membros no fim do dia (consulta periódica). */
  vip: number | null;
  previas: number | null;
  /** Entradas e saídas do dia (eventos do webhook). `null` = não medido (o
   *  Hot-Dash não estava operando o bot naquele dia); `0` = medido e ninguém
   *  entrou/saiu. Os dois são coisas diferentes e o gráfico os desenha
   *  diferente — zero vira ponto na linha, null vira buraco. */
  vipJoined: number | null;
  vipLeft: number | null;
  previasJoined: number | null;
  previasLeft: number | null;
};

export function groupGrowthSeries(dias = 14, profileId?: string): GroupGrowthPoint[] {
  const filtro = profileId ? " AND profile_id = ?" : "";
  const params = profileId ? [profileId] : [];
  // `grupos` conta quantos grupos entraram na soma daquele dia — é o
  // multiplicador do desconto dos ocupantes fixos (cada grupo tem o seu par
  // você + bot). Sem isso, um perfil com dois grupos do mesmo tipo ficaria com
  // o desconto pela metade.
  const rows = getDb()
    .prepare(
      `SELECT day, kind, SUM(member_count) AS total, COUNT(*) AS grupos
         FROM telegram_group_history
        WHERE 1 = 1${filtro}
        GROUP BY day, kind ORDER BY day`,
    )
    .all(...params) as { day: string; kind: string; total: number; grupos: number }[];

  // Entradas e saídas NÃO levam o desconto dos ocupantes fixos, de propósito:
  // são eventos, não saldo. Você e o bot entraram uma vez, no dia em que o
  // grupo nasceu, e aquilo aconteceu de verdade — descontar aqui inventaria
  // uma saída que nunca houve.
  const eventos = getDb()
    .prepare(
      `SELECT day, kind, SUM(joined) AS joined, SUM(left_count) AS left_count
         FROM telegram_group_events
        WHERE 1 = 1${filtro}
        GROUP BY day, kind`,
    )
    .all(...params) as { day: string; kind: string; joined: number; left_count: number }[];

  const porDia = new Map<string, { vip: number | null; previas: number | null }>();
  for (const r of rows) {
    const cur = porDia.get(r.day) || { vip: null, previas: null };
    const liquido = semOcupantesFixos(r.total, r.grupos);
    if (r.kind === "vip") cur.vip = liquido;
    else cur.previas = liquido;
    porDia.set(r.day, cur);
  }
  // Um dia pode ter evento sem consulta (ou o contrário): a série é a UNIÃO
  // dos dois, senão uma entrada registrada sumiria do gráfico.
  for (const e of eventos) {
    if (!porDia.has(e.day)) porDia.set(e.day, { vip: null, previas: null });
  }

  const chave = (day: string, kind: string) => `${day}|${kind}`;
  const porEvento = new Map(eventos.map((e) => [chave(e.day, e.kind), e]));

  const ordenados = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return ordenados.slice(-dias).map(([day, v]) => {
    const ev = (kind: string) => porEvento.get(chave(day, kind));
    return {
      day,
      vip: v.vip,
      previas: v.previas,
      vipJoined: ev("vip")?.joined ?? null,
      vipLeft: ev("vip")?.left_count ?? null,
      previasJoined: ev("previas")?.joined ?? null,
      previasLeft: ev("previas")?.left_count ?? null,
    };
  });
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
          error: e instanceof Error ? e.message.slice(0, 200) : "Falha ao consultar o canal.",
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
