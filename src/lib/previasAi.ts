import "server-only";
import { callAiRaw } from "./ai";
import type { AiProvider } from "./settings";

/**
 * Gerador da SEQUÊNCIA DIÁRIA do grupo de PRÉVIAS (metodologia de aquecimento):
 * um dia é uma mistura de tipos de post ao longo do dia, no tom "diário íntimo"
 * da modelo, empurrando para o VIP. Tipos:
 *  - teaser: micro-história do momento do dia (acordou, academia, banho, cama…).
 *  - foto: post com mídia + legenda provocante (a mídia é escolhida no servidor).
 *  - pergunta: pergunta de engajamento ("o que você faria…") + "reage e me conta".
 *  - enquete: enquete nativa (2–3 opções).
 *  - oferta: oferta relâmpago (urgência).
 *  - prova: prova social ("um assinante me mandou…").
 *
 * A IA devolve SÓ o corpo da copy; os links de CTA para o VIP são anexados no
 * envio (telegramCron), como já acontece com as prévias.
 */

export type PreviaType = "teaser" | "foto" | "pergunta" | "enquete" | "oferta" | "prova";

export type PreviaPost = {
  time: string; // HH:MM
  type: PreviaType;
  text: string;
  poll?: { question: string; options: string[] };
};

function buildPrompt(profile: {
  name: string;
  physical?: string;
  fetish?: string;
  personality?: string;
  notes?: string;
}): string {
  const persona = [
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

  return [
    `Você é a própria ${profile.name} escrevendo no seu grupo de PRÉVIAS gratuito do Telegram.`,
    persona,
    "",
    "Monte a AGENDA de UM DIA de mensagens seguindo a metodologia de aquecimento:",
    "conteúdo de 'diário íntimo' que provoca e leva o lead a assinar o VIP.",
    "",
    "Regras OBRIGATÓRIAS:",
    '- Responda SOMENTE um JSON: {"posts":[{"time":"HH:MM","type":"...","text":"...","poll":{"question":"...","options":["..","..",".."]}}]}',
    "- 12 a 16 posts espalhados das 08:00 à 01:00 (madrugada), horários realistas e crescendo o tesão à noite.",
    "- Tipos permitidos em type: teaser, foto, pergunta, enquete, oferta, prova.",
    "- Distribuição sugerida no dia: ~5 teaser, ~4 foto, ~2 pergunta, ~2 enquete, 1 oferta, 1 prova.",
    "- 1ª pessoa, tom sensual e autêntico, contexto do horário (manhã: acordar/rotina; tarde: trabalho/estúdio; noite: banho/cama/tesão).",
    "- NÃO escreva links nem 'entra no VIP' no final: os botões/links são adicionados automaticamente. Foque na copy que provoca.",
    "- Em type 'pergunta', termine com algo como 'Reage com 🔥 e me conta'.",
    "- Em type 'enquete', preencha poll.question e poll.options (2 ou 3 opções curtas e safadas); o campo text pode repetir a pergunta.",
    "- Em type 'foto', escreva a legenda como se descrevesse uma foto ousada da modelo (o servidor anexa a imagem).",
    "- Emojis com moderação (🔥😈💦😏), português do Brasil, cada text com no máximo ~350 caracteres.",
    "- Varie as aberturas; nunca repita a mesma frase de abertura.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function timeToMs(dateBase: Date, time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const d = new Date(dateBase);
  if (!m) {
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  }
  let h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  // Horários de madrugada (00:00–05:00) pertencem ao "dia seguinte".
  d.setHours(h, min, 0, 0);
  if (h <= 5) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function parse(raw: string, dateBase: Date): PreviaPost[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const posts = (parsed as { posts?: unknown })?.posts;
  if (!Array.isArray(posts)) return [];
  const allowed: PreviaType[] = ["teaser", "foto", "pergunta", "enquete", "oferta", "prova"];
  const out: PreviaPost[] = [];
  for (const p of posts as Record<string, unknown>[]) {
    const type = allowed.includes(p.type as PreviaType) ? (p.type as PreviaType) : "teaser";
    const text = typeof p.text === "string" ? p.text.trim().slice(0, 800) : "";
    const time = typeof p.time === "string" ? p.time : "12:00";
    if (type !== "enquete" && !text) continue;
    let poll: PreviaPost["poll"];
    if (type === "enquete") {
      const q = (p.poll as Record<string, unknown>)?.question;
      const opts = (p.poll as Record<string, unknown>)?.options;
      const options = Array.isArray(opts) ? opts.filter((o): o is string => typeof o === "string") : [];
      if (typeof q === "string" && options.length >= 2) poll = { question: q, options };
      else continue; // enquete sem dados válidos: descarta
    }
    out.push({ time, type, text, poll });
  }
  // Ordena por horário real (considerando madrugada = dia seguinte).
  return out.sort((a, b) => timeToMs(dateBase, a.time) - timeToMs(dateBase, b.time));
}

export async function generatePreviasDay(
  profile: { name: string; physical?: string; fetish?: string; personality?: string; notes?: string },
  provider: AiProvider,
  dateBase: Date,
): Promise<{ posts: PreviaPost[]; scheduledAt: (p: PreviaPost) => number }> {
  const raw = await callAiRaw(buildPrompt(profile), provider, { json: true, maxTokens: 4000 });
  const posts = parse(raw, dateBase);
  return { posts, scheduledAt: (p) => timeToMs(dateBase, p.time) };
}
