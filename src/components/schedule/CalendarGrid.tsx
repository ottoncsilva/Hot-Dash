import React from "react";
import { IconArrowLeft, IconChevronRight } from "@/components/icons";
import { NETWORK_DOT_COLORS, type ScheduledPost } from "@/lib/postTypes";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
}: {
  month: { year: number; month: number };
  onMonthChange: (m: { year: number; month: number }) => void;
  posts: ScheduledPost[];
  onDayClick: (d: Date) => void;
  onPostClick: (p: ScheduledPost) => void;
  onPostMove: (postId: string, newDate: Date) => void;
}) {
  const first = new Date(month.year, month.month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // volta até domingo
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  const byDay = new Map<string, ScheduledPost[]>();
  for (const p of posts) {
    const k = new Date(p.scheduledAt).toDateString();
    const list = byDay.get(k) || [];
    list.push(p);
    byDay.set(k, list);
  }

  function shift(delta: number) {
    const d = new Date(month.year, month.month + delta, 1);
    onMonthChange({ year: d.getFullYear(), month: d.getMonth() });
  }

  const monthLabel = first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="mt-4 card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <button
          onClick={() => shift(-1)}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Mês anterior"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-3">
          <p className="font-display text-sm font-semibold capitalize text-white">{monthLabel}</p>
          <button
            onClick={() => {
              const d = new Date();
              onMonthChange({ year: d.getFullYear(), month: d.getMonth() });
            }}
            className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white"
          >
            hoje
          </button>
        </div>
        <button
          onClick={() => shift(1)}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Próximo mês"
        >
          <IconChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-white/[0.06]">
        {WEEKDAYS.map((d) => (
          <p key={d} className="py-2 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            {d}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month.month;
          const isToday = d.getTime() === today.getTime();
          const dayPosts = (byDay.get(d.toDateString()) || []).sort(
            (a, b) => a.scheduledAt - b.scheduledAt,
          );
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
              className={`min-h-[72px] border-b border-r border-white/[0.04] p-1 text-left align-top transition-colors hover:bg-white/[0.03] sm:min-h-[96px] ${
                inMonth ? "" : "opacity-35"
              }`}
            >
              <span
                className={`ml-1 inline-grid h-6 w-6 place-items-center rounded-full font-mono text-[11px] ${
                  isToday ? "bg-white font-bold text-ink-950" : "text-zinc-500"
                }`}
              >
                {d.getDate()}
              </span>
              <div className="mt-0.5 space-y-1">
                {dayPosts.slice(0, 3).map((p) => {
                  const targetType = p.networks.find(n => n.network === "telegram")?.postType;
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
                        {!isTelegram && p.networks.map((n) => (
                          <span
                            key={n.accountId || n.network}
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                          />
                        ))}
                        <span className="font-mono">{fmtTime(p.scheduledAt)}</span>
                        {!isReady(p) && !isTelegram && (
                          <span className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-red-500" title="Incompleto (falta mídia ou legenda)" />
                        )}
                      </span>
                      <span className="block truncate text-zinc-400">
                        {p.profileName} {isTelegram ? `· ${targetType}` : `· ${p.networks[0]?.postType}`}
                        {(!isTelegram && p.networks.length > 1) ? ` +${p.networks.length - 1}` : ""}
                      </span>
                    </span>
                  );
                })}
                {dayPosts.length > 3 && (
                  <span className="block px-1.5 font-mono text-[9px] uppercase text-zinc-600">
                    +{dayPosts.length - 3} post(s)
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
