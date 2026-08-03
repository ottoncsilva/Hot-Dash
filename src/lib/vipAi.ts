import "server-only";

/**
 * Método MK — versão do GRUPO VIP (pós-venda / LTV).
 *
 * Diferença de filosofia em relação às Prévias: aqui o lead JÁ COMPROU. O
 * objetivo não é mais vender a assinatura — é MANTER o relacionamento. Então:
 *
 * - 20 a 25 posts/dia (menos que as Prévias), número e sequência aleatórios.
 * - A maioria é humanização/relacionamento e engajamento: o VIP é um cantinho
 *   íntimo, não um catálogo de vendas.
 * - Nada de "vem pro VIP" (ele já está dentro). Posts de foto/vídeo exclusivos
 *   valorizam o conteúdo, sem link.
 * - O convite pro WhatsApp particular é OPCIONAL e decidido A CADA GERAÇÃO
 *   (`whatsappCta`). O WhatsApp virou produto à parte, então o padrão é NÃO
 *   entregar: ligado, o dia ganha ~8 posts com o botão, concentrados nos
 *   HORÁRIOS DE PICO do MK (meio-dia, noite e madrugada); desligado, o dia sai
 *   inteiro sem venda nenhuma.
 *
 * O SERVIDOR planeja (horários/tipos/CTA); a IA só ESCREVE a legenda de cada
 * post (na rota generate-vip, analisando a foto).
 */

// "Kind físico" = o que o motor de envio realmente posta.
export type VipKind = "foto" | "video" | "reacao" | "enquete" | "texto";

// Tipos da copy do VIP (sabor sobre o kind físico).
export type VipType =
  | "GOOD_MORNING"
  | "HUMANIZATION"
  | "BREAKFAST"
  | "SELFIE"
  | "WORK"
  | "BEHIND_SCENES"
  | "VIP_THANKS"
  | "GOOD_NIGHT"
  | "CURIOSITY"
  | "QUESTION"
  | "REACTION"
  | "POLL"
  | "EXCLUSIVE_PHOTO"
  | "EXCLUSIVE_VIDEO"
  | "WHATSAPP_INVITE"
  | "WHATSAPP_PHOTO";

// humaniza = relacionamento; engaja = interação; whatsapp = convite pro
// WhatsApp particular (leva o botão) — só entra quando a geração pede.
export type VipIntent = "humaniza" | "engaja" | "whatsapp";

type TypeDef = {
  kind: VipKind;
  intent: VipIntent;
  /** true = leva o BOTÃO do WhatsApp particular no envio. */
  cta: boolean;
  media?: "photo" | "video";
};

export const VIP_TYPE_DEFS: Record<VipType, TypeDef> = {
  GOOD_MORNING: { kind: "texto", intent: "humaniza", cta: false },
  HUMANIZATION: { kind: "texto", intent: "humaniza", cta: false },
  BREAKFAST: { kind: "texto", intent: "humaniza", cta: false },
  SELFIE: { kind: "foto", intent: "humaniza", cta: false, media: "photo" },
  WORK: { kind: "texto", intent: "humaniza", cta: false },
  BEHIND_SCENES: { kind: "texto", intent: "humaniza", cta: false },
  VIP_THANKS: { kind: "texto", intent: "humaniza", cta: false },
  GOOD_NIGHT: { kind: "texto", intent: "humaniza", cta: false },
  CURIOSITY: { kind: "texto", intent: "engaja", cta: false },
  QUESTION: { kind: "texto", intent: "engaja", cta: false },
  REACTION: { kind: "reacao", intent: "engaja", cta: false },
  POLL: { kind: "enquete", intent: "engaja", cta: false },
  EXCLUSIVE_PHOTO: { kind: "foto", intent: "engaja", cta: false, media: "photo" },
  EXCLUSIVE_VIDEO: { kind: "video", intent: "engaja", cta: false, media: "video" },
  WHATSAPP_INVITE: { kind: "texto", intent: "whatsapp", cta: true },
  WHATSAPP_PHOTO: { kind: "foto", intent: "whatsapp", cta: true, media: "photo" },
};

// Janela de horário: [início, fim) em BRT, com os tipos priorizados e o peso
// relativo (quantos posts o dia coloca nessa janela).
type Window = { start: number; end: number; weight: number; types: VipType[] };

