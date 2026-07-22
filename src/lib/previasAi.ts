import "server-only";
import { callAiRaw } from "./ai";
import type { AiProvider } from "./settings";

/**
 * Método MK v2 — PLANEJADOR do dia inteiro do grupo de PRÉVIAS.
 *
 * Filosofia: o SERVIDOR monta o plano do dia (quantos posts, que horas, que
 * tipo, com/sem CTA, distribuição humanização/engajamento/conversão), imitando
 * o "MK" (o operador dos bots que convertem bem). A IA só ESCREVE a copy de
 * cada post — nunca decide tipos nem horários (evita o bug de "tudo virou foto").
 *
 * - 30 a 35 posts/dia, número e sequência aleatórios (nenhum dia igual).
 * - 8 janelas de horário (fuso America/São_Paulo), cada uma com objetivo e
 *   tipos priorizados; horários sorteados, sem repetir, com gap mínimo.
 * - Distribuição-alvo ~40% humanização / 30% engajamento / 30% conversão (±10).
 * - Só os tipos de CONVERSÃO levam o botão VIP (cta=true).
 */

// "Kind físico" = o que o motor de envio realmente posta.
export type MkKind = "foto" | "video" | "reacao" | "enquete" | "texto";

// Os 17 tipos do método (sabor da copy sobre o kind físico).
export type MkType =
  | "GOOD_MORNING"
  | "HUMANIZATION"
  | "BREAKFAST"
  | "SELFIE"
  | "WORK"
  | "BEHIND_SCENES"
  | "PHOTO_PREMIUM"
  | "VIDEO_PREMIUM"
  | "REACTION"
  | "POLL"
  | "QUESTION"
  | "CURIOSITY"
  | "PRESENT"
  | "COUNTDOWN"
  | "VIP_INVITATION"
  | "GOOD_NIGHT"
  | "LAST_CALL";

export type MkIntent = "humaniza" | "engaja" | "converte";

type TypeDef = {
  kind: MkKind;
  intent: MkIntent;
  cta: boolean;
  /** Tipo de mídia que este post consome do banco (foto/vídeo), se algum. */
  media?: "photo" | "video";
};

// Comportamento de cada tipo (kind físico + intenção + CTA + mídia).
export const TYPE_DEFS: Record<MkType, TypeDef> = {
  GOOD_MORNING: { kind: "texto", intent: "humaniza", cta: false },
  HUMANIZATION: { kind: "texto", intent: "humaniza", cta: false },
  BREAKFAST: { kind: "texto", intent: "humaniza", cta: false },
  SELFIE: { kind: "foto", intent: "humaniza", cta: false, media: "photo" },
  WORK: { kind: "texto", intent: "humaniza", cta: false },
  BEHIND_SCENES: { kind: "texto", intent: "humaniza", cta: false },
  CURIOSITY: { kind: "texto", intent: "engaja", cta: false },
  QUESTION: { kind: "texto", intent: "engaja", cta: false },
  REACTION: { kind: "reacao", intent: "engaja", cta: false },
  POLL: { kind: "enquete", intent: "engaja", cta: false },
  PHOTO_PREMIUM: { kind: "foto", intent: "converte", cta: true, media: "photo" },
  VIDEO_PREMIUM: { kind: "video", intent: "converte", cta: true, media: "video" },
  PRESENT: { kind: "foto", intent: "converte", cta: true, media: "photo" },
  COUNTDOWN: { kind: "texto", intent: "converte", cta: true },
  VIP_INVITATION: { kind: "texto", intent: "converte", cta: true },
  LAST_CALL: { kind: "texto", intent: "converte", cta: true },
  GOOD_NIGHT: { kind: "texto", intent: "humaniza", cta: false },
};

// Janela de horário: [horaInício, horaFim) em BRT, com os tipos priorizados e o
// peso relativo (quantos posts o dia coloca nessa janela).
type Window = { start: number; end: number; weight: number; types: MkType[] };

