"use client";

import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/periods";

export type PeriodState = { period: PeriodKey; from: string; to: string };

/**
 * Seletor de período usado no Dashboard e no Financeiro — os mesmos botões e as
 * mesmas regras nos dois lugares. "Escolher datas" abre os dois campos de data;
 * enquanto nenhuma ponta estiver preenchida o intervalo fica aberto (tudo).
 */
export default function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodState;
  onChange: (v: PeriodState) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PERIOD_OPTIONS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange({ ...value, period: p.key })}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            value.period === p.key
              ? "bg-emerald-500 text-black"
              : "border border-white/10 bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {p.label}
        </button>
      ))}

      {value.period === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5">
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
