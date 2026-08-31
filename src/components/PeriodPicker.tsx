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
 * AS DUAS LINHAS TERMINAM RENTES À DIREITA, e isso é `grow` nos chips, não
 * `justify-between` no contêiner. Os dois fecham na margem, mas o
 * `justify-between` fecha AFASTANDO os chips: a linha de baixo, com menos
 * gente, virava três botões soltos com buracos entre eles. Com `grow` a folga
 * entra DENTRO de cada chip, os vãos continuam iguais em toda a fileira e a
 * largura de cada um segue o próprio texto — "Hoje" estreito, "Últimos 30
 * dias" largo.
 *
 * QUATRO E QUATRO. Medido no navegador em 430, 414, 393, 375 e 360pt: duas
 * linhas de quatro em todas. É o respiro de 9px que decide — com 7px cabiam
 * cinco na primeira linha e sobravam três na segunda.
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

/**
 * Corpo, respiro e vão da fileira — MEDIDOS, não estimados.
 *
 * A linha de baixo é a mais larga e manda no resultado. Medida no navegador
 * com a Inter de verdade, ela ocupa
 *
 *     23,5 × corpo  +  8 × respiro  +  3 × vão  +  8 (bordas)
 *
 * e o espaço disponível é `largura da tela − 50` (32 do `px-4` do <main>, 16 do
 * `p-2` do contêiner, 2 da borda). Escrevendo corpo/respiro/vão como frações da
 * largura, a condição vira
 *
 *     23,5a + 8b + 3c  ≤  1 − 58/largura
 *
 * cujo pior caso é a tela mais ESTREITA: 0,839 a 360pt. Os valores abaixo dão
 * 0,82 — com folga, e sem cortar palavra em nenhuma largura.
 *
 * Eu já errei isso uma vez estimando a largura do texto, e errei de novo medindo
 * numa página que não carregava a Inter (a serifada de fallback é mais estreita,
 * então o teste aprovava um layout que na tela real quebrava).
 */
const CORPO = "text-[clamp(9px,2.89vw,12.5px)] md:text-[13px]";
const RESPIRO = "px-[clamp(4px,1.4vw,6px)] py-[clamp(4px,1.15vw,6px)] md:px-3 md:py-1.5";
const VAO = "gap-[clamp(3px,0.93vw,4px)] md:gap-2";

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

  function tocar(key: PeriodKey) {
    if (key === "custom") setAberto(true);
    else onChange({ ...value, period: key });
  }

  return (
    <div className="w-full min-w-0">
      {/* BLOQUEIO ESTRUTURAL DAS DUAS LINHAS.
          As duas linhas existem no HTML — quatro opções em cada — e cada uma é
          `flex-nowrap`. Não há como virar três: não depende de caber.

          A versão anterior confiava em `flex-wrap` + corpo calculado por
          `clamp`, e eu conferi isso num teste que não carregava a Inter. Medido
          na fonte errada, fechava em duas linhas; na fonte real, em três. Largura
          de texto não é coisa de estimar — então saiu da conta.

          Os chips crescem E encolhem (`grow` + `basis-auto`): a folga da linha
          entra dentro deles, e o encolhimento é proporcional à largura de cada
          um, o que preserva a assimetria ("Hoje" estreito, "Últimos 30 dias"
          largo) e faz as duas linhas fecharem rentes à direita.

          `md:contents` dissolve as duas linhas no iPad e no desktop: os oito
          chips viram filhos diretos do contêiner de fora e formam UMA fila. */}
      <div className={`flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2 md:flex-row md:flex-wrap md:items-center ${VAO}`}>
        <div className={`flex min-w-0 flex-nowrap items-center md:contents ${VAO}`}>
          <span className="shrink-0 text-zinc-500" aria-hidden>
            <IconCalendar size={16} />
          </span>
          {PERIOD_OPTIONS.slice(0, 4).map((p) => (
            <Chip key={p.key} opcao={p} ativo={value.period === p.key} aoTocar={tocar} />
          ))}
        </div>
        <div className={`flex min-w-0 flex-nowrap items-center md:contents ${VAO}`}>
          {PERIOD_OPTIONS.slice(4).map((p) => (
            <Chip key={p.key} opcao={p} ativo={value.period === p.key} aoTocar={tocar} />
          ))}
        </div>
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
        <h2 className="font-display text-lg text-white">Escolher datas</h2>

        {/* LADO A LADO, mas cada um com moldura PRÓPRIA e rótulo em cima.
            Na primeira tentativa eu botei os dois numa grade sem separação e
            eles leram como um campo só, com a data de um invadindo o outro —
            o campo de data do iOS ocupa a largura inteira e não tem borda
            visível por dentro. O que separa é a moldura, não o espaço. */}
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label className="min-w-0">
            <span className="eyebrow mb-1.5 block">De</span>
            <input
              type="date"
              className="input w-full px-2 text-center text-[13px]"
              value={de}
              max={ate || undefined}
              onChange={(e) => setDe(e.target.value)}
            />
          </label>
          <span className="pb-2.5 text-xs text-zinc-600" aria-hidden>
            até
          </span>
          <label className="min-w-0">
            <span className="eyebrow mb-1.5 block">Até</span>
            <input
              type="date"
              className="input w-full px-2 text-center text-[13px]"
              value={ate}
              min={de || undefined}
              onChange={(e) => setAte(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
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

/**
 * Um chip da fileira. `grow shrink basis-auto` com `min-w-0` e `truncate`: ele
 * cresce para preencher a linha e encolhe se faltar espaço, sempre na proporção
 * do próprio texto. O `truncate` é rede de segurança, não plano A — o corpo é
 * pequeno o bastante para o texto inteiro caber em qualquer celular.
 */
function Chip({
  opcao,
  ativo,
  aoTocar,
}: {
  opcao: { key: PeriodKey; label: string };
  ativo: boolean;
  aoTocar: (k: PeriodKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => aoTocar(opcao.key)}
      aria-pressed={ativo}
      title={opcao.label}
      className={`min-w-0 shrink grow basis-auto truncate rounded-[10px] border font-medium transition-colors md:grow-0 md:shrink-0 ${CORPO} ${RESPIRO} ${
        ativo
          ? "border-transparent bg-emerald-400 font-semibold text-black"
          : "border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      {opcao.label}
    </button>
  );
}
