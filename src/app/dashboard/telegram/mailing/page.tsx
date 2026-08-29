"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useConfirm } from "@/hooks/useConfirm";
import type { Profile } from "@/lib/types";
import { IconSend, IconClose, IconPlus, IconTrash } from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import { MoneyInput } from "@/components/MoneyInput";

// ---- Tipos (espelham telegramMailing.ts / telegramUsers.ts) ----
type Audience =
  | "todos"
  | "vips"
  | "novos"
  | "expirados"
  | "pendentes"
  | "compradores"
  | "recorrentes"
  | "pacotes"
  | "order_bump"
  | "previas"
  | "grupo_vip";

const AUDIENCE_LABELS: Record<Audience, string> = {
  todos: "Todos",
  vips: "Vips",
  novos: "Novos",
  expirados: "Expirados",
  pendentes: "Pendentes",
  compradores: "Compradores",
  recorrentes: "Recorrentes",
  pacotes: "Pacotes",
  order_bump: "Order Bump",
  previas: "Prévias",
  grupo_vip: "Canal VIP",
};

/** A explicação de cada público, no `title` do cartão. */
const AUDIENCE_HINTS: Record<Audience, string> = {
  todos: "Todo mundo que já falou com o bot.",
  vips: "Assinatura VIP em dia.",
  novos: "Deu /start e nunca gerou cobrança.",
  expirados: "Assinatura VIP vencida.",
  pendentes: "Gerou PIX e não pagou.",
  compradores: "Já pagou pelo menos uma vez.",
  recorrentes: "Comprou mais de uma vez.",
  pacotes: "Comprou um pacote (compra única).",
  order_bump: "Aceitou uma oferta adicional na hora de pagar.",
  previas: "Está no canal de prévias.",
  grupo_vip: "Está dentro do canal VIP.",
};

const AUDIENCE_ORDER: Audience[] = [
  "todos",
  "vips",
  "novos",
  "expirados",
  "pendentes",
  "compradores",
  "recorrentes",
  "pacotes",
  "order_bump",
  "previas",
  "grupo_vip",
];

type Plan = {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
  kind: "subscription" | "package";
  deliverable?: string;
};

type Offer = {
  planId?: string;
  name: string;
  priceCents: number;
  durationDays: number;
  kind: "subscription" | "package";
  deliverable?: string;
};

type ScheduleType = "once" | "daily" | "interval" | "weekdays";
type MailingStatus = "draft" | "scheduled" | "sending" | "sent" | "paused";

type Mailing = {
  id: string;
  name: string;
  message: string;
  audiences: Audience[];
  mediaIds?: string[];
  mediaMode?: "album" | "separate";
  mediaTags?: string;
  audioUrl?: string;
  buttons: { text: string; url: string }[];
  scheduleType: ScheduleType;
  scheduleTimes?: string;
  scheduleWeekdays?: string;
  intervalHours?: number;
  scheduledAt?: number;
  status: MailingStatus;
  lastRunAt?: number;
  nextRunAt?: number;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  blockedCount: number;
  offers: (Offer & { id: string })[];
};


const MESSAGE_MAX = 4096;