const WINDOWS: Window[] = [
  // 05–08 manhã leve (só carinho, zero venda)
  { start: 5, end: 8, weight: 2, types: ["GOOD_MORNING", "HUMANIZATION", "BREAKFAST", "SELFIE"] },
  // 08–11 dia (relacionamento + engajamento, whats bem eventual)
  { start: 8, end: 11, weight: 3, types: ["HUMANIZATION", "CURIOSITY", "QUESTION", "SELFIE", "REACTION", "VIP_THANKS", "WHATSAPP_INVITE"] },
  // 11–14 PICO do meio-dia (aqui entra mais o WhatsApp)
  { start: 11, end: 14, weight: 3, types: ["WHATSAPP_INVITE", "WHATSAPP_PHOTO", "EXCLUSIVE_PHOTO", "HUMANIZATION", "SELFIE", "QUESTION", "CURIOSITY"] },
  // 14–17 tarde (baixar a bola)
  { start: 14, end: 17, weight: 2, types: ["HUMANIZATION", "BEHIND_SCENES", "CURIOSITY", "SELFIE", "POLL"] },
  // 17–20 fim de tarde (aquece o engajamento)
  { start: 17, end: 20, weight: 3, types: ["SELFIE", "CURIOSITY", "POLL", "HUMANIZATION", "REACTION", "WHATSAPP_INVITE"] },
  // 20–23:30 PICO da noite (maior janela de LTV)
  { start: 20, end: 24, weight: 4, types: ["WHATSAPP_INVITE", "WHATSAPP_PHOTO", "EXCLUSIVE_PHOTO", "EXCLUSIVE_VIDEO", "HUMANIZATION", "SELFIE", "POLL", "VIP_THANKS"] },
  // 00–03 PICO da madrugada (alta intenção)
  { start: 0, end: 3, weight: 3, types: ["WHATSAPP_INVITE", "WHATSAPP_PHOTO", "EXCLUSIVE_PHOTO", "HUMANIZATION", "GOOD_NIGHT", "REACTION", "CURIOSITY"] },
  // 03–05 baixa atividade
  { start: 3, end: 5, weight: 1, types: ["HUMANIZATION", "GOOD_NIGHT", "SELFIE"] },
];

export type VipPost = {
  time: string; // HH:MM (BRT)
  type: VipType;
  kind: VipKind;
  intent: VipIntent;
  cta: boolean;
  media?: "photo" | "video";
};

// --------------------------------------------------------------------------
// Aleatoriedade
// --------------------------------------------------------------------------
function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --------------------------------------------------------------------------
// Planejar o dia (100% servidor) — 20 a 25 posts.
// --------------------------------------------------------------------------
/**
 * @param opts.whatsappCta Ligar o convite pro WhatsApp particular NESTA
 *   geração. Padrão `false`: o WhatsApp é produto à parte, então só entra
 *   quando o operador pede na hora de gerar.
 */
