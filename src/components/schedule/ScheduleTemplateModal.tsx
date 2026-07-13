"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import { IconPlus, IconTrash } from "@/components/icons";
import { NETWORK_LABELS, type SocialNetwork } from "@/lib/types";
import { POST_TYPES, WEEKDAY_LABELS, type MediaKindFilter } from "@/lib/postTypes";

type EditableSlot = {
  key: string;
  weekday: number;
  timeStart: string;
  timeEnd: string;
  network: SocialNetwork;
  postType: string;
  mediaKind: MediaKindFilter;
};

let tempCounter = 0;
function tempKey() {
  return `tmp-${Date.now()}-${tempCounter++}`;
}

/**
 * Programa semanal recorrente (ex.: "seg-sex, 06h-09h, Instagram Reels,
 * só vídeo"): fica salvo e é reaplicado sempre que o usuário pedir para a
 * IA gerar um cronograma novo. É global — vale para todos os perfis.
 */
export default function ScheduleTemplateModal({ onClose }: { onClose: () => void }) {
  const [slots, setSlots] = useState<EditableSlot[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{
      slots: {
        id: string;
        weekday: number;
        timeStart: string;
        timeEnd: string;
        network: SocialNetwork;
        postType: string;
        mediaKind: MediaKindFilter;
      }[];
    }>("/api/settings/schedule-template")
      .then((d) =>
        setSlots(
          d.slots.map((s) => ({
            key: s.id,
            weekday: s.weekday,
            timeStart: s.timeStart,
            timeEnd: s.timeEnd,
            network: s.network,
            postType: s.postType,
            mediaKind: s.mediaKind,
          })),
        ),
      )
      .catch((e) => setErr(e instanceof Error ? e.message : "Falha ao carregar."));
  }, []);

  function addSlot(weekday: number) {
    const network: SocialNetwork = "instagram";
    setSlots((prev) => [
      ...(prev || []),
      {
        key: tempKey(),
        weekday,
        timeStart: "09:00",
        timeEnd: "10:00",
        network,
        postType: POST_TYPES[network][0],
        mediaKind: "any",
      },
    ]);
  }

  function updateSlot(key: string, patch: Partial<EditableSlot>) {
    setSlots((prev) => (prev || []).map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function removeSlot(key: string) {
    setSlots((prev) => (prev || []).filter((s) => s.key !== key));
  }

  async function save() {
    if (!slots) return;
    setSaving(true);
    setErr(null);
    try {
      const sorted = [...slots].sort(
        (a, b) => a.weekday - b.weekday || a.timeStart.localeCompare(b.timeStart),
      );
      await apiSend("/api/settings/schedule-template", "PUT", {
        slots: sorted.map((s) => ({
          weekday: s.weekday,
          timeStart: s.timeStart,
          timeEnd: s.timeEnd,
          network: s.network,
          postType: s.postType,
          mediaKind: s.mediaKind,
        })),
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl">
      <div className="max-h-[80vh] overflow-y-auto pr-1">
        <p className="eyebrow">programa</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">Programa de postagens</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Defina os horários recorrentes da semana. Ao gerar um cronograma com IA, cada
          janela vira posts reais preenchidos com mídia da biblioteca do perfil escolhido.
        </p>

        {err && (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        )}

        {slots === null ? (
          <div className="mt-4 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {WEEKDAY_LABELS.map((label, weekday) => {
              const daySlots = slots.filter((s) => s.weekday === weekday);
              return (
                <div key={weekday} className="rounded-lg border border-white/10 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-zinc-200">{label}</p>
                    <button
                      type="button"
                      onClick={() => addSlot(weekday)}
                      className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-white"
                    >
                      <IconPlus size={12} /> horário
                    </button>
                  </div>
                  {daySlots.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {daySlots.map((s) => (
                        <div
                          key={s.key}
                          className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2 sm:grid-cols-6"
                        >
                          <input
                            type="time"
                            className="input py-1.5 text-xs"
                            value={s.timeStart}
                            onChange={(e) => updateSlot(s.key, { timeStart: e.target.value })}
                          />
                          <input
                            type="time"
                            className="input py-1.5 text-xs"
                            value={s.timeEnd}
                            onChange={(e) => updateSlot(s.key, { timeEnd: e.target.value })}
                          />
                          <select
                            className="input py-1.5 text-xs"
                            value={s.network}
                            onChange={(e) => {
                              const network = e.target.value as SocialNetwork;
                              updateSlot(s.key, { network, postType: POST_TYPES[network][0] });
                            }}
                          >
                            {Object.entries(NETWORK_LABELS).map(([value, l]) => (
                              <option key={value} value={value}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input py-1.5 text-xs"
                            value={s.postType}
                            onChange={(e) => updateSlot(s.key, { postType: e.target.value })}
                          >
                            {POST_TYPES[s.network].map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input py-1.5 text-xs"
                            value={s.mediaKind}
                            onChange={(e) =>
                              updateSlot(s.key, { mediaKind: e.target.value as MediaKindFilter })
                            }
                          >
                            <option value="any">Qualquer mídia</option>
                            <option value="image">Só fotos</option>
                            <option value="video">Só vídeos</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => removeSlot(s.key)}
                            className="grid h-8 w-8 place-items-center justify-self-end rounded-lg text-zinc-500 hover:bg-white/5 hover:text-red-400"
                            aria-label="Remover horário"
                          >
                            <IconTrash size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            className="btn-primary flex-1"
            disabled={saving || slots === null}
          >
            {saving ? "Salvando…" : "Salvar programa"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