const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function MailingPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  // Modelo escolhida no menu — vale para o painel inteiro.
  const { profileId } = useProfile();
  const [loading, setLoading] = useState(false);

  const [bot, setBot] = useState<{ id: string; botUsername?: string; operationActive: boolean } | null>(null);
  const [mailings, setMailings] = useState<Mailing[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Mailing | null>(null);

  useEffect(() => {
  }, []);

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const d = await apiGet<{
        bot: { id: string; botUsername?: string; operationActive: boolean } | null;
        mailings: Mailing[];
        plans: Plan[];
        audiences: Record<string, number>;
      }>(`/api/telegram/mailings?profileId=${profileId}`);
      setBot(d.bot);
      setMailings(d.mailings || []);
      setPlans(d.plans || []);
      setCounts(d.audiences || {});
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao carregar.", "error");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  // Enquanto um disparo está em andamento, os números sobem sozinhos.
  const hasSending = mailings.some((m) => m.status === "sending");
  useEffect(() => {
    if (!hasSending) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [hasSending, load]);

  // Sem modelo escolhida no menu ("Todas"), esta tela não tem o que
  // mostrar: bot, mailing e usuários são sempre de UMA modelo. Antes a tela
  // escolhia a primeira sozinha; com o seletor no menu isso viraria mentira.
  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Mailing" />
        <PrecisaDeModelo oQue="disparar o mailing" />
      </div>
    );
  }

  return (
    <div className="page px-1 py-2">
      {ConfirmDialog}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconSend size={22} /> Mailing
          </span>
        }
        description="Dispara uma mensagem para os leads do VIP, das prévias e para quem deu /start no bot."
      />
      <div className="mb-5" />

      {loading && (
        <div className="grid place-items-center py-10">
          <div className="h-7 w-7 animate-spin rounded-full border border-white/15 border-t-white" />
        </div>
      )}

      {!loading && !bot && (
        <div className="card p-6 text-center text-sm text-zinc-400">
          Este modelo ainda não tem o bot configurado. Vá em <b>Modelos → editar a modelo → Bot do
          Telegram</b>, informe o <b>Token do Bot</b> e os <b>IDs dos canais</b> e salve.
        </div>
      )}

      {!loading && bot && (
        <div className="space-y-5">
          {!bot.operationActive && (
            <div className="card border-amber-500/30 bg-amber-500/[0.06] p-3.5 text-xs text-amber-200">
              A operação do bot está <b>desligada</b>. O disparo até sai, mas o bot não vai responder
              aos botões de compra. Ligue em <b>Telegram → Bot de vendas</b>.
            </div>
          )}

          <MailingForm
            key={editing?.id || "novo"}
            profileId={profileId}
            botUsername={bot.botUsername}
            plans={plans}
            counts={counts}
            mailing={editing}
            onCancelEdit={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />

          <MailingList
            mailings={mailings}
            onEdit={setEditing}
            onChanged={load}
            confirm={confirm}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário do disparo
// ---------------------------------------------------------------------------
const FORMAT_BUTTONS: { label: string; open: string; close: string; title: string }[] = [
  { label: "B", open: "<b>", close: "</b>", title: "Negrito" },
  { label: "I", open: "<i>", close: "</i>", title: "Itálico" },
  { label: "U", open: "<u>", close: "</u>", title: "Sublinhado" },
  { label: "S", open: "<s>", close: "</s>", title: "Riscado" },
  { label: "</>", open: "<code>", close: "</code>", title: "Monoespaçado" },
  { label: "spoiler", open: "<tg-spoiler>", close: "</tg-spoiler>", title: "Spoiler" },
  { label: "❝", open: "<blockquote>", close: "</blockquote>", title: "Citação" },
];

const VARIABLES = ["{nome}", "{sobrenome}", "{usuario}", "{saudacao}", "{modelo}", "{bot}"];

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

function MailingForm({
  profileId,
  botUsername,
  plans,
  counts,
  mailing,
  onCancelEdit,
  onSaved,
}: {
  profileId: string;
  botUsername?: string;
  plans: Plan[];
  counts: Record<string, number>;
  mailing: Mailing | null;
  onCancelEdit: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(mailing?.name || "");
  const [message, setMessage] = useState(mailing?.message || "");
  const [audiences, setAudiences] = useState<Audience[]>(mailing?.audiences || ["todos"]);
  const [offers, setOffers] = useState<Offer[]>(mailing?.offers || []);
  const [buttons, setButtons] = useState(mailing?.buttons || []);
  const [mediaIds, setMediaIds] = useState<string[]>(mailing?.mediaIds || []);
  const [mediaMode, setMediaMode] = useState<"album" | "separate">(mailing?.mediaMode || "album");
  const [audioUrl, setAudioUrl] = useState(mailing?.audioUrl || "");
  const [scheduleType, setScheduleType] = useState<ScheduleType>(mailing?.scheduleType || "once");
  const [times, setTimes] = useState<string[]>(
    (mailing?.scheduleTimes || "").split(",").filter(Boolean),
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    (mailing?.scheduleWeekdays || "")
      .split(",")
      .filter(Boolean)
      .map(Number),
  );
  const [intervalHours, setIntervalHours] = useState(String(mailing?.intervalHours || 6));
  const [scheduledAt, setScheduledAt] = useState(
    mailing?.scheduledAt ? toLocalInput(mailing.scheduledAt) : "",
  );
  const [busy, setBusy] = useState<"" | "save" | "send">("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reach = useMemo(
    () => audiences.reduce((max, a) => Math.max(max, counts[a] ?? 0), 0),
    [audiences, counts],
  );

  function toggleAudience(a: Audience) {
    setAudiences((cur) => {
      if (cur.includes(a)) {
        const next = cur.filter((x) => x !== a);
        return next.length > 0 ? next : ["todos"];
      }
      // "Todos" já contém os demais: escolher outro público substitui a seleção.
      if (a === "todos") return ["todos"];
      return [...cur.filter((x) => x !== "todos"), a];
    });
  }

  /** Envolve a seleção do textarea com as tags (ou insere o par vazio). */
  function wrapSelection(open: string, close: string) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = message.slice(start, end);
    const next = message.slice(0, start) + open + selected + close + message.slice(end);
    setMessage(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + open.length + selected.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function insertVariable(v: string) {
    const el = textareaRef.current;
    if (!el) {
      setMessage((m) => m + v);
      return;
    }
    const start = el.selectionStart;
    const next = message.slice(0, start) + v + message.slice(el.selectionEnd);
    setMessage(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + v.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function addOfferFromPlan(plan: Plan) {
    setOffers((cur) => [
      ...cur,
      {
        planId: plan.id,
        name: plan.name,
        priceCents: plan.priceCents,
        durationDays: plan.durationDays,
        kind: plan.kind,
        deliverable: plan.deliverable,
      },
    ]);
  }

  function payload() {
    return {
      profileId,
      id: mailing?.id,
      name,
      message,
      audiences,
      mediaIds,
      mediaMode,
      audioUrl,
      buttons,
      offers,
      scheduleType,
      scheduleTimes: times.join(","),
      scheduleWeekdays: weekdays.join(","),
      intervalHours: Number(intervalHours) || undefined,
      scheduledAt:
        scheduleType === "once" && scheduledAt ? new Date(scheduledAt).getTime() : undefined,
    };
  }

  async function submit(action: "save" | "send") {
    setBusy(action);
    try {
      const r = await apiSend<{ ok: boolean; mailing: Mailing }>("/api/telegram/mailings", "POST", {
        action,
        ...payload(),
      });
      if (action === "save") {
        showToast("Rascunho salvo.", "success");
      } else if (r.mailing?.status === "sending") {
        showToast(`Disparo iniciado para ${r.mailing.totalRecipients} pessoa(s).`, "success");
      } else {
        showToast("Disparo agendado.", "success");
      }
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
          <IconSend size={18} />
        </span>
        <h2 className="font-display text-lg font-semibold">
          {mailing ? "Editar Mailing" : "Criar Mailing"}
          {botUsername && <span className="text-zinc-500"> — @{botUsername}</span>}
        </h2>
        {mailing && (
          <button onClick={onCancelEdit} className="btn-ghost ml-auto px-2.5 py-1.5 text-xs">
            Novo
          </button>
        )}
      </div>

      <label className="eyebrow mt-4 block">Nome do mailing</label>
      <input
        className="input mt-1.5"
        placeholder="Ex: Promoção Exclusiva"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="eyebrow mt-4 block">Mensagem inicial</label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {FORMAT_BUTTONS.map((b) => (
          <button
            key={b.label}
            type="button"
            title={b.title}
            onClick={() => wrapSelection(b.open, b.close)}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:bg-white/5"
          >
            {b.label}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="input mt-2 min-h-[160px]"
        placeholder="Digite aqui a mensagem que será enviada..."
        maxLength={MESSAGE_MAX}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-zinc-500">Variáveis (clique para inserir):</span>
        {VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => insertVariable(v)}
            className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            {v}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-zinc-600">
          {message.length}/{MESSAGE_MAX}
        </span>
      </div>

      {/* Público-alvo */}
      <div className="mt-5">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-semibold text-white">Grupo de destinatários</p>
          <span className="text-[11px] text-zinc-500">(pode escolher mais de um)</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {AUDIENCE_ORDER.map((a) => {
            const on = audiences.includes(a);
            return (
              <button
                key={a}
                type="button"
                title={AUDIENCE_HINTS[a]}
                onClick={() => toggleAudience(a)}
                className={`rounded-xl border p-3 text-center transition-colors ${
                  on
                    ? "border-emerald-500/60 bg-emerald-500/[0.08]"
                    : "border-white/10 bg-ink-850 hover:bg-ink-800"
                }`}
              >
                <p className={`text-xs ${on ? "text-emerald-400" : "text-zinc-400"}`}>
                  {AUDIENCE_LABELS[a]}
                </p>
                <p
                  className={`mt-0.5 font-display text-xl font-semibold ${
                    on ? "text-emerald-400" : "text-white"
                  }`}
                >
                  {counts[a] ?? 0}
                </p>
              </button>
            );
          })}
        </div>
        <div className="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-200/90">
          <b>Atenção:</b> só entram as pessoas que já falaram com o bot no privado. Quem bloqueou fica de fora e volta sozinho se desbloquear.
        </div>
      </div>

      {/* Ofertas */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-white">Planos da oferta</p>
        <p className="mt-1 text-xs text-zinc-500">
          Escolha planos existentes e ajuste <b>nome, preço e duração</b> só para este disparo. Sem
          planos, a mensagem vai só com o texto/mídia.
        </p>
        {plans.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addOfferFromPlan(p)}
                className="btn-ghost px-2.5 py-1.5 text-xs"
              >
                <IconPlus size={13} /> {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 space-y-2">
          {offers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 p-3 text-xs text-zinc-500">
              Nenhum plano adicionado.
            </p>
          ) : (
            offers.map((o, i) => (
              <div key={i} className="panel p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input min-w-[120px] flex-1"
                    value={o.name}
                    onChange={(e) =>
                      setOffers((cur) => cur.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <MoneyInput
                    className="w-24"
                    value={(o.priceCents / 100).toFixed(2)}
                    onChange={(v) =>
                      setOffers((cur) =>
                        cur.map((x, idx) =>
                          idx === i ? { ...x, priceCents: v ? Math.round(parseFloat(v) * 100) : 0 } : x,
                        ),
                      )
                    }
                  />
                  {o.kind === "subscription" && (
                    <div className="flex items-center gap-1">
                      <input
                        className="input w-16"
                        value={o.durationDays}
                        onChange={(e) =>
                          setOffers((cur) =>
                            cur.map((x, idx) =>
                              idx === i ? { ...x, durationDays: Number(e.target.value) || 1 } : x,
                            ),
                          )
                        }
                      />
                      <span className="text-xs text-zinc-500">dias</span>
                    </div>
                  )}
                  <button
                    onClick={() => setOffers((cur) => cur.filter((_, idx) => idx !== i))}
                    className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                    aria-label="Remover oferta"
                  >
                    <IconClose size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Botões personalizados */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-white">Botões personalizados</p>
        <div className="mt-2 space-y-2">
          {buttons.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 panel p-2">
              <input
                className="input min-w-[120px] flex-1"
                placeholder="Texto do botão"
                value={b.text}
                onChange={(e) =>
                  setButtons((cur) => cur.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)))
                }
              />
              <input
                className="input min-w-[160px] flex-[2] font-mono"
                placeholder="https://..."
                value={b.url}
                onChange={(e) =>
                  setButtons((cur) => cur.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))
                }
              />
              <button
                onClick={() => setButtons((cur) => cur.filter((_, idx) => idx !== i))}
                className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                aria-label="Remover botão"
              >
                <IconClose size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setButtons((cur) => [...cur, { text: "", url: "" }])}
          className="btn-ghost mt-2 px-2.5 py-1.5 text-xs"
        >
          <IconPlus size={13} /> Adicionar botão
        </button>
      </div>

      {/* Mídia e áudio */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-white">Mídia e áudio</p>
        <p className="mt-1 text-xs text-zinc-500">
          Opcional. As mídias vão nesta ordem, escolhidas a dedo.
        </p>
        <div className="mt-2">
          <MediaPicker profileId={profileId} selected={mediaIds} onChange={setMediaIds} />
        </div>
        {mediaIds.length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-zinc-500">Enviar as {mediaIds.length}:</span>
            {(
              [
                ["album", "em álbum"],
                ["separate", "uma por mensagem"],
              ] as const
            ).map(([k, rotulo]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMediaMode(k)}
                className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                  mediaMode === k
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-ink-850 text-zinc-400 hover:border-white/20"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        )}

        <label className="eyebrow mt-4 block">Áudio (URL pública .ogg)</label>
        <input
          className="input mt-1.5 font-mono text-xs"
          placeholder="https://... .ogg"
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Enviado como mensagem de voz <b>depois</b> do texto. A URL precisa ser alcançável da internet.
        </p>
      </div>

      {/* Frequência */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-white">Frequência do disparo</p>
        <div className="mt-2 rounded-xl border border-white/10 p-3">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["once", "Uma vez"],
                ["daily", "Diário"],
                ["interval", "A cada X horas"],
                ["weekdays", "Dias da semana"],
              ] as [ScheduleType, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScheduleType(value)}
                className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                  scheduleType === value
                    ? "border-emerald-500/60 bg-emerald-500/[0.08] text-emerald-400"
                    : "border-white/10 bg-ink-850 text-zinc-300 hover:bg-ink-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {scheduleType === "once" && (
            <div className="mt-3">
              <label className="eyebrow block">Data e hora (vazio = agora)</label>
              <input
                type="datetime-local"
                className="input mt-1.5"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
              <p className="mt-1.5 text-xs text-zinc-500">
                {scheduledAt
                  ? "Envia uma única vez no horário marcado."
                  : "Envia uma única vez agora, ao clicar em Enviar Mailing."}
              </p>
            </div>
          )}

          {scheduleType === "interval" && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-zinc-400">A cada</span>
              <input
                className="input w-20"
                type="number"
                min={1}
                value={intervalHours}
                onChange={(e) => setIntervalHours(e.target.value)}
              />
              <span className="text-sm text-zinc-400">horas, a partir do envio.</span>
            </div>
          )}

          {(scheduleType === "daily" || scheduleType === "weekdays") && (
            <div className="mt-3">
              {scheduleType === "weekdays" && (
                <div className="mb-3">
                  <label className="eyebrow block">Dias</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() =>
                          setWeekdays((cur) =>
                            cur.includes(d.value) ? cur.filter((x) => x !== d.value) : [...cur, d.value],
                          )
                        }
                        className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                          weekdays.includes(d.value)
                            ? "border-emerald-500/60 bg-emerald-500/[0.08] text-emerald-400"
                            : "border-white/10 text-zinc-400 hover:bg-white/5"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="eyebrow block">Horários</label>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {times.map((t) => (
                  <span key={t} className="chip">
                    {t}
                    <button
                      onClick={() => setTimes((cur) => cur.filter((x) => x !== t))}
                      className="text-zinc-500 hover:text-red-400"
                      aria-label={`Remover ${t}`}
                    >
                      <IconClose size={12} />
                    </button>
                  </span>
                ))}
                <input
                  type="time"
                  className="input w-32"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v && !times.includes(v)) setTimes((cur) => [...cur, v].sort());
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">
                Horários no fuso da operação (Configurações → Geral).
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <p className="mr-auto text-xs text-zinc-500">
          Alcance estimado: <b className="text-zinc-300">{reach}</b> pessoa(s)
        </p>
        <button onClick={() => submit("save")} disabled={Boolean(busy)} className="btn-ghost">
          {busy === "save" ? "Salvando..." : "Salvar rascunho"}
        </button>
        <button onClick={() => submit("send")} disabled={Boolean(busy)} className="btn-primary">
          <IconSend size={15} />
          {busy === "send"
            ? "Enviando..."
            : scheduleType === "once" && !scheduledAt
              ? "Enviar Mailing"
              : "Agendar Mailing"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista dos disparos
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<MailingStatus, string> = {
  draft: "rascunho",
  scheduled: "agendado",
  sending: "enviando",
  sent: "enviado",
  paused: "pausado",
};

const STATUS_COLOR: Record<MailingStatus, string> = {
  draft: "text-zinc-500",
  scheduled: "text-sky-400",
  sending: "text-amber-400",
  sent: "text-emerald-400",
  paused: "text-zinc-400",
};

function MailingList({
  mailings,
  onEdit,
  onChanged,
  confirm,
}: {
  mailings: Mailing[];
  onEdit: (m: Mailing) => void;
  onChanged: () => void;
  confirm: (opts: { title: string; message: string }) => Promise<boolean>;
}) {
  const [busyId, setBusyId] = useState("");

  async function act(m: Mailing, action: "pause" | "resume" | "delete") {
    setBusyId(m.id + action);
    try {
      await apiSend("/api/telegram/mailings", "POST", { action, id: m.id });
      showToast("Feito.", "success");
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Disparos</h2>
        <span className="chip">{mailings.length} no total</span>
      </div>

      {mailings.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Nenhum disparo criado ainda.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {mailings.map((m) => {
            const progress =
              m.totalRecipients > 0
                ? Math.round(((m.sentCount + m.failedCount + m.blockedCount) / m.totalRecipients) * 100)
                : 0;
            return (
              <div key={m.id} className="panel p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">{m.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                      <span className={STATUS_COLOR[m.status]}>{STATUS_LABEL[m.status]}</span>
                      {m.totalRecipients > 0 && ` · ${m.sentCount}/${m.totalRecipients} enviadas`}
                      {m.failedCount > 0 && ` · ${m.failedCount} falha(s)`}
                      {m.blockedCount > 0 && ` · ${m.blockedCount} bloqueado(s)`}
                      {m.status === "scheduled" &&
                        m.nextRunAt &&
                        ` · próximo ${new Date(m.nextRunAt).toLocaleString("pt-BR")}`}
                    </p>
                  </div>
                  <button onClick={() => onEdit(m)} className="btn-ghost px-2.5 py-1.5 text-xs">
                    Editar
                  </button>
                  {(m.status === "scheduled" || m.status === "sending") && (
                    <button
                      onClick={() => act(m, "pause")}
                      disabled={Boolean(busyId)}
                      className="btn-ghost px-2.5 py-1.5 text-xs"
                    >
                      Pausar
                    </button>
                  )}
                  {m.status === "paused" && (
                    <button
                      onClick={() => act(m, "resume")}
                      disabled={Boolean(busyId)}
                      className="btn-ghost px-2.5 py-1.5 text-xs"
                    >
                      Retomar
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Apagar disparo",
                        message: `Apagar "${m.name}"? As mensagens já enviadas não são afetadas.`,
                      });
                      if (ok) act(m, "delete");
                    }}
                    disabled={Boolean(busyId)}
                    className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                    aria-label="Apagar"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
                {m.status === "sending" && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full bg-emerald-500/70" style={{ width: `${progress}%` }} />
                  </div>
                )}
                {m.offers.length > 0 && (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    Ofertas: {m.offers.map((o) => `${o.name} (${money(o.priceCents)})`).join(" · ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Timestamp → valor aceito por <input type="datetime-local"> (hora local). */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}
