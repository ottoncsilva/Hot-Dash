"use client";

import { useState } from "react";
import { IconArrowLeft, IconChevronRight } from "@/components/icons";
import FaixaRolavel from "@/components/FaixaRolavel";
import AuthImage from "@/components/AuthImage";
import { NETWORK_DOT_COLORS, type ScheduledPost } from "@/lib/postTypes";

/**
 * Calendário do CRONOGRAMA — redes sociais.
 *
 * Nasceu separado do `CalendarGrid` (que é do calendário do Telegram) porque os
 * dois respondem perguntas diferentes e por isso mostram coisas diferentes.
 * Enquanto dividiam o mesmo componente, cada ajuste de um virava uma opção a
 * mais no outro, e as duas telas ficavam presas ao denominador comum.
 *
 * O que o Cronograma precisa mostrar, e que manda no desenho daqui:
 *
 *  - A MÍDIA. O trabalho é montar uma grade visual, então reconhecer a foto de
 *    relance vale mais que qualquer texto — a miniatura é o corpo do cartão.
 *  - A CONTA. A modelo tem três, quatro Instagram; "que post é esse" quase
 *    sempre quer dizer "em qual perfil". O @ vem antes de qualquer outra coisa.
 *  - O ESTADO. Já saiu ou ainda falta: verde e laranja claro, e nada mais.
 *
 * O nome da MODELO não aparece: ela é escolhida no menu do painel e vale para a
 * tela inteira, então repeti-la em cada cartão só gastaria a largura que o @ da
 * conta precisa.
 */

