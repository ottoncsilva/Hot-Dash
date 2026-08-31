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
 * - COTA DE VÍDEO: 4 a 6 por dia (o método sorteava ~1,3) e com PAPEL definido —
 *   o vídeo CENSURADO vende, nas janelas de venda e com botão do VIP; os outros
 *   vídeos (reels/lifestyle) engajam, no pico de audiência e sem venda. Nunca
 *   dois vídeos colados. Ver `balanceVideos`. O teto é o acervo: um canal com
 *   dois vídeos etiquetados recebe dois, não cinco repetidos.
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
  | "CENSORED_VIDEO"
  | "VIDEO_REELS"
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
  // O vídeo que VENDE: prévia cortada, com as partes quentes cobertas. Consome
  // o acervo etiquetado como censurado (ver TAG_VIDEO_CENSURADO em mediaUsage).
  CENSORED_VIDEO: { kind: "video", intent: "converte", cta: true, media: "video" },
  // O vídeo que ENGAJA: reels, lifestyle, duplo sentido — todo o resto do
  // acervo de vídeo. Sem botão do VIP, como qualquer post de engajamento.
  VIDEO_REELS: { kind: "video", intent: "engaja", cta: false, media: "video" },
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
  { start: 7, end: 8, weight: 2, types: ["PHOTO_PREMIUM", "CENSORED_VIDEO", "VIP_INVITATION", "CENSORED_PREVIEW", "PRESENT", "SELFIE", "HUMANIZATION", "BREAKFAST"] },
  // 08–11 engajamento com rotina. Contém as 9h, 2º melhor horário do dia
  // (39,3 vendas/1k views) — daí a cota ter subido de 0,16 para 0,30.
  { start: 8, end: 11, weight: 4, types: ["REACTION", "POLL", "QUESTION", "CURIOSITY", "SELFIE", "HUMANIZATION", "BREAKFAST", "CENSORED_PREVIEW", "CENSORED_VIDEO"] },
  // 11–14 meio-dia. Cota reduzida: 12h é buraco (17,6 vendas/1k, conversão
  // 21,4%) — muito clique de hora de almoço e pouca compra. 13h compensa.
  { start: 11, end: 14, weight: 4, types: ["CENSORED_PREVIEW", "PHOTO_PREMIUM", "CENSORED_VIDEO", "VIP_INVITATION", "SOCIAL_PROOF", "PRESENT", "REACTION", "HUMANIZATION", "SELFIE"] },
  // 14–17 tarde. Era a menor cota do dia útil (0,26) e o dado não sustenta:
  // 14h/15h/16h ficam todas em 23–25 vendas/1k, tão boas quanto a média.
  { start: 14, end: 17, weight: 4, types: ["HUMANIZATION", "CURIOSITY", "QUESTION", "BEHIND_SCENES", "WORK", "SELFIE", "PHOTO_PREMIUM", "CENSORED_VIDEO", "OFFER", "CENSORED_PREVIEW"] },
  // 17–19 fim de expediente. As 17h são o 3º melhor horário (35,1 vendas/1k,
  // 13 pagos). Estava diluída dentro da antiga 17–20 junto com as 18h/19h.
  { start: 17, end: 19, weight: 3, types: ["PHOTO_PREMIUM", "CENSORED_VIDEO", "CENSORED_PREVIEW", "SOCIAL_PROOF", "VIP_INVITATION", "PRESENT", "CURIOSITY", "SELFIE", "HUMANIZATION"] },
  // 19–22 PICO DE AUDIÊNCIA (460 views às 21h, o máximo do dia) e a PIOR
  // conversão por visualização (15,2–15,6). O grupo está cheio de gente que
  // veio se entreter, não comprar. Aqui se ENGAJA e se aquece — a venda sai
  // logo depois, às 22h, com o público já quente.
  { start: 19, end: 22, weight: 4, types: ["REACTION", "POLL", "QUESTION", "CURIOSITY", "SELFIE", "HUMANIZATION", "BEHIND_SCENES", "WORK", "PHOTO_PREMIUM"] },
  // 22–00 O PICO DE VENDA. 23h é a melhor hora do dia em tudo: 39 PIX gerados,
  // 16 pagos, 41,0% de conversão e 48,5 vendas/1k views — o dobro das 21h, com
  // 28% MENOS audiência. Maior cota do método.
  { start: 22, end: 24, weight: 5, types: ["CENSORED_PREVIEW", "PHOTO_PREMIUM", "CENSORED_VIDEO", "COUNTDOWN", "VIP_INVITATION", "SOCIAL_PROOF", "OFFER", "LAST_CALL", "REACTION", "HUMANIZATION"] },
  // 00–03 madrugada. A v2 tratava como 2º pico (peso 5, cota 0,60) e o dado
  // desmente: conversão 22,9% contra 33,8% da média, audiência despencando, e
  // a penalidade sobrevive até controlando o preço (35,5% contra 41–47%).
  { start: 0, end: 3, weight: 3, types: ["HUMANIZATION", "GOOD_NIGHT", "REACTION", "POLL", "CENSORED_PREVIEW", "PHOTO_PREMIUM", "COUNTDOWN", "LAST_CALL"] },
  // 03–05 deserto: 85 views às 3h e ZERO pagamentos em 4 cobranças no período.
  { start: 3, end: 5, weight: 2, types: ["HUMANIZATION", "GOOD_NIGHT", "SELFIE", "CURIOSITY", "BEHIND_SCENES"] },
];