const WINDOWS: Window[] = [
  // 05–08 humanizar (venda baixíssima)
  { start: 5, end: 8, weight: 3, types: ["GOOD_MORNING", "HUMANIZATION", "SELFIE", "BREAKFAST", "WORK"] },
  // 08–11 engajamento (com rotina/humanização no meio)
  { start: 8, end: 11, weight: 4, types: ["REACTION", "POLL", "QUESTION", "CURIOSITY", "SELFIE", "HUMANIZATION", "BREAKFAST"] },
  // 11–14 1º pico de conversão
  { start: 11, end: 14, weight: 4, types: ["PHOTO_PREMIUM", "VIDEO_PREMIUM", "VIP_INVITATION", "PRESENT", "REACTION", "HUMANIZATION", "SELFIE"] },
  // 14–17 baixar pressão
  { start: 14, end: 17, weight: 4, types: ["HUMANIZATION", "CURIOSITY", "QUESTION", "BEHIND_SCENES", "WORK", "SELFIE", "PHOTO_PREMIUM"] },
  // 17–20 aquecer
  { start: 17, end: 20, weight: 4, types: ["CURIOSITY", "SELFIE", "POLL", "HUMANIZATION", "BEHIND_SCENES", "PHOTO_PREMIUM", "REACTION"] },
  // 20–23:30 maior janela (mais salesy do dia)
  { start: 20, end: 24, weight: 6, types: ["PHOTO_PREMIUM", "VIDEO_PREMIUM", "COUNTDOWN", "VIP_INVITATION", "LAST_CALL", "REACTION", "HUMANIZATION", "SELFIE"] },
  // 00–03 2º pico (madrugada, alta intenção)
  { start: 0, end: 3, weight: 5, types: ["PHOTO_PREMIUM", "VIDEO_PREMIUM", "COUNTDOWN", "LAST_CALL", "REACTION", "POLL", "HUMANIZATION", "GOOD_NIGHT"] },
  // 03–05 baixa atividade
  { start: 3, end: 5, weight: 2, types: ["HUMANIZATION", "GOOD_NIGHT", "SELFIE", "CURIOSITY", "BEHIND_SCENES"] },
];

