import "server-only";
import { getDb } from "./db";
import { normalizarMetodosGravados, SUFIXO_RENOVACAO } from "./transactions";

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
  // A marca sobe a cada mudança de REGRA de leitura, porque as linhas já
  // gravadas não são alcançadas sozinhas: depender de um relatório novo da
  // mesma venda é esperar por algo que não vem. Todas as etapas são
  // idempotentes, então rodar de novo não desfaz nada.
  //  v4: `''` deixou de contar como campo preenchido (ver o NULLIF em
  //      `registrarRelatorioExterno`) — havia linha travada para sempre.
  //  v5: "start" passou a ser um CÓDIGO, e o método deixou de ser gravado cru
  //      ("PIX"/"Pix"/"pix" eram três coisas na tela).
  const MARCA = "rastreio_codigos_v5";
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
    const produtos = arrumarNomeDoProduto();
    // "PIX"/"Pix"/"pix" viravam três métodos diferentes no filtro e no gráfico.
    const metodos = normalizarMetodosGravados();

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      MARCA,
      String(Date.now()),
    );
    console.log(
      `[hotdash] rastreio: ${relatorios.lidos} relatórios relidos (${relatorios.comCodigo} com código); ` +
        `código amarrado em ${vinculos.relatorio + vinculos.lead + vinculos.usuario} vendas ` +
        `(relatório ${vinculos.relatorio}, lead ${vinculos.lead}, usuário ${vinculos.usuario}); ` +
        `produto: ${produtos.semPrefixo} sem prefixo, ${produtos.zerados} zerados, ` +
        `${produtos.peloRelatorio} preenchidos pelo relatório, ` +
        `${produtos.renovacoes} marcados como renovação; ` +
        `método normalizado em ${metodos} vendas.`,
    );
  } catch (err) {
    console.error("[hotdash] falha migrando os códigos de rastreio:", err);
  }
}

/**
 * Arruma o campo PRODUTO das cobranças que já estão gravadas.
 *
 * Três coisas, na ordem:
 *  1. Tira o prefixo ("Assinatura Telegram - X" vira "X"). O prefixo repetia
 *     em toda linha uma informação que as colunas Bot e provedor já dão, e
 *     empurrava o nome do plano para fora da largura da coluna.
 *  2. Zera os textos que NÃO são produto ("Venda SyncPay", "Venda Stripe"):
 *     eram só o nome do provedor ocupando o lugar do nome de verdade. Vazio a
 *     tela mostra "—", que é honesto — não se sabe o produto.
 *  3. Preenche o que der a partir do relatório do Canal de Vendas, que é onde
 *     o nome do plano de uma venda de bot operado por fora fica gravado.
 *
 * Uma vez só, marcada em `settings`.
 */
function arrumarNomeDoProduto(): {
  semPrefixo: number;
  zerados: number;
  peloRelatorio: number;
  renovacoes: number;
} {
  const db = getDb();

  // SQLite não tem regex; os prefixos são conhecidos e poucos, então cada um é
  // recortado pelo seu tamanho exato. `LIKE` do SQLite já ignora maiúsculas em
  // ASCII, e "Renovação" só aparece com essa grafia (é string do próprio código).
  let semPrefixo = 0;
  for (const prefixo of [
    "Assinatura Telegram - ",
    "Venda SyncPay - ",
    "Venda Stripe - ",
    "Renovação Stripe - ",
  ]) {
    semPrefixo += db
      .prepare(
        `UPDATE transactions SET description = TRIM(SUBSTR(description, ?))
          WHERE description LIKE ? AND LENGTH(description) > ?`,
      )
      .run(prefixo.length + 1, prefixo + "%", prefixo.length).changes;
  }

  // O sufixo "(fora do checkout do Hot-Dash)" vinha colado no nome do plano.
  const zerados = db
    .prepare(
      `UPDATE transactions SET description = NULL
        WHERE description IN (
          'Venda SyncPay', 'Venda Stripe', 'Venda (webhook)',
          'Venda Stripe (fora do checkout do Hot-Dash)'
        )`,
    )
    .run().changes;

  const peloRelatorio = db
    .prepare(
      `UPDATE transactions
          SET description = (
            SELECT r.plan_name FROM external_sale_reports r
             WHERE r.provider = transactions.provider
               AND r.provider_ref = transactions.provider_ref
               AND r.plan_name IS NOT NULL AND r.plan_name <> ''
          )
        WHERE (description IS NULL OR description = '')
          AND provider_ref IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM external_sale_reports r
             WHERE r.provider = transactions.provider
               AND r.provider_ref = transactions.provider_ref
               AND r.plan_name IS NOT NULL AND r.plan_name <> ''
          )`,
    )
    .run().changes;

  // RENOVAÇÃO nas linhas antigas. O prefixo "Renovação Stripe - " já foi
  // recortado acima, então ele não serve mais para reconhecê-las — mas o id da
  // FATURA da Stripe começa com "in_", e só renovação é gravada com um. É um
  // sinal da própria Stripe, não um palpite sobre o texto.
  //
  // A venda INICIAL que virou assinatura não é recuperável assim (o id dela é
  // de sessão de checkout, `cs_`, igual ao de uma avulsa). Essas ficam sem o
  // sufixo; daqui para frente nascem com ele.
  const renovacoes = getDb()
    .prepare(
      `UPDATE transactions SET description = COALESCE(description, 'Assinatura') || ?
        WHERE provider = 'stripe'
          AND provider_ref LIKE 'in\\_%' ESCAPE '\\'
          AND (description IS NULL OR description NOT LIKE ?)`,
    )
    .run(SUFIXO_RENOVACAO, `%${SUFIXO_RENOVACAO}`).changes;

  return { semPrefixo, zerados, peloRelatorio, renovacoes };
}