/**
 * COTA DE VÍDEO do dia, e o PAPEL de cada vídeo.
 *
 * O método tratava vídeo como sobra: `VIDEO_PREMIUM` era o único tipo de vídeo e
 * aparecia em duas das dez janelas, contra quatro tipos de foto espalhados por
 * quase todas. Medido em 5.000 dias simulados, o plano saía com ~1,3 vídeo/dia
 * contra ~12,7 fotos, e um em cada cinco dias não tinha vídeo nenhum — com a
 * galeria cheia de etiqueta de vídeo sem uso.
 *
 * Agora o dia leva de 4 a 6 vídeos (sorteado, para nenhum dia sair igual), e
 * eles NÃO são todos a mesma coisa:
 *
 *   CENSORED_VIDEO — a prévia CORTADA, com as partes cobertas. É o vídeo que
 *     converte: a curiosidade de ver sem a tarja é o que faz clicar. Vai nas
 *     janelas que vendem (`VIDEO_PRIORITY`) e leva o botão do VIP. É a maioria.
 *
 *   VIDEO_REELS — todo o resto do acervo de vídeo (reels, lifestyle, duplo
 *     sentido). É o vídeo que engaja: vai no pico de AUDIÊNCIA, sem venda e sem
 *     botão. Um ou dois por dia, nunca mais que isso — o dia é de venda.
 *
 * Quem separa um do outro é a etiqueta que o editor de vídeo já aplica sozinho
 * ao borrar/cobrir alguma coisa (ver TAG_VIDEO_CENSURADO em mediaUsage): o
 * método só lê o resultado do fluxo de censura que o operador já usa.
 */
const VIDEO_MIN = 4;
const VIDEO_MAX = 6;
/** Quantos dos vídeos do dia são de ENGAJAMENTO. O resto é censurado. */
const REELS_MIN = 1;
const REELS_MAX = 2;
/** Piso de vídeo de VENDA: os reels nunca comem a cota abaixo disto. Com 4 no
 *  dia sai 1 reels; com 6, dois — o vídeo de conversão fica sempre em maioria. */
const CENSORED_MIN = 3;

/**
 * Em que janelas vale GASTAR vídeo de VENDA, da melhor conversão para a pior. É
 * a mesma ordem de `windowConvTarget`, que veio de vendas por 1.000
 * visualizações: 22–00 (48,5), 07–08 (43,3% de conversão), 17–19 (35,1), 11–14
 * (13h compensa o buraco das 12h), 08–11 (9h, 39,3) e 14–17 (23–25).
 *
 * O acervo de vídeo é finito e mais caro de produzir que foto: queimá-lo às 4h
 * da manhã, onde não houve UM pagamento em todo o período medido, é desperdício.
 */
