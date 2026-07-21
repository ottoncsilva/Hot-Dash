import "server-only";
import { callAiRaw } from "./ai";
import type { AiProvider } from "./settings";

/**
 * Gerador da SEQUÊNCIA DIÁRIA do grupo de PRÉVIAS (Método MK).
 *
 * IMPORTANTE: a AGENDA é FIXA e definida pelo SERVIDOR — cada horário tem um
 * TIPO de post pré-definido (foto, reação ou enquete). A IA NÃO decide os tipos
 * nem os horários; ela só escreve a COPY de cada post. Assim o dia sempre sai
 * com a mistura certa (não "tudo foto").
 *
 * Tipos:
 *  - foto: legenda ousada + mídia (a imagem é escolhida no servidor).
 *  - reacao: post curto que provoca e PEDE reação ("reage com 🔥 e me conta…").
 *  - enquete: enquete nativa do Telegram (pergunta + 2–3 opções).
 *
 * Os links de CTA para o VIP são anexados no envio (telegramCron).
 */

export type MkKind = "foto" | "reacao" | "enquete";

export type MkSlot = { time: string; kind: MkKind; note?: string };

/** AGENDA FIXA do Método MK — 16 posts/dia (08h → 01h da madrugada). */
export const MK_SCHEDULE: MkSlot[] = [
  { time: "08:00", kind: "foto", note: "acordando hypada" },
  { time: "09:00", kind: "reacao" },
  { time: "10:00", kind: "enquete" },
  { time: "11:00", kind: "foto" },
  { time: "12:00", kind: "reacao" },
  { time: "13:00", kind: "enquete" },
  { time: "14:00", kind: "reacao" },
  { time: "17:00", kind: "foto", note: "saindo do trampo" },
  { time: "18:00", kind: "reacao" },
  { time: "19:00", kind: "enquete", note: "com clima de teaser" },
  { time: "20:00", kind: "reacao" },
  { time: "21:00", kind: "foto", note: "pico do desejo" },
  { time: "22:00", kind: "reacao" },
  { time: "23:00", kind: "enquete", note: "leve" },
  { time: "00:00", kind: "foto", note: "pra quem tá acordado de madrugada" },
  { time: "01:00", kind: "reacao", note: "fechando o dia" },
];

export type PreviaPost = {
  time: string;
  kind: MkKind;
  text: string;
  poll?: { question: string; options: string[] };
};

export type PreviasProfile = {
  name: string;
  physical?: string;
  fetish?: string;
  personality?: string;
  notes?: string;
};

function personaLine(profile: PreviasProfile): string {
  return [
    `Modelo: ${profile.name}.`,
    profile.physical ? `Físico: ${profile.physical}.` : "",
    profile.fetish ? `Diferencial/fetiche: ${profile.fetish}.` : "",
    profile.notes ? `Notas: ${profile.notes}.` : "",
    profile.personality === "santinha"
      ? "Estilo: santinha (inocente por fora, safada por dentro)."
      : profile.personality === "explicita"
        ? "Estilo: explícita (sem papas na língua, ousada e direta)."
        : "Estilo: safadinha (safada na medida).",
  ]
    .filter(Boolean)
    .join(" ");
}

function periodHint(time: string): string {
  const h = parseInt(time.slice(0, 2), 10);
  if (h >= 5 && h < 12) return "manhã (acordar, rotina, cama)";
  if (h >= 12 && h < 18) return "tarde (trabalho, estúdio, treino)";
  if (h >= 18 && h < 24) return "noite (banho, tesão subindo)";
  return "madrugada (sozinha na cama, mais explícita)";
}

function kindHint(kind: MkKind): string {
  switch (kind) {
    case "foto":
      return "foto — legenda ousada como se descrevesse uma foto sua (o sistema anexa a imagem)";
    case "reacao":
      return "reacao — post CURTO que provoca e PEDE reação (ex.: 'reage com 🔥 e me conta…', '🔥 se você faria isso comigo')";
    case "enquete":
      return "enquete — preencha poll.question e 2 a 3 poll.options curtas e safadas; text pode repetir a pergunta";
  }
}

