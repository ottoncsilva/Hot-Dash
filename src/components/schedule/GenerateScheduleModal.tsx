"use client";

import { useMemo, useState } from "react";
import { apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import AuthImage from "@/components/AuthImage";
import { IconPlay, IconSparkle } from "@/components/icons";
import { NETWORK_LABELS, type Profile } from "@/lib/types";
import { NETWORK_DOT_COLORS, type PostNetwork, type ScheduledPost } from "@/lib/postTypes";

function mediaUrl(m: { id: string; updatedAt?: number }): string {
  return `/api/media/${m.id}/file?v=${m.updatedAt || 0}`;
}
function thumbUrl(m: { id: string; updatedAt?: number }): string {
  return `/api/media/${m.id}/thumbnail?v=${m.updatedAt || 0}`;
}
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDayLong(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Media = { id: string; kind: "image" | "video"; filename: string; updatedAt?: number };

type Proposal = {
  key: string;
  profileId: string;
  profileName: string;
  slotId: string;
  scheduledAt: number;
  networks: PostNetwork[];
  caption: string;
  media: Media[];
  usedFallback: boolean;
  included: boolean;
  failed?: boolean;
};

/**
 * Gera um lote de posts a partir do programa semanal salvo, usando IA para
 * escolher mídia (por metadados, nunca a imagem em si) e escrever legendas.
 * Nada é agendado até o usuário revisar e confirmar.
 */
export default function GenerateScheduleModal({
  profiles,
  defaultProfileId,
  onClose,
  onCreated,
}: {
  profiles: Profile[];
  defaultProfileId: string;
  onClose: () => void;
  onCreated: (posts: ScheduledPost[]) => void;
}) {
  const [step, setStep] = useState<"form" | "review">("form");
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(
    new Set(defaultProfileId ? [defaultProfileId] : []),
  );
  const today = new Date();
  const weekAhead = new Date(today);
  weekAhead.setDate(weekAhead.getDate() + 7);
  const [from, setFrom] = useState(toDateInput(today));
  const [to, setTo] = useState(toDateInput(weekAhead));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [confirming, setConfirming] = useState(false);

  function toggleProfile(id: string) {
    setSelectedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyPreset(days: number) {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + days);
    setFrom(toDateInput(start));
    setTo(toDateInput(end));
  }

  async function generate() {
    setErr(null);
    if (selectedProfiles.size === 0) return setErr("Selecione ao menos um perfil.");
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const fromMs = new Date(fy, fm - 1, fd).getTime();
    const toMs = new Date(ty, tm - 1, td + 1).getTime();
    if (toMs <= fromMs) return setErr("O período final precisa ser depois do inicial.");

    setBusy(true);
    try {
      const { results } = await apiSend<{
        results: {
          profileId: string;
          profileName?: string;
          proposals: {
            slotId: string;
            scheduledAt: number;
            networks: PostNetwork[];
            caption: string;
            media: Media[];
            usedFallback: boolean;
          }[];
          error?: string;
        }[];
      }>("/api/ai/schedule", "POST", { profileIds: Array.from(selectedProfiles), from: fromMs, to: toMs });

      const errors = results.filter((r) => r.error).map((r) => `${r.profileName || r.profileId}: ${r.error}`);
      const flat: Proposal[] = results.flatMap((r) =>
        r.proposals.map((p) => ({
          key: `${r.profileId}:${p.slotId}`,
          profileId: r.profileId,
          profileName: r.profileName || "",
          slotId: p.slotId,
          scheduledAt: p.scheduledAt,
          networks: p.networks,
          caption: p.caption,
          media: p.media,
          usedFallback: p.usedFallback,
          included: true,
        })),
      );

      if (flat.length === 0) {
        setErr(errors.join(" · ") || "Nenhuma proposta gerada.");
        return;
      }
      setProposals(flat.sort((a, b) => a.scheduledAt - b.scheduledAt));
      if (errors.length > 0) setErr(errors.join(" · "));
      setStep("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao gerar cronograma.");
    } finally {
      setBusy(false);
    }
  }

  function toggleIncluded(key: string) {
    setProposals((prev) => prev.map((p) => (p.key === key ? { ...p, included: !p.included } : p)));
  }
  function updateCaption(key: string, caption: string) {
    setProposals((prev) => prev.map((p) => (p.key === key ? { ...p, caption } : p)));
  }

  const groups = useMemo(() => {
    const map = new Map<string, Proposal[]>();
    for (const p of proposals) {
      const k = String(new Date(p.scheduledAt).setHours(0, 0, 0, 0));
      map.set(k, [...(map.get(k) || []), p]);
    }
    return Array.from(map.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [proposals]);

  const includedCount = proposals.filter((p) => p.included && !p.failed).length;

  async function confirmAll() {
    setConfirming(true);
    setErr(null);
    const created: ScheduledPost[] = [];
    const remaining: Proposal[] = [];
    for (const p of proposals) {
      if (!p.included) {
        remaining.push(p);
        continue;
      }
      try {
        const { post } = await apiSend<{ post: ScheduledPost }>("/api/posts", "POST", {
          profileId: p.profileId,
          networks: p.networks,
          scheduledAt: p.scheduledAt,
          caption: p.caption,
          mediaIds: p.media.map((m) => m.id),
        });
        created.push(post);
      } catch {
        remaining.push({ ...p, failed: true });
      }
    }
    setConfirming(false);
    if (created.length > 0) onCreated(created);
    if (remaining.some((p) => p.failed)) {
      setProposals(remaining);
      setErr("Alguns posts não puderam ser criados. Tente novamente ou remova-os.");
    } else {
      onClose();
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl">
      <div className="max-h-[80vh] overflow-y-auto pr-1">
        <p className="eyebrow">{step === "form" ? "gerar" : "revisar"}</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">
          {step === "form" ? "Gerar cronograma com IA" : `Revisar propostas (${proposals.length})`}
        </h2>

        {err && (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        )}

        {step === "form" ? (
          <div className="mt-4 grid gap-3">
            <div>
              <label className="eyebrow mb-1.5 block">Perfis</label>
              <div className="flex flex-wrap gap-1.5">
                {profiles.map((p) => {
                  const active = selectedProfiles.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProfile(p.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        active
                          ? "border-white bg-white text-ink-950"
                          : "border-white/15 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="eyebrow mb-1.5 block">De</label>
                <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="eyebrow mb-1.5 block">Até</label>
                <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => applyPreset(7)} className="chip hover:border-white/40">
                Próximos 7 dias
              </button>
              <button type="button" onClick={() => applyPreset(14)} className="chip hover:border-white/40">
                Próximas 2 semanas
              </button>
              <button type="button" onClick={() => applyPreset(30)} className="chip hover:border-white/40">
                Próximo mês
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {groups.map(([day, items]) => (
              <div key={day}>
                <p className="eyebrow capitalize">{fmtDayLong(Number(day))}</p>
                <div className="mt-2 space-y-2">
                  {items.map((p) => (
                    <div
                      key={p.key}
                      className={`rounded-lg border p-3 ${
                        p.failed
                          ? "border-red-500/30 bg-red-500/[0.05]"
                          : p.included
                            ? "border-white/10 bg-white/[0.02]"
                            : "border-white/5 bg-transparent opacity-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => toggleIncluded(p.key)}
                          className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-all ${
                            p.included ? "border-white bg-white text-black" : "border-white/30"
                          }`}
                          aria-label="Incluir"
                        >
                          {p.included && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M5 13l4 4 10-10"
                                stroke="currentColor"
                                strokeWidth={3}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>

                        {p.media[0] && (
                          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-ink-800">
                            {p.media[0].kind === "image" ? (
                              <AuthImage
                                src={mediaUrl(p.media[0])}
                                alt={p.media[0].filename}
                                className="h-full w-full object-cover"
                                fallback={<div className="h-full w-full bg-ink-800" />}
                              />
                            ) : (
                              <>
                                <AuthImage
                                  src={thumbUrl(p.media[0])}
                                  alt={p.media[0].filename}
                                  className="h-full w-full object-cover"
                                  fallback={<div className="h-full w-full bg-ink-800" />}
                                />
                                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                                  <IconPlay size={14} className="text-white drop-shadow" />
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-zinc-200">
                            <span className="font-mono text-xs text-zinc-500">{fmtTime(p.scheduledAt)}</span>
                            <span className="font-medium">{p.profileName}</span>
                            {p.networks.map((n) => (
                              <span
                                key={n.network}
                                className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500"
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                                />
                                {NETWORK_LABELS[n.network]} · {n.postType}
                              </span>
                            ))}
                            {p.usedFallback && (
                              <span className="rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300">
                                revisar
                              </span>
                            )}
                            {p.failed && (
                              <span className="rounded-full border border-red-500/30 bg-red-500/[0.08] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-red-300">
                                falhou
                              </span>
                            )}
                          </p>
                          <textarea
                            className="input mt-1.5 min-h-[52px] py-1.5 text-xs"
                            value={p.caption}
                            onChange={(e) => updateCaption(p.key, e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={step === "review" ? () => setStep("form") : onClose}
            className="btn-ghost flex-1"
            disabled={busy || confirming}
          >
            {step === "review" ? "Voltar" : "Cancelar"}
          </button>
          {step === "form" ? (
            <button type="button" onClick={generate} className="btn-primary flex-1" disabled={busy}>
              <IconSparkle size={15} /> {busy ? "Gerando…" : "Gerar"}
            </button>
          ) : (
            <button
              type="button"
              onClick={confirmAll}
              className="btn-primary flex-1"
              disabled={confirming || includedCount === 0}
            >
              {confirming ? "Agendando…" : `Confirmar e agendar (${includedCount})`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
