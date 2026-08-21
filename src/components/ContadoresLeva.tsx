/**
 * Os contadores de uma leva de trabalho (Censura, First Frame).
 *
 * No monitor são quatro cartões grandes; no celular viram UMA linha.
 *
 * O motivo é medido: com os quatro cartões, a área de envio da Censura — que é
 * a razão de a tela existir — só começava a 440px do topo numa tela de 844, e
 * o que ocupava esse espaço eram quatro zeros. Contador é para acompanhar o
 * trabalho, não para recebê-lo; enquanto não há leva, ele não deveria custar
 * meia tela.
 */
export type Contador = { label: string; value: number };

export default function ContadoresLeva({ itens }: { itens: Contador[] }) {
  return (
    <>
      {/* Celular: uma linha só. */}
      <div className="card mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3.5 py-2.5 sm:hidden">
        {itens.map((c) => (
          <span key={c.label} className="flex items-baseline gap-1.5">
            <b className="font-display text-lg font-semibold text-white">{c.value}</b>
            <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              {c.label}
            </span>
          </span>
        ))}
      </div>

      {/* Daí para cima, os cartões de sempre. */}
      <div className="mb-5 hidden gap-3 sm:grid sm:grid-cols-4">
        {itens.map((c) => (
          <div key={c.label} className="card p-4">
            <p className="eyebrow">{c.label}</p>
            <p className="mt-1 font-display text-3xl font-semibold text-white">{c.value}</p>
          </div>
        ))}
      </div>
    </>
  );
}