const VIDEO_PRIORITY: number[] = [22, 7, 17, 11, 8, 14];

/**
 * Onde cai o vídeo de ENGAJAMENTO — quase o inverso da lista acima, de propósito.
 *
 * 19–22 vem primeiro porque é o PICO DE AUDIÊNCIA do dia (460 views às 21h) e a
 * PIOR conversão por visualização: é a janela em que o método já decidiu engajar
 * em vez de vender. Um reels ali pega a maior plateia do dia com o post que não
 * pede nada — que é exatamente o que aquece o público para a venda das 22h.
 *
 * 22–00 fica de fora mesmo com audiência: é a hora que VENDE, e um vídeo sem
 * botão ali gasta o melhor horário do dia. Ficam de fora também 03–05 e 05–07,
 * as horas mortas (85 views às 3h, zero pagamento no período medido) — reels na
 * madrugada é acervo queimado com ninguém olhando.
 */
const REELS_PRIORITY: number[] = [19, 8, 14, 11, 0];

/** Quanto de cada tipo de vídeo o canal tem disponível, depois do filtro de
 *  etiquetas do canal. É o TETO da cota — ver `videoQuota`. */
export type MkAcervo = { videosCensurados: number; videosOutros: number };

/**
 * Divide a cota do dia entre vídeo de venda e vídeo de engajamento, respeitando
 * o que existe na galeria.
 *
 * O teto do acervo não é detalhe: a fila de mídia RECICLA quando acaba (ver
 * createMediaQueue), então pedir cinco vídeos de quem tem dois não cria vídeo —
 * faz o mesmo clipe sair duas vezes no mesmo dia. E o saldo de um lado escorre
 * para o outro: canal sem nenhum reels leva o dia inteiro de censurado, canal
 * sem nenhum censurado não fica sem vídeo, leva reels.
 */
function videoQuota(acervo?: MkAcervo): { censurado: number; reels: number } {
  const temCensurado = acervo ? acervo.videosCensurados : Number.POSITIVE_INFINITY;
  const temOutros = acervo ? acervo.videosOutros : Number.POSITIVE_INFINITY;

  const total = Math.max(0, Math.min(randInt(VIDEO_MIN, VIDEO_MAX), temCensurado + temOutros));
  // Reels só até onde não morder o piso de vídeo de venda.
  const reels = Math.min(randInt(REELS_MIN, REELS_MAX), temOutros, Math.max(0, total - CENSORED_MIN));
  // O resto é vídeo de VENDA — e não é limitado pelo acervo censurado de
  // propósito. Se o canal tem menos vídeo censurado que isso, o slot continua
  // sendo de venda: a fila devolve um vídeo comum e o gerador rebaixa a legenda
  // para o convite genérico (VIDEO_PREMIUM). Cortar aqui faria o dia perder
  // vídeo de venda tendo acervo de vídeo na mão.
  return { censurado: total - reels, reels };
}

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
 *  Não escreve copy — só a estrutura.
 *
 *  `acervo` é o TETO da cota de vídeo (ver videoQuota): quantos vídeos
 *  DISTINTOS o canal tem de cada papel depois do filtro de etiquetas. Sem ele,
 *  um perfil com dois vídeos receberia um plano pedindo cinco e a fila de mídia
 *  repetiria o mesmo clipe no mesmo dia. Omitir = sem teto. */
export function planDay(acervo?: MkAcervo): Omit<PreviaPost, "text" | "poll">[] {
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
  // 5) COTA DE VÍDEO: 4 a 6 por dia, o censurado vendendo e o reels engajando —
  //    ver balanceVideos.
  balanceVideos(planned, videoQuota(acervo));
  return planned;
}

