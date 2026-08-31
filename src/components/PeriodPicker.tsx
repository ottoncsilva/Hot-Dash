"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { IconCalendar } from "@/components/icons";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/periods";

export type PeriodState = { period: PeriodKey; from: string; to: string };

/**
 * Seletor de período — o MESMO em toda tela que filtra por data (Dashboard,
 * Financeiro, Funil, Links, Códigos, Galeria, Relatório, LTV).
 *
 * DUAS LINHAS NO CELULAR, UMA NO IPAD E NO DESKTOP, com os rótulos INTEIROS e
 * cada chip do tamanho do próprio texto — "Hoje" estreito, "Últimos 30 dias"
 * largo. A fileira é assimétrica; nada de colunas iguais.
 *
 * AS DUAS LINHAS TERMINAM RENTES À DIREITA. Isso é `justify-between`, que no
 * flex age por LINHA: a folga que sobra em cada uma vira vão entre os chips
 * dela, e as duas fecham na mesma margem. Com vão fixo cada linha parava onde
 * o texto acabasse, e a fileira ficava com a direita serrilhada. No iPad e no
 * desktop volta a `justify-start`: lá é uma linha só e sobra largura demais —
 * espalhar oito chips por ela abriria buracos entre eles.
 *
 * O ÍCONE FICA SÓ NA LINHA DE CIMA, e é item da mesma fileira: ele desloca o
 * começo da primeira linha e a segunda nasce colada na borda do contêiner,
 * como na referência.
 *
 * O QUE FAZ AS DUAS LINHAS CABEREM: a métrica do chip escala com a largura da
 * tela (`clamp` no corpo, no respiro e no vão). Com medida fixa não tem jeito
 * — a conta da linha mais larga, a de baixo, é
 *
 *     texto + 8×respiro + 3×vão  ≤  largura da tela − 48
 *
 * e com corpo de 14px ela dá 412pt de conteúdo para 382pt de espaço num
 * aparelho de 430pt: sobra um chip, que desce para a terceira linha. Foi o que
 * aconteceu. Amarrando o corpo a ~3% da largura (teto de 13px), os dois lados
 * da conta encolhem juntos e a proporção se mantém: 359 para 382 em 430pt, 326
 * para 342 em 390pt, 301 para 312 em 360pt. Sempre duas linhas, em qualquer
 * aparelho, sem cortar palavra nenhuma.
 *
 * ESCOLHER DATAS ABRE UM DIÁLOGO. Antes os dois campos apareciam embaixo dos
 * chips e empurravam a página inteira para baixo — o faturamento descia dois
 * dedos toda vez que alguém abria o intervalo. Num diálogo nada do que está
 * embaixo se mexe, e o período só muda quando a pessoa confirma.
 */

/** Corpo, respiro e vão que escalam com a tela — ver o comentário acima. */
const CORPO = "text-[clamp(10px,3.02vw,13px)] md:text-[13px]";
const RESPIRO = "px-[clamp(4px,1.4vw,7px)] py-[clamp(4px,1.15vw,6px)] md:px-3 md:py-1.5";
const VAO = "gap-[clamp(4px,1.4vw,6px)] md:gap-2";

export default function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodState;
  onChange: (v: PeriodState) => void;
}) {
  const [aberto, setAberto] = useState(false);
  // Rascunho do diálogo: enquanto a pessoa escolhe as duas pontas, a tela
  // atrás continua mostrando o período antigo. Trocar a cada tecla dispararia
  // uma busca por dia com o intervalo pela metade.
  const [de, setDe] = useState(value.from);
  const [ate, setAte] = useState(value.to);

  useEffect(() => {
    if (aberto) {
      setDe(value.from);
      setAte(value.to);
    }
  }, [aberto, value.from, value.to]);

  return (
    <div className="w-full min-w-0">
      <div
        className={`flex flex-wrap items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2 md:justify-start ${VAO}`}
      >
        <span className="shrink-0 text-zinc-500" aria-hidden>
          <IconCalendar size={16} />
        </span>
        {PERIOD_OPTIONS.map((p) => {
          const ativo = value.period === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => (p.key === "custom" ? setAberto(true) : onChange({ ...value, period: p.key }))}
              aria-pressed={ativo}
              className={`shrink-0 whitespace-nowrap rounded-[10px] font-medium transition-colors ${CORPO} ${RESPIRO} ${
                ativo
                  ? "bg-emerald-400 font-semibold text-black"
                  : "border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* O intervalo escolhido, quando há um. O chip diz só "Escolher datas";
          quem escolheu precisa ver QUAIS, sem reabrir o diálogo. */}
      {value.period === "custom" && (value.from || value.to) && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="mt-1.5 font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          {value.from || "início"} → {value.to || "hoje"}
        </button>
      )}

      <Modal open={aberto} onClose={() => setAberto(false)}>
        <p className="eyebrow">Escolher datas</p>
        <h2 className="mt-1 font-display text-lg text-white">Período personalizado</h2>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div>
            <label className="eyebrow mb-1.5 block" htmlFor="periodo-de">
              De
            </label>
            <input
              id="periodo-de"
              type="date"
              className="input"
              value={de}
              max={ate || undefined}
              onChange={(e) => setDe(e.target.value)}
            />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block" htmlFor="periodo-ate">
              Até
            </label>
            <input
              id="periodo-ate"
              type="date"
              className="input"
              value={ate}
              min={de || undefined}
              onChange={(e) => setAte(e.target.value)}
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Deixar uma ponta em branco mantém aquele lado aberto — sem data inicial conta desde o
          começo, sem data final conta até hoje.
        </p>

        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-[11px] text-zinc-500 hover:text-white"
            onClick={() => {
              setDe("");
              setAte("");
            }}
          >
            limpar
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAberto(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                onChange({ period: "custom", from: de, to: ate });
                setAberto(false);
              }}
            >
              Aplicar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Query string do período, do jeito que as rotas esperam. */
export function periodQuery(v: PeriodState): string {
  const qs = new URLSearchParams({ period: v.period });
  if (v.period === "custom") {
    if (v.from) qs.set("from", v.from);
    if (v.to) qs.set("to", v.to);
  }
  return qs.toString();
}