export type PreviaPost = {
  time: string; // HH:MM (BRT)
  type: MkType;
  kind: MkKind;
  intent: MkIntent;
  cta: boolean;
  media?: "photo" | "video";
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

// --------------------------------------------------------------------------
// Utilitários de aleatoriedade
// --------------------------------------------------------------------------
function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --------------------------------------------------------------------------
// ETAPA 1 — Planejar o dia (100% servidor)
// --------------------------------------------------------------------------

/** Monta a agenda do dia: horários (BRT) + tipo de cada post, com todas as
 *  regras do método (janelas, distribuição, alternância, sem repetir horário).
 *  Não escreve copy — só a estrutura. */
export function planDay(): Omit<PreviaPost, "text" | "poll">[] {
  const total = randInt(30, 35);

  // 1) Distribui o total pelas janelas conforme o peso (garante ≥1 nas de peso).
  const weightSum = WINDOWS.reduce((s, w) => s + w.weight, 0);
  const perWindow = WINDOWS.map((w) => Math.max(1, Math.round((total * w.weight) / weightSum)));
  // Ajuste fino para bater no total exato.
  let diff = total - perWindow.reduce((s, n) => s + n, 0);
  while (diff !== 0) {
    const i = randInt(0, WINDOWS.length - 1);
    if (diff > 0) {
      perWindow[i]++;
      diff--;
    } else if (perWindow[i] > 1) {
      perWindow[i]--;
      diff++;
    }
  }

  // 2) Para cada janela, sorteia horários únicos (gap mínimo) e tipos, com
  //    alternância de kind físico e limite de venda por janela.
  const planned: Omit<PreviaPost, "text" | "poll">[] = [];
  let lastKind: MkKind | null = null;

  WINDOWS.forEach((w, wi) => {
    const count = perWindow[wi];
    const spanMin = (w.end - w.start) * 60;
    const times = uniqueMinutes(count, spanMin).map((m) => w.start * 60 + m);

    // Alvo de conversão por janela (fração de posts com intent "converte").
    const convTarget = windowConvTarget(w);

    let convDone = 0;
    times.forEach((totalMin, idx) => {
      const h = Math.floor(totalMin / 60) % 24;
      const min = totalMin % 60;
      const timeStr = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

      const wantConv = convDone / count < convTarget;
      const type = chooseType(w, { wantConv, avoidKind: lastKind });
      const def = TYPE_DEFS[type];
      if (def.intent === "converte") convDone++;
      lastKind = def.kind;

      planned.push({
        time: timeStr,
        type,
        kind: def.kind,
        intent: def.intent,
        cta: def.cta,
        media: def.media,
      });
    });
  });

  // 3) Ordena por horário real (madrugada = dia seguinte) para a fila sair certa.
  planned.sort((a, b) => wallOrder(a.time) - wallOrder(b.time));
  return planned;
}

/** Fração-alvo de posts de CONVERSÃO da janela. Calibrado para o GLOBAL ficar
 *  ~30% (alvo 40/30/30 e o que os bots reais fazem, ~27% foto/vídeo), mantendo
 *  noite (20h–03h) e meio-dia como os períodos mais vendedores. */
function windowConvTarget(w: Window): number {
  if (w.start === 20 || w.start === 0) return 0.5; // 20–23:30 e 00–03 (picos)
  if (w.start === 11) return 0.4; // 11–14 (1º pico)
  if (w.start === 17) return 0.3; // 17–20 aquecer
  if (w.start === 14) return 0.2; // 14–17 baixar pressão
  if (w.start === 8) return 0.1; // 08–11 (engajamento)
  if (w.start === 5) return 0.05; // 05–08 (humanização)
  return 0.1; // 03–05
}

/** Escolhe um tipo da janela: prioriza conversão quando `wantConv`; senão
 *  humanização/engajamento. Evita repetir o mesmo kind físico seguido. */
function chooseType(w: Window, opts: { wantConv: boolean; avoidKind: MkKind | null }): MkType {
  const conv = w.types.filter((t) => TYPE_DEFS[t].intent === "converte");
  const nonConv = w.types.filter((t) => TYPE_DEFS[t].intent !== "converte");
  let pool: MkType[];
  if (opts.wantConv && conv.length > 0) {
    pool = conv;
  } else if (nonConv.length > 0) {
    // Não-conversão: enviesa para HUMANIZAÇÃO (~60%) sobre engajamento, para o
    // canal ficar dominado por humanização (alvo ~40%) e não parecer catálogo.
    const hum = nonConv.filter((t) => TYPE_DEFS[t].intent === "humaniza");
    const eng = nonConv.filter((t) => TYPE_DEFS[t].intent === "engaja");
    if (hum.length && eng.length) pool = Math.random() < 0.6 ? hum : eng;
    else pool = nonConv;
  } else {
    pool = w.types;
  }
  // Alternância: tira os do mesmo kind do anterior, se sobrar opção.
  const alt = pool.filter((t) => TYPE_DEFS[t].kind !== opts.avoidKind);
  if (alt.length > 0) pool = alt;
  return pick(pool);
}

/** Sorteia `count` minutos DISTINTOS num intervalo de `span` minutos, com um
 *  espaçamento mínimo, para os horários não colidirem nem ficarem redondos. */
function uniqueMinutes(count: number, span: number): number[] {
  const minGap = Math.max(4, Math.floor(span / (count + 1)) - 3);
  const chosen: number[] = [];
  let guard = 0;
  while (chosen.length < count && guard < count * 40) {
    guard++;
    const m = randInt(2, span - 2);
    if (chosen.every((c) => Math.abs(c - m) >= minGap)) chosen.push(m);
  }
  // Se o guard estourou (janela apertada), completa espaçando por igual.
  while (chosen.length < count) {
    chosen.push(Math.round(((chosen.length + 1) * span) / (count + 1)));
  }
  return chosen.sort((a, b) => a - b);
}

/** Ordem cronológica do "dia MK" (05:00 → 04:59): madrugada vai pro fim. */
function wallOrder(time: string): number {
  const [h, m] = time.split(":").map((x) => parseInt(x, 10));
  const mins = h * 60 + m;
  const dayStart = 5 * 60;
  return mins >= dayStart ? mins - dayStart : mins + (24 * 60 - dayStart);
}

// --------------------------------------------------------------------------
// Fuso horário — America/São_Paulo (UTC−3, sem horário de verão desde 2019)
// --------------------------------------------------------------------------

/** Offset (minutos) de America/São_Paulo em relação ao UTC para uma data.
 *  Calculado via Intl para ser robusto (retorna -180 hoje). */
function saoPauloOffsetMinutes(atUtc: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const parts = dtf.formatToParts(atUtc).reduce<Record<string, number>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = parseInt(p.value, 10);
      return acc;
    }, {});
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
    return Math.round((asUtc - atUtc.getTime()) / 60000);
  } catch {
    return -180; // fallback: UTC−3
  }
}

/** Converte uma hora de PAREDE de São Paulo (HH:MM, no dia `dateBase`) no
 *  instante UTC (ms) correto. Madrugada (00:00–04:59) pertence ao dia seguinte.
 *  `jitter` aplica ±3 min para o horário não sair redondo. */
