import "server-only";
// O tema do dia da semana é o MESMO dos dois grupos — sexta é sextou em
// qualquer lugar. Fica nas Prévias porque nasceu lá.
import { DAY_THEMES } from "./previasAi";

/**
 * Método MK — versão do GRUPO VIP (pós-venda / LTV).
 *
 * Diferença de filosofia em relação às Prévias: aqui o lead JÁ COMPROU. O
 * objetivo não é mais vender a assinatura — é MANTER o relacionamento. Então:
 *
 * - 20 a 25 posts/dia (menos que as Prévias), número e sequência aleatórios.
 * - A maioria é humanização/relacionamento e engajamento: o VIP é um cantinho
 *   íntimo, não um catálogo de vendas. Hoje o dia sai ~35% humanização, ~32%
 *   engajamento e ~34% convite (com o convite ligado).
 * - Nada de "vem pro VIP" (ele já está dentro). Posts de foto/vídeo exclusivos
 *   valorizam o conteúdo, sem link.
 * - TETO DE ACERVO: no máximo 4 a 6 posts com foto ou vídeo por dia (~4,6 na
 *   média, contra ~9 na versão anterior). O acervo não acompanhava esse ritmo e
 *   o VIP passava a rever o que já tinha visto; o excedente virou conversa —
 *   pergunta, enquete, reação. Menos mídia por dia = conteúdo mais fresco.
 * - O convite pro CONTATO DIRETO é OPCIONAL e decidido A CADA GERAÇÃO
 *   (`contato`). O contato particular virou produto à parte, então o padrão é
 *   NÃO entregar: ligado, o dia ganha ~7 a 8 posts com o botão; desligado, o
 *   dia sai inteiro sem venda nenhuma.
 * - AS JANELAS SEGUEM A CURVA DE VISUALIZAÇÃO do próprio grupo (gráfico do
 *   Telegram, em BRT): picos às 07–09h, 13–15h e 20–22h; vales no almoço e
 *   madrugada. A v2 tratava 00–02h como pico e mandava um quarto dos convites
 *   para uma sala com 5 a 13 pessoas olhando. Hoje ~95% dos convites caem em
 *   hora de pico.
 * - O destino é UM POR GERAÇÃO: WhatsApp OU Telegram particular. Misturar os
 *   dois no mesmo dia divide a atenção e nenhum dos dois vira hábito — quem
 *   respondeu no zap ontem não vai procurar você no Telegram hoje.
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
  | "DM_INVITE"
  | "DM_PHOTO";

/** Para onde o convite do VIP aponta nesta geração. `null` = geração sem
 *  convite nenhum (o padrão). */
export type VipContato = "whatsapp" | "telegram";

/** Como cada destino se chama na copy e no aviso da tela. */
export const CONTATO_LABEL: Record<VipContato, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

// humaniza = relacionamento; engaja = interação; direto = convite pro contato
// particular (leva o botão) — só entra quando a geração pede.
export type VipIntent = "humaniza" | "engaja" | "direto";

type TypeDef = {
  kind: VipKind;
  intent: VipIntent;
  /** true = leva o BOTÃO do contato particular no envio. */
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
  DM_INVITE: { kind: "texto", intent: "direto", cta: true },
  DM_PHOTO: { kind: "foto", intent: "direto", cta: true, media: "photo" },
};

// Janela de horário: [início, fim) em BRT, com os tipos priorizados e o peso
// relativo (quantos posts o dia coloca nessa janela).
type Window = { start: number; end: number; weight: number; types: VipType[] };

