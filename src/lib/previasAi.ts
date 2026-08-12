import "server-only";
import { partsInTimeZone, zonedWallTimeToUtcMs } from "./timezone";

/**
 * Método MK v3 — PLANEJADOR do dia inteiro do grupo de PRÉVIAS.
 *
 * Filosofia: o SERVIDOR monta o plano do dia (quantos posts, que horas, que
 * tipo, com/sem CTA, distribuição humanização/engajamento/conversão), imitando
 * o "MK" (o operador dos bots que convertem bem). A IA só ESCREVE a copy de
 * cada post — nunca decide tipos nem horários (evita o bug de "tudo virou foto").
 *
 * - 30 a 35 posts/dia, número e sequência aleatórios (nenhum dia igual).
 * - 10 janelas de horário (fuso da operação), cada uma com objetivo e tipos
 *   priorizados; horários sorteados, sem repetir, com gap mínimo.
 * - Mix medido em 2.000 dias simulados: ~39% humanização / ~19% engajamento /
 *   ~42% conversão, com a venda ESPALHADA (nunca em bloco) — ver planDay.
 * - Só os tipos de CONVERSÃO levam o botão VIP (cta=true).
 * - PICÂNCIA ESCALONADA pela hora (ver `heatForHour`), e os posts de conversão
 *   nunca ficam abaixo do nível 3 — INCLUSIVE de manhã, de propósito: as 07h
 *   são a melhor hora de conversão do dia (43%), e prévia morna não vende.
 * - TEMA POR DIA DA SEMANA (ver `DAY_THEMES`): sexta fala de sextou, domingo
 *   fala de carência. O mesmo tipo de post muda de assunto conforme o dia.
 *
 * ---------------------------------------------------------------------------
 * DE ONDE VÊM AS COTAS (v3 — calibração por dado real, não por intuição)
 * ---------------------------------------------------------------------------
 * Duas fontes, 24/07 a 10/08/2026: o relatório financeiro (506 PIX gerados,
 * 171 pagos) e o gráfico de visualizações por hora do Telegram.
 *
 * Conversão por hora ISOLADA não decide nada: com ~21 observações por hora o
 * intervalo de confiança é de ±15 pontos e a curva é plana das 07h às 23h. O
 * que separa audiência de intenção é VENDAS POR 1.000 VISUALIZAÇÕES:
 *
 *     23h 48,5 · 09h 39,3 · 17h 35,1 · 07h 30,2 · 22h 25,0   ← quem compra
 *     21h 15,2 · 20h 15,6 · 19h 15,4 · 06h 5,1 · 03h 0,0     ← quem só olha
 *
 * As 21h são o PICO DE AUDIÊNCIA do dia (460 views) e uma das piores conversões
 * por visualização. Daí a virada de filosofia da v3:
 *
 *     Usar o pico de audiência (19h–22h) para ENGAJAR e aquecer.
 *     VENDER às 22h–00h, quando há menos gente olhando mas é quem compra.
 *
 * Só mudou a cota das janelas em que as DUAS fontes concordam: 23h forte, 07h
 * forte, 17h forte, 21h fraca, 05h–06h fracas, madrugada deserto.
 */

// "Kind físico" = o que o motor de envio realmente posta.
export type MkKind = "foto" | "video" | "reacao" | "enquete" | "texto";

// Os tipos do método (sabor da copy sobre o kind físico).
export type MkType =
  | "GOOD_MORNING"
  | "HUMANIZATION"
  | "BREAKFAST"
  | "SELFIE"
  | "WORK"
  | "BEHIND_SCENES"
  | "PHOTO_PREMIUM"
  | "VIDEO_PREMIUM"
  | "CENSORED_PREVIEW"
  | "REACTION"
  | "POLL"
  | "QUESTION"
  | "CURIOSITY"
  | "PRESENT"
  | "COUNTDOWN"
  | "VIP_INVITATION"
  | "SOCIAL_PROOF"
  | "OFFER"
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
  CENSORED_PREVIEW: { kind: "foto", intent: "converte", cta: true, media: "photo" },
  PRESENT: { kind: "foto", intent: "converte", cta: true, media: "photo" },
  COUNTDOWN: { kind: "texto", intent: "converte", cta: true },
  VIP_INVITATION: { kind: "texto", intent: "converte", cta: true },
  SOCIAL_PROOF: { kind: "texto", intent: "converte", cta: true },
  OFFER: { kind: "texto", intent: "converte", cta: true },
  LAST_CALL: { kind: "texto", intent: "converte", cta: true },
  GOOD_NIGHT: { kind: "texto", intent: "humaniza", cta: false },
};