export function saoPauloWallTimeToUtcMs(dateBase: Date, time: string, jitter = false): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const h = m ? Math.min(23, Math.max(0, parseInt(m[1], 10))) : 12;
  const min = m ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;

  // Dia BRT-alvo: base + (madrugada → dia seguinte).
  const y = dateBase.getFullYear();
  const mo = dateBase.getMonth();
  const d = dateBase.getDate() + (h < 5 ? 1 : 0);

  // 1ª aproximação assumindo UTC−3, depois corrige com o offset real do instante.
  let guessUtc = Date.UTC(y, mo, d, h + 3, min, 0);
  const off = saoPauloOffsetMinutes(new Date(guessUtc)); // ex.: -180
  guessUtc = Date.UTC(y, mo, d, h, min, 0) - off * 60000;

  if (jitter) guessUtc += (Math.floor(Math.random() * 7) - 3) * 60000;
  return guessUtc;
}

// --------------------------------------------------------------------------
// ETAPA 2 — Escrever a copy (IA)
// --------------------------------------------------------------------------

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

/** Instrução de copy por tipo (o "método MK" aplicado a cada post). */
function typeHint(type: MkType): string {
  switch (type) {
    case "GOOD_MORNING": return "bom dia curto e humano, sem vender, tom carinhoso/safadinho";
    case "HUMANIZATION": return "conta um pedaço da rotina (café, banho, academia, TV, voltando pra casa), íntimo, sem vender";
    case "BREAKFAST": return "café da manhã, provocante e leve, sem venda";
    case "SELFIE": return "legenda de uma selfie sua do momento (o sistema anexa a foto), sem CTA";
    case "WORK": return "está trabalhando/estúdio, insinua o que grava, sem venda direta";
    case "BEHIND_SCENES": return "bastidores do conteúdo, curiosidade, sem venda";
    case "CURIOSITY": return "curiosidade que prende ('descobri que…', 'ontem aconteceu…'), gera comentário, sem venda";
    case "QUESTION": return "pergunta simples pra gerar comentário ('o que você faria…'), sem venda";
    case "REACTION": return "post CURTO que PEDE reação (ex.: 'reage com 🔥 se…'), sem link";
    case "POLL": return "enquete safada: preencha poll.question e 2 a 4 poll.options curtas; text pode repetir a pergunta; sem venda";
    case "PHOTO_PREMIUM": return "legenda ousada de uma foto premium (o sistema anexa) com CTA forte pro VIP";
    case "VIDEO_PREMIUM": return "legenda de um vídeo premium (o sistema anexa) com CTA MUITO forte pro VIP";
    case "PRESENT": return "sensação de recompensa ('quem reagir/entrar ganha…'), com CTA pro VIP";
    case "COUNTDOWN": return "urgência real ('hoje eu apago', 'última chance'), com CTA pro VIP";
    case "VIP_INVITATION": return "convite direto e safado pro VIP, com CTA";
    case "LAST_CALL": return "última chamada de venda do dia, urgência máxima, com CTA";
    case "GOOD_NIGHT": return "boa noite íntimo, provocante, sem vender";
  }
}

function buildPrompt(profile: PreviasProfile, plan: Omit<PreviaPost, "text" | "poll">[]): string {
  const agenda = plan
    .map((s, i) => `${i}) ${s.time} — ${s.type}: ${typeHint(s.type)}`)
    .join("\n");

  return [
    `Você é a própria ${profile.name} escrevendo no seu grupo de PRÉVIAS gratuito do Telegram.`,
    personaLine(profile),
    "",
    "Um social media profissional montou a AGENDA do dia abaixo (horário + tipo).",
    "Escreva SÓ a COPY de cada post. Tom de 'diário íntimo', 1ª pessoa, português do Brasil,",
    "sensual e autêntico. Humanização de manhã/tarde; CTA forte à noite/madrugada. NÃO escreva",
    "links nem 'entra no VIP' (os botões/links são anexados automaticamente pelo sistema).",
    "Emojis com moderação (🔥😈💦😏). Cada text com no máximo ~350 caracteres. Varie as aberturas;",
    "NUNCA repita a mesma frase de abertura entre os posts.",
    "",
    "AGENDA (responda na MESMA ordem e índices):",
    agenda,
    "",
    "Regras DE FORMATO (obrigatórias):",
    '- Responda SOMENTE um JSON: {"slots":[{"i":0,"text":"...","poll":{"question":"...","options":["..",".."]}}]}',
    `- Um item para CADA índice acima (0 a ${plan.length - 1}).`,
    "- O campo poll SÓ nos itens de tipo POLL; nos demais, omita poll.",
    "- Não invente novos tipos nem horários: eles já estão fixados.",
  ].join("\n");
}

