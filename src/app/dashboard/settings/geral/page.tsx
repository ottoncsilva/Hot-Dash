"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { TIME_ZONES, DEFAULT_TIME_ZONE } from "@/lib/timezone";
import { BackToSettings } from "../_shared";
import { showToast } from "@/lib/toast";

type GeneralSettings = {
  timeZone: string;
  now: string;
  serverUtc?: string;
  fixedGroupMembers: number;
};

export default function GeneralSettingsPage() {
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  // Guardado como texto para o campo poder ficar vazio enquanto se digita.
  const [membros, setMembros] = useState("2");
  const [saved, setSaved] = useState<GeneralSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingMembros, setSavingMembros] = useState(false);
  const [ok, setOk] = useState(false);
  const [okMembros, setOkMembros] = useState(false);

  useEffect(() => {
    apiGet<GeneralSettings>("/api/settings/general")
      .then((d) => {
        setSaved(d);
        setTimeZone(d.timeZone);
        setMembros(String(d.fixedGroupMembers));
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
      showToast("Salvo!");
    } finally {
      setSaving(false);
    }
  }

  async function saveMembros() {
    setSavingMembros(true);
    setOkMembros(false);
    try {
      const d = await apiSend<GeneralSettings>("/api/settings/general", "PATCH", {
        fixedGroupMembers: membrosNum,
      });
      setSaved(d);
      setMembros(String(d.fixedGroupMembers));
      setOkMembros(true);
      showToast("Salvo!");
    } finally {
      setSavingMembros(false);
    }
  }

  const membrosNum = Math.round(Number(membros));
  const membrosValido = membros.trim() !== "" && Number.isFinite(membrosNum) && membrosNum >= 0;
  const membrosChanged = saved ? membrosValido && membrosNum !== saved.fixedGroupMembers : false;
  const changed = saved ? timeZone !== saved.timeZone : false;
  // Se o fuso escolhido não estiver na lista (veio de outro lugar), mostra junto.
  const options = TIME_ZONES.some((t) => t.id === timeZone)
    ? TIME_ZONES
    : [{ id: timeZone, label: timeZone }, ...TIME_ZONES];

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Geral</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Fuso da operação e contagem de integrantes dos grupos.
      </p>

      <h2 className="mt-6 font-display text-lg font-semibold tracking-tight">Fuso horário</h2>
      <p className="mt-1.5 text-sm text-zinc-500">
        Define o que é “hoje” no sistema todo: Dashboard e horários dos posts. O servidor roda em UTC — sem
        isso o dia viraria às 21h de Brasília.
      </p>

      <div className="mt-3 card p-4">
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
            Os posts já agendados mantêm o horário exato — só a leitura de “hoje” muda.
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

      <h2 className="mt-8 font-display text-lg font-semibold tracking-tight">
        Integrantes fixos dos grupos
      </h2>
      <p className="mt-1.5 text-sm text-zinc-500">
        O Telegram conta você, o bot e os admins junto com o público. Este número é descontado de cada grupo
        nos painéis. Padrão 2 (você + o bot); com outro admin em todos os grupos, 3.
      </p>

      <div className="mt-3 card p-4">
        <label className="eyebrow mb-1.5 block" htmlFor="membros-fixos">
          Descontar por grupo
        </label>
        <input
          id="membros-fixos"
          type="number"
          min={0}
          max={50}
          step={1}
          inputMode="numeric"
          className="input"
          value={membros}
          onChange={(e) => {
            setMembros(e.target.value);
            setOkMembros(false);
          }}
        />

        {!membrosValido && membros.trim() !== "" && (
          <p className="mt-2 text-[11px] text-red-400">Use um número inteiro de 0 para cima.</p>
        )}

        {membrosChanged && (
          <p className="mt-3 text-[11px] text-amber-400">
            O desconto é aplicado na leitura, então mudar aqui reajusta o histórico na hora.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveMembros}
            disabled={savingMembros || !membrosValido}
            className="btn-primary"
          >
            {savingMembros ? "Salvando..." : "Salvar desconto"}
          </button>
          {okMembros && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
              salvo ✓
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