/**
 * Substituto de TEXTO quando o acervo não tem mídia para o slot.
 *
 * A fila de mídia acaba antes do dia (o acervo é finito e a mesma foto não pode
 * repetir), e aí o post seguia com o tipo de foto/vídeo: a IA escrevia
 * "olha como esse vestido tá marcando" e saía uma mensagem de texto sem imagem
 * nenhuma. Trocando o tipo, a legenda é escrita para o que o post realmente é.
 *
 * A intenção é preservada — post de conversão continua de conversão, com CTA.
 */
const SEM_MIDIA: Partial<Record<MkType, MkType[]>> = {
  SELFIE: ["HUMANIZATION", "BEHIND_SCENES", "WORK"],
  PHOTO_PREMIUM: ["VIP_INVITATION", "OFFER", "SOCIAL_PROOF"],
  CENSORED_PREVIEW: ["VIP_INVITATION", "COUNTDOWN"],
  PRESENT: ["VIP_INVITATION", "SOCIAL_PROOF"],
  VIDEO_PREMIUM: ["COUNTDOWN", "VIP_INVITATION"],
  CENSORED_VIDEO: ["COUNTDOWN", "VIP_INVITATION"],
  // Reels sem acervo vira engajamento de TEXTO, nunca post de venda: o slot foi
  // tirado do pool de engajamento e tem que voltar pra lá, senão a cota de
  // conversão do dia sobe por tabela.
  VIDEO_REELS: ["CURIOSITY", "QUESTION", "REACTION"],
};

/** Tipo equivalente sem mídia, ou `null` se o tipo já não depende de acervo. */
export function typeWithoutMedia(type: MkType): MkType | null {
  const alts = SEM_MIDIA[type];
  return alts && alts.length > 0 ? pick(alts) : null;
}

/** Kinds que pedem ação do grupo — dois colados soam pedinte. */
const INTERACTION_KINDS: MkKind[] = ["enquete", "reacao"];

/** Trocas possíveis: engajamento sem mídia, o mesmo conjunto de `balancePolls`. */
const ENGAJA_SEM_MIDIA: MkType[] = ["QUESTION", "CURIOSITY", "REACTION"];

/** O bastante de um post para reavaliar seu tipo — serve tanto para o plano do
 *  dia quanto para o slot já com horário resolvido do `previasGenerator`. */
export type SpreadableSlot = {
  type: MkType;
  kind: MkKind;
  intent: MkIntent;
  cta: boolean;
  media?: "photo" | "video";
};

/**
 * Rede de segurança aplicada sobre a lista que REALMENTE vai ser agendada —
 * a mesma do VIP (`vipAi.spreadInteractions`), pelo mesmo motivo.
 *
 * `balancePolls` espalha as enquetes no dia MK inteiro (05:00 → 04:59), mas o
 * `enqueuePreviasJob` depois descarta os horários que já passaram e os que
 * colidem com posts existentes. O que sobra fecha fileira, e enquetes separadas
 * por um vizinho viram vizinhas — com o agravante de o alvo de quantidade ter
 * sido calculado sobre o dia cheio.
 *
 * Aqui a regra vale sobre o que sobrou: nunca dois kinds de interação colados, e
 * no máximo um quarto dos posts agendados é enquete. Só o TIPO muda; horário,
 * mídia e CTA de conversão ficam intactos.
 */
export function spreadInteractions<T extends SpreadableSlot>(slots: T[]): void {
  const maxPolls = Math.max(1, Math.round(slots.length / 4));
  let polls = 0;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!INTERACTION_KINDS.includes(slot.kind)) continue;
    // Post de conversão e post com mídia não entram na troca.
    if (slot.intent !== "engaja" || slot.media || slot.cta) continue;

    const anterior = slots[i - 1];
    const coladoNoAnterior = !!anterior && INTERACTION_KINDS.includes(anterior.kind);
    const estourouCota = slot.kind === "enquete" && polls >= maxPolls;
    if (!coladoNoAnterior && !estourouCota) {
      if (slot.kind === "enquete") polls++;
      continue;
    }

    const vizinhos = [anterior?.kind, slots[i + 1]?.kind].filter(Boolean) as MkKind[];
    const vizinhoInterage = vizinhos.some((k) => INTERACTION_KINDS.includes(k));
    const candidatos = ENGAJA_SEM_MIDIA.filter((t) => {
      const kind = TYPE_DEFS[t].kind;
      if (vizinhos.includes(kind)) return false;
      if (vizinhoInterage && INTERACTION_KINDS.includes(kind)) return false;
      if (kind === "enquete" && polls >= maxPolls) return false;
      return true;
    });
    // QUESTION é texto puro: nunca colide com a regra, serve de último recurso.
    const escolhido = candidatos.length > 0 ? pick(candidatos) : "QUESTION";
    const def = TYPE_DEFS[escolhido];
    slots[i] = { ...slot, type: escolhido, kind: def.kind, intent: def.intent, cta: def.cta };
    if (def.kind === "enquete") polls++;
  }
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