// --------------------------------------------------------------------------
// Fallbacks (dia sai completo mesmo sem IA)
// --------------------------------------------------------------------------
const FALLBACK: Partial<Record<MkType, string[]>> = {
  GOOD_MORNING: ["Bom dia… acordei pensando em você 😏", "Oi, dorminhoco… já acordei toda molhadinha 🔥"],
  HUMANIZATION: ["Saindo do banho agora… queria você aqui pra secar 💦", "Dia cheio, mas minha cabeça só pensa em safadeza 😈"],
  BREAKFAST: ["Café da manhã… mas a fome que eu tô é outra 😏"],
  SELFIE: ["Olha eu aqui… gostou? 🔥"],
  WORK: ["No estúdio gravando um negócio bem safado hoje 😈"],
  BEHIND_SCENES: ["Os bastidores de hoje tão pesados… 🙈🔥"],
  CURIOSITY: ["Descobri uma coisa nova que eu amei fazer… quer saber? 😏"],
  QUESTION: ["O que você faria comigo agora se pudesse? 😈 me conta"],
  REACTION: ["Reage com 🔥 se você tá pensando em mim agora 😈"],
  PHOTO_PREMIUM: ["Essa aqui é só pros meus safados… vem ver o resto 🔥"],
  VIDEO_PREMIUM: ["Gravei um vídeo que não posso mostrar aqui… te espero lá 💦"],
  PRESENT: ["Quem entrar agora ganha um presentinho meu 🎁😈"],
  COUNTDOWN: ["Hoje eu apago tudo… é sua última chance de ver 🔥"],
  VIP_INVITATION: ["Vem pro meu cantinho secreto onde eu não tenho vergonha 😈"],
  LAST_CALL: ["Última chamada de hoje… depois some 🔥 corre"],
  GOOD_NIGHT: ["Boa noite… vou dormir pensando em você 😏"],
};
function fallbackText(type: MkType): string {
  const arr = FALLBACK[type];
  return arr ? pick(arr) : "Reage com 🔥 😈";
}
function fallbackPoll(): { question: string; options: string[] } {
  return { question: "O que você quer ver hoje? 😈", options: ["Foto 🔥", "Vídeo 💦", "Surpresa 😏"] };
}

function parse(raw: string, plan: Omit<PreviaPost, "text" | "poll">[]): PreviaPost[] {
  let items: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(raw) as { slots?: unknown };
    if (Array.isArray(parsed?.slots)) items = parsed.slots as Record<string, unknown>[];
  } catch {
    items = [];
  }
  const byIndex = new Map<number, Record<string, unknown>>();
  items.forEach((it, pos) => {
    const i = typeof it.i === "number" ? it.i : pos;
    byIndex.set(i, it);
  });

  return plan.map((slot, i) => {
    const it = byIndex.get(i);
    const aiText = typeof it?.text === "string" ? (it.text as string).trim().slice(0, 800) : "";
    const text = aiText || fallbackText(slot.type);

    let poll: PreviaPost["poll"];
    if (slot.kind === "enquete") {
      const p = it?.poll as Record<string, unknown> | undefined;
      const q = typeof p?.question === "string" ? (p.question as string) : "";
      const opts = Array.isArray(p?.options)
        ? (p!.options as unknown[]).filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        : [];
      poll = q && opts.length >= 2 ? { question: q, options: opts.slice(0, 4) } : fallbackPoll();
    }

    return { ...slot, text, poll };
  });
}

/** Gera o dia inteiro: planeja (servidor) + escreve a copy (IA), com fallback. */
export async function generatePreviasDay(
  profile: PreviasProfile,
  provider: AiProvider,
  dateBase: Date,
): Promise<{ posts: PreviaPost[]; scheduledAt: (p: PreviaPost) => number }> {
  const plan = planDay();

  let posts: PreviaPost[];
  try {
    const rawAi = await callAiRaw(buildPrompt(profile, plan), provider, { json: true, maxTokens: 6000 });
    posts = parse(rawAi, plan);
  } catch {
    posts = plan.map((slot) => ({
      ...slot,
      text: fallbackText(slot.type),
      poll: slot.kind === "enquete" ? fallbackPoll() : undefined,
    }));
  }
  return { posts, scheduledAt: (p) => saoPauloWallTimeToUtcMs(dateBase, p.time, true) };
}
