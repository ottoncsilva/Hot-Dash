import "server-only";
import { getDb } from "./db";

/**
 * RASTREIO — o código do deep-link (`t.me/<bot>?start=CODIGO`) que trouxe o
 * lead, do primeiro toque até o dinheiro.
 *
 * O código nasce no /start, é gravado no lead e copiado para a venda na hora
 * de gerar a cobrança. Isso funciona para tudo que passa pelo checkout do
 * Hot-Dash — mas deixava buracos: venda de bot operado por fora (o código vem
 * no relatório do Canal de Vendas, que só passou a ser lido agora), venda
 * anterior à coluna `source_code`, e venda cujo lead ganhou o código depois
 * da cobrança gerada. Este arquivo fecha esses buracos e é a fonte da tela
 * Rastreio → Códigos de rastreio.
 */

/**
 * Preenche `transactions.source_code` onde está vazio, a partir de quem já
 * sabe o código.
 *
 * Três fontes, da mais direta para a menos: o relatório do Canal de Vendas
 * (que fala DESSA venda), o lead do funil e o cadastro de usuários do bot (os
 * dois falam da PESSOA que comprou, alcançada pela inscrição criada na
 * entrega). Só toca linha com o campo NULL ou vazio — a palavra final continua
 * sendo de quem gravou a venda.
 *
 * Idempotente de propósito: rodar de novo não muda nada além de preencher o
 * que ainda estiver faltando.
 */
export function vincularCodigosNasVendas(): { relatorio: number; lead: number; usuario: number } {
  const db = getDb();
  const VAZIO = "(source_code IS NULL OR source_code = '')";

  // 1) Relatório do Canal de Vendas: é a única fonte que fala desta venda
  // especificamente, então vem primeiro.
  const relatorio = db
    .prepare(
      `UPDATE transactions
          SET source_code = (
            SELECT r.source_code FROM external_sale_reports r
             WHERE r.provider = transactions.provider
               AND r.provider_ref = transactions.provider_ref
               AND r.source_code IS NOT NULL AND r.source_code <> ''
          )
        WHERE ${VAZIO}
          AND provider_ref IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM external_sale_reports r
             WHERE r.provider = transactions.provider
               AND r.provider_ref = transactions.provider_ref
               AND r.source_code IS NOT NULL AND r.source_code <> ''
          )`,
    )
    .run().changes;

  // 2) O lead do funil, alcançado pela inscrição que a entrega criou. O id do
  // lead é `<bot_id>_<telegram_user_id>` — mesma chave que o webhook usa.
  const lead = db
    .prepare(
      `UPDATE transactions
          SET source_code = (
            SELECT l.source_code
              FROM telegram_subscriptions s
              JOIN telegram_leads l ON l.id = s.bot_id || '_' || s.telegram_user_id
             WHERE s.transaction_id = transactions.id
               AND l.source_code IS NOT NULL AND l.source_code <> ''
             LIMIT 1
          )
        WHERE ${VAZIO}
          AND EXISTS (
            SELECT 1 FROM telegram_subscriptions s
              JOIN telegram_leads l ON l.id = s.bot_id || '_' || s.telegram_user_id
             WHERE s.transaction_id = transactions.id
               AND l.source_code IS NOT NULL AND l.source_code <> ''
          )`,
    )
    .run().changes;

  // 3) A tela de Usuários. Guarda o mesmo código, e sobrevive à faxina que
  // apaga lead antigo — por isso cobre venda que a fonte 2 já não alcança.
  const usuario = db
    .prepare(
      `UPDATE transactions
          SET source_code = (
            SELECT u.source_code
              FROM telegram_subscriptions s
              JOIN telegram_users u ON u.bot_id = s.bot_id AND u.telegram_user_id = s.telegram_user_id
             WHERE s.transaction_id = transactions.id
               AND u.source_code IS NOT NULL AND u.source_code <> ''
             LIMIT 1
          )
        WHERE ${VAZIO}
          AND EXISTS (
            SELECT 1 FROM telegram_subscriptions s
              JOIN telegram_users u ON u.bot_id = s.bot_id AND u.telegram_user_id = s.telegram_user_id
             WHERE s.transaction_id = transactions.id
               AND u.source_code IS NOT NULL AND u.source_code <> ''
          )`,
    )
    .run().changes;

  return { relatorio, lead, usuario };
}

/**
 * Migração de uma vez só, no start do servidor: relê os relatórios já
 * guardados (o texto original nunca foi jogado fora) e depois amarra o código
 * de rastreio em toda venda que ainda estava sem.
 *
 * Fica marcada em `settings` para não repetir a cada deploy — o trabalho é
 * proporcional ao histórico inteiro, e depois disso quem grava o código é o
 * próprio caminho da venda. Nunca lança: uma falha aqui não pode impedir o
 * servidor de subir.
 */
export async function migrarCodigosDeRastreio(): Promise<void> {
  const MARCA = "rastreio_codigos_v1";
  const db = getDb();
  try {
    if (db.prepare("SELECT value FROM settings WHERE key = ?").get(MARCA)) return;

    // Import tardio: `externalSaleReport` importa este módulo? Não — mas
    // importa `settings` e `telegramUsers`, e carregá-los no topo faria o
    // start do servidor puxar essa árvore inteira só para uma migração que
    // roda uma vez.
    const { reprocessarRelatoriosGuardados } = await import("./externalSaleReport");
    const relatorios = reprocessarRelatoriosGuardados();
    const vinculos = vincularCodigosNasVendas();

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      MARCA,
      String(Date.now()),
    );
    console.log(
      `[hotdash] rastreio: ${relatorios.lidos} relatórios relidos (${relatorios.comCodigo} com código); ` +
        `código amarrado em ${vinculos.relatorio + vinculos.lead + vinculos.usuario} vendas ` +
        `(relatório ${vinculos.relatorio}, lead ${vinculos.lead}, usuário ${vinculos.usuario}).`,
    );
  } catch (err) {
    console.error("[hotdash] falha migrando os códigos de rastreio:", err);
  }
}

