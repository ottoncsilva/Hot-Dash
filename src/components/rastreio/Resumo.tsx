/**
 * A faixa de números do topo, usada pelas DUAS visões do Rastreio.
 *
 * Existe para as duas conversarem. Antes, Links mostrava os totais num card só
 * com divisórias e Códigos mostrava cards soltos com vão entre eles — mesma
 * informação, duas linguagens, e trocar de visão parecia trocar de sistema.
 * Ficou a de Links: um bloco só, dividido por fios. Menos caixa na tela e a
 * leitura corre na horizontal, que é como se lê um funil.
 *
 * As colunas se ajustam à quantidade porque as duas visões têm cinco números,
 * mas a de Códigos ganha um sexto quando existe venda fora do rastreio — e uma
 * grade fixa deixaria o sexto órfão numa linha só dele.
 */
export type NumeroDoResumo = {
  rotulo: string;
  valor: string;
  /** Segunda linha, pequena: a conta por trás do número. */
  nota?: string;
  cor?: string;
};

const COLUNAS: Record<number, string> = {
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

export default function Resumo({ numeros }: { numeros: NumeroDoResumo[] }) {
  const colunas = COLUNAS[numeros.length] || "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
  return (
    <div className={`mt-4 card grid ${colunas} divide-x divide-y divide-white/[0.06] lg:divide-y-0`}>
      {numeros.map((n) => (
        <div key={n.rotulo} className="p-3.5">
          <p className="eyebrow">{n.rotulo}</p>
          <p className={`mt-1 font-display text-xl ${n.cor || "text-white"}`}>{n.valor}</p>
          {/* Altura reservada mesmo sem nota: sem isso as células da faixa
              ficam de alturas diferentes e o fio de baixo serrilha. */}
          <p className="mt-0.5 min-h-[14px] text-[11px] leading-[14px] text-zinc-600">{n.nota || ""}</p>
        </div>
      ))}
    </div>
  );
}
