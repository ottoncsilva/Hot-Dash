/**
 * Funil ou LTV: de que tipo é uma venda que o Hot-Dash não operou.
 *
 * Venda de bot operado por fora chega só como cobrança no gateway, e `origin`
 * vira 'bot' para tudo. O que separa os dois é o DINHEIRO RETIDO: cada
 * cobrador tem uma tabela por tipo de venda (taxa fixa + percentual), e o
 * quanto foi retido está gravado na transação — `split_cents` para o
 * terceiro que opera o bot, `fee_cents` para o gateway. Dado o valor da
 * venda, só uma das duas linhas da tabela produz aquele número.
 *
 * As tabelas são configuração (Configurações → Pagamentos), não código:
 * renegociar comissão reclassifica o histórico inteiro sem migração.
 *
 * Não é `server-only`: quem classifica é a tela do Financeiro.
 */

import type { Transaction } from "./transactions";

export type OrigemVenda = "bot" | "ltv" | "painel";

/**
 * Quem retém dinheiro de uma venda.
 *
 * O terceiro que opera o bot por fora aparece DUAS vezes porque cobra tabelas
 * diferentes conforme o gateway que liquidou: no PIX da SyncPay o repasse dele
 * é uma coisa, no cartão da Stripe é outra (5% e 10% no funil). Uma tabela só
 * classificaria errado metade das vendas.
 */
export type CobradorTaxa = "syncpay" | "stripe" | "terceirosSyncpay" | "terceirosStripe";

/**
 * Taxa fixa por transação (centavos) mais o percentual sobre a venda, para um
 * tipo de venda. Um percentual só: cada cobrador tem uma combinação por tipo,
 * e ela não varia.
 */
export type LinhaTaxa = { fixoCents: number; percent: number };

export type TabelaTaxas = { funil: LinhaTaxa; ltv: LinhaTaxa };

export type TaxasPorCobrador = Record<CobradorTaxa, TabelaTaxas>;

export const TAXAS_PADRAO: TaxasPorCobrador = {
  // Tabela da SyncPay: R$ 0,80 fixos no PIX. Igual nos dois tipos, então não
  // classifica nada — e é isso mesmo, o gateway não sabe o que foi vendido.
  syncpay: { funil: { fixoCents: 80, percent: 0 }, ltv: { fixoCents: 80, percent: 0 } },
  // Tabela da Stripe no cartão brasileiro: R$ 0,39 + 3,99%. Também igual nos
  // dois tipos (conferido numa venda de R$ 24,76 → R$ 1,38 de processamento).
  stripe: { funil: { fixoCents: 39, percent: 3.99 }, ltv: { fixoCents: 39, percent: 3.99 } },

  // Tabela do terceiro que opera o bot por fora. O fixo de R$ 0,75 é o mesmo
  // nos quatro casos; o percentual do FUNIL é que muda com o meio de
  // pagamento — 5% no PIX, 10% no cartão (confirmado com o próprio terceiro:
  // é a combinação, não erro de cobrança). No LTV são 20% nos dois.
  terceirosSyncpay: { funil: { fixoCents: 75, percent: 5 }, ltv: { fixoCents: 75, percent: 20 } },
  terceirosStripe: { funil: { fixoCents: 75, percent: 10 }, ltv: { fixoCents: 75, percent: 20 } },
};

/**
 * Folga entre o valor esperado e o que está na linha. O percentual cai em
 * fração de centavo e não dá pra saber se o cobrador arredonda ou trunca:
 * 1 centavo é ruído, não outra tabela.
 */
const TOLERANCIA_CENTS = 2;

/** O que a linha reteria numa venda deste valor. */
export function taxaEsperadaCents(amountCents: number, linha: LinhaTaxa): number {
  return linha.fixoCents + Math.round((amountCents * linha.percent) / 100);
}

/**
 * Qual das duas linhas da tabela produz `retidoCents` numa venda de
 * `amountCents`. `undefined` quando nenhuma produz, ou quando AS DUAS
 * produzem — tabela não cadastrada, cobrador que não diferencia os tipos, ou
 * alguém que cadastrou o mesmo percentual dos dois lados. Responder aí seria
 * cara ou coroa.
 */
export function tipoPelaTaxa(
  amountCents: number,
  retidoCents: number,
  tabela: TabelaTaxas,
): OrigemVenda | undefined {
  if (retidoCents <= 0 || amountCents <= 0) return undefined;
  const perto = (linha: LinhaTaxa) =>
    Math.abs(retidoCents - taxaEsperadaCents(amountCents, linha)) <= TOLERANCIA_CENTS;
  const funilBate = perto(tabela.funil);
  const ltvBate = perto(tabela.ltv);
  if (funilBate && ltvBate) return undefined;
  if (ltvBate) return "ltv";
  if (funilBate) return "bot";
  // Não bate com nenhuma: outra combinação, ou a tabela mudou e ninguém avisou
  // a configuração. Fica sem resposta em vez de chutar.
  return undefined;
}

/**
 * De qual parte do painel a venda veio, na ordem em que os critérios valem:
 *
 * 1. O SPLIT contra a tabela de `terceiros` — é o único critério que enxerga
 *    dentro de um bot operado por fora, e por isso vence o `origin`, que
 *    nessas vendas foi preenchido como 'bot' sem saber o que foi vendido.
 * 2. A TAXA DO GATEWAY contra a tabela do provedor da cobrança. Só responde
 *    onde o gateway cobra diferente por tipo de venda; com as duas linhas
 *    iguais, cala.
 * 3. O `origin` gravado — a verdade para tudo que passou pelo checkout.
 * 4. O BOT amarrado, para cobrança antiga de antes da coluna `origin` existir.
 *
 * O que sobra fica `undefined`, e não 'painel': chutar "lançada à mão"
 * inventaria um dado que ninguém conferiu.
 */
export function origemDaVenda(
  t: Pick<Transaction, "amountCents" | "splitCents" | "feeCents" | "provider" | "origin" | "botId">,
  taxas?: TaxasPorCobrador | null,
): OrigemVenda | undefined {
  if (taxas) {
    const valor = t.amountCents || 0;
    // A tabela do terceiro é a do GATEWAY que liquidou — ele cobra diferente
    // em cada um. Provedor desconhecido não tem tabela e pula direto.
    const terceiro =
      t.provider === "stripe"
        ? taxas.terceirosStripe
        : t.provider === "syncpay"
          ? taxas.terceirosSyncpay
          : null;
    if (terceiro) {
      const peloSplit = tipoPelaTaxa(valor, t.splitCents ?? 0, terceiro);
      if (peloSplit) return peloSplit;
    }
    const doGateway = t.provider === "stripe" ? taxas.stripe : t.provider === "syncpay" ? taxas.syncpay : null;
    if (doGateway) {
      const pelaTaxa = tipoPelaTaxa(valor, t.feeCents ?? 0, doGateway);
      if (pelaTaxa) return pelaTaxa;
    }
  }
  if (t.origin) return t.origin;
  return t.botId ? "bot" : undefined;
}