// A grade do MÊS começa na segunda-feira.
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/** Quantos posts o cartão do MÊS mostra antes de virar "+N". */
const MAX_POSTS_NO_MES = 3;

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekRangeLabel(a: Date, b: Date): string {
  const monA = a.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const monB = b.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const year = b.getFullYear();
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} de ${monA} ${year}`;
  return `${a.getDate()} ${monA} – ${b.getDate()} ${monB} ${year}`;
}

/** Post pronto para ir ao ar: tem mídia E legenda. */
const estaPronto = (p: ScheduledPost) =>
  p.media.length > 0 && Boolean(p.caption && p.caption.trim());

/** O @ do destino, com "+N" quando o post vai para mais de uma conta. */
function rotuloDaConta(p: ScheduledPost): string {
  const primeira = p.networks[0];
  if (!primeira) return "";
  const nome = primeira.accountUsername ? `@${primeira.accountUsername}` : primeira.network;
  return p.networks.length > 1 ? `${nome} +${p.networks.length - 1}` : nome;
}

export default function CronogramaCalendar({
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
  // SEMANA é o padrão: o cronograma se monta olhando os próximos dias, não o
  // mês fechado. O mês continua disponível para a visão geral.
  const [view, setView] = useState<"month" | "week">("week");
  // A semana é ancorada em HOJE — a primeira coluna é sempre o dia atual, e as
  // setas deslocam de 7 em 7. Planejar começa de hoje, não de uma segunda-feira
  // que já passou.
  const [weekStart, setWeekStart] = useState<Date>(() => startOfDay(new Date()));

  const today = startOfDay(new Date());

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

  const porDia = new Map<string, ScheduledPost[]>();
  for (const p of posts) {
    const k = new Date(p.scheduledAt).toDateString();
    const lista = porDia.get(k) || [];
    lista.push(p);
    porDia.set(k, lista);
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

  function hoje() {
    if (view === "week") setWeekStart(startOfDay(new Date()));
    else {
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

  return (
    <div className="mt-4 card overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-white/[0.06] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shift(-1)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            aria-label={view === "week" ? "Semana anterior" : "Mês anterior"}
          >
            <IconArrowLeft size={16} />
          </button>
          <div className="flex gap-1 rounded-lg border border-white/10 p-1">
            {(
              [
                ["month", "Mês"],
                ["week", "Semana"],
              ] as const
            ).map(([key, texto]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-[40px] ${
                  view === key ? "bg-white text-ink-950" : "text-zinc-400 hover:text-white"
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
          <p className="font-display text-sm font-semibold capitalize text-white sm:hidden">
            {label}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <p className="hidden font-display text-sm font-semibold capitalize text-white sm:block">
            {label}
          </p>
          <button
            onClick={hoje}
            className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white"
          >
            hoje
          </button>
          <button
            onClick={() => shift(1)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            aria-label={view === "week" ? "Próxima semana" : "Próximo mês"}
          >
            <IconChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Sete colunas em ~390px dariam ~55px cada — ilegível. No celular a grade
          rola na horizontal com largura mínima; a faixa põe o degradê na ponta
          para avisar que há mais coisa ali. */}
      <FaixaRolavel ariaLabel={view === "week" ? "Semana" : "Mês"}>
        <div className="min-w-[760px] sm:min-w-0">
          <div className="grid grid-cols-7 border-b border-white/[0.06]">
            {(view === "week"
              ? days.map((d) => d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""))
              : WEEKDAYS
            ).map((texto, i) => (
              <p
                key={i}
                className={`py-2 text-center font-mono text-[10px] uppercase tracking-wider ${
                  view === "week" && days[i].getTime() === today.getTime()
                    ? "font-bold text-white"
                    : "text-zinc-600"
                }`}
              >
                {texto}
              </p>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const noMes = view === "week" || d.getMonth() === month.month;
              const ehHoje = d.getTime() === today.getTime();
              const doDia = (porDia.get(d.toDateString()) || []).sort(
                (a, b) => a.scheduledAt - b.scheduledAt,
              );
              const mostrados = view === "week" ? doDia : doDia.slice(0, MAX_POSTS_NO_MES);
              return (
                <div
                  key={i}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const postId = e.dataTransfer.getData("text/plain");
                    if (postId) onPostMove(postId, new Date(d));
                  }}
                  // Na SEMANA a coluna vai até o rodapé da janela. As 21rem são
                  // o que fica em volta no desktop: o py-10 do <main> (5rem
                  // somados), o cabeçalho da página (~3rem), a barra de filtros
                  // com a margem (~5,9rem) e o cabeçalho daqui com a linha dos
                  // dias (~6,3rem). Sobra ~1rem — a conta erra para o lado
                  // seguro, porque folga é invisível e falta traz de volta a
                  // barra de rolagem da página que isto veio tirar.
                  //
                  // Quem rola é o DIA, não a página: com a página rolando,
                  // arrastar um post para outro dia levava a grade junto e a
                  // coluna de destino saía da vista.
                  className={`flex flex-col border-b border-r border-white/[0.04] p-1 text-left transition-colors ${
                    view === "week"
                      ? "h-[calc(100dvh-21rem)] min-h-[320px]"
                      : "min-h-[84px] sm:min-h-[104px]"
                  } ${noMes ? "" : "opacity-35"} ${ehHoje && view === "week" ? "bg-white/[0.02]" : ""}`}
                >
                  {/* O número do dia é o botão de "criar aqui". O dia inteiro
                      não é clicável de propósito: com a coluna ocupando a tela,
                      um clique perdido em qualquer lugar dela abria o
                      formulário sem querer o tempo todo. */}
                  <button
                    type="button"
                    onClick={() => onDayClick(new Date(d))}
                    title="Novo post neste dia"
                    className={`ml-1 inline-grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] transition-colors ${
                      ehHoje
                        ? "bg-white font-bold text-ink-950"
                        : "text-zinc-500 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {d.getDate()}
                  </button>

                  <div
                    className={`mt-1 space-y-1 ${view === "week" ? "flex-1 overflow-y-auto pr-0.5" : ""}`}
                  >
                    {mostrados.map((p) => {
                      const postado = p.status === "posted";
                      const capa = p.media[0];
                      return (
                        <div
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                          onClick={() => onPostClick(p)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onPostClick(p);
                          }}
                          // Duas cores e mais nada: verde já saiu, laranja
                          // clarinho ainda falta. É a única pergunta que o
                          // cartão precisa responder de longe.
                          className={`block cursor-pointer overflow-hidden rounded-md border transition-colors ${
                            postado
                              ? "border-emerald-500/40 bg-emerald-500/[0.10] hover:border-emerald-500/60"
                              : "border-amber-400/25 bg-amber-400/[0.07] hover:border-amber-400/50"
                          }`}
                        >
                          {view === "week" && capa && (
                            <AuthImage
                              src={`/api/media/${capa.id}/thumbnail?v=${capa.updatedAt || 0}`}
                              alt=""
                              // `cover` aqui, ao contrário da galeria do
                              // formulário: o cartão é uma faixa larga e baixa,
                              // onde a imagem inteira viraria um selo no meio.
                              // Aqui a miniatura serve para RECONHECER, não para
                              // avaliar enquadramento.
                              className="h-20 w-full object-cover"
                              fallback={<div className="h-20 w-full bg-white/5" />}
                            />
                          )}
                          <div className="px-1.5 py-1 text-[10px] leading-tight">
                            <span className="flex items-center gap-1">
                              {p.networks.map((n) => (
                                <span
                                  key={n.accountId || n.network}
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: NETWORK_DOT_COLORS[n.network] }}
                                />
                              ))}
                              <span
                                className={`font-mono ${postado ? "text-emerald-200" : "text-amber-100/90"}`}
                              >
                                {fmtTime(p.scheduledAt)}
                              </span>
                              <span className="truncate text-zinc-400">
                                {p.networks[0]?.postType}
                              </span>
                              {!estaPronto(p) && (
                                <span
                                  className="ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                                  title="Incompleto: falta mídia ou legenda"
                                />
                              )}
                            </span>
                            <span className="block truncate text-zinc-400">{rotuloDaConta(p)}</span>
                          </div>
                        </div>
                      );
                    })}
                    {view === "month" && doDia.length > MAX_POSTS_NO_MES && (
                      <span className="block px-1.5 font-mono text-[9px] uppercase text-zinc-600">
                        +{doDia.length - MAX_POSTS_NO_MES} post(s)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </FaixaRolavel>
    </div>
  );
}
