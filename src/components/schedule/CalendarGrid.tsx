import React, { useState } from "react";
import { IconArrowLeft, IconChevronRight } from "@/components/icons";
import { NETWORK_DOT_COLORS, type ScheduledPost } from "@/lib/postTypes";

// Cabeçalho fixo do MÊS: a grade mensal começa na SEGUNDA-FEIRA.
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** 00:00 da data informada (início do dia). */
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekRangeLabel(a: Date, b: Date): string {
  const monA = a.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const monB = b.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const year = b.getFullYear();
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${b.getDate()} de ${monA} ${year}`;
  }
  return `${a.getDate()} ${monA} – ${b.getDate()} ${monB} ${year}`;
}

const isReady = (p: ScheduledPost) => p.media && p.media.length > 0 && Boolean(p.caption && p.caption.trim());
const isOverdue = (p: ScheduledPost) => p.status === "scheduled" && p.scheduledAt < Date.now();

export default function CalendarGrid({
  month,
  onMonthChange,
  posts,
  onDayClick,
  onPostClick,
  onPostMove,
  defaultView = "month",
}: {
  month: { year: number; month: number };
  onMonthChange: (m: { year: number; month: number }) => void;
  posts: ScheduledPost[];
  onDayClick: (d: Date) => void;
  onPostClick: (p: ScheduledPost) => void;
  onPostMove: (postId: string, newDate: Date) => void;
  /** Visão inicial do calendário. O Telegram abre em "week"; a agenda em "month". */
  defaultView?: "month" | "week";
}) {
  const [view, setView] = useState<"month" | "week">(defaultView);
  // A visão de SEMANA é ancorada no DIA ATUAL: a primeira coluna é sempre hoje
  // (hoje, amanhã, +2…). "Semana anterior/próxima" desloca de 7 em 7 dias.
  const [weekStart, setWeekStart] = useState<Date>(() => startOfDay(new Date()));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Monta a lista de dias exibidos conforme a visão.
  const days: Date[] = [];
  if (view === "week") {
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      days.push(d);
    }
  } else {
    const first = new Date(month.year, month.month, 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // volta até a segunda-feira
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
  }

  const byDay = new Map<string, ScheduledPost[]>();
  for (const p of posts) {
    const k = new Date(p.scheduledAt).toDateString();
    const list = byDay.get(k) || [];
    list.push(p);
    byDay.set(k, list);
  }

  function shift(delta: number) {
    if (view === "week") {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + delta * 7);
      setWeekStart(d);
    } else {
      const d = new Date(month.year, month.month + delta, 1);
      onMonthChange({ year: d.getFullYear(), month: d.getMonth() });
    }
  }

  function goToday() {
    if (view === "week") {
      setWeekStart(startOfDay(new Date()));
    } else {
      const d = new Date();
      onMonthChange({ year: d.getFullYear(), month: d.getMonth() });
    }
  }

  const label =
    view === "week"
      ? weekRangeLabel(days[0], days[6])
      : new Date(month.year, month.month, 1).toLocaleDateString("pt-BR", {
          month: "long",
          year: "numeric",
        });

  const MAX_MONTH_POSTS = 3;

  return (
    <div className="mt-4 card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shift(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
            aria-label={view === "week" ? "Semana anterior" : "Mês anterior"}
          >
            <IconArrowLeft size={16} />
          </button>
          {/* Alternador Mês / Semana */}
          <div className="flex rounded-lg border border-white/10 bg-black/20 p-0.5">
            <button
              onClick={() => setView("month")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                view === "month" ? "bg-white text-ink-950" : "text-zinc-400 hover:text-white"
              }`}
            >
              Mês
            </button>
            <button
              onClick={() => setView("week")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                view === "week" ? "bg-white text-ink-950" : "text-zinc-400 hover:text-white"
              }`}
            >
              Semana
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <p className="font-display text-sm font-semibold capitalize text-white">{label}</p>
          <button
            onClick={goToday}
            className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white"
          >
            hoje
          </button>
        </div>

        <button
          onClick={() => shift(1)}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label={view === "week" ? "Próxima semana" : "Próximo mês"}
        >
          <IconChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-white/[0.06]">
        {/* No MÊS o cabeçalho é fixo (seg…dom); na SEMANA acompanha os dias reais,
            já que a primeira coluna é sempre HOJE. */}
        {(view === "week"
          ? days.map((d) => d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""))
          : WEEKDAYS
        ).map((label, i) => (
          <p
            key={i}
            className={`py-2 text-center font-mono text-[10px] uppercase tracking-wider ${
              view === "week" && days[i].getTime() === today.getTime()
                ? "font-bold text-white"
                : "text-zinc-600"
            }`}
          >
            {label}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = view === "week" || d.getMonth() === month.month;
          const isToday = d.getTime() === today.getTime();
          const dayPosts = (byDay.get(d.toDateString()) || []).sort(
            (a, b) => a.scheduledAt - b.scheduledAt,
          );
          // Na semana mostra todos (com rolagem); no mês, os 3 primeiros + contador.
          const shown = view === "week" ? dayPosts : dayPosts.slice(0, MAX_MONTH_POSTS);
          return (
            <button
              key={i}
              onClick={() => onDayClick(new Date(d))}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const postId = e.dataTransfer.getData("text/plain");
                if (postId) onPostMove(postId, new Date(d));
              }}
              className={`flex flex-col border-b border-r border-white/[0.04] p-1 text-left align-top transition-colors hover:bg-white/[0.03] ${
                view === "week" ? "h-[420px]" : "min-h-[72px] sm:min-h-[96px]"
              } ${inMonth ? "" : "opacity-35"} ${isToday && view === "week" ? "bg-white/[0.02]" : ""}`}
            >
              <span
                className={`ml-1 inline-grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] ${
                  isToday ? "bg-white font-bold text-ink-950" : "text-zinc-500"
                }`}
              >
                {d.getDate()}
              </span>
              <div className={`mt-0.5 space-y-1 ${view === "week" ? "flex-1 overflow-y-auto pr-0.5" : ""}`}>
                {shown.map((p) => {
                  const targetType = p.networks.find((n) => n.network === "telegram")?.postType;
                  const isTelegramVIP = targetType === "VIP";
                  const isTelegramWarmup = targetType && targetType !== "VIP";
                  const isTelegram = isTelegramVIP || isTelegramWarmup;

                  return (
                    <span
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", p.id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPostClick(p);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          onPostClick(p);
                        }
                      }}
                      className={`block rounded-md border px-1.5 py-1 text-[10px] leading-tight transition-colors ${
                        p.status === "posted"
                          ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200"
                          : isOverdue(p)
                            ? "border-amber-500/30 bg-amber-500/[0.08] text-amber-200"
                            : isTelegramVIP
                              ? "border-sky-500/30 bg-sky-500/[0.08] text-sky-200 hover:border-sky-500/50"
                              : isTelegramWarmup
                                ? "border-orange-500/30 bg-orange-500/[0.08] text-orange-200 hover:border-orange-500/50"
                                : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/25"
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {!isTelegram &&
                          p.networks.map((n) => (
                            <span
                              key={n.accountId || n.network}
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                            />
                          ))}
                        <span className="font-mono">{fmtTime(p.scheduledAt)}</span>
                        {!isReady(p) && !isTelegram && (
                          <span
                            className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-red-500"
                            title="Incompleto (falta mídia ou legenda)"
                          />
                        )}
                      </span>
                      <span className="block truncate text-zinc-400">
                        {p.profileName} {isTelegram ? `· ${targetType}` : `· ${p.networks[0]?.postType}`}
                        {!isTelegram && p.networks.length > 1 ? ` +${p.networks.length - 1}` : ""}
                      </span>
                    </span>
                  );
                })}
                {view === "month" && dayPosts.length > MAX_MONTH_POSTS && (
                  <span className="block px-1.5 font-mono text-[9px] uppercase text-zinc-600">
                    +{dayPosts.length - MAX_MONTH_POSTS} post(s)
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
