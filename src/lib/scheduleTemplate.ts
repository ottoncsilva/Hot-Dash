import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { POST_TYPES, type MediaKindFilter } from "./postTypes";
import type { SocialNetwork } from "./types";

/** Um horário do programa semanal recorrente (ex.: "seg, 06h-09h, Instagram Reels"). */
export type TemplateSlot = {
  id: string;
  weekday: number; // 0=domingo … 6=sábado
  timeStart: string; // "HH:MM"
  timeEnd: string; // "HH:MM"
  network: SocialNetwork;
  postType: string;
  mediaKind: MediaKindFilter;
  label?: string;
  sortOrder: number;
  createdAt: number;
};

export type TemplateSlotInput = Omit<TemplateSlot, "id" | "createdAt">;

type SlotRow = {
  id: string;
  weekday: number;
  time_start: string;
  time_end: string;
  network: string;
  post_type: string;
  media_kind: string;
  label: string | null;
  sort_order: number;
  created_at: number;
};

function toClient(r: SlotRow): TemplateSlot {
  return {
    id: r.id,
    weekday: r.weekday,
    timeStart: r.time_start,
    timeEnd: r.time_end,
    network: r.network as SocialNetwork,
    postType: r.post_type,
    mediaKind: r.media_kind === "image" || r.media_kind === "video" ? r.media_kind : "any",
    label: r.label || undefined,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}

export function listTemplateSlots(): TemplateSlot[] {
  const rows = getDb()
    .prepare("SELECT * FROM schedule_template_slots ORDER BY weekday, time_start")
    .all() as SlotRow[];
  return rows.map(toClient);
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateSlot(s: TemplateSlotInput) {
  if (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6) {
    throw new Error("Dia da semana inválido no programa.");
  }
  if (!TIME_RE.test(s.timeStart) || !TIME_RE.test(s.timeEnd)) {
    throw new Error("Horário inválido no programa (use HH:MM).");
  }
  if (s.timeEnd <= s.timeStart) {
    throw new Error("O horário final precisa ser depois do inicial em cada janela.");
  }
  if (!POST_TYPES[s.network]) {
    throw new Error("Rede social inválida no programa.");
  }
  if (!POST_TYPES[s.network].includes(s.postType)) {
    throw new Error(`Tipo de post inválido para ${s.network} no programa.`);
  }
  if (s.mediaKind !== "any" && s.mediaKind !== "image" && s.mediaKind !== "video") {
    throw new Error("Formato de mídia inválido no programa.");
  }
}

/** Substitui todo o programa semanal em uma transação (lista pequena, global). */
export function replaceTemplateSlots(slots: TemplateSlotInput[]): TemplateSlot[] {
  slots.forEach(validateSlot);
  const db = getDb();
  const now = Date.now();
  const run = db.transaction(() => {
    db.prepare("DELETE FROM schedule_template_slots").run();
    const ins = db.prepare(
      `INSERT INTO schedule_template_slots
       (id, weekday, time_start, time_end, network, post_type, media_kind, label, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    slots.forEach((s, i) => {
      ins.run(
        randomUUID(),
        s.weekday,
        s.timeStart,
        s.timeEnd,
        s.network,
        s.postType,
        s.mediaKind,
        s.label || null,
        i,
        now,
      );
    });
  });
  run();
  return listTemplateSlots();
}

/** Uma instância concreta de um slot do programa numa data específica. */
export type SlotInstance = {
  slotId: string; // `${templateSlotId}:${yyyy-mm-dd}`
  date: string; // "YYYY-MM-DD"
  weekday: number;
  timeStart: string;
  timeEnd: string;
  network: SocialNetwork;
  postType: string;
  mediaKind: MediaKindFilter;
  label?: string;
};

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Expande o programa semanal em instâncias concretas dentro de [from, to)
 * (epoch ms, horário local). Função pura, sem acesso ao banco — testável
 * isoladamente e reutilizada tanto pela rota quanto pelo gerador de IA.
 */
export function expandTemplate(from: number, to: number, slots: TemplateSlot[]): SlotInstance[] {
  const instances: SlotInstance[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  while (cursor.getTime() < end.getTime()) {
    const weekday = cursor.getDay();
    const dateStr = fmtDate(cursor);
    for (const s of slots) {
      if (s.weekday !== weekday) continue;
      instances.push({
        slotId: `${s.id}:${dateStr}`,
        date: dateStr,
        weekday,
        timeStart: s.timeStart,
        timeEnd: s.timeEnd,
        network: s.network,
        postType: s.postType,
        mediaKind: s.mediaKind,
        label: s.label,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  instances.sort((a, b) => (a.date + a.timeStart).localeCompare(b.date + b.timeStart));
  return instances;
}
