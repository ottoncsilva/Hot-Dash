"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { IconCalendar } from "@/components/icons";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/periods";

export type PeriodState = { period: PeriodKey; from: string; to: string };

/**
 * Rótulo de cada período no CELULAR. Os três longos encurtam; o resto é o
 * texto inteiro.
 *
 * Isto é o que garante as duas linhas. Somados, os oito rótulos completos dão
 * cerca de 650px com o corpo em 11px — cabe em duas linhas num aparelho de
 * 430pt (é por isso que a referência fecha em duas), e transborda para a
 * terceira num de 390pt ou menos. Encurtar "Últimos 30 dias" e companhia tira
 * uns 120px e resolve para qualquer largura, sem mexer no corpo do texto nem
 * engessar os chips em colunas iguais.
 *
 * Da largura `md` para cima, onde tudo cabe numa fila só, volta o rótulo
 * inteiro.
 */
const CURTO: Record<PeriodKey, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  thisWeek: "Esta semana",
  last7: "7 dias",
  thisMonth: "Este mês",
  last30: "30 dias",
  all: "Máximo",
  custom: "Datas",
};

/**
 * Seletor de período — o MESMO em toda tela que filtra por data (Dashboard,
 * Financeiro, Funil, Links, Códigos, Galeria, Relatório, LTV).
 *
 * DUAS LINHAS NO CELULAR, UMA NO IPAD E NO DESKTOP. Sempre, em qualquer
 * aparelho — e com os chips do TAMANHO DO TEXTO de cada um, não de colunas
 * iguais: "Hoje" é estreito, "Esta semana" é largo, e a fileira fica
 * assimétrica como tem que ficar.
 *
 * O que faz as duas linhas caberem não é grade nenhuma, é o comprimento do
 * texto (ver `CURTO` acima) somado a chips sem folga extra no dedo. A versão
 * anterior inflava o padding em telas de toque, o que sozinho já empurrava a
 * fileira para a terceira linha.
 *
 * ESCOLHER DATAS ABRE UM DIÁLOGO. Antes os dois campos apareciam embaixo dos
 * chips e empurravam a página inteira para baixo — o faturamento descia dois
 * dedos toda vez que alguém abria o intervalo. Num diálogo, nada do que está
 * embaixo se mexe, e o período só muda quando a pessoa confirma.
 */
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

  function clicar(key: PeriodKey) {
    if (key === "custom") {
      setAberto(true);
      return;
    }
    onChange({ ...value, period: key });
  }

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1.5">
        <span className="shrink-0 pl-1 text-zinc-500" aria-hidden>
          <IconCalendar size={14} />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 md:flex-nowrap">
          {PERIOD_OPTIONS.map((p) => {
            const ativo = value.period === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => clicar(p.key)}
                aria-pressed={ativo}
                className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors md:px-2.5 md:py-1 ${
                  ativo
                    ? "bg-emerald-500 text-black"
                    : "border border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                }`}
              >
                <span className="md:hidden">{CURTO[p.key]}</span>
                <span className="hidden md:inline">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* O intervalo escolhido, quando há um. Uma linha discreta — quem
          escolheu datas precisa VER quais, e o chip só diz "Datas". */}
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