export function planDayVip(opts: { whatsappCta?: boolean } = {}): VipPost[] {
  const whatsappCta = opts.whatsappCta === true;
  const total = randInt(20, 25);

  // 1) Distribui o total pelas janelas conforme o peso (≥1 nas de peso).
  const weightSum = WINDOWS.reduce((s, w) => s + w.weight, 0);
  const perWindow = WINDOWS.map((w) => Math.max(1, Math.round((total * w.weight) / weightSum)));
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

  // 2) Sorteia horários únicos por janela + escolhe os tipos, com alternância de
  //    kind físico e a fração-alvo de WhatsApp da janela (zero quando o convite
  //    está desligado nesta geração).
  const planned: VipPost[] = [];
  let lastKind: VipKind | null = null;

  WINDOWS.forEach((w, wi) => {
    const count = perWindow[wi];
    const spanMin = (w.end - w.start) * 60;
    const times = uniqueMinutes(count, spanMin).map((m) => w.start * 60 + m);
    // Desligado, os tipos de WhatsApp somem do sorteio: não basta tirar o
    // botão, porque a legenda desses posts é escrita convidando pro WhatsApp e
    // sem o link ficaria chamando para um destino que não existe.
    const types = whatsappCta
      ? w.types
      : w.types.filter((t) => VIP_TYPE_DEFS[t].intent !== "whatsapp");
    const waTarget = whatsappCta ? windowWhatsappTarget(w) : 0;

    let waDone = 0;
    times.forEach((totalMin) => {
      const h = Math.floor(totalMin / 60) % 24;
      const min = totalMin % 60;
      const timeStr = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

      const wantWa = waDone / count < waTarget;
      const type = chooseType(types, { wantWa, avoidKind: lastKind });
      const def = VIP_TYPE_DEFS[type];
      if (def.intent === "whatsapp") waDone++;
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

  // 3) Ordena por horário real (madrugada = fim do "dia MK", que começa 05:00).
  planned.sort((a, b) => wallOrder(a.time) - wallOrder(b.time));

  // 4) Garante um mínimo de ENQUETES (engajamento saudável no VIP).
  ensureMinPolls(planned, randInt(2, 3));
  return planned;
}

/** Converte posts de engajamento em POLL até o alvo, espalhados (nunca duas
 *  enquetes seguidas). Nunca mexe em posts de WhatsApp (o CTA é intocável). */
function ensureMinPolls(planned: VipPost[], target: number): void {
  const pollDef = VIP_TYPE_DEFS.POLL;
  const isPoll = (i: number) => planned[i]?.type === "POLL";
  let current = planned.filter((p) => p.type === "POLL").length;
  if (current >= target) return;

  const candidates = planned
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.intent === "engaja" && p.type !== "POLL")
    .sort(() => Math.random() - 0.5);

  for (const { i } of candidates) {
    if (current >= target) break;
    if (isPoll(i - 1) || isPoll(i + 1)) continue;
    planned[i] = {
      ...planned[i],
      type: "POLL",
      kind: pollDef.kind,
      intent: pollDef.intent,
      cta: pollDef.cta,
      media: pollDef.media,
    };
    current++;
  }
}

/** Fração-alvo de posts de WHATSAPP da janela, quando o convite está ligado.
 *  Concentrada nos PICOS do MK (meio-dia, noite, madrugada); quase nada fora
 *  deles. Na prática dá ~8 posts com o link por dia: a cota é conferida ANTES
 *  de contar o post, então cada janela de pico arredonda para cima. */
function windowWhatsappTarget(w: Window): number {
  if (w.start === 20 || w.start === 0) return 0.4; // noite e madrugada (picos)
  if (w.start === 11) return 0.4; // meio-dia (pico)
  if (w.start === 17) return 0.15; // fim de tarde (aquece)
  if (w.start === 8) return 0.1; // manhã (eventual)
  return 0; // 05–08, 14–17, 03–05 (só relacionamento)
}

/** Escolhe um tipo dos disponíveis na janela: prioriza WhatsApp quando
 *  `wantWa`; senão pende para HUMANIZAÇÃO (relacionamento) sobre engajamento.
 *  Evita repetir o kind físico do post anterior. */
function chooseType(
  types: VipType[],
  opts: { wantWa: boolean; avoidKind: VipKind | null },
): VipType {
  const wa = types.filter((t) => VIP_TYPE_DEFS[t].intent === "whatsapp");
  const nonWa = types.filter((t) => VIP_TYPE_DEFS[t].intent !== "whatsapp");
  let pool: VipType[];
  if (opts.wantWa && wa.length > 0) {
    pool = wa;
  } else if (nonWa.length > 0) {
    const hum = nonWa.filter((t) => VIP_TYPE_DEFS[t].intent === "humaniza");
    const eng = nonWa.filter((t) => VIP_TYPE_DEFS[t].intent === "engaja");
    if (hum.length && eng.length) pool = Math.random() < 0.6 ? hum : eng;
    else pool = nonWa;
  } else {
    pool = types;
  }
  const alt = pool.filter((t) => VIP_TYPE_DEFS[t].kind !== opts.avoidKind);
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
// Temas por tipo (o que a IA deve escrever) + fallbacks de reserva
// --------------------------------------------------------------------------

/** Tema/instrução que a rota passa a generateCaption como `theme`. Tom de quem
 *  já tem intimidade com o cara (ele é VIP). Nenhum tipo vende assinatura; só
 *  os dois de WhatsApp convidam, e mesmo eles NUNCA escrevem o link/número —
 *  o botão é anexado automaticamente no envio. */
export function captionThemeVip(type: VipType): string {
  const base =
    "Fale como brasileira DE VERDADE, informal, do dia a dia (tá, pra, cê, tô). " +
    "Curta (1–2 linhas). Tom íntimo de quem já conhece o cara — ele já é do seu VIP, " +
    "então NADA de vender assinatura nem 'vem pro VIP'. Sem hashtags. Varie a abertura.";
  const wa =
    "Convide de um jeito leve e carinhoso pra ele te chamar no seu WhatsApp particular " +
    "(mais pessoal, resposta mais rápida, você responde de verdade lá). " +
    "NÃO escreva link, número nem 'clica aqui' — o botão do WhatsApp é anexado automaticamente. " +
    "Faça soar como um convite íntimo, não como anúncio.";
  switch (type) {
    case "GOOD_MORNING": return `Bom dia carinhoso pro seu VIP, sem vender. ${base}`;
    case "HUMANIZATION": return `Conte um pedaço da sua rotina (café, banho, treino, sofá), íntimo, sem vender. ${base}`;
    case "BREAKFAST": return `Café da manhã, leve e provocante, sem vender. ${base}`;
    case "SELFIE": return `Legenda pra esta SELFIE, reagindo ao que aparece na foto (roupa, pose, clima), sem vender. ${base}`;
    case "WORK": return `Você tá trabalhando/gravando; insinua o clima, sem venda. ${base}`;
    case "BEHIND_SCENES": return `Bastidores, curiosidade, intimidade com quem é VIP, sem vender. ${base}`;
    case "VIP_THANKS": return `Agradeça/valorize quem é do seu VIP ('você que fica comigo aqui…'), carinhoso, sem vender. ${base}`;
    case "GOOD_NIGHT": return `Boa noite íntimo e provocante, sem vender. ${base}`;
    case "CURIOSITY": return `Curiosidade que prende ('descobri que…', 'ontem rolou…') e gera comentário, sem vender. ${base}`;
    case "QUESTION": return `Pergunta simples e safada pra gerar comentário ('o que você faria…'), sem vender. ${base}`;
    case "REACTION": return `Post CURTO que PEDE reação com emoji ('reage com 🔥 se…'), sem vender. ${base}`;
    case "POLL": return `Enquete safada e leve, sem vender. ${base}`;
    case "EXCLUSIVE_PHOTO": return `Legenda pra esta FOTO exclusiva do VIP, valorizando ('isso é só aqui pra vocês'), sem vender assinatura nem WhatsApp. ${base}`;
    case "EXCLUSIVE_VIDEO": return `Legenda pra um VÍDEO exclusivo do VIP (use o frame como referência), valorizando, sem vender. ${base}`;
    case "WHATSAPP_INVITE": return `Chama o cara pro seu WhatsApp particular. ${wa} ${base}`;
    case "WHATSAPP_PHOTO": return `Legenda desta FOTO + convite pro seu WhatsApp particular. ${wa} ${base}`;
  }
}

const FALLBACK: Partial<Record<VipType, string[]>> = {
  GOOD_MORNING: ["Bom dia, meu VIP 😏 acordei pensando em você", "Oi vida… bom dia 🥰 já tô com saudade", "Bom dia! primeira coisa foi lembrar de você 😈"],
  HUMANIZATION: ["Saindo do banho agora… queria você aqui 💦", "Deitada aqui só pensando em safadeza 😈", "Terminei o treino toda suada… imagina o resto 🔥"],
  BREAKFAST: ["Tomando meu café pensando em coisa que não devia 😏", "Café da manhã… mas a fome é outra 😈"],
  SELFIE: ["Olha eu aqui só pra você 🔥 gostou?", "Tirei essa agora, o que achou? 😏", "Me sentindo perigosa hoje 😈"],
  WORK: ["No estúdio gravando algo bem safado 😈", "Trabalhando… mas o de hoje veio pesado 🔥"],
  BEHIND_SCENES: ["Os bastidores de hoje tão pesados 🙈🔥", "Se você visse o que rola por trás 😈"],
  VIP_THANKS: ["Você que fica aqui comigo me deixa boba 🥰", "Amo ter você no meu cantinho 😈🔥", "Meu VIP é quem me vê de verdade 💕"],
  GOOD_NIGHT: ["Boa noite… vou dormir pensando em você 😏", "Já tô na cama… queria você aqui 💦 boa noite"],
  CURIOSITY: ["Descobri uma coisa nova que eu amei… quer saber? 😏", "Ontem rolou algo que me deixou sem vergonha 😈"],
  QUESTION: ["O que você faria comigo agora? 😈 me conta", "Se eu tivesse aí, por onde começaria? 😏"],
  REACTION: ["Reage com 🔥 se tá pensando em mim 😈", "Manda um 💦 se você me quer agora"],
  EXCLUSIVE_PHOTO: ["Essa é só aqui pra vocês do VIP 🔥", "Isso ninguém mais vê 😈 só meu VIP"],
  EXCLUSIVE_VIDEO: ["Gravei um vídeo só pro VIP 💦 aproveita", "Esse vídeo é exclusivo daqui 😈🔥"],
  WHATSAPP_INVITE: ["Me chama no meu zap 😏 lá eu respondo de verdade", "No WhatsApp eu sou mais sua 💕 vem", "Queria te responder no particular 😈 me chama no zap"],
  WHATSAPP_PHOTO: ["Gostou? no meu zap tem mais e é mais pessoal 😏", "Vem falar comigo no particular 💦 te respondo lá"],
};
export function fallbackTextVip(type: VipType): string {
  const arr = FALLBACK[type];
  return arr ? pick(arr) : "Reage com 🔥 😈";
}
