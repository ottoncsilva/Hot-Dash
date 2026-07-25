"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { TIME_ZONES, DEFAULT_TIME_ZONE } from "@/lib/timezone";
import { BackToSettings } from "../_shared";

type GeneralSettings = { timeZone: string; now: string; serverUtc?: string };

export default function GeneralSettingsPage() {
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [saved, setSaved] = useState<GeneralSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    apiGet<GeneralSettings>("/api/settings/general")
      .then((d) => {
        setSaved(d);
        setTimeZone(d.timeZone);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setOk(false);
    try {
      const d = await apiSend<GeneralSettings>("/api/settings/general", "PATCH", { timeZone });
      setSaved(d);
      setOk(true);
    } finally {
      setSaving(false);
    }
  }

  const changed = saved ? timeZone !== saved.timeZone : false;
  // Se o fuso escolhido não estiver na lista (veio de outro lugar), mostra junto.
  const options = TIME_ZONES.some((t) => t.id === timeZone)
    ? TIME_ZONES
    : [{ id: timeZone, label: timeZone }, ...TIME_ZONES];

  return (
    <div className="page-narrow">
      <BackToSettings />
      <p className="eyebrow mt-4">geral</p>
      <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Fuso horário</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Define o que é “hoje” em todo o sistema: os totais e o gráfico de vendas do
        Dashboard, e o planejamento de horários dos posts do Telegram. O servidor roda
        em UTC — sem este ajuste, o dia virava às 21h de Brasília e as vendas da noite
        apareciam no dia seguinte.
      </p>

      <div className="mt-4 card p-4">
        <label className="eyebrow mb-1.5 block">Fuso da operação</label>
        <select
          className="input"
          value={timeZone}
          onChange={(e) => {
            setTimeZone(e.target.value);
            setOk(false);
          }}
        >
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        {saved && (
          <div className="mt-4 grid gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Agora, no fuso salvo</span>
              <span className="font-mono text-zinc-200">{saved.now}</span>
            </div>
            {saved.serverUtc && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Relógio do servidor (UTC)</span>
                <span className="font-mono text-zinc-500">
                  {saved.serverUtc.slice(0, 16).replace("T", " ")}
                </span>
              </div>
            )}
          </div>
        )}

        {changed && (
          <p className="mt-3 text-[11px] text-amber-400">
            Alterar o fuso muda como os dias são contados. Os posts já agendados mantêm o
            horário exato — só a leitura de “hoje” muda.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Salvando..." : "Salvar fuso"}
          </button>
          {ok && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              salvo ✓
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
