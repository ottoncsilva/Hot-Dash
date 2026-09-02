/**
 * De qual parte da operação a venda veio: FUNIL (assinatura vendida pelo bot)
 * ou LTV (produto avulso vendido depois, para quem já é cliente).
 *
 * O caso fácil é o bot que o próprio Hot-Dash opera: a venda passou pelo
 * checkout dele e nasceu com `origin` gravado. O caso difícil — e o motivo
 * deste arquivo existir — é o bot operado POR FORA (o Bobz), cuja venda chega
 * só como uma cobrança no gateway: ali `origin` vira `'bot'` para tudo (ver
 * `externalSaleReport.ts`), e funil e LTV ficam no mesmo balde.
 *
 * O que separa os dois é o DINHEIRO. O parceiro cobra tabelas diferentes por
 * tipo de venda, e o quanto ele reteve está gravado em cada transação
 * (`split_cents`, que a importação do export da SyncPay já preenche —
 * ver `syncpayExport.ts`). Duas tabelas, dois números: dado o valor da venda,
 * só uma delas produz o split que está na linha.
 *
 * As tabelas NÃO estão no código: são configuração (Configurações →
 * Pagamentos). Renegociar a comissão é uma conversa comercial, não um deploy,
 * e a classificação é derivada na leitura — mudou a tabela, o histórico
 * inteiro se reclassifica sozinho, sem migração.
 *
 * Não é `server-only`: quem classifica é a tela do Financeiro.
 */

import type { Transaction } from "./transactions";

export type OrigemVenda = "bot" | "ltv" | "painel";

/**
 * A tabela de repasse do parceiro que opera bots por fora: um valor FIXO por
 * transação mais um percentual da venda, e o percentual muda conforme o que
 * foi vendido. Hoje (Bobz): R$ 0,75 + 5% no funil, R$ 0,75 + 20% no LTV.
 */
export type SplitRules = {
  /** Parte fixa, por transação, em centavos. */
  fixoCents: number;
  /** Percentual sobre a venda de PLANO (assinatura). */
  funilPercent: number;
  /** Percentual sobre a venda de PRODUTO avulso (LTV). */
  ltvPercent: number;
};

export const SPLIT_RULES_PADRAO: SplitRules = {
  fixoCents: 75,
  funilPercent: 5,
  ltvPercent: 20,
};

/**
 * Quanto de folga aceitar entre o split esperado e o que está na linha.
 *
 * O percentual cai em fração de centavo (5% de R$ 19,97 são 99,85 centavos) e
 * não dá para saber se o parceiro arredonda ou trunca — 1 centavo de
 * diferença é ruído, não outra tabela. Dois centavos cobrem isso com sobra e
 * continuam MUITO longe de confundir as duas tabelas, que numa venda de
 * R$ 19,93 já estão a R$ 2,99 de distância uma da outra.
 */
const TOLERANCIA_CENTS = 2;

/** O split que a tabela `percent` produziria para uma venda deste valor. */
export function splitEsperadoCents(amountCents: number, fixoCents: number, percent: number): number {
  return fixoCents + Math.round((amountCents * percent) / 100);
}

/**
 * A classificação pelo split, quando ela é possível. `undefined` = este
 * critério não sabe responder, e quem chama cai no próximo.
 *
 * Split ZERO não é "não sei" por acaso: é o bot que o Hot-Dash opera, que não
 * passa pelo parceiro e não tem repasse nenhum. Nessas vendas o `origin`
 * gravado é a verdade, e sobrepor um palpite a ele seria trocar dado certo
 * por estimativa.
 */
export function origemPeloSplit(
  t: Pick<Transaction, "amountCents" | "splitCents">,
  regras: SplitRules,
): OrigemVenda | undefined {
  const split = t.splitCents ?? 0;
  if (split <= 0) return undefined;
  const valor = t.amountCents;
  if (!valor || valor <= 0) return undefined;
  // Tabela zerada = tabela não cadastrada. Sem os dois percentuais não há o
  // que comparar, e o critério inteiro fica desligado.
  if (regras.funilPercent <= 0 || regras.ltvPercent <= 0) return undefined;

  const funil = splitEsperadoCents(valor, regras.fixoCents, regras.funilPercent);
  const ltv = splitEsperadoCents(valor, regras.fixoCents, regras.ltvPercent);
  // Duas tabelas perto demais para este valor (ou iguais, se alguém cadastrar
  // o mesmo percentual nos dois campos): responder qualquer coisa aqui seria
  // cara ou coroa.
  if (Math.abs(ltv - funil) <= TOLERANCIA_CENTS * 2) return undefined;

  const distFunil = Math.abs(split - funil);
  const distLtv = Math.abs(split - ltv);
  if (distLtv <= TOLERANCIA_CENTS && distLtv <= distFunil) return "ltv";
  if (distFunil <= TOLERANCIA_CENTS) return "bot";
  // Split que não bate com NENHUMA das duas tabelas: outro parceiro, outra
  // combinação, ou a tabela mudou e ninguém avisou a configuração. Fica sem
  // resposta de propósito — chutar "funil" só porque é o mais comum
  // esconderia exatamente o caso que precisa ser olhado.
  return undefined;
}

/**
 * De qual parte do painel a venda veio, na ordem em que os critérios valem:
 *
 * 1. O SPLIT, quando existe. É o único critério que enxerga dentro de um bot
 *    operado por fora, e vence o `origin` de propósito: nessas vendas o
 *    `origin` foi preenchido como `'bot'` por padrão, sem ninguém saber o que
 *    tinha sido vendido.
 * 2. O `origin` gravado. Vale para tudo que passou pelo Hot-Dash — inclusive
 *    o `'painel'` de uma venda lançada à mão.
 * 3. O BOT amarrado, para cobrança antiga de antes da coluna `origin` existir:
 *    toda venda com bot passou por um bot de vendas.
 *
 * O que sobra fica `undefined` de propósito, e não `'painel'`: chutar
 * "lançada à mão" numa venda de origem desconhecida inventaria um dado que
 * ninguém conferiu.
 */
export function origemDaVenda(
  t: Pick<Transaction, "amountCents" | "splitCents" | "origin" | "botId">,
  regras?: SplitRules | null,
): OrigemVenda | undefined {
  if (regras) {
    const peloSplit = origemPeloSplit(t, regras);
    if (peloSplit) return peloSplit;
  }
  if (t.origin) return t.origin;
  return t.botId ? "bot" : undefined;
}
