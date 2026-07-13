import "server-only";
import { callAiRaw } from "./ai";
import type { AiProvider } from "./settings";
import { NETWORK_LABELS, type SocialNetwork } from "./types";
import type { SlotInstance } from "./scheduleTemplate";

export type MediaCandidate = {
  id: string;
  filename: string;
  kind: "image" | "video";
  tags: string[];
  ratio: string;
  createdAt: number;
  used: boolean;
};

export type ScheduleAiInput = {
  provider: AiProvider;
  profileName: string;
  profileNotes?: string;
  slots: SlotInstance[];
  media: MediaCandidate[];
};

export type ScheduleProposal = {
  slotId: string;
  scheduledAt: number;
  network: SocialNetwork;
  postType: string;
  mediaIds: string[];
  caption: string;
  /** true = a IA não preencheu esse slot corretamente; o servidor completou no braço. */
  usedFallback: boolean;
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dateTimeToMs(date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

function buildSchedulePrompt(input: ScheduleAiInput): string {
  const slotsJson = JSON.stringify(
    input.slots.map((s) => ({
      slotId: s.slotId,
      date: s.date,
      timeStart: s.timeStart,
      timeEnd: s.timeEnd,
      network: NETWORK_LABELS[s.network] || s.network,
      postType: s.postType,
      mediaKind: s.mediaKind,
    })),
  );
  const mediaJson = JSON.stringify(
    input.media.map((m) => ({
      id: m.id,
      filename: m.filename,
      kind: m.kind,
      tags: m.tags,
      ratio: m.ratio,
      createdAt: new Date(m.createdAt).toISOString().slice(0, 10),
      used: m.used,
    })),
  );
  return [
    `Você é social media da influenciadora "${input.profileName}".`,
    input.profileNotes ? `Sobre a personagem: ${input.profileNotes}` : "",
    "Sua tarefa: para cada slot de horário abaixo, escolha 1 mídia da lista de",
    "mídias disponíveis (2 ou mais somente se o tipo do post for \"Carrossel\") e",
    "escreva uma legenda curta em português do Brasil.",
    "",
    "Regras OBRIGATÓRIAS:",
    '- Responda SOMENTE com um JSON no formato exato: {"posts":[{"slotId":"...","time":"HH:MM","mediaIds":["..."],"caption":"..."}]}',
    "- Um objeto por slot da lista abaixo, usando o MESMO slotId recebido.",
    '- "time" deve ser um horário dentro da janela [timeStart, timeEnd] daquele slot.',
    "- Dê preferência a horários próximos de 12:00 ou 18:00 (horários de pico) para",
    "  o conteúdo com maior potencial de engajamento, avaliado pelas etiquetas/nome do arquivo.",
    '- "mediaIds" só pode conter ids que aparecem na lista de mídias — nunca invente ids.',
    '- Respeite o "mediaKind" pedido em cada slot (se for "image" ou "video", só escolha mídia desse kind).',
    '- PRIORIZE mídias com "used": false. Só use "used": true se não houver mídias',
    "  suficientes sem uso para cobrir todos os slots.",
    "- NÃO repita a mesma mídia em dois slots diferentes deste plano, a menos que",
    "  o pool de mídias sem uso seja pequeno demais para cobrir todos os slots.",
    '- Combine a proporção ("ratio") da mídia com o tipo de post quando possível',
    '  (Stories/Reels/Short combinam com "9:16"; Feed/Post combinam com "1:1" ou "4:3").',
    "- Legendas: tom autêntico em primeira pessoa, emojis com moderação, 3 a 6",
    "  hashtags no final; curtas para Stories/Mensagem, mais longas para Feed/Reels.",
    "",
    "slots:",
    slotsJson,
    "",
    "media:",
    mediaJson,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

type RawPost = { slotId?: unknown; time?: unknown; mediaIds?: unknown; caption?: unknown };

function parseAndValidate(
  raw: string,
  input: ScheduleAiInput,
): Map<string, { time: string; mediaIds: string[]; caption: string }> {
  const result = new Map<string, { time: string; mediaIds: string[]; caption: string }>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  const posts = (parsed as { posts?: unknown })?.posts;
  if (!Array.isArray(posts)) return result;

  const slotsById = new Map(input.slots.map((s) => [s.slotId, s]));
  const mediaById = new Map(input.media.map((m) => [m.id, m]));
  const usedInBatch = new Set<string>();
  const unusedCount = input.media.filter((m) => !m.used).length;

  for (const entry of posts as RawPost[]) {
    if (typeof entry?.slotId !== "string") continue;
    const slot = slotsById.get(entry.slotId);
    if (!slot || result.has(entry.slotId)) continue;

    let time = typeof entry.time === "string" && /^\d{2}:\d{2}$/.test(entry.time) ? entry.time : slot.timeStart;
    const startMin = timeToMinutes(slot.timeStart);
    const endMin = timeToMinutes(slot.timeEnd);
    const min = timeToMinutes(time);
    if (min < startMin || min > endMin) {
      time = minutesToTime(Math.round((startMin + endMin) / 2));
    }

    const rawIds = Array.isArray(entry.mediaIds) ? entry.mediaIds : [];
    const mediaIds = rawIds.filter((id): id is string => {
      if (typeof id !== "string") return false;
      const m = mediaById.get(id);
      if (!m) return false;
      if (slot.mediaKind !== "any" && m.kind !== slot.mediaKind) return false;
      // Evita repetir mídia dentro do mesmo lote, a menos que o pool sem uso
      // seja menor que o número de slots (aí a repetição é aceitável).
      if (usedInBatch.has(id) && unusedCount >= input.slots.length) return false;
      return true;
    });
    if (mediaIds.length === 0) continue;

    const caption = typeof entry.caption === "string" ? entry.caption.trim().slice(0, 2000) : "";
    if (!caption) continue;

    mediaIds.forEach((id) => usedInBatch.add(id));
    result.set(entry.slotId, { time, mediaIds, caption });
  }
  return result;
}

/** Preenche no braço qualquer slot que a IA não tenha respondido validamente. */
function fillGaps(
  input: ScheduleAiInput,
  validated: Map<string, { time: string; mediaIds: string[]; caption: string }>,
): ScheduleProposal[] {
  const consumed = new Set<string>();
  for (const v of validated.values()) v.mediaIds.forEach((id) => consumed.add(id));

  const pool = [...input.media]
    .sort((a, b) => a.createdAt - b.createdAt)
    .sort((a, b) => Number(a.used) - Number(b.used));

  function pickFallbackMedia(kind: "any" | "image" | "video"): string | null {
    const compatible = pool.filter((m) => kind === "any" || m.kind === kind);
    const fresh = compatible.find((m) => !consumed.has(m.id));
    if (fresh) return fresh.id;
    // Pool esgotado: relaxa a exigência de kind antes de desistir.
    const anyFresh = pool.find((m) => !consumed.has(m.id));
    if (anyFresh) return anyFresh.id;
    // Nada sobrando: repete algo (melhor que deixar o slot vazio).
    return compatible[0]?.id ?? pool[0]?.id ?? null;
  }

  return input.slots.map((slot) => {
    const v = validated.get(slot.slotId);
    if (v) {
      return {
        slotId: slot.slotId,
        scheduledAt: dateTimeToMs(slot.date, v.time),
        network: slot.network,
        postType: slot.postType,
        mediaIds: v.mediaIds,
        caption: v.caption,
        usedFallback: false,
      };
    }
    const mediaId = pickFallbackMedia(slot.mediaKind);
    if (mediaId) consumed.add(mediaId);
    const midTime = minutesToTime(
      Math.round((timeToMinutes(slot.timeStart) + timeToMinutes(slot.timeEnd)) / 2),
    );
    const [y, mo, d] = slot.date.split("-");
    return {
      slotId: slot.slotId,
      scheduledAt: dateTimeToMs(slot.date, midTime),
      network: slot.network,
      postType: slot.postType,
      mediaIds: mediaId ? [mediaId] : [],
      caption: `Publicação para ${NETWORK_LABELS[slot.network] || slot.network} (${slot.postType}) em ${d}/${mo}/${y}. Revise a legenda antes de confirmar.`,
      usedFallback: true,
    };
  });
}

export async function generateSchedulePlan(input: ScheduleAiInput): Promise<ScheduleProposal[]> {
  if (input.slots.length === 0) return [];
  const prompt = buildSchedulePrompt(input);
  const raw = await callAiRaw(prompt, input.provider, { json: true, maxTokens: 4000 });
  const validated = parseAndValidate(raw, input);
  return fillGaps(input, validated);
}
