"use client";

/** Uma linha por moeda de COBRANÇA do período. Vem de `receitaPorMoeda`. */
export type LinhaMoeda = {
  currency: string;
  paidCount: number;
  /** Bruto na moeda em que o cliente pagou. */
  paidCents: number;
  /** O mesmo bruto em real, como o gateway liquidou. */
  paidBrlCents: number;
  netBrlCents: number;
};

const NOME: Record<string, string> = {
  BRL: "real",
  USD: "dólar",
  EUR: "euro",
  GBP: "libra",
  MXN: "peso",
};

export function moeda(cents: number, m: string): string {
  try {
    return (cents / 100).toLocaleString(m === "BRL" ? "pt-BR" : "en-US", {
      style: "currency",
      currency: m,
    });
  } catch {
    // Moeda que o navegador não conhece: mostra o código, em vez de quebrar a
    // linha inteira por causa de um símbolo.
    return `${m} ${(cents / 100).toFixed(2)}`;
  }
}

/**
 * O total do período aberto POR MOEDA DE COBRANÇA, em letra pequena, embaixo
 * do número grande.
 *
 * O grande é um só, em real, porque é isso que entra na conta: cartão cobrado
 * em dólar a Stripe deposita em real, e o extrato dela traz os dois lados. Mas
 * QUANTO foi vendido em dólar o total em real não conta, e é esse número que
 * diz se o internacional está crescendo.
 *
 * Substituiu o card "vendas em outra moeda", que existia porque a venda
 * internacional ficava FORA do faturamento — converter exigiria uma cotação
 * que não se tinha. Agora se tem, a da própria liquidação, então o total
 * voltou a ser o total e a abertura virou uma linha em vez de um bloco.
 *
 * Some quando só existe UMA moeda no período: repetir embaixo, menor, o mesmo
 * número que está grande em cima não informa nada. Operação que só vende no
 * Brasil nunca vê esta linha.
 */
export default function MoedasDoPeriodo({
  linhas,
  className = "",
}: {
  linhas: LinhaMoeda[] | undefined;
  className?: string;
}) {
  if (!linhas || linhas.length < 2) return null;

  return (
    <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${className}`}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        vendido por moeda
      </span>
      {linhas.map((l) => (
        <span key={l.currency} className="whitespace-nowrap text-xs text-zinc-400">
          <span className="font-semibold text-zinc-300">{moeda(l.paidCents, l.currency)}</span>
          <span className="ml-1 text-zinc-600">
            {NOME[l.currency] || l.currency}
            {l.currency !== "BRL" && ` · ${moeda(l.paidBrlCents, "BRL")}`}
          </span>
        </span>
      ))}
    </div>
  );
}
