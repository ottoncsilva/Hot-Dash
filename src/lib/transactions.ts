import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { getAppTimeZone } from "./settings";
import { syncPayFeeCents } from "./payments/syncpayExport";
import type { PeriodKey } from "./periods";
import {
  addDaysInTimeZone,
  formatDayLabel,
  formatHourLabel,
  partsInTimeZone,
  startOfDayInTimeZone,
  zonedWallTimeToUtcMs,
} from "./timezone";

export type Transaction = {
  id: string;
  provider: string;
  providerRef?: string;
  profileId?: string;
  /** Bot do Telegram que gerou a cobrança — vazio em venda do LTV ou lançada
   *  à mão (nunca passou por um bot). */
  botId?: string;
  /** @usuário do bot, só quando a consulta faz o JOIN (listagem do
   *  Financeiro) — ausente nas outras leituras, que não precisam dele. */
  botUsername?: string;
  /**
   * O bot da MODELO desta venda, quando ela mesma não tem bot amarrado.
   *
   * Existe por causa do LTV: aquela venda tem modelo (`profile_id`) e não tem
   * bot, porque não passou pelo bot de vendas — mas a modelo tem um, e é o
   * dela que a tela precisa mostrar. "Bot do LTV" não existe.
   *
   * Fica em campo PRÓPRIO em vez de preencher `botUsername` por tabela: os dois
   * dizem coisas diferentes (um é o bot que fez a venda, outro é o bot da
   * modelo), e misturá-los apagaria a distinção em todo lugar que lê `botId`.
   */
  profileBotUsername?: string;
  /** O id do mesmo bot de `profileBotUsername`. Existe para o FILTRO por bot:
   *  a tela mostra o bot da modelo nessas linhas, então filtrar por ele tem de
   *  trazê-las — comparar só `botId` deixava a venda de LTV de fora de um
   *  filtro que a própria tela dizia que ela atendia. */
  profileBotId?: string;
  description?: string;
  customer?: string;
  /** Valor CHEIO da venda (faturamento bruto). */
  amountCents: number;
  /** Valor LÍQUIDO repassado pelo gateway ("você recebe"). */
  netAmountCents?: number;
  /** Taxa do gateway (fixa, R$ 0,80 na SyncPay). */
  feeCents?: number;
  /** Split: parte repassada a terceiros. Zero na maioria das vendas. */
  splitCents?: number;
  /** A venda como o gateway LIQUIDOU, quando converteu de moeda: o cliente
   *  pagou US$ 19,90 (`amountCents`/`currency`) e caiu R$ 101,28. Ausente
   *  quando não houve conversão — que é o caso de toda venda em real. */
  settledAmountCents?: number;
  settledCurrency?: string;
  currency: string;
  method?: string;
  status: string;
  createdAt: number;
  /** Instante em que virou paga (diferente de createdAt = geração do Pix). */
  paidAt?: number;
  updatedAt: number;
  /** Qual parte do painel gerou a cobrança: 'bot' (bot de vendas do
   *  Telegram), 'ltv' (agente de LTV) ou 'painel' (lançada à mão). NULL em
   *  linha antiga, de antes da coluna existir — ver `origemDaVenda` na tela
   *  do Financeiro, que decide o rótulo quando isto vem vazio. */
  origin?: "bot" | "ltv" | "painel";
  /** Código do deep-link que trouxe o lead (`?start=CODIGO`). */
  sourceCode?: string;
  /** Contato do Telegram que fez a compra, quando o webhook amarrou a venda a
   *  uma inscrição. É o que permite abrir a conversa com o lead pelo painel. */
  telegram?: { userId: number; username?: string };
};

type Row = {
  id: string;
  provider: string;
  provider_ref: string | null;
  profile_id: string | null;
  bot_id: string | null;
  /** Só presente quando a consulta faz LEFT JOIN telegram_bots (ver
   *  `comBot` abaixo) — em `SELECT *` puro fica ausente (undefined). */
  bot_username?: string | null;
  /** O bot DA MODELO da venda, achado pelo `profile_id` em vez do `bot_id`.
   *  Serve à venda que não passou por bot nenhum mas pertence a uma modelo que
   *  tem um — o caso do LTV. */
  profile_bot_username?: string | null;
  profile_bot_id?: string | null;
  description: string | null;
  customer: string | null;
  amount_cents: number;
  net_amount_cents: number | null;
  fee_cents: number | null;
  split_cents: number | null;
  settled_amount_cents: number | null;
  settled_currency: string | null;
  paid_at: number | null;
  reprocessed_at: number | null;
  currency: string;
  method: string | null;
  status: string;
  origin: string | null;
  source_code: string | null;
  created_at: number;
  updated_at: number;
};