/** Janela (identificada pelo `start`) a que a hora pertence. */
function windowStartForHour(hour: number): number {
  const w = WINDOWS.find((x) => hour >= x.start && hour < x.end);
  return w ? w.start : -1;
}

/** Hora cheia (0–23) de um slot já planejado. */
function hourOf(p: { time: string }): number {
  return parseInt(p.time.slice(0, 2), 10);
}

/** Posição da hora numa lista de prioridade — menor é melhor; fora da lista é
 *  pior que qualquer uma. */
function rankNaLista(hour: number, prioridade: number[]): number {
  const i = prioridade.indexOf(windowStartForHour(hour));
  return i < 0 ? prioridade.length : i;
}

/**
 * Deixa o dia com a cota de vídeo de {@link videoQuota}: os censurados nas
 * janelas que vendem, os reels no pico de audiência, e NUNCA dois vídeos
 * colados (de qualquer papel).
 *
 * Mesmo desenho de `balancePolls`: corrige para cima e para baixo, porque o
 * sorteio das janelas erra dos dois lados.
 */
function balanceVideos(
  planned: Omit<PreviaPost, "text" | "poll">[],
  quota: { censurado: number; reels: number },
): void {
  // Venda primeiro, que é o foco do dia. A ordem quase não muda o resultado:
  // medido nos dois sentidos, o reels sai em ~86% dos dias de qualquer forma. O
  // que limita o reels não é a ordem, é o pool de origem — engajamento sem
  // enquete dá só ~3 posts no dia inteiro, e parte deles já nasce colada num
  // vídeo sorteado pela janela.
  ajustarCensurados(planned, quota.censurado);
  plantarReels(planned, quota.reels);
}

/** Há vídeo colado neste índice? Vale para os dois papéis: dois vídeos seguidos
 *  pesam no grupo independentemente de qual deles vende. */
function coladoEmVideo(planned: Omit<PreviaPost, "text" | "poll">[], i: number): boolean {
  return planned[i - 1]?.kind === "video" || planned[i + 1]?.kind === "video";
}

function vira(
  planned: Omit<PreviaPost, "text" | "poll">[],
  i: number,
  type: MkType,
): void {
  const def = TYPE_DEFS[type];
  planned[i] = {
    ...planned[i],
    type,
    kind: def.kind,
    intent: def.intent,
    cta: def.cta,
    media: def.media,
  };
}

/**
 * Ajusta os vídeos de VENDA para o alvo.
 *
 * Quem vira vídeo é sempre um post de CONVERSÃO que já usaria FOTO. É isso que
 * mantém intacta a distribuição humanização/engajamento/conversão calibrada em
 * `windowConvTarget` — o post continua sendo o mesmo post de venda, na mesma
 * hora, com o mesmo botão do VIP; muda só o que ele MOSTRA.
 */