// Janela de horário: [horaInício, horaFim) em BRT, com os tipos priorizados e o
// peso relativo (quantos posts o dia coloca nessa janela).
type Window = { start: number; end: number; weight: number; types: MkType[] };

const WINDOWS: Window[] = [
  // 05–07 acordar/humanizar. 5h e 6h são os piores horários úteis medidos
  // (5–9 vendas por 1.000 views), mesmo com a audiência já subindo às 6h:
  // tem gente olhando o celular, mas ninguém compra. Venda praticamente zero.
  { start: 5, end: 7, weight: 2, types: ["GOOD_MORNING", "HUMANIZATION", "SELFIE", "BREAKFAST", "WORK"] },
  // 07–08 a MELHOR hora de conversão do dia (43,3%) com audiência alta. Uma
  // hora só, cota alta: quem acorda e olha o celular já vê a chamada do VIP.
  { start: 7, end: 8, weight: 2, types: ["PHOTO_PREMIUM", "VIP_INVITATION", "CENSORED_PREVIEW", "PRESENT", "SELFIE", "HUMANIZATION", "BREAKFAST"] },
  // 08–11 engajamento com rotina. Contém as 9h, 2º melhor horário do dia
  // (39,3 vendas/1k views) — daí a cota ter subido de 0,16 para 0,30.
  { start: 8, end: 11, weight: 4, types: ["REACTION", "POLL", "QUESTION", "CURIOSITY", "SELFIE", "HUMANIZATION", "BREAKFAST", "CENSORED_PREVIEW"] },
  // 11–14 meio-dia. Cota reduzida: 12h é buraco (17,6 vendas/1k, conversão
  // 21,4%) — muito clique de hora de almoço e pouca compra. 13h compensa.
  { start: 11, end: 14, weight: 4, types: ["CENSORED_PREVIEW", "PHOTO_PREMIUM", "VIDEO_PREMIUM", "VIP_INVITATION", "SOCIAL_PROOF", "PRESENT", "REACTION", "HUMANIZATION", "SELFIE"] },
  // 14–17 tarde. Era a menor cota do dia útil (0,26) e o dado não sustenta:
  // 14h/15h/16h ficam todas em 23–25 vendas/1k, tão boas quanto a média.
  { start: 14, end: 17, weight: 4, types: ["HUMANIZATION", "CURIOSITY", "QUESTION", "BEHIND_SCENES", "WORK", "SELFIE", "PHOTO_PREMIUM", "OFFER", "CENSORED_PREVIEW"] },
  // 17–19 fim de expediente. As 17h são o 3º melhor horário (35,1 vendas/1k,
  // 13 pagos). Estava diluída dentro da antiga 17–20 junto com as 18h/19h.
  { start: 17, end: 19, weight: 3, types: ["PHOTO_PREMIUM", "CENSORED_PREVIEW", "SOCIAL_PROOF", "VIP_INVITATION", "PRESENT", "CURIOSITY", "SELFIE", "HUMANIZATION"] },
  // 19–22 PICO DE AUDIÊNCIA (460 views às 21h, o máximo do dia) e a PIOR
  // conversão por visualização (15,2–15,6). O grupo está cheio de gente que
  // veio se entreter, não comprar. Aqui se ENGAJA e se aquece — a venda sai
  // logo depois, às 22h, com o público já quente.
  { start: 19, end: 22, weight: 4, types: ["REACTION", "POLL", "QUESTION", "CURIOSITY", "SELFIE", "HUMANIZATION", "BEHIND_SCENES", "WORK", "PHOTO_PREMIUM"] },
  // 22–00 O PICO DE VENDA. 23h é a melhor hora do dia em tudo: 39 PIX gerados,
  // 16 pagos, 41,0% de conversão e 48,5 vendas/1k views — o dobro das 21h, com
  // 28% MENOS audiência. Maior cota do método.
  { start: 22, end: 24, weight: 5, types: ["CENSORED_PREVIEW", "PHOTO_PREMIUM", "VIDEO_PREMIUM", "COUNTDOWN", "VIP_INVITATION", "SOCIAL_PROOF", "OFFER", "LAST_CALL", "REACTION", "HUMANIZATION"] },
  // 00–03 madrugada. A v2 tratava como 2º pico (peso 5, cota 0,60) e o dado
  // desmente: conversão 22,9% contra 33,8% da média, audiência despencando, e
  // a penalidade sobrevive até controlando o preço (35,5% contra 41–47%).
  { start: 0, end: 3, weight: 3, types: ["HUMANIZATION", "GOOD_NIGHT", "REACTION", "POLL", "CENSORED_PREVIEW", "PHOTO_PREMIUM", "COUNTDOWN", "LAST_CALL"] },
  // 03–05 deserto: 85 views às 3h e ZERO pagamentos em 4 cobranças no período.
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

    // Quantos posts de conversão esta janela leva — número EXATO — e em quais
    // posições. Antes a decisão era "enquanto a proporção corrente estiver
    // abaixo do alvo", o que enfileirava toda a venda no COMEÇO da janela: às
    // 20h saíam quatro posts de venda seguidos e o resto da noite não tinha
    // nenhum. Bloco de venda é o que faz o pessoal silenciar o grupo. Agora as
    // posições são sorteadas espalhadas pela janela inteira.
    const nConv = Math.round(count * windowConvTarget(w));
    const convIdx = spreadIndexes(count, nConv);

    times.forEach((totalMin, idx) => {
      const h = Math.floor(totalMin / 60) % 24;
      const min = totalMin % 60;
      const timeStr = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

      const type = chooseType(w, { wantConv: convIdx.has(idx), avoidKind: lastKind });
      const def = TYPE_DEFS[type];
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

  // 4) Equilibra o ENGAJAMENTO em 50/50 entre enquete e o resto (reação,
  //    pergunta, curiosidade) — ver balancePolls.
  balancePolls(planned);
  return planned;
}

/**
 * Deixa as ENQUETES em metade do engajamento do dia, convertendo posts de
 * engajamento em POLL até chegar lá (espalhados, nunca duas seguidas).
 *
 * Antes o alvo era fixo (4 a 6 enquetes) e isso desequilibrava: o dia tem ~6 a 8
 * posts de engajamento no total, então um alvo de 4–6 comia quase todo o pool e
 * sobravam 2 ou 3 REACTION/QUESTION/CURIOSITY no dia inteiro. Reação com emoji é
 * o que gera prova social barata; enquete demais transforma o grupo em formulário.
 */
function balancePolls(planned: Omit<PreviaPost, "text" | "poll">[]): void {
  const pollDef = TYPE_DEFS.POLL;
  const isPoll = (i: number) => planned[i]?.type === "POLL";
  const totalEngaja = planned.filter((p) => p.intent === "engaja").length;
  const target = Math.round(totalEngaja / 2);
  let current = planned.filter((p) => p.type === "POLL").length;

  // Enquete DEMAIS também desequilibra: as janelas 08–11, 19–22 e 00–03 têm
  // POLL na lista de tipos e o sorteio pode passar da metade sozinho. Aí o
  // excesso volta a ser reação/pergunta/curiosidade.
  if (current > target) {
    const excedente = planned
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.type === "POLL")
      .sort(() => Math.random() - 0.5);
    for (const { i } of excedente) {
      if (current <= target) break;
      const virar = pick<MkType>(["REACTION", "QUESTION", "CURIOSITY"]);
      const def = TYPE_DEFS[virar];
      planned[i] = { ...planned[i], type: virar, kind: def.kind, intent: def.intent, cta: def.cta, media: def.media };
      current--;
    }
    return;
  }
  if (current >= target) return;

  // Candidatos: engajamento não-enquete (reação/pergunta/curiosidade), fora de
  // adjacência com outra enquete. Ordena por posição embaralhada p/ espalhar.
  const candidates = planned
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.intent === "engaja" && p.type !== "POLL")
    .sort(() => Math.random() - 0.5);

  for (const { i } of candidates) {
    if (current >= target) break;
    if (isPoll(i - 1) || isPoll(i + 1)) continue; // não cola duas enquetes
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

/** Fração-alvo de posts de CONVERSÃO da janela — calibrada por VENDAS POR 1.000
 *  VISUALIZAÇÕES (ver o cabeçalho do arquivo), não por intuição. O global fica
 *  em ~42%, o mesmo patamar da v2; o que mudou foi ONDE a venda cai.
 *
 *  O teto de ~42% é de propósito: quando quase todo post é venda o grupo vira
 *  catálogo, o pessoal silencia e a conversão cai junto. O ganho aqui vem de
 *  redistribuir, não de empurrar mais oferta. */
function windowConvTarget(w: Window): number {
  if (w.start === 22) return 0.7; // 22–00 pico de venda (23h: 48,5 vendas/1k)
  if (w.start === 7) return 0.55; // 07–08 melhor conversão do dia (43,3%)
  if (w.start === 17) return 0.55; // 17–19 fim de expediente (35,1 vendas/1k)
  if (w.start === 14) return 0.45; // 14–17 tarde consistente (23–25 vendas/1k)
  if (w.start === 11) return 0.4; // 11–14 (12h é buraco, 13h compensa)
  if (w.start === 8) return 0.3; // 08–11 (9h é o 2º melhor do dia)
  if (w.start === 19) return 0.3; // 19–22 pico de AUDIÊNCIA → engajar, não vender
  if (w.start === 0) return 0.25; // 00–03 madrugada converte 22,9%
  return 0.05; // 05–07 e 03–05: os piores horários medidos
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

/** Escolhe `n` posições entre `count`, uma por fatia — assim os posts de venda
 *  saem espalhados pela janela em vez de todos juntos no começo dela. */
function spreadIndexes(count: number, n: number): Set<number> {
  const out = new Set<number>();
  if (n <= 0 || count <= 0) return out;
  if (n >= count) {
    for (let i = 0; i < count; i++) out.add(i);
    return out;
  }
  const fatia = count / n;
  for (let k = 0; k < n; k++) {
    const lo = Math.floor(k * fatia);
    const hi = Math.max(lo, Math.min(count - 1, Math.ceil((k + 1) * fatia) - 1));
    let i = randInt(lo, hi);
    // Fatias podem se sobrepor por arredondamento: anda até achar uma livre.
    let guard = 0;
    while (out.has(i) && guard++ < count) i = (i + 1) % count;
    out.add(i);
  }
  return out;
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
// Fuso horário — vem das Configurações (padrão America/São_Paulo, UTC−3)
// --------------------------------------------------------------------------

/** Dia do calendário (no fuso da operação) usado como base de um plano. */
export type MkDay = { year: number; month: number; day: number };

/**
 * Converte um horário do plano (HH:MM, hora de PAREDE do fuso) no instante UTC
 * (ms), tomando `base` como o DIA MK. Madrugada (00:00–04:59) pertence ao dia
 * seguinte, porque o "dia MK" vai das 05:00 às 04:59.
 *
 * O dia precisa vir em campos explícitos do fuso da operação: usar um `Date` e
 * ler getDate() pegava o calendário do SERVIDOR (UTC em produção) e, entre 21h
 * e 23h59 de Brasília, já era "amanhã" para o servidor — o gerador pulava o
 * resto da noite, justamente a janela de maior venda.
 *
 * `jitter` aplica ±3 min para o horário não sair redondo.
 */
export function mkSlotToUtcMs(base: MkDay, time: string, tz: string, jitter = false): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const h = m ? Math.min(23, Math.max(0, parseInt(m[1], 10))) : 12;
  const min = m ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;

  // Normaliza o dia-alvo (madrugada → dia seguinte), deixando o Date.UTC
  // resolver estouro de mês/ano.
  const target = new Date(Date.UTC(base.year, base.month - 1, base.day + (h < 5 ? 1 : 0)));
  let at = zonedWallTimeToUtcMs(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    h,
    min,
    tz,
  );

  if (jitter) at += (Math.floor(Math.random() * 7) - 3) * 60000;
  return at;
}

/**
 * Dia da semana (0 = domingo, como `Date.getDay()`) do slot dentro do DIA MK —
 * é o que escolhe o tema de {@link DAY_THEMES}.
 *
 * Segue a mesma regra do {@link mkSlotToUtcMs}: madrugada (00:00–04:59) pertence
 * ao dia seguinte, porque o dia MK vai das 05:00 às 04:59. Sem isso o post da
 * 01h de sábado sairia falando de sexta.
 *
 * O cálculo é feito só com os campos de calendário do fuso da operação — uma
 * data de calendário tem o mesmo dia da semana em qualquer fuso, então o
 * `Date.UTC` aqui não introduz o erro que ele introduziria num horário.
 */
export function mkWeekday(base: MkDay, time: string): number {
  const m = /^(\d{1,2}):/.exec(time.trim());
  const h = m ? parseInt(m[1], 10) : 12;
  return new Date(Date.UTC(base.year, base.month - 1, base.day + (h < 5 ? 1 : 0))).getUTCDay();
}

/** Dia MK de hoje (no fuso) somado de `offset` dias — base dos planos gerados. */
export function mkDayFromToday(offset: number, tz: string): MkDay {
  const p = partsInTimeZone(Date.now(), tz);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// --------------------------------------------------------------------------
// ETAPA 2 — Copy de cada post (feita PER-POST na rota, com ANÁLISE DA FOTO)
// --------------------------------------------------------------------------
// A rota (generate-previas) gera a legenda de cada post com generateCaption,
// enviando a IMAGEM (visão) nos posts de foto/vídeo — assim a legenda descreve
// a foto de verdade, em vez de sair genérica. Aqui ficam só os "temas" por
// tipo (o que a IA deve escrever) e os fallbacks de reserva.

/**
 * Nível de PICÂNCIA por hora do dia. O grupo de prévias é adulto e o conteúdo
 * é o produto, então a copy morna não converte — mas soltar tudo desde as 6h
 * satura: quem já leu o mais pesado de manhã não abre a noite, que é justamente
 * quando se vende. Por isso a curva sobe ao longo do dia e estoura na madrugada.
 */
export type MkHeat = 1 | 2 | 3 | 4;

export function heatForHour(hour: number): MkHeat {
  if (hour >= 5 && hour < 9) return 1; // manhã: insinuação
  if (hour >= 9 && hour < 17) return 2; // dia: safada assumida
  if (hour >= 17 && hour < 21) return 3; // noite: tesão explícito
  return 4; // 21h–04h59: sem freio
}

/**
 * TEMA DO DIA DA SEMANA. O índice segue `Date.getDay()` (0 = domingo), a mesma
 * convenção de WEEKDAY_LABELS em postTypes.ts.
 *
 * O tipo do post define o OBJETIVO (vender, engajar, humanizar) e a hora define
 * a picância; o dia define o ASSUNTO. Sem isso, a segunda-feira e o sábado
 * saíam com a mesma conversa e o grupo percebe — quem lê todo dia nota quando a
 * modelo não sabe que dia é hoje.
 */
export const DAY_THEMES: Record<number, string> = {
  0: "É DOMINGO — o dia mais carente da semana. Fale de estar sozinha em casa, ressaca de sábado, filme na cama, tédio, vontade de ter alguém pra abraçar (e o resto). É o dia de puxar a carência, não a festa.",
  1: "É SEGUNDA — preguiça de recomeçar a semana, vontade de ter ficado na cama, reclamação gostosa de ter que trabalhar.",
  2: "É TERÇA — dia de rotina: gravação, treino, tarefa chata do dia, bastidor do trabalho.",
  3: "É QUARTA — metade da semana vencida, aquele fôlego de 'aguenta mais dois dias'.",
  4: "É QUINTA — véspera: a ansiedade do fim de semana começando, 'amanhã já é sexta'.",
  5: "É SEXTA — SEXTOU, começo do fim de semana. Fale de se arrumar, sair, beber, a noite que vem pela frente, o que você faria se ele estivesse junto.",
  6: "É SÁBADO — ou a noitada (se arrumando, balada, bebendo) ou o contraste: 'sábado à noite e eu aqui sozinha'. Escolha um dos dois e vá fundo.",
};

const HEAT_INSTRUCTION: Record<MkHeat, string> = {
  1: "PICÂNCIA 1/4 — insinuante: provoque por baixo do pano, com dupla intenção, sem falar de sexo abertamente.",
  2: "PICÂNCIA 2/4 — safada assumida: fale de tesão e de vontade com naturalidade, malícia na cara, ainda sem descrever ato sexual.",
  3: "PICÂNCIA 3/4 — quente: diga o que você está sentindo e o que faria com ele, com palavras adultas (tesão, molhada, gemendo, sentar, chupar), direto e sem rodeio.",
  4: "PICÂNCIA 4/4 — sem freio: putaria explícita de conversa de zap, sem eufemismo, descrevendo a safadeza em detalhe e falando na cara o que quer que ele faça em você.",
};

/** Tema/instrução que a rota passa a generateCaption como `theme` — define o
 *  OBJETIVO, o TOM, a PICÂNCIA e o ASSUNTO DO DIA do post, imitando o método MK.
 *  Nunca pede link/hashtag (o botão do VIP é anexado automaticamente no envio).
 *
 *  `hour` é a hora do slot no plano: é ela que define a picância. Posts de
 *  CONVERSÃO nunca ficam abaixo do nível 3 — é a prévia quente que faz o cara
 *  clicar; no nível insinuante ele só curte e continua de graça no grupo.
 *
 *  `weekday` é o dia da semana do slot (0 = domingo), no fuso da OPERAÇÃO — ver
 *  mkWeekday. Passar `undefined` desliga o tema do dia. */
export function captionTheme(type: MkType, hour = 21, weekday?: number): string {
  const def = TYPE_DEFS[type];
  const nivel: MkHeat =
    def.intent === "converte"
      ? (Math.max(3, heatForHour(hour)) as MkHeat)
      : heatForHour(hour);

  const dia = weekday !== undefined && DAY_THEMES[weekday] ? `${DAY_THEMES[weekday]} ` : "";
  const base =
    `${dia}${HEAT_INSTRUCTION[nivel]} ` +
    "Escreva na 1ª pessoa, como brasileira mandando mensagem no zap pro cara que ela quer provocar. " +
    "Curta (1–2 linhas), sem enrolação. NÃO escreva link, URL nem 'entra no VIP' — o botão é " +
    "anexado automaticamente. Sem hashtags. Varie a abertura; nunca comece igual a outra legenda.";
  const cta =
    "CHAMADA pro VIP: deixe explícito que aqui é só a prévia e que o pesado — sem censura, sem corte — " +
    "está lá dentro. Diga em uma frase O QUE ele vai ver lá (o ato, a cena, o quanto é forte), " +
    "porque é essa imagem na cabeça dele que faz clicar. Sem escrever o link.";

  switch (type) {
    case "GOOD_MORNING": return `Post de BOM DIA, humano e carinhoso, com uma pitada de safadeza. Sem vender. ${base}`;
    case "HUMANIZATION": return `Conte um pedaço da sua ROTINA (café, banho, academia, TV, voltando pra casa) e emende com o que isso te deu vontade de fazer. Sem vender. ${base}`;
    case "BREAKFAST": return `Café da manhã com dupla intenção — a fome que você tem é outra. Sem vender. ${base}`;
    case "SELFIE": return `Legenda pra esta SELFIE reagindo ao que aparece na foto (roupa, pose, o que está aparecendo, o que está quase aparecendo). Sem vender. ${base}`;
    case "WORK": return `Você está gravando; conte o que está rolando na gravação de hoje e o quanto ficou pesado. Sem venda direta. ${base}`;
    case "BEHIND_SCENES": return `Bastidores safados da gravação: o que aconteceu que não vai aparecer cortado. Sem vender. ${base}`;
    case "CURIOSITY": return `Curiosidade que prende ('descobri uma coisa que…', 'ontem eu fiz…') e dá vontade de perguntar o resto. Sem vender. ${base}`;
    case "QUESTION": return `Pergunta safada e direta pra ele responder ('o que você faria comigo se…'), gerando comentário. Sem vender. ${base}`;
    case "REACTION": return `Post CURTÍSSIMO que PEDE reação com emoji ('reage com 🔥 se…', '😈 se você…'), com a provocação no meio. ${base}`;
    case "PHOTO_PREMIUM": return `Legenda quente desta FOTO, comentando o que aparece nela e o que NÃO deu pra postar aqui. ${cta} ${base}`;
    case "VIDEO_PREMIUM": return `Legenda de VÍDEO (use o frame como referência): conte o que acontece no vídeo e por que ele não cabe no grupo de prévias. ${cta} ${base}`;
    case "CENSORED_PREVIEW": return `PRÉVIA CORTADA: essa é a versão que dá pra mostrar no grupo — diga isso e descreva o que ficou de fora do enquadramento, o que a foto original mostra inteiro. É o post que mais converte: a curiosidade tem que doer. Não afirme que tem tarja preta na imagem. ${cta} ${base}`;
    case "PRESENT": return `Recompensa imediata: 'quem entrar agora ganha…' (um vídeo seu, um nude, uma chamada). ${cta} ${base}`;
    case "COUNTDOWN": return `Urgência real ('esse eu apago hoje', 'sai do ar à meia-noite'), dizendo o que vai sumir. ${cta} ${base}`;
    case "VIP_INVITATION": return `Convite direto e safado pro VIP, contando como você é do lado de lá. ${cta} ${base}`;
    case "SOCIAL_PROOF": return `PROVA SOCIAL: conte que o pessoal lá dentro está enlouquecido com o conteúdo de ontem/hoje (reação, mensagem que te mandaram, gente pedindo mais), sem citar números inventados. ${cta} ${base}`;
    case "OFFER": return `QUEBRA DE OBJEÇÃO do preço: mostre que entrar custa menos que uma besteira qualquer (um lanche, uma cerveja) perto do que tem lá dentro. ${cta} ${base}`;
    case "LAST_CALL": return `ÚLTIMA CHAMADA do dia, urgência máxima, quase implorando pra ele não perder. ${cta} ${base}`;
    case "GOOD_NIGHT": return `Boa noite íntimo, na cama, contando o que você vai fazer sozinha antes de dormir. Sem vender. ${base}`;
    case "POLL": return `Enquete safada e curta, sem vender. ${base}`;
  }
}

// --------------------------------------------------------------------------
// Fallbacks (só usados quando a IA falha — variados pra não repetir)
// --------------------------------------------------------------------------
const FALLBACK: Partial<Record<MkType, string[]>> = {
  GOOD_MORNING: ["Bom dia… acordei toda molhadinha pensando em você 😏", "Oi, dorminhoco… acordei com a mão onde não devia 🔥", "Bom dia! Sonhei uma coisa com você que não dá pra contar aqui 😈", "Acordei com um tesão absurdo… bom dia 💦"],
  HUMANIZATION: ["Saindo do banho agora, pelada e sem vontade nenhuma de me vestir 💦", "Dia cheio, mas minha cabeça só pensa em sentar em você 😈", "Deitada aqui de calcinha, entediada… vem me distrair 😏", "Terminei o treino toda suada, de shortinho colado… imagina o resto 🔥"],
  BREAKFAST: ["Café da manhã… mas a fome que eu tô é bem outra 😏", "Tomando café só de camisetinha, sem nada por baixo 😈"],
  SELFIE: ["Olha o que eu tô usando… ou quase 🔥 gostou?", "Tirei essa agora no espelho, antes de tirar o resto 😏", "Tô me sentindo perigosa hoje 😈 aguenta?", "Essa carinha aqui tá pedindo o quê? 💦"],
  WORK: ["Gravando hoje e o negócio ficou pesado demais 😈", "Trabalhando… mas o de hoje eu não vou conseguir postar aqui 🔥"],
  BEHIND_SCENES: ["O que rolou entre as gravações de hoje foi pior que o vídeo 🙈🔥", "Se você visse o que acontece quando a câmera desliga 😈"],
  CURIOSITY: ["Descobri uma posição nova ontem e eu não parei mais 😏", "Ontem eu fiz uma coisa que eu jurei que não faria 😈", "Tô com um segredo bem safado pra te contar 🙈"],
  QUESTION: ["Se eu sentasse no teu colo agora, o que você fazia? 😈 me conta", "Por onde você começaria em mim? 😏 quero ver"],
  REACTION: ["Reage com 🔥 se você tá duro pensando em mim 😈", "😈 se você me aguentaria a noite toda", "Manda um 💦 se você quer me ver gozando", "🔥 se você tá com saudade da minha bunda"],
  PHOTO_PREMIUM: ["Aqui eu tive que tapar… lá eu tô toda aberta pra você 🔥", "Essa é a versão comportada. A outra você não esquece 😈", "Isso é 10% do que eu postei lá dentro hoje 💦"],
  VIDEO_PREMIUM: ["Gravei um vídeo gozando que não cabe aqui… tá te esperando 💦", "Esse vídeo é forte demais pro grupo, tive que jogar lá dentro 😈", "Fiz um vídeo pensando em você e não segurei o gemido 🔥"],
  CENSORED_PREVIEW: ["Essa é a parte que dá pra postar aqui… a foto inteira tá lá 🔥", "Cortei bem na hora que ficou bom 😈 do lado de lá não tem corte", "Aqui você vê metade. Lá você vê tudo 💦"],
  PRESENT: ["Quem entrar agora ganha um vídeo meu bem safado 🎁😈", "Tenho um nude guardado pra quem chegar hoje 🎁🔥"],
  COUNTDOWN: ["Esse vídeo eu apago hoje à meia-noite… corre 🔥", "Depois de hoje some e não volta 😈"],
  VIP_INVITATION: ["Do lado de lá eu não tenho vergonha nenhuma 😈 vem ver", "Aqui eu me seguro. Lá eu faço tudo que você pedir 🔥"],
  SOCIAL_PROOF: ["O pessoal lá dentro surtou com o vídeo de ontem 😈 e hoje tem mais", "Tô sem conta de responder mensagem lá dentro hoje 🔥"],
  OFFER: ["Custa menos que um lanche e você me vê pelada o mês todo 😈", "Uma cerveja a menos hoje e você entra pra ver tudo 🔥"],
  LAST_CALL: ["Última chamada de hoje… depois eu apago 🔥 corre", "Fechando o dia. Tua última chance de me ver sem corte 😈"],
  GOOD_NIGHT: ["Boa noite… vou me tocar pensando em você 😏", "Já tô na cama, pelada, sem sono 💦 boa noite"],
};
export function fallbackText(type: MkType): string {
  const arr = FALLBACK[type];
  return arr ? pick(arr) : "Reage com 🔥 se você aguenta 😈";
}

const POLL_FALLBACKS: { question: string; options: string[] }[] = [
  { question: "O que você quer ver de mim hoje? 😈", options: ["Nude 🔥", "Vídeo gozando 💦", "Me surpreende 😏"] },
  { question: "Como você me prefere? 😏", options: ["Safadinha 😈", "Submissa 🥰", "Sem vergonha nenhuma 🔥"] },
  { question: "Onde você me pegaria agora? 💦", options: ["Cama 🛏️", "Chuveiro 🚿", "Em pé na parede 😈"] },
  { question: "Por onde você começaria em mim? 🔥", options: ["Boca 😈", "Peito 💦", "Descendo 😏"] },
  { question: "Você prefere que eu… 😈", options: ["Sente em você 🔥", "Fique de quatro 💦", "Só use a boca 😏"] },
];
export function fallbackPoll(): { question: string; options: string[] } {
  return pick(POLL_FALLBACKS);
}