export type CodigoDeRastreio = {
  /** O código em si. String vazia = venda/lead que chegou SEM código. */
  code: string;
  profileId: string | null;
  profileName: string;
  /** /start com este código no período. */
  starts: number;
  /** Cobranças geradas (pagas ou não). */
  gerados: number;
  pagos: number;
  /** Faturamento bruto das pagas. */
  paidCents: number;
  /** Já sem a taxa do gateway. */
  netCents: number;
  /** Gerado e ainda não pago — dinheiro na mesa. */
  pendingCents: number;
  /** Bots em que este código apareceu, para o operador saber onde ele roda. */
  bots: string[];
};

/**
 * Todo código de rastreio do período, por MODELO — o mesmo formato da tela de
 * Links (que agrupa página por modelo), só que a unidade aqui é o código.
 *
 * Um mesmo código pode aparecer em mais de uma modelo (o operador reusa
 * "insta_bio" em todas): cada par (modelo, código) é uma linha, como uma
 * página do SLT é uma linha por modelo. O total de cada código vem da soma
 * das linhas, feita na tela.
 *
 * Fora do recorte, de propósito: cobrança do LTV (`origin = 'ltv'`), que tem
 * o funil próprio dela e nunca nasceu de um /start com código.
 */
export function codigosDeRastreio(
  sinceMs: number | null,
  untilMs: number | null,
): CodigoDeRastreio[] {
  const db = getDb();

  const janela = (coluna: string) => {
    const clauses: string[] = [];
    const params: number[] = [];
    if (sinceMs !== null) {
      clauses.push(`${coluna} >= ?`);
      params.push(sinceMs);
    }
    if (untilMs !== null) {
      clauses.push(`${coluna} < ?`);
      params.push(untilMs);
    }
    return { clauses, params };
  };

  const l = janela("created_at");
  const leads = db
    .prepare(
      `SELECT COALESCE(source_code, '') code, profile_id, COUNT(*) c
         FROM telegram_leads
        ${l.clauses.length ? `WHERE ${l.clauses.join(" AND ")}` : ""}
        GROUP BY COALESCE(source_code, ''), profile_id`,
    )
    .all(...l.params) as { code: string; profile_id: string | null; c: number }[];

  const t = janela("t.created_at");
  const txWhere = [...t.clauses, "COALESCE(t.origin, '') <> 'ltv'"];
  const vendas = db
    .prepare(
      `SELECT COALESCE(t.source_code, '') code, t.profile_id,
              COUNT(*) gerados,
              COALESCE(SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END), 0) pagos,
              COALESCE(SUM(CASE WHEN t.status = 'paid' THEN t.amount_cents ELSE 0 END), 0) pago_cents,
              COALESCE(SUM(CASE WHEN t.status = 'paid' THEN COALESCE(t.net_amount_cents, t.amount_cents) ELSE 0 END), 0) liq_cents,
              COALESCE(SUM(CASE WHEN t.status = 'pending' THEN t.amount_cents ELSE 0 END), 0) pend_cents,
              GROUP_CONCAT(DISTINCT b.bot_username) bots
         FROM transactions t
         LEFT JOIN telegram_bots b ON b.id = t.bot_id
        WHERE ${txWhere.join(" AND ")}
        GROUP BY COALESCE(t.source_code, ''), t.profile_id`,
    )
    .all(...t.params) as {
    code: string;
    profile_id: string | null;
    gerados: number;
    pagos: number;
    pago_cents: number;
    liq_cents: number;
    pend_cents: number;
    bots: string | null;
  }[];

  const nomes = new Map(
    (db.prepare("SELECT id, name FROM profiles").all() as { id: string; name: string }[]).map(
      (p) => [p.id, p.name],
    ),
  );

  const mapa = new Map<string, CodigoDeRastreio>();
  const pega = (code: string, profileId: string | null) => {
    const chave = `${profileId || ""}|${code}`;
    let r = mapa.get(chave);
    if (!r) {
      r = {
        code,
        profileId,
        profileName: profileId ? nomes.get(profileId) || "Modelo removida" : "Sem modelo",
        starts: 0,
        gerados: 0,
        pagos: 0,
        paidCents: 0,
        netCents: 0,
        pendingCents: 0,
        bots: [],
      };
      mapa.set(chave, r);
    }
    return r;
  };

  for (const r of leads) pega(r.code, r.profile_id).starts += r.c;
  for (const r of vendas) {
    const linha = pega(r.code, r.profile_id);
    linha.gerados += r.gerados;
    linha.pagos += r.pagos;
    linha.paidCents += r.pago_cents;
    linha.netCents += r.liq_cents;
    linha.pendingCents += r.pend_cents;
    linha.bots = (r.bots || "").split(",").filter(Boolean).sort();
  }

  return [...mapa.values()].sort(
    (a, b) => b.paidCents - a.paidCents || b.starts - a.starts || a.code.localeCompare(b.code, "pt-BR"),
  );
}