/**
 * O código de rastreio que uma URL de link carrega (`t.me/<bot>?start=CODIGO`).
 *
 * Mesma extração da tela de Links (`/api/links`), e de propósito: as duas
 * precisam concordar sobre o que é o código de um link, senão o clique aparece
 * numa tela e some na outra.
 */
function codigoDaUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)t\.me$/i.test(u.hostname) && !/(^|\.)telegram\.me$/i.test(u.hostname)) return null;
    const bruto = (u.searchParams.get("start") || u.searchParams.get("startgroup") || "").trim();
    return bruto.replace(/[^\w-]/g, "").slice(0, 40) || null;
  } catch {
    return null;
  }
}

/**
 * Clique nos links do SLT, agrupado pelo CÓDIGO que cada link carrega.
 *
 * É a etapa que faltava no funil: entre "clicou no link da bio" e "deu /start
 * no bot" existe uma perda que nenhuma tela mostrava — o clique abre o
 * Telegram, aparece o bot, e a pessoa não aperta Iniciar.
 *
 * A VISUALIZAÇÃO da página NÃO entra aqui, de propósito. Ela é da página, não
 * do código: uma página com três links de códigos diferentes teria a mesma
 * visualização contada três vezes, e o funil mentiria para cima. Visualização
 * fica na tela de Links, onde a unidade é a página.
 *
 * Link sem `?start=` (o convite de grupo das prévias, um site) não entra em
 * código nenhum — o clique existe e aparece em Links, mas não há como
 * segui-lo até a venda.
 */
export function cliquesPorCodigo(
  sinceMs: number | null,
  untilMs: number | null,
): Map<string, number> {
  const db = getDb();
  const clauses: string[] = ["event_type = 'link_clicked'", "link_url IS NOT NULL", "link_url != ''"];
  const params: number[] = [];
  if (sinceMs !== null) {
    clauses.push("created_at >= ?");
    params.push(sinceMs);
  }
  if (untilMs !== null) {
    clauses.push("created_at < ?");
    params.push(untilMs);
  }
  const linhas = db
    .prepare(
      `SELECT link_url, COUNT(*) c FROM slt_events
        WHERE ${clauses.join(" AND ")}
        GROUP BY link_url`,
    )
    .all(...params) as { link_url: string; c: number }[];

  const mapa = new Map<string, number>();
  for (const l of linhas) {
    const code = codigoDaUrl(l.link_url);
    if (!code) continue;
    // Minúsculas na chave: o código chega do `/start` como foi digitado no
    // link, e "Insta2" e "insta2" são o mesmo código para quem opera.
    const k = code.toLowerCase();
    mapa.set(k, (mapa.get(k) || 0) + l.c);
  }
  return mapa;
}

export type CodigoDeRastreio = {
  /** O código em si. String vazia = venda/lead que chegou SEM código. */
  code: string;
  profileId: string | null;
  profileName: string;
  /** Clique num link do SLT que carrega este código. 0 = nenhum link do SLT
   *  aponta para ele (o lead veio da bio direta, de story, de mensagem). */
  cliques: number;
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
  // Só REAL: o código de rastreio soma faturamento, e centavo de dólar não
  // se soma com centavo de real. Ver `SO_REAL` em transactions.ts.
  const txWhere = [
    ...t.clauses,
    "COALESCE(t.origin, '') <> 'ltv'",
    "COALESCE(t.currency,'BRL') = 'BRL'",
  ];
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
        cliques: 0,
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

  // O CLIQUE, vindo do SLT, POR ÚLTIMO — depois de leads e vendas.
  //
  // A ordem importa: o clique é distribuído entre as linhas que já existem do
  // código, e um código pode aparecer só nas vendas (lead que deu /start antes
  // da janela, ou base ainda sem `telegram_leads`). Distribuir antes das
  // vendas fazia o clique cair no vazio e a coluna ficar zerada.
  //
  // O evento do SLT não sabe de qual MODELO é — ele guarda a página e a URL,
  // não o perfil —, então o total do código vai entre as linhas dele na
  // proporção dos starts. Sem starts, na proporção das cobranças; sem nenhum
  // dos dois, inteiro na primeira linha. Em qualquer caso a soma continua
  // sendo o clique real: distribuir nunca inventa clique.
  const cliques = cliquesPorCodigo(sinceMs, untilMs);
  const linhasPorCodigo = new Map<string, CodigoDeRastreio[]>();
  for (const linha of mapa.values()) {
    const k = linha.code.toLowerCase();
    linhasPorCodigo.set(k, [...(linhasPorCodigo.get(k) || []), linha]);
  }
  for (const [code, total] of cliques) {
    const linhas = linhasPorCodigo.get(code);
    if (!linhas || linhas.length === 0) continue;
    const peso = (l: CodigoDeRastreio) => (l.starts > 0 ? l.starts : 0);
    let soma = linhas.reduce((n, l) => n + peso(l), 0);
    let porLinha = peso;
    if (soma === 0) {
      porLinha = (l) => l.gerados;
      soma = linhas.reduce((n, l) => n + l.gerados, 0);
    }
    if (soma === 0) {
      linhas[0].cliques += total;
      continue;
    }
    let distribuido = 0;
    linhas.forEach((l, i) => {
      // A última fica com o resto, para a soma bater exatamente com o total.
      const parte =
        i === linhas.length - 1 ? total - distribuido : Math.round((total * porLinha(l)) / soma);
      l.cliques += parte;
      distribuido += parte;
    });
  }

  return [...mapa.values()].sort(
    (a, b) => b.paidCents - a.paidCents || b.starts - a.starts || a.code.localeCompare(b.code, "pt-BR"),
  );
}
