"use client";

import { IconCalendar } from "@/components/icons";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/periods";

export type PeriodState = { period: PeriodKey; from: string; to: string };

/**
 * Seletor de período — o MESMO em toda tela que filtra por data (Dashboard,
 * Financeiro, Funil, Links, Códigos, Galeria, Relatório, LTV).
 *
 * Todas as opções ficam VISÍVEIS, sempre. Antes os oito chips viravam uma fila
 * que rolava de lado no celular: o que não coubesse na largura da tela sumia
 * atrás da borda, e "Máximo" e "Escolher datas" — justamente os dois do fim —
 * só apareciam para quem adivinhasse que dava para arrastar. Agora eles
 * quebram em linha, duas no celular e uma da largura `lg` para cima (iPad e
 * desktop), sem nada escondido em lugar nenhum.
 *
 * Os chips são compactos de propósito: o seletor é moldura, não conteúdo. Ele
 * fica acima do número que a pessoa veio ver, e cada pixel que ele ocupa é um
 * pixel a menos do faturamento na primeira tela.
 */
export default function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodState;
  onChange: (v: PeriodState) => void;
}) {
  return (
    <div className="w-full min-w-0">
      <div className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1.5">
        <span className="mt-[5px] hidden shrink-0 pl-1 text-zinc-600 sm:block" aria-hidden>
          <IconCalendar size={14} />
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange({ ...value, period: p.key })}
              aria-pressed={value.period === p.key}
              // Compacto no mouse, ainda confortável no dedo. O alvo de toque
              // encolheu de 44px para 36 a pedido: com 44 os oito chips não
              // cabiam em duas linhas no celular, que é o que se quer ver.
              className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors [@media(pointer:coarse)]:min-h-[36px] [@media(pointer:coarse)]:px-3 ${
                value.period === p.key
                  ? "bg-emerald-500 text-black"
                  : "border border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {value.period === "custom" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            aria-label="Data inicial"
            className="input w-auto py-1.5 text-xs"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span className="text-xs text-zinc-600">até</span>
          <input
            type="date"
            aria-label="Data final"
            className="input w-auto py-1.5 text-xs"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
          {(value.from || value.to) && (
            <button
              type="button"
              onClick={() => onChange({ ...value, from: "", to: "" })}
              className="text-[11px] text-zinc-500 hover:text-white"
            >
              limpar
            </button>
          )}
        </div>
      )}
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