function toClient(r: Row): Transaction {
  return {
    id: r.id,
    provider: r.provider,
    providerRef: r.provider_ref || undefined,
    profileId: r.profile_id || undefined,
    botId: r.bot_id || undefined,
    botUsername: r.bot_username || undefined,
    profileBotUsername: r.profile_bot_username || undefined,
    profileBotId: r.profile_bot_id || undefined,
    description: r.description || undefined,
    customer: r.customer || undefined,
    amountCents: r.amount_cents,
    netAmountCents: r.net_amount_cents ?? undefined,
    feeCents: r.fee_cents ?? undefined,
    splitCents: r.split_cents ?? undefined,
    // A liquidação em outra moeda. Sem estas duas linhas o banco guardava a
    // conversão e a tela nunca a via: a venda em dólar aparecia sem o valor em
    // real, taxa e líquido saíam com cifrão de dólar sobre número de real, e a
    // soma do rodapé contava US$ 19,90 como se fossem R$ 19,90.
    settledAmountCents: r.settled_amount_cents ?? undefined,
    settledCurrency: r.settled_currency || undefined,
    paidAt: r.paid_at ?? undefined,
    currency: r.currency,
    method: r.method || undefined,
    status: r.status,
    origin: (r.origin as Transaction["origin"]) || undefined,
    sourceCode: r.source_code || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Sufixo que marca a venda cuja cobrança se repete sozinha (assinatura da
 * Stripe). Fica numa constante porque três lugares gravam e um quarto (a
 * migração) reconhece — se cada um escrevesse o seu, a coluna Produto teria
 * variações que nenhum filtro casaria.
 */
export const SUFIXO_RENOVACAO = " com renovação";

/**
 * Nome do produto como ele aparece na coluna Produto e nas notificações.
 *
 * Sem o sufixo, a renovação automática ficava indistinguível de uma venda
 * nova: mesmo plano, mesmo valor, linhas idênticas — e a diferença entre
 * faturamento novo e recorrente é justamente o que se quer enxergar ali.
 */
export function nomeDoProduto(
  nome: string | undefined | null,
  renovacaoAutomatica: boolean,
): string | undefined {
  const limpo = (nome || "").trim();
  if (!limpo) return renovacaoAutomatica ? `Assinatura${SUFIXO_RENOVACAO}` : undefined;
  // Não empilha o sufixo em quem já tem (relatório reprocessado, migração
  // rodando de novo).
  if (!renovacaoAutomatica || limpo.endsWith(SUFIXO_RENOVACAO)) return limpo;
  return `${limpo}${SUFIXO_RENOVACAO}`;
}

/**
 * O MÉTODO DE PAGAMENTO no vocabulário do painel: "pix" ou "card".
 *
 * Existe porque o gateway não tem vocabulário nenhum. A SyncPay manda o
 * `payment_method` como vier — "pix", "PIX", "Pix" — e isso era gravado cru.
 * O resultado é que a mesma forma de pagamento virava TRÊS na tela: três
 * linhas diferentes no filtro de Método, três fatias no gráfico, e nenhuma
 * somando com a outra.
 *
 * A normalização mora aqui, dentro de `recordTransaction`, e não em cada
 * webhook: é o único ponto por onde toda venda passa, então não há como um
 * caminho novo esquecer de chamar.
 *
 * O que não é reconhecido volta em minúsculas, como veio. Chutar "pix" para um
 * método desconhecido seria inventar um dado; minúsculo pelo menos junta as
 * variações de caixa da mesma coisa.
 */
export function normalizarMetodo(raw: string | undefined | null): string | undefined {
  const v = (raw || "").trim().toLowerCase();
  if (!v || v === "-") return undefined;
  if (v.includes("pix")) return "pix";
  if (/cart[aã]o|card|credit|cr[eé]dito|d[eé]bito|debit/.test(v)) return "card";
  return v;
}

/**
 * Arruma o método das cobranças JÁ gravadas — as que entraram como "PIX" ou
 * "Pix" antes de a normalização existir.
 *
 * Sem isto, a correção só valeria para vendas novas e o filtro continuaria
 * mostrando as três variantes do histórico. Idempotente: rodar de novo não
 * muda nada além do que ainda estiver fora do padrão.
 */
export function normalizarMetodosGravados(): number {
  const db = getDb();
  const linhas = db
    .prepare("SELECT DISTINCT method FROM transactions WHERE method IS NOT NULL AND method <> ''")
    .all() as { method: string }[];
  let mudadas = 0;
  for (const l of linhas) {
    const certo = normalizarMetodo(l.method);
    if (!certo || certo === l.method) continue;
    mudadas += db
      .prepare("UPDATE transactions SET method = ? WHERE method = ?")
      .run(certo, l.method).changes;
  }
  return mudadas;
}

export function recordTransaction(input: {
  provider: string;
  providerRef?: string;
  profileId?: string;
  /** Bot do Telegram que gerou a cobrança (venda pelo bot de vendas). Vazio
   *  em venda do LTV ou lançada à mão. */
  botId?: string;
  description?: string;
  customer?: string;
  amountCents: number;
  /** Valor líquido (sem a taxa), quando o gateway já informou. */
  netAmountCents?: number;
  currency?: string;
  method?: string;
  status: string;
  /** O que o GATEWAY cobrou, quando ele informa (a Stripe informa; a SyncPay
   *  não, e cai na tabela determinística logo abaixo). */
  feeCents?: number;
  /** O que quem opera o bot por fora reteve — `application_fee` na Stripe,
   *  split na SyncPay. É o número que separa funil de LTV nessas vendas. */
  splitCents?: number;
  /** A venda como o gateway LIQUIDOU, quando ele converteu de moeda: US$ 19,90
   *  cobrados viram R$ 101,28 depositados. Só vem quando difere da cobrança. */
  settledAmountCents?: number;
  settledCurrency?: string;
  /** Código do deep-link que trouxe o lead (origem do tráfego). */
  sourceCode?: string;
  /**
   * Qual parte do painel gerou esta cobrança: 'bot' (bot de vendas do
   * Telegram), 'ltv' (agente de LTV) ou 'painel' (lançada à mão). É o que
   * separa o Funil de Vendas do Funil de LTV — sem isso os dois mediam a mesma
   * pilha de transações e nenhuma das taxas de conversão fazia sentido.
   */
  origin?: "bot" | "ltv" | "painel";
}): Transaction {
  const now = Date.now();
  const id = randomUUID();
  // Já nasce com a conta fechada quando a venda entra paga: taxa pela tabela da
  // SyncPay (determinística), split com o que sobrar do desconto informado.
  // Informados pelo gateway ganham de qualquer cálculo: são o número real,
  // não uma estimativa por tabela de preço.
  let fee: number | null = input.feeCents ?? null;
  let split: number | null = input.splitCents ?? null;
  let net = input.netAmountCents ?? null;
  // A tabela de taxas é da SyncPay. Uma venda lançada na mão no LTV (o lead
  // pagou direto na chave pix da modelo) não passou por gateway nenhum:
  // descontar taxa dela faria o faturamento mostrar menos do que entrou.
  if (fee !== null) {
    if (net === null) net = input.amountCents - fee - (split ?? 0);
  } else if (input.status === "paid" && input.provider === "syncpay") {
    const tabela = syncPayFeeCents(input.amountCents);
    const desconto = net !== null && net < input.amountCents ? input.amountCents - net : tabela;
    fee = Math.min(tabela, desconto);
    split = Math.max(0, desconto - fee);
    if (net === null) net = input.amountCents - desconto;
  } else if (input.status === "paid" && net === null) {
    net = input.amountCents;
  }
  getDb()
    .prepare(
      `INSERT INTO transactions
        (id, provider, provider_ref, profile_id, bot_id, description, customer,
         amount_cents, net_amount_cents, fee_cents, split_cents, paid_at,
         currency, method, status, source_code, origin,
         settled_amount_cents, settled_currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.provider,
      input.providerRef || null,
      input.profileId || null,
      input.botId || null,
      input.description || null,
      input.customer || null,
      input.amountCents,
      net,
      fee,
      split,
      input.status === "paid" ? now : null,
      input.currency || "BRL",
      normalizarMetodo(input.method) || null,
      input.status,
      input.sourceCode || null,
      input.origin || null,
      input.settledAmountCents ?? null,
      input.settledCurrency || null,
      now,
      now,
    );
  return getTransaction(id)!;
}

/**
 * Soma leve das transações pagas de um perfil (usada na coluna Faturamento
 * da listagem de Modelos) — evita chamar `overview()`, que roda várias
 * queries por período e seria caro repetir uma vez por perfil.
 */
export function totalPaidCentsByProfile(profileId: string): number {
  const r = getDb()
    .prepare(
      `SELECT COALESCE(SUM(${VALOR_LIQUIDADO}),0) s FROM transactions
        WHERE status = 'paid' AND ${SO_REAL} AND profile_id = ?`,
    )
    .get(profileId) as { s: number };
  return r.s;
}

export function getTransaction(id: string): Transaction | null {
  const r = getDb()
    .prepare("SELECT * FROM transactions WHERE id = ?")
    .get(id) as Row | undefined;
  return r ? toClient(r) : null;
}

export function listTransactions(limit = 50, profileId?: string): Transaction[] {
  const rows = profileId
    ? (getDb()
        .prepare(
          "SELECT * FROM transactions WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(profileId, limit) as Row[])
    : (getDb()
        .prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?")
        .all(limit) as Row[]);
  return rows.map(toClient);
}

/**
 * Corrige à mão o que o gateway não soube dizer.
 *
 * O gateway nem sempre manda tudo (e nem sempre manda certo): uma venda de
 * R$ 19,90 já entrou como R$ 20,70 por leitura errada do payload. E numa
 * venda de BOT OPERADO POR FORA ele mal sabe o que foi vendido — produto,
 * método, código de origem e modelo chegam vazios e só o relatório do Canal
 * de Vendas os traz, se e quando chegar. Em vez de mexer no banco por fora,
 * o operador ajusta na própria tela.
 *
 * Cada campo é OPCIONAL e independente: o que não vier fica como está. Uma
 * string vazia é uma decisão do operador ("apagar isso"), diferente de
 * `undefined` ("não mexi nisso") — por isso a distinção é preservada em vez
 * de tratar tudo como falsy.
 *
 * O líquido não é editável de propósito — ele é sempre venda − taxa − split,
 * e deixar os quatro soltos abriria espaço para uma linha que não fecha.
 *
 * `status`, `paid_at`, `provider_ref` e moeda também ficam de fora: são a
 * palavra do gateway sobre dinheiro que entrou (ou não). Deixar o status
 * editável transformaria o Financeiro num campo livre — o faturamento do mês
 * mudaria com um clique, sem nada no gateway para conferir.
 */
export function updateTransaction(
  id: string,
  input: {
    amountCents?: number;
    feeCents?: number;
    splitCents?: number;
    customer?: string;
    /** Bot que fez a venda. É por ELE que a tela atribui: escolher o bot já
     *  diz a modelo (um bot por modelo), enquanto escolher a modelo deixava o
     *  `bot_id` vazio e a linha ficava em "Sem bot" no filtro. "" desvincula
     *  os dois. */
    botId?: string;
    /** Modelo a que a venda pertence. Continua aceito para o caso que o bot
     *  não cobre: modelo SEM bot cadastrado (venda de LTV ou lançada à mão).
     *  "" desvincula. */
    profileId?: string;
    /** O PRODUTO (coluna Produto e texto de toda notificação de venda). Numa
     *  venda de bot operado por fora ele nasce vazio: o gateway só sabe o
     *  valor. "" volta a esvaziar. */
    description?: string;
    /** "pix" | "card" — o vocabulário da coluna Método e do filtro dela. */
    method?: string;
    /** Código do deep-link que trouxe o lead (`?start=CODIGO`). É a origem de
     *  tráfego da venda no Funil. */
    sourceCode?: string;
    /** 'bot' | 'ltv' | 'painel'. É o que decide de qual funil a venda
     *  participa; linha antiga tem NULL e o Funil de Vendas a ignora. */
    origin?: string;
  },
): Transaction | null {
  const atual = getTransaction(id);
  if (!atual) return null;

  const venda = input.amountCents !== undefined && input.amountCents >= 0 ? input.amountCents : atual.amountCents;
  const taxa = input.feeCents !== undefined && input.feeCents >= 0 ? input.feeCents : atual.feeCents ?? 0;
  const split = input.splitCents !== undefined && input.splitCents >= 0 ? input.splitCents : atual.splitCents ?? 0;
  const liquido = Math.max(0, venda - taxa - split);
  /** "" = apagar; ausente = não mexer. */
  const texto = (novo: string | undefined, antigo: string | undefined) =>
    novo !== undefined ? novo.trim() || null : antigo ?? null;
  const customer = texto(input.customer, atual.customer);
  const perfil = texto(input.profileId, atual.profileId);
  const description = texto(input.description, atual.description);
  const method = texto(input.method, atual.method);
  const sourceCode = texto(input.sourceCode, atual.sourceCode);
  const origin = texto(input.origin, atual.origin);

  // A MODELO SEGUE O BOT. Existe exatamente um bot por modelo
  // (`telegram_bots.profile_id` é UNIQUE), então os dois são a mesma
  // informação — e a tela pergunta pelo BOT, que é o lado que carrega o outro.
  // Pelo caminho inverso (escolher a modelo) o `bot_id` ficava vazio, e era
  // isso que mantinha a linha em "Sem bot" no filtro e sem @usuário na coluna
  // Bot mesmo depois de corrigida.
  //
  // `profileId` continua aceito sozinho para o caso que o bot não cobre:
  // modelo SEM bot cadastrado (venda de LTV ou lançada à mão). Aí o vínculo de
  // bot é desfeito, porque essa venda não passou por bot nenhum.
  let botId = atual.botId ?? null;
  let perfilFinal = perfil;
  if (input.botId !== undefined) {
    const escolhido = input.botId.trim();
    if (escolhido) {
      const dono = getDb()
        .prepare("SELECT id, profile_id FROM telegram_bots WHERE id = ?")
        .get(escolhido) as { id: string; profile_id: string } | undefined;
      if (dono) {
        botId = dono.id;
        perfilFinal = dono.profile_id;
      }
      // Bot que não existe mais: não mexe em nada. Apagar a atribuição por
      // causa de um id velho seria perder um dado certo por um erro nosso.
    } else {
      // "" = desvincular. Sem bot escolhido e sem modelo informada, a venda
      // volta a ser "Sem modelo" — que é o que o operador pediu.
      botId = null;
      if (input.profileId === undefined) perfilFinal = null;
    }
  } else if (input.profileId !== undefined && perfil !== (atual.profileId ?? null)) {
    // Caminho da modelo sem bot: atribui a modelo e desfaz qualquer bot que
    // estivesse pendurado ali.
    botId = perfil
      ? ((getDb().prepare("SELECT id FROM telegram_bots WHERE profile_id = ?").get(perfil) as
          | { id: string }
          | undefined)?.id ?? null)
      : null;
  }

  getDb()
    .prepare(
      `UPDATE transactions
       SET amount_cents = ?, fee_cents = ?, split_cents = ?, net_amount_cents = ?,
           customer = ?, profile_id = ?, bot_id = ?, description = ?, method = ?,
           source_code = ?, origin = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      venda,
      taxa,
      split,
      liquido,
      customer,
      perfilFinal,
      botId,
      description,
      method,
      sourceCode,
      origin,
      Date.now(),
      id,
    );
  return getTransaction(id);
}

/**
 * Apaga uma cobrança do histórico. Existe porque o webhook da SyncPay é por
 * CONTA e traz movimentos que não são venda (saque, por exemplo) — quando um
 * deles escapa da filtragem, o operador precisa poder tirar do Financeiro sem
 * mexer no banco. A inscrição do Telegram que apontasse para ela fica com
 * `transaction_id` nulo (ON DELETE SET NULL), sem perder o acesso do cliente.
 */
export function deleteTransaction(id: string): boolean {
  const r = getDb().prepare("DELETE FROM transactions WHERE id = ?").run(id);
  return r.changes > 0;
}

/**
 * Cobranças de um intervalo [since, until) — as pontas vêm resolvidas no fuso
 * da operação. Usada pelo Financeiro, que filtra por período na origem em vez
 * de cortar as últimas N no navegador (senão o filtro só veria essas N).
 *
 * SEM limite por padrão: o registro é o que sustenta a conferência financeira
 * — um teto arbitrário derrubando linha do meio de um período grande (mais de
 * ~500 cobranças) é dado que some sem aviso nenhum. `limit` só existe para
 * quem realmente quer as últimas N (nenhum chamador usa hoje).
 */
export function listTransactionsInRange(
  sinceMs: number | null,
  untilMs: number | null,
  limit?: number,
  profileId?: string,
): Transaction[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (sinceMs !== null) {
    clauses.push("t.created_at >= ?");
    params.push(sinceMs);
  }
  if (untilMs !== null) {
    clauses.push("t.created_at < ?");
    params.push(untilMs);
  }
  if (profileId) {
    clauses.push("t.profile_id = ?");
    params.push(profileId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  if (limit) params.push(limit);
  const rows = getDb()
    .prepare(
      `SELECT t.*, b.bot_username, bp.bot_username AS profile_bot_username, bp.id AS profile_bot_id
         FROM transactions t
         LEFT JOIN telegram_bots b ON b.id = t.bot_id
         -- O bot da MODELO, para a venda que não tem bot próprio (LTV). Um bot
         -- por modelo (telegram_bots.profile_id e UNIQUE), entao o JOIN nunca
         -- multiplica linha.
         LEFT JOIN telegram_bots bp ON bp.profile_id = t.profile_id
         ${where}
        ORDER BY t.created_at DESC
        ${limit ? "LIMIT ?" : ""}`,
    )
    .all(...params) as Row[];
  return rows.map(toClient);
}

/**
 * Normaliza o status de um provedor para o vocabulário interno. "med"
 * (disputa/chargeback da SyncPay) fica separado de "refunded" para que o
 * painel financeiro mostre reembolso e chargeback como métricas distintas.
 */
export function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (["paid", "completed", "approved", "confirmed", "success"].includes(s)) return "paid";
  if (["chargeback", "med"].includes(s)) return "chargeback";
  if (["refunded"].includes(s)) return "refunded";
  if (["failed", "canceled", "cancelled", "expired", "declined", "error"].includes(s))
    return "failed";
  return "pending";
}

export function findByProviderRef(
  provider: string,
  providerRef: string,
): Transaction | null {
  const r = getDb()
    .prepare("SELECT * FROM transactions WHERE provider = ? AND provider_ref = ?")
    .get(provider, providerRef) as Row | undefined;
  return r ? toClient(r) : null;
}

/** Última venda paga registrada (qualquer perfil/provedor) — usado como
 *  diagnóstico em Configurações → Pagamentos para confirmar que o webhook da
 *  SyncPay está realmente chegando, e no Dashboard para o toast de venda
 *  nova. Ordena por `paid_at` (quando ela virou paga), não `created_at`
 *  (quando a cobrança foi gerada) — uma cobrança antiga que acabou de ser
 *  paga tem que aparecer como a mais recente, não sumir atrás de uma
 *  cobrança gerada depois dela mas ainda pendente. */
export function lastPaidTransaction(): { at: number; amountCents: number; customer?: string } | null {
  const r = getDb()
    .prepare(
      "SELECT created_at, paid_at, amount_cents, customer FROM transactions WHERE status = 'paid' ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 1",
    )
    .get() as
    | { created_at: number; paid_at: number | null; amount_cents: number; customer: string | null }
    | undefined;
  if (!r) return null;
  return { at: r.paid_at ?? r.created_at, amountCents: r.amount_cents, customer: r.customer || undefined };
}

/**
 * Atualiza o status de uma transação pelo provider_ref (usado no webhook).
 * Retorna a transação atualizada, ou null se não encontrada. Também
 * indica se houve transição para "paid" (para disparar alerta de nova venda).
 */
export function updateStatusByRef(
  provider: string,
  providerRef: string,
  status: string,
  /** Valores informados pelo gateway: o cheio e o líquido (já sem a taxa). */
  amounts?: {
    grossCents?: number;
    netCents?: number;
    feeCents?: number;
    splitCents?: number;
    /** A venda como o gateway liquidou, quando converteu de moeda. */
    settledAmountCents?: number;
    settledCurrency?: string;
  },
): { transaction: Transaction; becamePaid: boolean } | null {
  const existing = findByProviderRef(provider, providerRef);
  if (!existing) return null;
  const normalized = normalizeStatus(status);
  const becamePaid = existing.status !== "paid" && normalized === "paid";
  const now = Date.now();

  // `amount` da SyncPay é a VENDA CHEIA e `final_amount` o líquido (o cashin
  // documentado manda os dois). O histórico antigo ficou R$ 0,80 menor porque
  // o código de então gravava o `final_amount` no lugar da venda — não porque
  // o gateway informe o líquido no `amount`. Aqui o valor informado é aceito
  // como venda; só um valor ausente ou zerado preserva o da cobrança.
  const informado = amounts?.grossCents && amounts.grossCents > 0 ? amounts.grossCents : null;
  const gross = informado ?? existing.amountCents;
  let net =
    amounts?.netCents && amounts.netCents > 0 ? amounts.netCents : existing.netAmountCents ?? null;
  // paid_at marca a hora do PAGAMENTO (createdAt é a geração do Pix). Não
  // reescreve se já estava paga, para não mascarar a data original.
  const paidAt = normalized === "paid" ? existing.paidAt ?? now : existing.paidAt ?? null;

  // Separa o desconto entre TAXA (tabela do gateway) e SPLIT (repasse), como o
  // próprio painel da SyncPay mostra: entrada − taxas − split = você recebe.
  // Quando o gateway não manda o líquido, a taxa ainda é conhecida: a tabela da
  // SyncPay é determinística (R$ 0,80 até R$ 100; + 1,99% acima). Sem isso a
  // venda entraria no extrato sem taxa e sem líquido.
  let fee = amounts?.feeCents ?? existing.feeCents ?? null;
  let split = amounts?.splitCents ?? existing.splitCents ?? null;
  // A tabela de taxa é da SyncPay (PIX) — aplicá-la a outro provedor (ex.:
  // Stripe, em centavos de dólar) daria um desconto sem sentido nenhum sobre
  // o valor. Só cai nesse fallback quando a venda É da SyncPay.
  if (fee === null && normalized === "paid" && existing.provider === "syncpay") {
    const tabela = syncPayFeeCents(gross);
    const desconto = net !== null ? Math.max(0, gross - net) : tabela;
    fee = Math.min(tabela, desconto);
    split = Math.max(0, desconto - fee);
  }
  if (net === null && fee !== null && normalized === "paid") {
    net = gross - fee - (split ?? 0);
  }
  // Provedor sem tabela de taxa própria (ainda): líquido = venda cheia, em vez
  // de ficar sem valor nenhum no extrato até alguém cadastrar uma taxa.
  if (net === null && normalized === "paid") {
    net = gross;
  }

  // A liquidação só entra quando VEM: uma atualização que não fala de moeda não
  // pode apagar a conversão que outra já gravou.
  getDb()
    .prepare(
      `UPDATE transactions
       SET status = ?, amount_cents = ?, net_amount_cents = ?, fee_cents = ?, split_cents = ?,
           settled_amount_cents = COALESCE(?, settled_amount_cents),
           settled_currency = COALESCE(?, settled_currency),
           paid_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      normalized, gross, net, fee, split,
      amounts?.settledAmountCents ?? null,
      amounts?.settledCurrency || null,
      paidAt, now, existing.id,
    );
  return { transaction: getTransaction(existing.id)!, becamePaid };
}

/**
 * Grava a taxa, o split e o líquido que o GATEWAY informou, sem tocar em mais
 * nada da cobrança. Usada pelo repescagem das taxas da Stripe (ver
 * `payments/stripeTaxasCron.ts`), que chega depois do webhook e não pode
 * mexer em produto, modelo ou qualquer correção que o operador já tenha feito
 * na tela.
 *
 * Só preenche o que estiver VAZIO: taxa já gravada (pelo webhook ou à mão)
 * manda, e a repescagem não a sobrescreve.
 */
export function completarTaxasDoGateway(
  id: string,
  taxas: {
    feeCents: number | null;
    splitCents: number;
    netCents: number | null;
    moeda?: string;
    grossCents?: number | null;
  },
): boolean {
  const atual = getTransaction(id);
  if (!atual) return false;
  const faltaConversao =
    (atual.currency || "BRL") !== "BRL" && atual.settledAmountCents === undefined;
  // Taxa já gravada (pelo webhook ou corrigida à mão) manda. Mas uma venda
  // internacional sem o valor em real ainda precisa ser completada, mesmo com
  // a taxa preenchida — senão ela fica fora do faturamento para sempre.
  if (atual.feeCents !== undefined && !faltaConversao) return false;
  if (taxas.feeCents === null) {
    // Só a comissão da plataforma é conhecida (a cobrança ainda não entrou no
    // saldo): grava ela e deixa taxa, líquido e conversão para a próxima
    // passada — nenhum dos três existe antes da liquidação.
    getDb()
      .prepare("UPDATE transactions SET split_cents = ?, updated_at = ? WHERE id = ?")
      .run(taxas.splitCents, Date.now(), id);
    return true;
  }
  // A liquidação em outra moeda entra junto: sem ela, a venda em dólar teria
  // taxa e líquido em real ao lado de um bruto em dólar, e a linha não fecharia.
  const converteu = Boolean(
    taxas.moeda && taxas.grossCents != null && taxas.moeda !== (atual.currency || "BRL"),
  );
  const liquido = taxas.netCents ?? (converteu ? taxas.grossCents! : atual.amountCents) - taxas.feeCents - taxas.splitCents;
  getDb()
    .prepare(
      `UPDATE transactions
          SET fee_cents = ?, split_cents = ?, net_amount_cents = ?,
              settled_amount_cents = COALESCE(?, settled_amount_cents),
              settled_currency = COALESCE(?, settled_currency),
              updated_at = ?
        WHERE id = ?`,
    )
    .run(
      taxas.feeCents, taxas.splitCents, liquido,
      converteu ? taxas.grossCents : null,
      converteu ? taxas.moeda : null,
      Date.now(), id,
    );
  return true;
}

/** Normaliza um identificador para comparação (o export corta em 30 chars e
 *  às vezes omite os hifens do UUID). */
function normRef(v: string): string {
  return (v || "").toLowerCase().replace(/[^0-9a-z]/g, "");
}

export type ImportRow = {
  externalId: string;
  amountCents: number;
  netCents: number;
  feeCents: number;
  splitCents: number;
  status: string;
  createdAtMs: number;
  customer?: string;
};

export type ImportResult = {
  total: number;
  atualizadas: number;
  novas: number;
  semMudanca: number;
  amostra: { quando: number; venda: number; taxa: number; split: number; liquido: number; status: string; acao: string }[];
};

/**
 * Aplica as linhas da exportação do gateway sobre o banco.
 *
 * Casamento: primeiro pelo identificador (prefixo, porque o PDF trunca em 30
 * caracteres); se não achar, por valor + horário de criação próximos (±3 min),
 * que é o par praticamente único de uma cobrança. Não achando nada, a venda é
 * CRIADA — assim o histórico fica completo mesmo para vendas que nunca
 * chegaram ao painel.
 *
 * `dryRun` não grava nada: serve para a tela mostrar a prévia antes.
 */
export function importProviderRows(
  provider: string,
  linhas: ImportRow[],
  opts: { dryRun?: boolean } = {},
): ImportResult {
  const db = getDb();
  const existentes = db
    .prepare("SELECT * FROM transactions WHERE provider = ?")
    .all(provider) as Row[];

  const res: ImportResult = { total: linhas.length, atualizadas: 0, novas: 0, semMudanca: 0, amostra: [] };

  const aplicar = db.transaction(() => {
    for (const l of linhas) {
      const alvo = normRef(l.externalId);
      let achou: Row | undefined = existentes.find((e) => {
        const r = normRef(e.provider_ref || "");
        return r.length > 0 && alvo.length > 0 && (r.startsWith(alvo) || alvo.startsWith(r));
      });
      if (!achou) {
        achou = existentes.find(
          (e) => e.amount_cents === l.amountCents && Math.abs(e.created_at - l.createdAtMs) <= 3 * 60_000,
        );
      }

      const status = normalizeStatus(l.status);
      const pago = status === "paid";
      let acao: string;

      if (achou) {
        const mudou =
          achou.amount_cents !== l.amountCents ||
          achou.net_amount_cents !== l.netCents ||
          achou.fee_cents !== l.feeCents ||
          achou.split_cents !== l.splitCents ||
          achou.status !== status;
        if (mudou) {
          res.atualizadas++;
          acao = "atualizada";
          if (!opts.dryRun) {
            db.prepare(
              `UPDATE transactions
               SET amount_cents = ?, net_amount_cents = ?, fee_cents = ?, split_cents = ?,
                   status = ?, created_at = ?,
                   paid_at = COALESCE(paid_at, ?), customer = COALESCE(customer, ?),
                   reprocessed_at = ?, updated_at = ?
               WHERE id = ?`,
            ).run(
              l.amountCents, l.netCents, l.feeCents, l.splitCents, status, l.createdAtMs,
              pago ? l.createdAtMs : null, l.customer || null,
              Date.now(), Date.now(), achou.id,
            );
          }
        } else {
          res.semMudanca++;
          acao = "sem mudança";
        }
      } else {
        res.novas++;
        acao = "nova";
        if (!opts.dryRun) {
          db.prepare(
            `INSERT INTO transactions
              (id, provider, provider_ref, profile_id, description, customer,
               amount_cents, net_amount_cents, fee_cents, split_cents, paid_at,
               currency, method, status, reprocessed_at, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'BRL', 'pix', ?, ?, ?, ?)`,
          ).run(
            randomUUID(), provider, l.externalId, "Venda SyncPay", l.customer || null,
            l.amountCents, l.netCents, l.feeCents, l.splitCents,
            pago ? l.createdAtMs : null, status,
            Date.now(), l.createdAtMs, Date.now(),
          );
        }
      }

      if (res.amostra.length < 8) {
        res.amostra.push({
          quando: l.createdAtMs, venda: l.amountCents,
          taxa: l.feeCents, split: l.splitCents, liquido: l.netCents,
          status, acao,
        });
      }
    }
  });
  aplicar();
  return res;
}

/** Agrupa o método de pagamento num rótulo de exibição. Desde a normalização
 *  (ver `normalizarMetodo`) ele já chega padronizado, mas o `includes` fica:
 *  é o que cobre linha antiga que a migração ainda não tocou. "PIX" em caixa
 *  alta é o mesmo rótulo da coluna Método, para as duas telas não chamarem a
 *  mesma coisa de dois jeitos. */
function methodBucket(method: string | null): "PIX" | "Cartão" | "Boleto" | "Outros" {
  const m = (method || "").toLowerCase();
  if (m.includes("pix")) return "PIX";
  if (m.includes("card") || m.includes("cart")) return "Cartão";
  if (m.includes("boleto")) return "Boleto";
  return "Outros";
}

/**
 * DINHEIRO NÃO SE SOMA ENTRE MOEDAS.
 *
 * A tabela guarda a moeda de cada venda (`transactions.currency`), mas TODA
 * soma de faturamento ignorava a coluna: uma venda de US$ 20 entrava como
 * 2000 centavos no mesmo `SUM` que R$ 20,00, e o painel exibia o resultado
 * com "R$" na frente. Quanto mais internacional a operação, mais errado o
 * número — e errado para MENOS, porque o dólar vale mais que o real.
 *
 * A regra agora é a MOEDA DE LIQUIDAÇÃO, não a da cobrança. Um cartão cobrado
 * em dólar que a Stripe deposita em real É faturamento em real, e entra pelo
 * valor que de fato caiu na conta (`settled_amount_cents`) — não pelo valor em
 * dólar, que viraria um número inventado, nem de fora do total, que é onde ele
 * ficava antes.
 *
 * Nada disso é estimativa: os dois lados vêm do extrato da própria Stripe
 * (ver `payments/stripeTaxas.ts`), com a cotação que ela usou na hora.
 *
 * `COALESCE` em cascata porque as colunas nasceram em épocas diferentes: venda
 * sem liquidação registrada vale pela moeda da cobrança, e venda anterior à
 * coluna `currency` é real.
 */
/** A moeda em que o dinheiro ENTROU. */
const MOEDA_LIQUIDADA = "COALESCE(settled_currency, currency, 'BRL')";
/** O valor que ENTROU, na moeda acima. */
const VALOR_LIQUIDADO = "COALESCE(settled_amount_cents, amount_cents)";
const SO_REAL = `${MOEDA_LIQUIDADA} = 'BRL'`;
const SO_REAL_T = "COALESCE(t.settled_currency, t.currency, 'BRL') = 'BRL'";
/** O valor que entrou, com apelido de tabela. */
const VALOR_LIQUIDADO_T = "COALESCE(t.settled_amount_cents, t.amount_cents)";

/** Uma linha por moeda de COBRANÇA do período. */
export type ReceitaPorMoeda = {
  /** A moeda em que o CLIENTE pagou. */
  currency: string;
  paidCount: number;
  /** Faturamento bruto NA MOEDA DA COBRANÇA (US$ 19,90). */
  paidCents: number;
  /** O mesmo faturamento em real, como o gateway liquidou (R$ 101,28). Quando
   *  a liquidação ainda não foi lida, é o próprio valor cobrado. */
  paidBrlCents: number;
  /** Líquido em real. */
  netBrlCents: number;
};

/**
 * O faturamento aberto POR MOEDA DE COBRANÇA — as duas linhas pequenas
 * embaixo do total.
 *
 * O total grande é um só, em real, porque é isso que entra na conta: o cartão
 * cobrado em dólar é depositado em real, e o extrato da Stripe traz os dois
 * lados. Mas quanto foi VENDIDO em dólar é informação que o total em real não
 * carrega, e é a que diz se o internacional está crescendo — por isso cada
 * moeda aparece aqui com o símbolo dela.
 *
 * Antes isto era "vendas em outra moeda": a venda internacional ficava FORA do
 * faturamento e aparecia num bloco à parte, porque converter exigiria uma
 * cotação que não se tinha. Agora se tem — a da própria liquidação —, então o
 * total volta a ser o total.
 */
export function receitaPorMoeda(
  sinceMs: number | null,
  untilMs: number | null,
  profileId?: string,
): ReceitaPorMoeda[] {
  const clauses: string[] = ["status = 'paid'"];
  const params: (number | string)[] = [];
  if (sinceMs !== null) {
    clauses.push("created_at >= ?");
    params.push(sinceMs);
  }
  if (untilMs !== null) {
    clauses.push("created_at < ?");
    params.push(untilMs);
  }
  if (profileId) {
    clauses.push("profile_id = ?");
    params.push(profileId);
  }
  return getDb()
    .prepare(
      `SELECT COALESCE(currency,'BRL') currency, COUNT(*) paidCount,
              COALESCE(SUM(amount_cents),0) paidCents,
              COALESCE(SUM(${VALOR_LIQUIDADO}),0) paidBrlCents,
              COALESCE(SUM(COALESCE(net_amount_cents, ${VALOR_LIQUIDADO})),0) netBrlCents
         FROM transactions
        WHERE ${clauses.join(" AND ")}
        GROUP BY COALESCE(currency,'BRL')
        ORDER BY paidBrlCents DESC`,
    )
    .all(...params) as ReceitaPorMoeda[];
}

export type PeriodStats = {
  /** Faturamento BRUTO (valor cheio das vendas pagas). */
  paidCents: number;
  /** Faturamento LÍQUIDO (já sem a taxa do gateway). Quando o gateway ainda não
   *  informou o líquido de alguma venda, cai no valor cheio dela. */
  paidNetCents: number;
  paidCount: number;
  pendingCents: number;
  pendingCount: number;
  refundedCents: number;
  refundedCount: number;
  chargebackCents: number;
  chargebackCount: number;
  avgTicketCents: number;
  /** Distribuição das vendas pagas por método (para o gráfico de rosca). */
  methodBreakdown: { method: string; count: number; cents: number }[];
};

/** Como computePeriodStats, mas aceita também um limite superior (untilMs) —
 *  necessário para períodos fechados como "Ontem" ([início, fim)). Exportada
 *  para o painel do bot de vendas (períodos Hoje/Ontem/7 dias/30 dias/Máximo). */
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Uma faixa de "quando o público compra" — um dia da semana ou uma hora. */
export type QuandoRow = {
  key: number;
  label: string;
  /** Faturamento somado da faixa no período. */
  cents: number;
  /** Vendas somadas da faixa no período. */
  count: number;
  /** Quantas vezes a faixa ocorreu no período (ex.: nº de terças). */
  occurrences: number;
  /** Média de VENDAS por ocorrência. `null` quando não há período apurável. */
  avgCount: number | null;
  /** Média de FATURAMENTO (centavos) por ocorrência. */
  avgCents: number | null;
  /** Ticket médio da faixa. `null` quando não houve venda. */
  avgTicketCents: number | null;
};

/**
 * Quantas vezes cada dia da semana e cada hora do dia ocorreram no intervalo,
 * no fuso da operação. É o DENOMINADOR das médias "por dia": sem ele, um
 * período com 5 terças e 4 quartas faz a terça parecer melhor só por ter
 * acontecido mais vezes — comparar somas de amostras de tamanhos diferentes.
 *
 * Caminha dia a dia no calendário do fuso (aritmética de calendário pura, sem
 * reconverter fuso a cada passo). O primeiro e o último dia entram só com as
 * horas realmente cobertas — senão "Hoje" às 11h contaria as 24 horas do dia e
 * as médias da noite sairiam pela metade.
 */
function contaOcorrencias(
  startMs: number,
  endMs: number,
  tz: string,
): { weekday: number[]; hour: number[] } {
  const weekday = new Array<number>(7).fill(0);
  const hour = new Array<number>(24).fill(0);
  if (!(endMs > startMs)) return { weekday, hour };

  const ini = partsInTimeZone(startMs, tz);
  const fim = partsInTimeZone(endMs - 1, tz);
  const primeiroDia = Date.UTC(ini.year, ini.month - 1, ini.day);
  const ultimoDia = Date.UTC(fim.year, fim.month - 1, fim.day);

  const cur = new Date(primeiroDia);
  // Guarda contra intervalo absurdo (data corrompida no banco) segurar o request.
  for (let i = 0; cur.getTime() <= ultimoDia && i < 4000; i++) {
    const ehPrimeiro = cur.getTime() === primeiroDia;
    const ehUltimo = cur.getTime() === ultimoDia;
    weekday[cur.getUTCDay()] += 1;
    for (let h = ehPrimeiro ? ini.hour : 0; h <= (ehUltimo ? fim.hour : 23); h++) {
      hour[h] += 1;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return { weekday, hour };
}

/**
 * Vendas pagas agrupadas por DIA DA SEMANA e por HORA — "quando o público
 * compra". Serve para escolher os horários de pico do bot e do disparo.
 *
 * Os baldes saem do FUSO DA OPERAÇÃO, não do relógio do servidor: em produção
 * ele roda em UTC e uma venda das 22h de Brasília cairia no dia seguinte.
 *
 * Devolve SEMPRE os 7 dias e as 24 horas, em ordem cronológica, incluindo as
 * faixas sem venda: a resposta procurada muitas vezes é o ZERO de uma faixa
 * (a madrugada vende ou não?), e uma lista que omite as vazias não consegue
 * dizer isso. Cada faixa vem com as médias por ocorrência.
 */
export function revenueByWeekdayAndHour(
  sinceMs: number | null,
  untilMs: number | null,
  tz: string,
  profileId?: string,
): { weekday: QuandoRow[]; hour: QuandoRow[] } {
  const clauses = ["status = 'paid'"];
  const params: (string | number)[] = [];
  // COALESCE: transação antiga pode não ter paid_at — cai no created_at.
  if (sinceMs !== null) {
    clauses.push("COALESCE(paid_at, created_at) >= ?");
    params.push(sinceMs);
  }
  if (untilMs !== null) {
    clauses.push("COALESCE(paid_at, created_at) < ?");
    params.push(untilMs);
  }
  if (profileId) {
    clauses.push("profile_id = ?");
    params.push(profileId);
  }
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(paid_at, created_at) AS at, amount_cents
         FROM transactions WHERE ${clauses.join(" AND ")}`,
    )
    .all(...params) as { at: number; amount_cents: number }[];

  // Semeia TODAS as faixas com zero. Sem isso, uma hora sem venda simplesmente
  // não vira linha e some da tela — justo o caso que se quer enxergar.
  const porDia = new Map<number, { cents: number; count: number }>();
  for (let d = 0; d < 7; d++) porDia.set(d, { cents: 0, count: 0 });
  const porHora = new Map<number, { cents: number; count: number }>();
  for (let h = 0; h < 24; h++) porHora.set(h, { cents: 0, count: 0 });

  for (const r of rows) {
    const p = partsInTimeZone(r.at, tz);
    const dia = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    const soma = (m: Map<number, { cents: number; count: number }>, k: number) => {
      const cur = m.get(k) || { cents: 0, count: 0 };
      cur.cents += r.amount_cents;
      cur.count += 1;
      m.set(k, cur);
    };
    soma(porDia, dia);
    soma(porHora, p.hour);
  }

  // Denominador das médias. No período "Máximo" não há limites explícitos —
  // usa então o intervalo real das próprias transações. Sem nenhuma venda não
  // há período apurável, e as médias saem `null` (a tela mostra "—") em vez de
  // um "R$ 0,00/dia" que finge precisão que não existe.
  let minAt = Infinity;
  let maxAt = -Infinity;
  for (const r of rows) {
    if (r.at < minAt) minAt = r.at;
    if (r.at > maxAt) maxAt = r.at;
  }
  const inicio = sinceMs ?? (rows.length > 0 ? minAt : null);
  const fim = untilMs ?? (rows.length > 0 ? maxAt + 1 : null);
  const occ = inicio !== null && fim !== null ? contaOcorrencias(inicio, fim, tz) : null;

  const monta = (
    entradas: Map<number, { cents: number; count: number }>,
    label: (k: number) => string,
    ocorrencias: number[] | undefined,
  ): QuandoRow[] =>
    [...entradas.entries()]
      // Cronológica, não por faturamento: a pergunta aqui é a FORMA da curva do
      // dia/da semana, e um ranking a embaralha.
      .sort((a, b) => a[0] - b[0])
      .map(([key, v]) => {
        const occurrences = ocorrencias?.[key] ?? 0;
        return {
          key,
          label: label(key),
          cents: v.cents,
          count: v.count,
          occurrences,
          avgCount: occurrences > 0 ? v.count / occurrences : null,
          avgCents: occurrences > 0 ? Math.round(v.cents / occurrences) : null,
          avgTicketCents: v.count > 0 ? Math.round(v.cents / v.count) : null,
        };
      });

  return {
    weekday: monta(porDia, (k) => DIAS_SEMANA[k], occ?.weekday),
    hour: monta(porHora, (k) => `${String(k).padStart(2, "0")}h`, occ?.hour),
  };
}

export function periodStatsInRange(
  sinceMs: number | null,
  untilMs: number | null,
  profileId?: string,
): PeriodStats {
  return computePeriodStats(sinceMs, profileId, untilMs);
}

function computePeriodStats(
  sinceMs: number | null,
  profileId?: string,
  untilMs: number | null = null,
): PeriodStats {
  const db = getDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (sinceMs !== null) {
    clauses.push("created_at >= ?");
    params.push(sinceMs);
  }
  if (untilMs !== null) {
    clauses.push("created_at < ?");
    params.push(untilMs);
  }
  if (profileId) {
    clauses.push("profile_id = ?");
    params.push(profileId);
  }
  const where = clauses.length ? `AND ${clauses.join(" AND ")}` : "";

  const byStatus = (status: string) =>
    db
      .prepare(
        // `n` = líquido: usa net_amount_cents quando o gateway já informou;
        // senão cai no valor cheio, para vendas antigas não sumirem do total.
        `SELECT COUNT(*) c, COALESCE(SUM(${VALOR_LIQUIDADO}),0) s,
                COALESCE(SUM(COALESCE(net_amount_cents, amount_cents)),0) n
         FROM transactions WHERE status = ? AND ${SO_REAL} ${where}`,
      )
      .get(status, ...params) as { c: number; s: number; n: number };

  const paid = byStatus("paid");
  const pending = byStatus("pending");
  const refunded = byStatus("refunded");
  const chargeback = byStatus("chargeback");

  const methodRows = db
    .prepare(
      `SELECT COALESCE(method,'') method, COUNT(*) c, COALESCE(SUM(${VALOR_LIQUIDADO}),0) s
       FROM transactions WHERE status = 'paid' AND ${SO_REAL} ${where}
       GROUP BY method`,
    )
    .all(...params) as { method: string; c: number; s: number }[];

  const bucketed = new Map<string, { count: number; cents: number }>();
  for (const row of methodRows) {
    const label = methodBucket(row.method);
    const acc = bucketed.get(label) || { count: 0, cents: 0 };
    acc.count += row.c;
    acc.cents += row.s;
    bucketed.set(label, acc);
  }

  return {
    paidCents: paid.s,
    paidNetCents: paid.n,
    paidCount: paid.c,
    pendingCents: pending.s,
    pendingCount: pending.c,
    refundedCents: refunded.s,
    refundedCount: refunded.c,
    chargebackCents: chargeback.s,
    chargebackCount: chargeback.c,
    avgTicketCents: paid.c > 0 ? Math.round(paid.s / paid.c) : 0,
    methodBreakdown: Array.from(bucketed.entries()).map(([method, v]) => ({
      method,
      count: v.count,
      cents: v.cents,
    })),
  };
}

export type Overview = {
  today: PeriodStats;
  week: PeriodStats;
  month: PeriodStats;
  total: PeriodStats;
  lastSaleAt: number | null;
  /** Últimos 14 dias de receita paga, para o mini-gráfico (mais antigo → hoje). */
  dailySeries: { day: string; cents: number }[];
};

/** Série diária de receita paga dos últimos N dias (hoje incluso), mais
 *  antigo → hoje. Usada no gráfico "Faturamento por período". */
export function revenueSeriesForDays(days: number, profileId?: string): { day: string; cents: number }[] {
  const db = getDb();
  // Os "dias" do gráfico seguem o FUSO DA OPERAÇÃO, não o do servidor (UTC).
  const tz = getAppTimeZone();
  const startOfToday = startOfDayInTimeZone(Date.now(), tz);
  const series: { day: string; cents: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = addDaysInTimeZone(startOfToday, -i, tz);
    const dayEnd = addDaysInTimeZone(dayStart, 1, tz);
    const params: (string | number)[] = [dayStart, dayEnd];
    let sql =
      `SELECT COALESCE(SUM(${VALOR_LIQUIDADO}),0) s FROM transactions
       WHERE status = 'paid' AND ${SO_REAL} AND created_at >= ? AND created_at < ?`;
    if (profileId) {
      sql += " AND profile_id = ?";
      params.push(profileId);
    }
    const r = db.prepare(sql).get(...params) as { s: number };
    series.push({ day: formatDayLabel(dayStart, tz), cents: r.s });
  }
  return series;
}

/**
 * Série do gráfico "faturamento por período" para um intervalo já resolvido.
 *
 * A granularidade acompanha o período escolhido em vez de sempre ser diária:
 *  - um dia só (Hoje, Ontem, ou uma única data no seletor) → por HORA;
 *  - "Esta semana" → segunda a hoje (dias futuros da semana ficam de fora);
 *  - "Este mês" → dia 1 até hoje (idem — sem completar o resto do mês);
 *  - "Máximo" (sem início) → últimos 30 dias, como antes;
 *  - qualquer outro intervalo (últimos 7/30 dias, datas escolhidas à mão) →
 *    exatamente os dias do intervalo, sem completar para trás.
 */
export function revenueSeriesForRange(
  period: PeriodKey,
  sinceMs: number | null,
  untilMs: number | null,
  profileId?: string,
): { day: string; cents: number }[] {
  const tz = getAppTimeZone();
  if (sinceMs === null) return revenueSeriesForDays(30, profileId);

  if (period === "thisWeek") return seriesBetween(sinceMs, 7, profileId);
  if (period === "thisMonth") return seriesBetween(sinceMs, daysInMonth(sinceMs, tz), profileId);
  if (isSingleDayRange(sinceMs, untilMs, tz)) return hourlySeriesForDay(sinceMs, profileId);

  const inicio = startOfDayInTimeZone(sinceMs, tz);
  // `until` é exclusivo: o último dia mostrado é o anterior a ele.
  const fim = startOfDayInTimeZone(untilMs === null ? Date.now() : untilMs - 1, tz);
  const dias = Math.round((fim - inicio) / 86_400_000) + 1;
  return seriesBetween(inicio, Math.min(92, Math.max(1, dias)), profileId);
}

/** O período resolvido cobre um único dia de parede? (Hoje, Ontem, ou uma
 *  data só escolhida à mão) — nesses casos o gráfico vira por hora. */
function isSingleDayRange(sinceMs: number, untilMs: number | null, tz: string): boolean {
  if (untilMs !== null) return untilMs - sinceMs === 86_400_000;
  return sinceMs === startOfDayInTimeZone(Date.now(), tz);
}

/** Quantidade de dias do mês (de parede) que contém `monthStartMs`. */
function daysInMonth(monthStartMs: number, tz: string): number {
  const p = partsInTimeZone(monthStartMs, tz);
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

/** Série por hora (24 pontos) de um único dia — usada quando o período
 *  resolvido é Hoje, Ontem ou uma data única do seletor. */
function hourlySeriesForDay(dayStartMs: number, profileId?: string): { day: string; cents: number }[] {
  const db = getDb();
  const tz = getAppTimeZone();
  // HORAS FUTURAS NÃO ENTRAM — mesmo corte de "Este mês"/"Esta semana"
  // (ver seriesBetween), só que por hora: em "Hoje" as horas que ainda não
  // chegaram apareciam zeradas, parecendo faturamento que caiu a zero. Um dia
  // inteiramente no passado (Ontem, uma data escolhida à mão) continua com
  // as 24 horas — só a hora ATUAL em diante de HOJE fica de fora.
  const horasReais = Math.min(24, Math.max(0, Math.floor((Date.now() - dayStartMs) / 3_600_000) + 1));
  const out: { day: string; cents: number }[] = [];
  for (let h = 0; h < horasReais; h++) {
    const hourStart = dayStartMs + h * 3_600_000;
    const hourEnd = hourStart + 3_600_000;
    const params: (string | number)[] = [hourStart, hourEnd];
    let sql =
      `SELECT COALESCE(SUM(${VALOR_LIQUIDADO}),0) s FROM transactions
       WHERE status = 'paid' AND ${SO_REAL} AND created_at >= ? AND created_at < ?`;
    if (profileId) {
      sql += " AND profile_id = ?";
      params.push(profileId);
    }
    const r = db.prepare(sql).get(...params) as { s: number };
    out.push({ day: formatHourLabel(hourStart, tz), cents: r.s });
  }
  return out;
}

function seriesBetween(
  primeiroDia: number,
  dias: number,
  profileId?: string,
): { day: string; cents: number }[] {
  const db = getDb();
  const tz = getAppTimeZone();
  // DIAS FUTUROS NÃO ENTRAM. "Este mês" e "Esta semana" iam até o fim do
  // período com zero nos dias que ainda nem chegaram — parecia faturamento
  // que caiu a zero, quando na verdade o dia simplesmente não aconteceu
  // ainda, e ainda achatava a média do card. O corte é em HOJE, no fuso da
  // operação — o mesmo que decide onde cada dia começa e termina acima.
  const hoje = startOfDayInTimeZone(Date.now(), tz);
  const diasAteHoje = Math.round((hoje - primeiroDia) / 86_400_000) + 1;
  const diasReais = Math.min(dias, Math.max(0, diasAteHoje));
  const out: { day: string; cents: number }[] = [];
  for (let i = 0; i < diasReais; i++) {
    const dayStart = addDaysInTimeZone(primeiroDia, i, tz);
    const dayEnd = addDaysInTimeZone(dayStart, 1, tz);
    const params: (string | number)[] = [dayStart, dayEnd];
    let sql =
      `SELECT COALESCE(SUM(${VALOR_LIQUIDADO}),0) s FROM transactions
       WHERE status = 'paid' AND ${SO_REAL} AND created_at >= ? AND created_at < ?`;
    if (profileId) {
      sql += " AND profile_id = ?";
      params.push(profileId);
    }
    const r = db.prepare(sql).get(...params) as { s: number };
    out.push({ day: formatDayLabel(dayStart, tz), cents: r.s });
  }
  return out;
}

export function overview(profileId?: string): Overview {
  const db = getDb();
  // Hoje/semana/mês seguem o FUSO DA OPERAÇÃO (Configurações → Geral).
  const tz = getAppTimeZone();
  const startOfToday = startOfDayInTimeZone(Date.now(), tz);
  const p = partsInTimeZone(startOfToday, tz);
  // Dia da semana no fuso: usa o calendário local reconstruído em UTC.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0=dom
  const startOfWeek = addDaysInTimeZone(startOfToday, -((dow + 6) % 7), tz); // segunda
  const startOfMonth = zonedWallTimeToUtcMs(p.year, p.month, 1, 0, 0, tz);

  const lastSaleQuery = profileId
    ? (db
        .prepare(
          "SELECT MAX(created_at) m FROM transactions WHERE status = 'paid' AND profile_id = ?",
        )
        .get(profileId) as { m: number | null })
    : (db
        .prepare("SELECT MAX(created_at) m FROM transactions WHERE status = 'paid'")
        .get() as { m: number | null });

  return {
    today: computePeriodStats(startOfToday, profileId),
    week: computePeriodStats(startOfWeek, profileId),
    month: computePeriodStats(startOfMonth, profileId),
    total: computePeriodStats(null, profileId),
    lastSaleAt: lastSaleQuery.m,
    dailySeries: revenueSeriesForDays(14, profileId),
  };
}