function ajustarCensurados(planned: Omit<PreviaPost, "text" | "poll">[], alvo: number): void {
  const ehVendaEmVideo = (p: { kind: MkKind; intent: MkIntent }) =>
    p.kind === "video" && p.intent === "converte";
  let atual = planned.filter(ehVendaEmVideo).length;

  // Passou do teto: seis janelas têm CENSORED_VIDEO na lista e o sorteio pode
  // estourar sozinho. O corte começa pelas PIORES horas — vídeo às 4h da manhã
  // é acervo queimado, vídeo às 23h é a melhor aposta do dia.
  if (atual > alvo) {
    const excedente = planned
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => ehVendaEmVideo(p))
      .sort((a, b) => rankNaLista(hourOf(b.p), VIDEO_PRIORITY) - rankNaLista(hourOf(a.p), VIDEO_PRIORITY));
    for (const { i } of excedente) {
      if (atual <= alvo) break;
      vira(planned, i, pick<MkType>(["PHOTO_PREMIUM", "CENSORED_PREVIEW"]));
      atual--;
    }
    return;
  }
  if (atual >= alvo) return;

  // Candidatos separados POR JANELA, embaralhados dentro de cada uma.
  const porJanela = new Map<number, number[]>();
  planned.forEach((p, i) => {
    if (p.intent !== "converte" || p.media !== "photo") return;
    const ws = windowStartForHour(hourOf(p));
    if (!VIDEO_PRIORITY.includes(ws)) return;
    porJanela.set(ws, [...(porJanela.get(ws) || []), i]);
  });
  // Dentro da janela sorteia, mas gasta primeiro o `PHOTO_PREMIUM`: ele é a
  // "foto quente com chamada pro VIP", exatamente a mesma mensagem do vídeo
  // censurado — o vídeo faz esse post melhor, não faz outro post. Os outros
  // dois têm gancho próprio: `CENSORED_PREVIEW` é, pelo próprio método, "o post
  // que mais converte", e `PRESENT` já é raro (menos de um por dia).
  const custo = (i: number) => (planned[i].type === "PHOTO_PREMIUM" ? 0 : 1);
  for (const lista of porJanela.values()) {
    lista.sort(() => Math.random() - 0.5);
    lista.sort((a, b) => custo(a) - custo(b)); // estável: mantém o sorteio no empate
  }

  atual += plantar(planned, porJanela, VIDEO_PRIORITY, alvo - atual, "CENSORED_VIDEO");
  if (atual >= alvo) return;

  // Ainda falta: o dia sorteou pouca conversão nas janelas boas. Aceita qualquer
  // hora, mantendo só a regra de não colar dois vídeos — um vídeo às 20h vale
  // mais que um dia com menos vídeo de venda que o combinado.
  plantarSobra(
    planned,
    (p) => p.intent === "converte" && p.media === "photo",
    alvo - atual,
    "CENSORED_VIDEO",
  );
}

/**
 * Planta os vídeos de ENGAJAMENTO.
 *
 * Aqui a origem é o pool de ENGAJAMENTO sem mídia (reação, pergunta,
 * curiosidade) — nunca um post de venda, senão o dia perderia conversão para
 * ganhar reels, e nunca uma ENQUETE, porque `balancePolls` acabou de deixar as
 * enquetes em metade do engajamento do dia e roubar uma desfaria essa conta.
 */
function plantarReels(planned: Omit<PreviaPost, "text" | "poll">[], alvo: number): void {
  if (alvo <= 0) return;
  let atual = planned.filter((p) => p.kind === "video" && p.intent === "engaja").length;
  if (atual >= alvo) return;

  const porJanela = new Map<number, number[]>();
  planned.forEach((p, i) => {
    if (p.intent !== "engaja" || p.media || p.type === "POLL") return;
    const ws = windowStartForHour(hourOf(p));
    if (!REELS_PRIORITY.includes(ws)) return;
    porJanela.set(ws, [...(porJanela.get(ws) || []), i]);
  });
  // Gasta primeiro CURIOSITY/QUESTION (texto puro) e só depois REACTION: o post
  // de reação com emoji é prova social barata, o que menos convém perder.
  const custo = (i: number) => (planned[i].type === "REACTION" ? 1 : 0);
  for (const lista of porJanela.values()) {
    lista.sort(() => Math.random() - 0.5);
    lista.sort((a, b) => custo(a) - custo(b));
  }

  // Sem rede de segurança "em qualquer hora" aqui, ao contrário do vídeo de
  // venda: o pool de engajamento sem enquete é pequeno (~3 posts/dia) e o que
  // sobra fora das janelas acima é madrugada. Reels às 4h não engaja ninguém —
  // é melhor o dia sair com um reels a menos.
  plantar(planned, porJanela, REELS_PRIORITY, alvo - atual, "VIDEO_REELS");
}

