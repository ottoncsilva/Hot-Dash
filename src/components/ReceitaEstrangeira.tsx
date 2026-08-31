"use client";

/** Uma linha por moeda estrangeira do período. Vem de `receitaPorMoeda`. */
export type LinhaMoeda = {
  currency: string;
  paidCount: number;
  paidCents: number;
  netCents: number;
};

const NOME: Record<string, string> = {
  USD: "dólar",
  EUR: "euro",
  GBP: "libra",
  MXN: "peso mexicano",
};

function formatar(cents: number, moeda: string): string {
  try {
    return (cents / 100).toLocaleString(moeda === "BRL" ? "pt-BR" : "en-US", {
      style: "currency",
      currency: moeda,
    });
  } catch {
    // Moeda que o navegador não conhece: mostra o código, em vez de quebrar
    // o card inteiro por causa de uma linha.
    return `${moeda} ${(cents / 100).toFixed(2)}`;
  }
}

/**
 * O faturamento que NÃO é em real, uma linha por moeda.
 *
 * Existe por causa de uma correção anterior: os totais em real passaram a
 * contar só o que é em real, porque somar centavo de dólar com centavo de real
 * dá um número que não é dinheiro nenhum. Sem este card, a venda internacional
 * teria sumido da tela — o número ficaria certo e incompleto, e o operador iria
 * procurar a venda que "desapareceu".
 *
 * Some sozinho quando não há venda em outra moeda no período. Uma operação que
 * só vende no Brasil nunca vê este card, e é assim que tem de ser: card vazio
 * todo dia vira ruído que ninguém lê.
 *
 * As moedas NUNCA são somadas entre si, nem convertidas. Converter exigiria a
 * cotação do dia de cada venda, que não temos — e um número convertido por
 * cotação de hoje seria uma invenção com cara de fato.
 */
export default function ReceitaEstrangeira({
  linhas,
  className = "",
}: {
  linhas: LinhaMoeda[] | undefined;
  className?: string;
}) {
  if (!linhas || linhas.length === 0) return null;

  return (
    <div className={`card p-4 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">vendas em outra moeda</p>
        <p className="text-[11px] text-zinc-600">fora do total em real</p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {linhas.map((l) => (
          <div key={l.currency} className="panel px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-widest2 text-zinc-500">
                {l.currency}
                {NOME[l.currency] && <span className="ml-1.5 normal-case">· {NOME[l.currency]}</span>}
              </p>
              <p className="font-mono text-[11px] text-zinc-500">
                {l.paidCount} {l.paidCount === 1 ? "venda" : "vendas"}
              </p>
            </div>
            <p className="mt-1 font-display text-lg font-semibold text-white">
              {formatar(l.paidCents, l.currency)}
            </p>
            {/* O líquido só aparece quando difere do bruto: repetir o mesmo
                número duas vezes não informa, só ocupa linha. */}
            {l.netCents !== l.paidCents && (
              <p className="mt-0.5 text-[11px] text-zinc-600">
                líquido {formatar(l.netCents, l.currency)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
