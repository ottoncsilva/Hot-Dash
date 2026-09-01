/**
 * Como o painel LÊ o saldo da Stripe.
 *
 * A conta pode ter várias moedas ao mesmo tempo — USD do checkout
 * internacional, BRL do "cartão no Brasil", EUR/GBP da cobrança na moeda do
 * lead. A regra de exibição é a mesma em toda tela que mostra esse número, e
 * mora aqui porque duplicá-la garantiria que uma tela mudasse sem a outra.
 *
 * Não é `server-only`: quem chama são componentes de tela.
 */

export type SaldoStripeBruto = {
  /** O saldo em DÓLAR — a moeda principal da conta. */
  availableCents: number;
  pendingCents?: number | null;
  /** Toda moeda que não é dólar, uma linha cada. */
  outras?: { currency: string; availableCents: number; pendingCents?: number }[] | null;
};

export type SaldoStripe = {
  currency: string;
  /** Já liberado para saque. Pode ser NEGATIVO enquanto um repasse não cai. */
  disp: number;
  /** Retido, ainda a caminho. */
  vindo: number;
  /** `disp + vindo` — é este que o card mostra grande. */
  total: number;
};

/**
 * O saldo que vale mostrar: o TOTAL (disponível + a caminho) da moeda com mais
 * dinheiro na conta.
 *
 * Duas decisões, as duas por engano visto em produção:
 *
 * - TOTAL, e não só o disponível. O disponível pode estar negativo enquanto o
 *   repasse não cai, e o painel mostrava saldo no vermelho com dinheiro a
 *   caminho.
 * - A MAIOR MOEDA, e não o dólar fixo. Numa conta que vende no cartão
 *   brasileiro o dólar é zero: dava "$0.00" com o dinheiro todo em real.
 *
 * Uma moeda só, nunca a soma — juntar dólar com real inventaria um número.
 */
export function maiorSaldoStripe(bruto: SaldoStripeBruto | null | undefined): SaldoStripe | null {
  if (!bruto) return null;
  const linhas = [
    { currency: "USD", disp: bruto.availableCents, vindo: bruto.pendingCents || 0 },
    ...(bruto.outras || []).map((o) => ({
      currency: o.currency,
      disp: o.availableCents,
      vindo: o.pendingCents || 0,
    })),
  ].map((l) => ({ ...l, total: l.disp + l.vindo }));
  linhas.sort((a, b) => b.total - a.total);
  return linhas[0] || null;
}

/** Centavos numa moeda qualquer. Real em pt-BR, o resto em en-US; moeda
 *  desconhecida cai num "XXX 0,00" em vez de estourar. */
export function moedaCents(cents: number, m: string): string {
  try {
    return (cents / 100).toLocaleString(m === "BRL" ? "pt-BR" : "en-US", {
      style: "currency",
      currency: m,
    });
  } catch {
    return `${m} ${(cents / 100).toFixed(2)}`;
  }
}