/**
 * Rodízio pelas janelas em ordem de prioridade: um vídeo em cada uma antes do
 * segundo na melhor delas. Sem o rodízio os vídeos caíam todos em 22–00 (maior
 * prioridade E maior cota de conversão) — justamente o bloco emendado que
 * `spreadIndexes` existe para evitar. Devolve quantos plantou.
 */
function plantar(
  planned: Omit<PreviaPost, "text" | "poll">[],
  porJanela: Map<number, number[]>,
  prioridade: number[],
  faltam: number,
  type: MkType,
): number {
  let feitos = 0;
  let avancou = true;
  while (feitos < faltam && avancou) {
    avancou = false;
    for (const ws of prioridade) {
      if (feitos >= faltam) break;
      const lista = porJanela.get(ws);
      while (lista && lista.length > 0) {
        const i = lista.shift() as number;
        if (planned[i].kind === "video" || coladoEmVideo(planned, i)) continue;
        vira(planned, i, type);
        feitos++;
        avancou = true;
        break;
      }
    }
  }
  return feitos;
}

/** Última tentativa, fora das janelas preferidas: qualquer slot que sirva,
 *  mantendo só a regra de não colar dois vídeos. */
function plantarSobra(
  planned: Omit<PreviaPost, "text" | "poll">[],
  serve: (p: Omit<PreviaPost, "text" | "poll">) => boolean,
  faltam: number,
  type: MkType,
): void {
  if (faltam <= 0) return;
  let feitos = 0;
  const resto = planned.map((_, i) => i).sort(() => Math.random() - 0.5);
  for (const i of resto) {
    if (feitos >= faltam) break;
    if (planned[i].kind === "video" || !serve(planned[i]) || coladoEmVideo(planned, i)) continue;
    vira(planned, i, type);
    feitos++;
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
    case "CENSORED_VIDEO": return `VÍDEO CORTADO: este vídeo tem as partes quentes COBERTAS (tarja/borrão) — diga isso e descreva o que está acontecendo embaixo da censura, o que o vídeo mostra inteiro do lado de lá. É o post de vídeo que mais converte: a curiosidade de ver sem a tarja tem que doer. ${cta} ${base}`;
    case "VIDEO_REELS": return `Legenda pra este VÍDEO curto do dia a dia (use o frame como referência), tipo reels: comente com malícia o que está rolando nele e termine puxando resposta ('adivinha o que eu ia fazer depois disso'). NÃO venda nada e não fale do VIP — este post é só pra puxar conversa. ${base}`;
    case "CENSORED_PREVIEW": return `PRÉVIA CORTADA: essa é a versão que dá pra mostrar no canal — diga isso e descreva o que ficou de fora do enquadramento, o que a foto original mostra inteiro. É o post que mais converte: a curiosidade tem que doer. Não afirme que tem tarja preta na imagem. ${cta} ${base}`;
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
  VIDEO_PREMIUM: ["Gravei um vídeo gozando que não cabe aqui… tá te esperando 💦", "Esse vídeo é forte demais pro canal, tive que jogar lá dentro 😈", "Fiz um vídeo pensando em você e não segurei o gemido 🔥"],
  CENSORED_VIDEO: ["Tive que cobrir bem na hora boa… sem a tarja tá lá dentro 🔥", "Esse é o vídeo censurado, o que dá pra postar aqui. O inteiro te espera 😈", "Imagina isso sem o borrão 💦 do lado de lá não tem"],
  VIDEO_REELS: ["Olha o que eu tava fazendo agora 😏 adivinha o que veio depois", "Gravei esse rapidinho hoje… gostou? 🔥", "Meu dia tá sendo assim 😈 e o seu?"],
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