function buildPrompt(profile: PreviasProfile): string {
  const agenda = MK_SCHEDULE.map(
    (s, i) =>
      `${i}) ${s.time} — ${kindHint(s.kind)}${s.note ? ` [contexto: ${s.note}]` : ""} — período: ${periodHint(s.time)}`,
  ).join("\n");

  return [
    `Você é a própria ${profile.name} escrevendo no seu grupo de PRÉVIAS gratuito do Telegram.`,
    personaLine(profile),
    "",
    "Escreva a COPY de cada post da AGENDA FIXA de hoje. Tom de 'diário íntimo', 1ª pessoa,",
    "português do Brasil, sensual e autêntico, provocando e levando pro VIP. NÃO escreva links",
    "nem 'entra no VIP' (os botões/links são adicionados automaticamente). Emojis com moderação",
    "(🔥😈💦😏). Cada text com no máximo ~350 caracteres. Varie as aberturas; nunca repita a mesma.",
    "",
    "AGENDA (responda na MESMA ordem e índices):",
    agenda,
    "",
    "Regras DE FORMATO (obrigatórias):",
    '- Responda SOMENTE um JSON: {"slots":[{"i":0,"text":"...","poll":{"question":"...","options":["..",".."]}}]}',
    `- Um item para CADA índice acima (0 a ${MK_SCHEDULE.length - 1}).`,
    "- O campo poll SÓ nos itens de enquete; nos demais, omita poll.",
    "- Não invente novos tipos nem horários: eles já estão fixados.",
  ].join("\n");
}

/** Converte HH:MM em timestamp. `jitter` aplica ±3 min aleatórios para o
 *  horário não sair "redondo" (00:07 em vez de 00:00). */
function timeToMs(dateBase: Date, time: string, jitter = false): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const d = new Date(dateBase);
  if (!m) {
    d.setHours(12, 0, 0, 0);
  } else {
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    // Horários de madrugada (00:00–05:00) pertencem ao "dia seguinte".
    d.setHours(h, min, 0, 0);
    if (h <= 5) d.setDate(d.getDate() + 1);
  }
  let ms = d.getTime();
  if (jitter) {
    const delta = Math.floor(Math.random() * 7) - 3; // -3..+3 minutos
    ms += delta * 60 * 1000;
  }
  return ms;
}

/** Copy de fallback caso a IA falhe/omita algum item — garante que o slot
 *  sempre vira um post do TIPO certo. */
function fallbackText(kind: MkKind, note?: string): string {
  if (kind === "foto") return note ? `Olha eu aqui ${note}… 🔥 gostou?` : "Preparei essa só pra você… 🔥";
  if (kind === "enquete") return "Me ajuda a decidir 😈";
  return "Reage com 🔥 se você tá pensando em mim agora 😈";
}

function fallbackPoll(): { question: string; options: string[] } {
  return { question: "O que você quer ver hoje? 😈", options: ["Foto 🔥", "Vídeo 💦", "Surpresa 😏"] };
}

function parse(raw: string): PreviaPost[] {
  let items: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(raw) as { slots?: unknown };
    if (Array.isArray(parsed?.slots)) items = parsed.slots as Record<string, unknown>[];
  } catch {
    items = [];
  }

  // Indexa a resposta da IA por índice `i` (com fallback pela posição).
  const byIndex = new Map<number, Record<string, unknown>>();
  items.forEach((it, pos) => {
    const i = typeof it.i === "number" ? it.i : pos;
    byIndex.set(i, it);
  });

  return MK_SCHEDULE.map((slot, i) => {
    const it = byIndex.get(i);
    const aiText = typeof it?.text === "string" ? (it.text as string).trim().slice(0, 800) : "";
    const text = aiText || fallbackText(slot.kind, slot.note);

    let poll: PreviaPost["poll"];
    if (slot.kind === "enquete") {
      const p = it?.poll as Record<string, unknown> | undefined;
      const q = typeof p?.question === "string" ? (p.question as string) : "";
      const opts = Array.isArray(p?.options)
        ? (p!.options as unknown[]).filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        : [];
      poll = q && opts.length >= 2 ? { question: q, options: opts.slice(0, 4) } : fallbackPoll();
    }

    return { time: slot.time, kind: slot.kind, text, poll };
  });
}

export async function generatePreviasDay(
  profile: PreviasProfile,
  provider: AiProvider,
  dateBase: Date,
): Promise<{ posts: PreviaPost[]; scheduledAt: (p: PreviaPost) => number }> {
  let posts: PreviaPost[];
  try {
    const rawAi = await callAiRaw(buildPrompt(profile), provider, { json: true, maxTokens: 4000 });
    posts = parse(rawAi);
  } catch {
    // Sem IA: ainda assim entrega o dia inteiro com copy de fallback.
    posts = MK_SCHEDULE.map((slot) => ({
      time: slot.time,
      kind: slot.kind,
      text: fallbackText(slot.kind, slot.note),
      poll: slot.kind === "enquete" ? fallbackPoll() : undefined,
    }));
  }
  // scheduledAt aplica jitter de ±3 min para não ficar com horário exato.
  return { posts, scheduledAt: (p) => timeToMs(dateBase, p.time, true) };
}
