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

/** Quem retém dinheiro de uma venda. `terceiros` é quem opera o bot por fora. */
export type CobradorTaxa = "syncpay" | "stripe" | "terceiros";

/** Taxa fixa por transação (centavos) mais percentual sobre a venda. */
export type LinhaTaxa = { fixoCents: number; percent: number };

export type TabelaTaxas = { funil: LinhaTaxa; ltv: LinhaTaxa };

export type TaxasPorCobrador = Record<CobradorTaxa, TabelaTaxas>;

export const TAXAS_PADRAO: TaxasPorCobrador = {
  syncpay: { funil: { fixoCents: 80, percent: 0 }, ltv: { fixoCents: 80, percent: 0 } },
  stripe: { funil: { fixoCents: 0, percent: 0 }, ltv: { fixoCents: 0, percent: 0 } },
  terceiros: { funil: { fixoCents: 75, percent: 5 }, ltv: { fixoCents: 75, percent: 20 } },
};

/**
 * Folga entre o valor esperado e o que está na linha. O percentual cai em
 * fração de centavo e não dá pra saber se o cobrador arredonda ou trunca:
 * 1 centavo é ruído, não outra tabela.
 */
const TOLERANCIA_CENTS = 2;

/** O que a linha da tabela reteria numa venda deste valor. */
export function taxaEsperadaCents(amountCents: number, linha: LinhaTaxa): number {
  return linha.fixoCents + Math.round((amountCents * linha.percent) / 100);
}

/**
 * Qual das duas linhas da tabela produz `retidoCents` numa venda de
 * `amountCents`. `undefined` = nenhuma delas, ou as duas são iguais demais
 * para distinguir (tabela não cadastrada, ou cobrador que não diferencia).
 */
export function tipoPelaTaxa(
  amountCents: number,
  retidoCents: number,
  tabela: TabelaTaxas,
): OrigemVenda | undefined {
  if (retidoCents <= 0 || amountCents <= 0) return undefined;
  const funil = taxaEsperadaCents(amountCents, tabela.funil);
  const ltv = taxaEsperadaCents(amountCents, tabela.ltv);
  if (Math.abs(ltv - funil) <= TOLERANCIA_CENTS * 2) return undefined;

  const dFunil = Math.abs(retidoCents - funil);
  const dLtv = Math.abs(retidoCents - ltv);
  if (dLtv <= TOLERANCIA_CENTS && dLtv <= dFunil) return "ltv";
  if (dFunil <= TOLERANCIA_CENTS) return "bot";
  // Não bate com nenhuma das duas: outra combinação, ou a tabela mudou e
  // ninguém avisou a configuração. Fica sem resposta em vez de chutar.
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
    const peloSplit = tipoPelaTaxa(valor, t.splitCents ?? 0, taxas.terceiros);
    if (peloSplit) return peloSplit;
    const doGateway = t.provider === "stripe" ? taxas.stripe : t.provider === "syncpay" ? taxas.syncpay : null;
    if (doGateway) {
      const pelaTaxa = tipoPelaTaxa(valor, t.feeCents ?? 0, doGateway);
      if (pelaTaxa) return pelaTaxa;
    }
  }
  if (t.origin) return t.origin;
  return t.botId ? "bot" : undefined;
}