const WINDOWS: Window[] = [
  // 05–07 acordando, grupo ainda vazio (~6 views). Só carinho, zero mídia.
  { start: 5, end: 7, weight: 1, types: ["GOOD_MORNING", "HUMANIZATION", "BREAKFAST"] },
  // 07–09 PICO DA MANHÃ (24 views às 7h, o 2º maior do dia) — e até aqui era
  // uma janela SEM convite nenhum. É o melhor horário desperdiçado do VIP.
  { start: 7, end: 9, weight: 3, types: ["DM_INVITE", "DM_PHOTO", "GOOD_MORNING", "HUMANIZATION", "BREAKFAST", "QUESTION", "SELFIE"] },
  // 09–12 manhã cheia e estável (16–21 views): relacionamento e interação.
  { start: 9, end: 12, weight: 3, types: ["DM_INVITE", "HUMANIZATION", "CURIOSITY", "QUESTION", "REACTION", "VIP_THANKS", "EXCLUSIVE_PHOTO"] },
  // 12–13 buraco do almoço (12 views, o vale do meio do dia). Sem convite.
  { start: 12, end: 13, weight: 1, types: ["HUMANIZATION", "CURIOSITY", "POLL"] },
  // 13–15 PICO DA TARDE (24 e 23 views) — também sem convite até aqui.
  { start: 13, end: 15, weight: 3, types: ["DM_INVITE", "DM_PHOTO", "EXCLUSIVE_PHOTO", "HUMANIZATION", "QUESTION", "REACTION"] },
  // 15–17 respiro (15–16 views): interação leve, sem mídia.
  { start: 15, end: 17, weight: 2, types: ["HUMANIZATION", "BEHIND_SCENES", "CURIOSITY", "POLL", "QUESTION"] },
  // 17–20 fim de tarde subindo de novo (20–22 views).
  { start: 17, end: 20, weight: 3, types: ["DM_INVITE", "CURIOSITY", "POLL", "REACTION", "HUMANIZATION", "SELFIE", "QUESTION"] },
  // 20–22 O MÁXIMO DO DIA (23 e 26 views). Maior janela e maior cota de convite.
  { start: 20, end: 22, weight: 4, types: ["DM_INVITE", "DM_PHOTO", "EXCLUSIVE_PHOTO", "EXCLUSIVE_VIDEO", "HUMANIZATION", "REACTION", "POLL", "VIP_THANKS"] },
  // 22–00 já caindo (19 → 13 views): fecha o dia sem insistir.
  { start: 22, end: 24, weight: 2, types: ["HUMANIZATION", "GOOD_NIGHT", "CURIOSITY", "REACTION", "EXCLUSIVE_PHOTO"] },
  // 00–02 madrugada. A v2 tratava como PICO (peso 3, cota 0,4 de convite) e o
  // gráfico do grupo desmente: 13 views à 0h e 5 à 1h. Um quarto dos convites
  // do dia ia para uma sala vazia.
  { start: 0, end: 2, weight: 1, types: ["HUMANIZATION", "GOOD_NIGHT", "CURIOSITY"] },
  // 02–05 deserto absoluto (1 a 5 views). Presença mínima, nada mais.
  { start: 2, end: 5, weight: 1, types: ["HUMANIZATION", "GOOD_NIGHT"] },
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
 * @param opts.contato Destino do convite NESTA geração: "whatsapp",
 *   "telegram" ou `null`/omitido para um dia sem convite nenhum (o padrão — o
 *   contato particular é produto à parte). O plano é o mesmo nos dois destinos;
 *   o que muda é só a copy e o botão, resolvidos na rota e no envio.
 */
export function planDayVip(opts: { contato?: VipContato | null } = {}): VipPost[] {
  const comConvite = opts.contato === "whatsapp" || opts.contato === "telegram";
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
    // Desligado, os tipos de convite somem do sorteio: não basta tirar o
    // botão, porque a legenda desses posts é escrita convidando pro particular
    // e sem o link ficaria chamando para um destino que não existe.
    const types = comConvite
      ? w.types
      : w.types.filter((t) => VIP_TYPE_DEFS[t].intent !== "direto");
    const waTarget = comConvite ? windowDiretoTarget(w) : 0;

    // Quais posts DESTA janela levam o convite. `times` sai em ordem
    // cronológica, então preencher a cota na marra jogava TODOS os convites na
    // primeira hora da janela: às 20h saíam 1,7 convites e às 21h — a hora de
    // mais audiência do grupo — 0,2. Sorteando as posições, a cota se espalha
    // pelas duas horas do pico.
    const waCount = Math.ceil(count * waTarget);
    const waSlots = new Set(
      times
        .map((_, i) => i)
        .sort(() => Math.random() - 0.5)
        .slice(0, waCount),
    );

    times.forEach((totalMin, ti) => {
      const h = Math.floor(totalMin / 60) % 24;
      const min = totalMin % 60;
      const timeStr = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

      const type = chooseType(types, { wantWa: waSlots.has(ti), avoidKind: lastKind });
      const def = VIP_TYPE_DEFS[type];
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

  // 4) Limita o CONSUMO DE ACERVO do dia (foto/vídeo) — ver capMedia.
  capMedia(planned, randInt(4, 6));

  // 5) Deixa as ENQUETES em metade do engajamento do dia — ver balancePolls.
  balancePolls(planned);
  return planned;
}

/**
 * Teto de posts com FOTO ou VÍDEO no dia.
 *
 * O plano antigo gastava ~9 mídias por dia (39% dos posts) e o acervo não
 * acompanha: em poucos dias o VIP volta a ver o que já viu, e conteúdo repetido
 * vale menos que conversa. O excedente vira post de TEXTO da mesma intenção —
 * o dia não encolhe, só troca acervo por interação.
 *
 * Ordem de sacrifício, do menos para o mais valioso:
 *   SELFIE (foto de rotina) → EXCLUSIVE_PHOTO → DM_PHOTO → EXCLUSIVE_VIDEO.
 * DM_PHOTO vira DM_INVITE: o convite continua no ar, perde só a foto. O vídeo
 * é o último a cair — é o post mais raro e mais forte do VIP.
 */
function capMedia(planned: VipPost[], target: number): void {
  const ordem: VipType[] = ["SELFIE", "EXCLUSIVE_PHOTO", "DM_PHOTO", "EXCLUSIVE_VIDEO"];
  const semMidia: Partial<Record<VipType, VipType[]>> = {
    SELFIE: ["HUMANIZATION", "BEHIND_SCENES", "WORK"],
    EXCLUSIVE_PHOTO: ["CURIOSITY", "QUESTION", "REACTION"],
    DM_PHOTO: ["DM_INVITE"],
    EXCLUSIVE_VIDEO: ["CURIOSITY", "REACTION"],
  };

  let current = planned.filter((p) => p.media).length;
  for (const tipo of ordem) {
    if (current <= target) return;
    const alvos = planned
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.type === tipo)
      .sort(() => Math.random() - 0.5);
    for (const { i } of alvos) {
      if (current <= target) return;
      const virar = pick(semMidia[tipo]!);
      const def = VIP_TYPE_DEFS[virar];
      planned[i] = { ...planned[i], type: virar, kind: def.kind, intent: def.intent, cta: def.cta, media: def.media };
      current--;
    }
  }
}

/**
 * Deixa as ENQUETES em metade do engajamento do dia (mesma regra das Prévias),
 * convertendo nos dois sentidos e sempre espalhado — nunca duas enquetes
 * seguidas. Antes o alvo era fixo (2 a 3) e o resto do engajamento ficava solto.
 *
 * Posts com mídia ficam de fora do sorteio: o teto do dia já foi definido em
 * `capMedia` e virar uma foto em enquete aqui desfaria aquela conta.
 */
function balancePolls(planned: VipPost[]): void {
  const pollDef = VIP_TYPE_DEFS.POLL;
  const isPoll = (i: number) => planned[i]?.type === "POLL";
  const totalEngaja = planned.filter((p) => p.intent === "engaja").length;
  const target = Math.round(totalEngaja / 2);
  let current = planned.filter((p) => p.type === "POLL").length;

  if (current > target) {
    const excedente = planned
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.type === "POLL")
      .sort(() => Math.random() - 0.5);
    for (const { i } of excedente) {
      if (current <= target) break;
      const virar = pick<VipType>(["REACTION", "QUESTION", "CURIOSITY"]);
      const def = VIP_TYPE_DEFS[virar];
      planned[i] = { ...planned[i], type: virar, kind: def.kind, intent: def.intent, cta: def.cta, media: def.media };
      current--;
    }
    return;
  }
  if (current >= target) return;

  const candidates = planned
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.intent === "engaja" && p.type !== "POLL" && !p.media)
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

/** Fração-alvo de posts de CONVITE da janela, quando o convite está ligado.
 *  Calibrada pelo GRÁFICO DE VISUALIZAÇÕES do próprio grupo VIP: convite só nas
 *  horas em que tem gente olhando. Na prática dá ~7 a 8 posts com o link por
 *  dia (a cota arredonda para cima em cada janela), ~90% deles em hora de pico. */
function windowDiretoTarget(w: Window): number {
  if (w.start === 20) return 0.5; // 20–22 máximo do dia (23 e 26 views)
  if (w.start === 7) return 0.45; // 07–09 pico da manhã (24 views às 7h)
  if (w.start === 13) return 0.45; // 13–15 pico da tarde (24 e 23 views)
  if (w.start === 17) return 0.3; // 17–20 fim de tarde subindo
  if (w.start === 9) return 0.25; // 09–12 manhã cheia
  if (w.start === 22) return 0.15; // 22–00 já caindo
  if (w.start === 15) return 0.1; // 15–17 respiro
  return 0; // 05–07, 12–13, 00–02 e 02–05: sala vazia ou vale
}

/** Escolhe um tipo dos disponíveis na janela: prioriza o convite quando
 *  `wantWa`; senão sorteia entre HUMANIZAÇÃO e ENGAJAMENTO com leve vantagem
 *  para o engajamento (o VIP responde mais a pergunta/enquete/reação do que a
 *  mais um post de rotina). Evita repetir o kind físico do post anterior. */
function chooseType(
  types: VipType[],
  opts: { wantWa: boolean; avoidKind: VipKind | null },
): VipType {
  const wa = types.filter((t) => VIP_TYPE_DEFS[t].intent === "direto");
  const nonWa = types.filter((t) => VIP_TYPE_DEFS[t].intent !== "direto");
  let pool: VipType[];
  if (opts.wantWa && wa.length > 0) {
    pool = wa;
  } else if (nonWa.length > 0) {
    const hum = nonWa.filter((t) => VIP_TYPE_DEFS[t].intent === "humaniza");
    const eng = nonWa.filter((t) => VIP_TYPE_DEFS[t].intent === "engaja");
    if (hum.length && eng.length) pool = Math.random() < 0.45 ? hum : eng;
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
 *  os dois de convite chamam pro particular, e mesmo eles NUNCA escrevem o
 *  link/número — o botão é anexado automaticamente no envio.
 *
 *  `contato` é o destino da geração. Ele muda a copy de verdade, não só o
 *  botão: "me chama no zap" num post cujo botão abre o Telegram faz o cara
 *  parar no meio do caminho. No Telegram ainda vale um argumento que o WhatsApp
 *  não tem — ele não precisa sair do app nem entregar o número.
 *
 *  `weekday` (0 = domingo) injeta o TEMA DO DIA — os mesmos das Prévias
 *  ({@link DAY_THEMES}): sexta fala de sextou, domingo fala de carência. No VIP
 *  isso pesa ainda mais, porque é o mesmo público todo dia: sem o tema, sete
 *  postagens de "rotina" viram a mesma postagem sete vezes. */
export function captionThemeVip(
  type: VipType,
  contato: VipContato = "whatsapp",
  weekday?: number,
): string {
  const dia = weekday !== undefined && DAY_THEMES[weekday] ? `${DAY_THEMES[weekday]} ` : "";
  const base =
    dia +
    "Fale como brasileira DE VERDADE, informal, do dia a dia (tá, pra, cê, tô). " +
    "Curta (1–2 linhas). Tom íntimo de quem já conhece o cara — ele já é do seu VIP, " +
    "então NADA de vender assinatura nem 'vem pro VIP'. Sem hashtags. Varie a abertura.";
  const wa =
    contato === "telegram"
      ? "Convide de um jeito leve e carinhoso pra ele te chamar no seu TELEGRAM particular, " +
        "na conversa privada (mais pessoal, você responde de verdade lá, e ele nem precisa " +
        "sair do Telegram nem passar o número). " +
        "NÃO escreva link, usuário nem 'clica aqui' — o botão é anexado automaticamente. " +
        "Faça soar como um convite íntimo, não como anúncio."
      : "Convide de um jeito leve e carinhoso pra ele te chamar no seu WhatsApp particular " +
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
    case "EXCLUSIVE_PHOTO": return `Legenda pra esta FOTO exclusiva do VIP, valorizando ('isso é só aqui pra vocês'), sem vender assinatura nem chamar pro particular. ${base}`;
    case "EXCLUSIVE_VIDEO": return `Legenda pra um VÍDEO exclusivo do VIP (use o frame como referência), valorizando, sem vender. ${base}`;
    case "DM_INVITE": return `Chama o cara pro seu ${CONTATO_LABEL[contato]} particular. ${wa} ${base}`;
    case "DM_PHOTO": return `Legenda desta FOTO + convite pro seu ${CONTATO_LABEL[contato]} particular. ${wa} ${base}`;
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
  DM_INVITE: ["Me chama no meu zap 😏 lá eu respondo de verdade", "No WhatsApp eu sou mais sua 💕 vem", "Queria te responder no particular 😈 me chama no zap"],
  DM_PHOTO: ["Gostou? no meu zap tem mais e é mais pessoal 😏", "Vem falar comigo no particular 💦 te respondo lá"],
};

/** Reservas dos dois tipos de convite quando o destino é o TELEGRAM. Precisam
 *  ser próprias: os fallbacks acima citam "zap" e sairiam contradizendo o botão. */
const FALLBACK_TELEGRAM: Partial<Record<VipType, string[]>> = {
  DM_INVITE: [
    "Me chama aqui no meu privado 😏 lá eu respondo de verdade",
    "No particular eu sou mais sua 💕 vem",
    "Queria te responder a sós 😈 me chama no meu direct",
  ],
  DM_PHOTO: [
    "Gostou? no meu privado tem mais e é mais pessoal 😏",
    "Vem falar comigo a sós 💦 te respondo lá",
  ],
};

export function fallbackTextVip(type: VipType, contato: VipContato = "whatsapp"): string {
  const arr =
    (contato === "telegram" ? FALLBACK_TELEGRAM[type] : undefined) || FALLBACK[type];
  return arr ? pick(arr) : "Reage com 🔥 😈";
}
