import { getDb } from "./db";
import { planButtonStyleProps, sanitizeButtonStyles, type ButtonStyles, type DynamicPrice } from "./settings";

export type TelegramBotConfig = {
  id: string;
  profileId: string;
  botToken: string;
  botUsername?: string;
  idVip: string;
  idAquecimento: string;
  idRegistro?: string;
  supportUsername?: string;
  welcomeMessage: string;
  welcomeMediaTags?: string;
  successMessage: string;
  /** Traduções GUARDADAS da mensagem de pagamento aprovado (botão "Traduzir",
   *  IA + cache — nunca traduzida ao vivo a cada envio). Usadas quando o
   *  lead escolheu esse idioma no menu internacional; sem tradução, cai no
   *  texto em português de sempre. */
  successMessageEn?: string;
  successMessageEs?: string;
  downsellFunnel?: string;
  upsellFunnel?: string;
  /** Mensagem enviada ao aprovar um lead no grupo de prévias (opcional). */
  previewsWelcomeMessage?: string;
  /** Liga/desliga da operação do bot de vendas (cutover para o Hot-Dash). */
  operationActive: boolean;
  /** Regra de aprovação de quem pede entrada no grupo VIP. */
  vipApprovalMode: ApprovalMode;
  /** Regra de aprovação de quem pede entrada no grupo de Prévias. */
  previasApprovalMode: ApprovalMode;
  /** Aviso enviado enquanto a cobrança é criada. Vazio = padrão. */
  pixGeneratingMessage?: string;
  /** Legenda do PIX. Aceita {plano}, {valor} e {pix_code}. Vazio = padrão. */
  pixCaption?: string;
  /** Texto do botão de acesso ao VIP na aprovação. Vazio = link solto no texto. */
  successButtonText?: string;
  /** Ids da Galeria escolhidos a dedo para a abertura do /start, em ordem. */
  welcomeMediaIds?: string[];
  /** "album" = tudo numa mensagem; "separate" = uma mensagem por mídia. */
  welcomeMediaMode: "album" | "separate";
  /** Mostra a linha de prova social (números reais) na tela do PIX. */
  pixSocialProof: boolean;
  /** Texto da prova social. Aceita {vendas_hoje} e {assinantes}. */
  pixSocialProofText?: string;
  /** URL pública de um OGG/OPUS enviado como mensagem de voz junto do PIX. */
  pixAudioUrl?: string;
  /** Textos dos botões do PIX. Vazio = padrão. */
  pixBtnCheck?: string;
  pixBtnQr?: string;
  pixBtnCopy?: string;
  /** Resposta do "Verificar Status" quando ainda não consta como pago. */
  pixNotPaidMessage?: string;
  /** Sequência de boas-vindas ao ser aprovado nas Prévias (JSON de passos). */
  previasWelcomeFunnel?: string;
  /** Idem para o VIP. */
  vipWelcomeFunnel?: string;
  /** Recuperação de quem GEROU PIX e não pagou (JSON de passos). */
  pixDownsellFunnel?: string;
  /** Liga/desliga de cada uma das três sequências de recuperação. */
  downsellEnabled: boolean;
  pixDownsellEnabled: boolean;
  upsellEnabled: boolean;
  /**
   * EFEITO DE MENSAGEM (a animação que roda quando a mensagem chega) em cada
   * um dos três momentos que valem a pena. Guarda a chave da lista de
   * MESSAGE_EFFECTS, não o id numérico do Telegram: o id é detalhe da API.
   * Vazio = sem efeito.
   */
  effectWelcome?: string;
  effectPix?: string;
  effectSuccess?: string;
  /** Ao aprovar no grupo, manda a MESMA mensagem de boas-vindas do /start
   *  (texto, mídias e botões dos planos) antes da sequência própria. */
  previasUseWelcome?: boolean;
  vipUseWelcome?: boolean;
  /** Variação de centavos por lead — configuração DESTA modelo. */
  dynamicPrice?: DynamicPrice;
  /** Cor de cada papel de botão — paleta DESTA modelo. */
  buttonStyles?: ButtonStyles;
  /**
   * ALERTA DE RENOVAÇÃO: avisa quem está VIP de que o acesso está para
   * vencer, com desconto para renovar (JSON de passos). Ao contrário dos
   * outros funis, a contagem é REGRESSIVA — cada passo dispara quando falta
   * X tempo para `expires_at`, não X tempo desde um evento.
   */
  renewalFunnel?: string;
  renewalEnabled: boolean;
  /** Liga/desliga o botão "Not from Brazil?" (checkout Stripe), independente
   *  de existir plano com preço em USD — sem plano em USD o botão não
   *  aparece de qualquer jeito, mas isto permite escondê-lo mesmo com preço
   *  cadastrado (ex.: pausar cobrança internacional sem apagar os preços). */
  intlEnabled: boolean;
  /** Com isto ligado, o /start pergunta Brasil/International (2 botões) ANTES
   *  de mandar qualquer coisa, em vez do botão "Not from Brazil?" no meio do
   *  funil (que continua existindo pra quem deixa isto desligado — padrão). */
  intlAskFirst?: boolean;
  /** Libera um botão extra pro lead BRASILEIRO pagar no cartão (Stripe, em
   *  BRL) depois da lista de planos em PIX — mensagem separada, em sequência.
   *  Só aparece de verdade com a Stripe conectada. */
  acceptCardBr?: boolean;
  /** Boas-vindas do ramo internacional — traduções GRAVADAS (mesmo padrão de
   *  `successMessageEn/Es`: populadas sozinhas a cada save do texto em PT,
   *  editáveis por cima). Vazio cai num texto padrão em inglês/espanhol. */
  welcomeMessageEn?: string;
  welcomeMessageEs?: string;
  /** Texto do botão de acesso, traduzido — a mensagem já traduz
   *  (`successMessageEn/Es`), mas o botão até aqui saía sempre em português. */
  successButtonTextEn?: string;
  successButtonTextEs?: string;
  /** Prova social traduzida — mesmos marcadores {vendas_hoje}/{assinantes}. */
  pixSocialProofTextEn?: string;
  pixSocialProofTextEs?: string;
  /** "Gerando cobrança..." do checkout no CARTÃO (Stripe) — separado de
   *  `pixGeneratingMessage`: antes o cartão usava o texto do PIX ("Gerando
   *  cobrança PIX...") mesmo pra quem pagava com cartão, o que é errado. Só
   *  PT: o intl usa o texto fixo já traduzido (`CHECKOUT_INTL_TEXTS`), isto
   *  aqui é só pro brasileiro que escolheu "Aceitar cartão no Brasil". */
  checkoutGeneratingMessage?: string;
  /** Botão que abre o link de pagamento no checkout Stripe (internacional ou
   *  "Aceitar cartão no Brasil") — antes era "Make payment"/"Pagar 👉" fixo
   *  no código. Vazio cai no texto padrão de sempre, em cada idioma. */
  checkoutPayButtonText?: string;
  checkoutPayButtonTextEn?: string;
  checkoutPayButtonTextEs?: string;
  /** Botão "Verificar Status do Pagamento" do MESMO checkout Stripe — antes
   *  "Check payment status" fixo. `checkoutShowCheckButton` desligado tira o
   *  botão inteiro (só fica o link de pagamento). */
  checkoutCheckButtonText?: string;
  checkoutCheckButtonTextEn?: string;
  checkoutCheckButtonTextEs?: string;
  checkoutShowCheckButton?: boolean;
};

/** Textos padrão da tela de pagamento — os mesmos que antes viviam fixos no
 *  handler do webhook. Ficam aqui para a UI conseguir mostrá-los como
 *  placeholder e oferecer um "restaurar padrão" honesto. */
export const PIX_DEFAULTS = {
  generatingMessage: "⏳ Gerando cobrança PIX...",
  /**
   * Prova social com números REAIS desta modelo — vendas pagas hoje e
   * assinantes ativos, lidos das mesmas tabelas do painel financeiro.
   *
   * De propósito não existe campo para inventar número: prova social fabricada
   * é propaganda enganosa com o cliente do outro lado, e quem responderia por
   * ela seria a operação, não o painel. Quando o número real é zero, a linha
   * simplesmente não é enviada.
   */
  socialProofText: "🔥 {vendas_hoje} pessoa(s) garantiram o acesso hoje.",
  /**
   * A tela do PIX. O `<code>` do copia-e-cola é o que faz o Telegram copiar o
   * código inteiro com UM toque — por isso a instrução "toque na chave acima"
   * só funciona com ele.
   */
  caption:
    `🌟 Você selecionou o seguinte plano:\n\n` +
    `🎁 Plano: <b>{plano}</b>\n` +
    `💰 Valor: <b>{valor}</b>\n\n` +
    `💠 Pagamento via Pix – Copia e Cola (ou QR Code, dependendo do seu banco):\n\n` +
    `<code>{pix_code}</code>\n\n` +
    `👆 Toque na chave PIX acima para copiá-la 💖\n\n` +
    `‼️ Depois de pagar, é só clicar no botão abaixo pra confirmar seu pagamento e liberar seu acesso amor, vem logo tô te esperando 👇✨`,
  /** Textos dos três botões que acompanham o PIX. */
  btnCheck: "Verificar Status do Pagamento",
  btnQr: "Mostrar QR Code",
  btnCopy: "Copiar Chave Pix",
  /** Resposta do "Verificar Status" quando a confirmação ainda não chegou. */
  notPaidMessage:
    "Ainda não identificamos seu pagamento. Se você já pagou, aguarde alguns instantes e tente novamente.",
} as const;

/** Textos padrão do checkout NO CARTÃO (Stripe) — mesmo espírito de
 *  `PIX_DEFAULTS`: ficam aqui pra UI mostrar como placeholder e restaurar. Só
 *  o texto em PT ("Aceitar cartão no Brasil"); o internacional já tem os
 *  seus fixos, traduzidos, no webhook. */
export const CHECKOUT_DEFAULTS = {
  generatingMessage: "⏳ Gerando cobrança no cartão...",
  payButton: "Pagar 👉",
  checkButton: "Verificar status",
} as const;

/**
 * Mensagens de partida de um bot NOVO. Antes eram "Bem-vindo" e "Aprovado" —
 * literalmente essas duas palavras, que ninguém deixaria no ar mas que também
 * não avisavam que precisavam ser trocadas.
 *
 * A de aprovação já vem com {link_vip}: sem ele, o cliente paga e não recebe
 * caminho nenhum para o grupo.
 */
export const MESSAGE_DEFAULTS = {
  welcome:
    "Oi meu amor 😈\n\nSeja bem-vindo! Aqui embaixo estão as opções pra você entrar no meu VIP e ver tudo o que eu não posso postar por aí 🔥\n\nEscolhe a sua e vem 👇",
  success: "✅ Pagamento aprovado meu amor! Acesse o Grupo VIP aqui:\n\n🔗 {link_vip}",
  successButton: "🔒 Acessar Conteúdo",
} as const;

/**
 * Sequência padrão do ALERTA DE RENOVAÇÃO — nasce pré-carregada em bot novo
 * (ver rota `save-credentials` em `app/api/telegram/route.ts`) e é o que o
 * backfill grava nos bots que já existiam antes deste funil nascer (ver
 * `backfillRenewalFunnel` em `lib/db.ts` — duplicado ali de propósito, no
 * mesmo espírito de `backfillMensagensPadrao`, para não criar um import
 * circular com este arquivo).
 *
 * Avisa cedo sem pressionar (1 dia e 18h antes, sem desconto) e o desconto
 * sobe conforme o vencimento se aproxima — 20% a 12h, 30% a 6h e 1h, 40% a
 * 20min, 50% nos últimos 5min. Só entra em quem está com o campo VAZIO: uma
 * modelo que já editou por cima nunca tem a edição sobrescrita.
 */
export const RENEWAL_DEFAULT_STEPS: { delayMinutes: number; discountPercent: number; text: string }[] = [
  {
    delayMinutes: 1440,
    discountPercent: 0,
    text: "Oi {nome} 😘 Passando pra avisar que seu VIP vence AMANHÃ. Não queria te perder logo agora que a gente tava se conhecendo... dá uma olhada nos planos e renova pra continuar aqui comigo 💕",
  },
  {
    delayMinutes: 1080,
    discountPercent: 0,
    text: "{nome}, faltam só 18 horinhas pro seu acesso vencer 👀 Ainda dá tempo de renovar tranquilo, sem correria. Não some não 🥺",
  },
  {
    delayMinutes: 720,
    discountPercent: 20,
    text: "Amor, seu VIP vence em 12 horas! 🔥 Separei 20% de desconto só pra você renovar agora e continuar vendo tudo que eu posto. Corre que é por tempo limitado 😈",
  },
  {
    delayMinutes: 360,
    discountPercent: 30,
    text: "{nome}, faltam só 6 horas e seu acesso cai fora 😱 Consegui liberar 30% de desconto pra você não perder — não vou fazer isso sempre viu, aproveita agora",
  },
  {
    delayMinutes: 60,
    discountPercent: 30,
    text: "ÚLTIMA HORA, {nome}! ⏰ Em breve você perde o acesso a tudo que eu posto aqui. Ainda dá tempo de renovar com 30% off, não deixa acabar assim 🥵",
  },
  {
    delayMinutes: 20,
    discountPercent: 40,
    text: "{nome}, faltam só 20 minutinhos e seu VIP vence 😰 Subi o desconto pra 40% AGORA, é a sua última chance antes de sair do grupo. Corre comigo 🔥",
  },
  {
    delayMinutes: 5,
    discountPercent: 50,
    text: "ÚLTIMOS 5 MINUTOS!!! 🚨 {nome}, não perde tudo por bobeira — renova AGORA com 50% de desconto, o maior que eu dou. Depois que vencer não tem mais volta 💔",
  },
];

/**
 * Monta a mensagem de "pagamento aprovado" GARANTINDO que o link do VIP chegue.
 *
 * O texto é livre, e era possível salvá-lo sem `{link_vip}` e sem texto de
 * botão — foi o que aconteceu na prática: o cliente pagava e recebia só
 * "Aprovado", sem caminho nenhum para o grupo. O convite tinha sido gerado,
 * mas não ia em lugar nenhum.
 *
 * Então aqui o link é obrigatório, não opcional:
 *   • se o texto tem {link_vip}, ele é trocado ali (o operador manda no lugar);
 *   • se não tem, o link é ANEXADO no fim;
 *   • o botão de acesso sempre acompanha, caindo no rótulo padrão quando o
 *     campo está vazio — um botão a mais nunca custou uma venda, um link a
 *     menos custa todas.
 */
export function buildAccessMessage(
  bot: Pick<
    TelegramBotConfig,
    "successMessage" | "successButtonText" | "successButtonTextEn" | "successButtonTextEs"
  >,
  inviteLink: string,
  buttonProps: Record<string, unknown> = {},
  /** Idioma do lead — troca o texto do BOTÃO (a mensagem já vem trocada de
   *  fora, ver `deliverPayment.ts`). Sem tradução salva pro idioma, cai no
   *  texto em português de sempre. */
  idioma?: "en" | "es",
): { text: string; options: Record<string, unknown> } {
  const base = bot.successMessage?.trim() || MESSAGE_DEFAULTS.success;
  const temMarcador = /{link_vip}/i.test(base);
  const text = temMarcador
    ? base.replace(/{link_vip}/gi, inviteLink)
    : `${base}\n\n🔗 ${inviteLink}`;
  const botaoTraduzido = idioma === "en" ? bot.successButtonTextEn : idioma === "es" ? bot.successButtonTextEs : undefined;
  const botao = botaoTraduzido?.trim() || bot.successButtonText?.trim() || MESSAGE_DEFAULTS.successButton;
  return {
    text,
    options: {
      reply_markup: {
        inline_keyboard: [[{ text: botao, url: inviteLink, ...buttonProps }]],
      },
    },
  };
}

/**
 * O que o bot faz com um pedido de entrada no grupo:
 *   subscribers → aprova só quem tem assinatura ativa (recusa o resto);
 *   all         → aprova todo mundo (grupo gratuito, de aquecimento);
 *   manual      → não decide: o pedido fica na fila do Telegram para o admin.
 */
export type ApprovalMode = "subscribers" | "all" | "manual";

const APPROVAL_MODES: ApprovalMode[] = ["subscribers", "all", "manual"];

/** Lê um modo vindo do banco ou da UI, caindo no padrão se vier lixo. */
export function toApprovalMode(value: unknown, fallback: ApprovalMode): ApprovalMode {
  return APPROVAL_MODES.includes(value as ApprovalMode) ? (value as ApprovalMode) : fallback;
}

export type TelegramPlan = {
  id: string;
  botId: string;
  name: string;
  /** Nome em inglês — tradução GRAVADA, populada sozinha quando `name` é
   *  salvo (mesmo mecanismo de `successMessageEn`). Vazio cai no `name` em
   *  PT. Usado no teclado do checkout internacional e no downsell em en/es. */
  nameEn?: string;
  priceCents: number;
  /** Preço em USD do MESMO plano, pro botão "Not from Brazil?" (Stripe).
   *  Ausente/0 = esse plano não entra na venda internacional. */
  priceUsdCents?: number;
  /** Controle A MAIS (além do preço em USD) pra incluir/excluir este plano
   *  específico da venda internacional — sem precisar apagar o preço.
   *  Padrão true. */
  intlAvailable?: boolean;
  /** Dias de acesso. 0 = VITALÍCIO (nunca expira). */
  durationDays: number;
  /** "subscription" = dá acesso VIP por N dias; "package" = compra única. */
  kind: "subscription" | "package";
  /** Conteúdo/link entregue ao pagar (bônus da assinatura ou item do pacote). */
  deliverable?: string;
  /** Posição na lista de botões do /start (menor primeiro). */
  sortOrder: number;
  /** Desligado some dos botões do bot, mas continua no painel com o histórico. */
  active: boolean;
  /** Cor de destaque na lista do painel: "" | green | blue | red. */
  highlight?: string;
  /** Botões enviados junto do entregável. */
  deliverableButtons?: { text: string; url: string }[];
  /** Oferta adicional mostrada antes de gerar o PIX deste plano. */
  bump?: OrderBump;
};

/**
 * ORDER BUMP — a oferta que aparece depois de escolher o plano.
 *
 * Aceitar SOMA o valor à mesma cobrança, em vez de criar uma segunda: dois PIX
 * deixariam um deles em aberto se o cliente desistisse no meio, e o painel
 * mostraria uma venda pendente que nunca fecharia.
 */
export type OrderBump = {
  enabled: boolean;
  name: string;
  priceCents: number;
  /** Aceita {selected_plan_name}, {order_bump_name}, {order_bump_value}, {total_value}. */
  text: string;
  acceptText?: string;
  declineText?: string;
  mediaIds?: string[];
  audioUrl?: string;
  deliverable?: string;
  deliverableButtons?: { text: string; url: string }[];
};

export const BUMP_DEFAULTS = { accept: "Aceitar", decline: "Recusar" } as const;

/**
 * Períodos com nome, no lugar de digitar dias na mão.
 *
 * `days: 0` é o VITALÍCIO: a confirmação do pagamento trata 0 como "não
 * expira", e a rotina de expiração o ignora — é o mesmo caminho que os pacotes
 * de compra única já usavam.
 */
export const PLAN_PERIODS: { key: string; label: string; days: number }[] = [
  { key: "weekly", label: "Semanal", days: 7 },
  { key: "monthly", label: "Mensal", days: 30 },
  { key: "quarterly", label: "Trimestral", days: 90 },
  { key: "semiannual", label: "Semestral", days: 180 },
  { key: "annual", label: "Anual", days: 365 },
  { key: "lifetime", label: "Vitalício", days: 0 },
];

/** Nome do período a partir dos dias (para a lista do painel). */
export function planPeriodLabel(days: number): string {
  if (days <= 0) return "Vitalício";
  const exato = PLAN_PERIODS.find((p) => p.days === days);
  return exato ? exato.label : `${days} dias`;
}

export type StripeRecurring = { interval: "day" | "week" | "month" | "year"; intervalCount: number };

/**
 * Traduz `durationDays` pro ciclo de cobrança que a Stripe entende
 * (`price_data.recurring`), para o checkout internacional virar assinatura
 * de verdade (cobrança automática) em vez de link avulso.
 *
 * Prioriza a unidade "redonda" (ano/mês/semana) quando o número de dias bate
 * exato — fica melhor no extrato do cliente e na lista de assinaturas da
 * própria Stripe do que "a cada 30 dias". Fora dos múltiplos exatos, cai
 * pra `day`, que a Stripe aceita em qualquer contagem até o teto de 3 anos
 * documentado pra `interval_count` (156 semanas / 36 meses / 3 anos).
 *
 * `null` = não dá pra representar com segurança (vitalício, ou uma duração
 * absurda) — quem chama trata como "esta compra não vira assinatura,
 * cobra avulso como sempre".
 */
export function recurringFromDurationDays(days: number): StripeRecurring | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  if (days % 365 === 0 && days / 365 <= 3) return { interval: "year", intervalCount: days / 365 };
  if (days % 30 === 0 && days / 30 <= 12) return { interval: "month", intervalCount: days / 30 };
  if (days % 7 === 0 && days / 7 <= 52) return { interval: "week", intervalCount: days / 7 };
  if (days <= 1095) return { interval: "day", intervalCount: days };
  return null;
}

export type TelegramSubscription = {
  id: string;
  botId: string;
  transactionId?: string;
  planId?: string;
  /** Oferta de um MAILING (nome/preço/duração só daquele disparo), se veio de lá. */
  offerId?: string;
  telegramUserId: number;
  telegramUsername?: string;
  inviteLink?: string;
  /** "abandoned": um PIX/cobrança que ficou pendente e foi SUPERADO por um
   *  novo /start do mesmo lead (ver `abandonPendingSubscriptions`) — não
   *  conta mais pra nada (não bloqueia o Downsell geral, não recebe
   *  mensagem do Downsell de cobrança), mas a linha continua existindo: se
   *  esse PIX antigo for pago do nada, a entrega ainda funciona (ver
   *  `deliverPaidTransaction`), só não volta a nagear ninguém. */
  status: "pending" | "active" | "expired" | "blocked" | "abandoned";
  expiresAt: number;
  lastUpsellAt?: number;
  upsellStepIndex: number;
  createdAt: number;
  /** Copia-e-cola do PIX, para os botões de QR/copiar funcionarem depois. */
  pixCode?: string;
  /** Quanto do valor pago foi do Order Bump. 0 = o cliente recusou. */
  bumpCents?: number;
  /** Progresso na sequência de "PIX gerado e não pago". */
  pixStepIndex?: number;
  lastPixStepAt?: number;
  /** Progresso no Alerta de Renovação — regressivo até `expiresAt`, por isso
   *  não tem um "lastRenewalStepAt": o que importa é o QUANTO FALTA, não
   *  desde quando. */
  renewalStepIndex?: number;
  /** Id da Subscription na Stripe — só existe quando a compra virou
   *  cobrança automática (checkout internacional, `mode: "subscription"`).
   *  Presença dele é o que tira esta inscrição do Alerta de Renovação
   *  manual (ver `runTelegramFunnels`) e é a CHAVE que o webhook usa pra
   *  achar a inscrição local quando a Stripe cobra um novo ciclo sozinha. */
  stripeSubscriptionId?: string;
  /** Id do Customer na Stripe — usado pra abrir o Billing Portal
   *  ("Gerenciar assinatura", cancelamento self-service). */
  stripeCustomerId?: string;
};

/** Linha do banco → config do bot. Um lugar só: as duas consultas abaixo
 *  liam os mesmos campos em cópias separadas, e um campo novo tinha de ser
 *  lembrado nas duas. */
function toBotConfig(row: any): TelegramBotConfig {
  return {
    id: row.id,
    profileId: row.profile_id,
    botToken: row.bot_token,
    botUsername: row.bot_username || undefined,
    idVip: row.id_vip,
    idAquecimento: row.id_aquecimento,
    idRegistro: row.id_registro || undefined,
    supportUsername: row.support_username || undefined,
    welcomeMessage: row.welcome_message,
    welcomeMediaTags: row.welcome_media_tags || undefined,
    successMessage: row.success_message,
    successMessageEn: row.success_message_en || undefined,
    successMessageEs: row.success_message_es || undefined,
    downsellFunnel: row.downsell_funnel || undefined,
    upsellFunnel: row.upsell_funnel || undefined,
    previewsWelcomeMessage: row.previews_welcome_message || undefined,
    operationActive: !!row.operation_active,
    vipApprovalMode: toApprovalMode(row.vip_approval_mode, "subscribers"),
    previasApprovalMode: toApprovalMode(row.previas_approval_mode, "all"),
    pixGeneratingMessage: row.pix_generating_message || undefined,
    pixCaption: row.pix_caption || undefined,
    successButtonText: row.success_button_text || undefined,
    welcomeMediaIds: parseIds(row.welcome_media_ids),
    welcomeMediaMode: row.welcome_media_mode === "separate" ? "separate" : "album",
    pixSocialProof: !!row.pix_social_proof,
    pixSocialProofText: row.pix_social_proof_text || undefined,
    pixAudioUrl: row.pix_audio_url || undefined,
    pixBtnCheck: row.pix_btn_check || undefined,
    pixBtnQr: row.pix_btn_qr || undefined,
    pixBtnCopy: row.pix_btn_copy || undefined,
    pixNotPaidMessage: row.pix_not_paid_message || undefined,
    previasWelcomeFunnel: row.previas_welcome_funnel || undefined,
    vipWelcomeFunnel: row.vip_welcome_funnel || undefined,
    pixDownsellFunnel: row.pix_downsell_funnel || undefined,
    // Sem valor gravado = LIGADO: é o comportamento de antes destes campos
    // existirem, quando bastava ter passos configurados para o funil rodar.
    downsellEnabled: row.downsell_enabled === undefined || row.downsell_enabled === null ? true : !!row.downsell_enabled,
    pixDownsellEnabled: row.pix_downsell_enabled === undefined || row.pix_downsell_enabled === null ? true : !!row.pix_downsell_enabled,
    upsellEnabled: row.upsell_enabled === undefined || row.upsell_enabled === null ? true : !!row.upsell_enabled,
    effectWelcome: row.effect_welcome || undefined,
    effectPix: row.effect_pix || undefined,
    effectSuccess: row.effect_success || undefined,
    previasUseWelcome: !!row.previas_use_welcome,
    vipUseWelcome: !!row.vip_use_welcome,
    dynamicPrice: {
      enabled: !!row.dynamic_price_enabled,
      cents: Number(row.dynamic_price_cents) || 9,
      direction:
        row.dynamic_price_direction === "up" || row.dynamic_price_direction === "down"
          ? row.dynamic_price_direction
          : "random",
    },
    buttonStyles: parseButtonStyles(row.button_styles),
    renewalFunnel: row.renewal_funnel || undefined,
    renewalEnabled: row.renewal_enabled === undefined || row.renewal_enabled === null ? true : !!row.renewal_enabled,
    intlEnabled: row.intl_enabled === undefined || row.intl_enabled === null ? true : !!row.intl_enabled,
    intlAskFirst: !!row.intl_ask_first,
    acceptCardBr: !!row.accept_card_br,
    welcomeMessageEn: row.welcome_message_en || undefined,
    welcomeMessageEs: row.welcome_message_es || undefined,
    successButtonTextEn: row.success_button_text_en || undefined,
    successButtonTextEs: row.success_button_text_es || undefined,
    pixSocialProofTextEn: row.pix_social_proof_text_en || undefined,
    pixSocialProofTextEs: row.pix_social_proof_text_es || undefined,
    checkoutGeneratingMessage: row.checkout_generating_message || undefined,
    checkoutPayButtonText: row.checkout_pay_button_text || undefined,
    checkoutPayButtonTextEn: row.checkout_pay_button_text_en || undefined,
    checkoutPayButtonTextEs: row.checkout_pay_button_text_es || undefined,
    checkoutCheckButtonText: row.checkout_check_button_text || undefined,
    checkoutCheckButtonTextEn: row.checkout_check_button_text_en || undefined,
    checkoutCheckButtonTextEs: row.checkout_check_button_text_es || undefined,
    checkoutShowCheckButton:
      row.checkout_show_check_button === undefined || row.checkout_show_check_button === null
        ? true
        : !!row.checkout_show_check_button,
  };
}

/** JSON {papel: cor} → paleta. Conteúdo corrompido vira paleta vazia (tudo na
 *  cor padrão) em vez de derrubar o carregamento do bot inteiro. */
function parseButtonStyles(raw: unknown): ButtonStyles {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    return sanitizeButtonStyles(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** JSON de ids da Galeria → lista. Conteúdo corrompido vira lista vazia em vez
 *  de derrubar o carregamento do bot inteiro. */
function parseIds(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : undefined;
  } catch {
    return undefined;
  }
}

export function getBotConfigByProfile(profileId: string): TelegramBotConfig | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_bots WHERE profile_id = ?")
    .get(profileId) as any;
  return row ? toBotConfig(row) : null;
}

export function getBotConfig(id: string): TelegramBotConfig | null {
  const row = getDb().prepare("SELECT * FROM telegram_bots WHERE id = ?").get(id) as any;
  return row ? toBotConfig(row) : null;
}

export function saveBotConfig(config: Omit<TelegramBotConfig, "id"> & { id?: string }): TelegramBotConfig {
  const db = getDb();
  const id = config.id || Math.random().toString(36).substring(2, 15);
  const now = Date.now();
  db.prepare(
    `INSERT INTO telegram_bots (id, profile_id, bot_token, bot_username, id_vip, id_aquecimento, id_registro, support_username, welcome_message, welcome_media_tags, success_message, success_message_en, success_message_es, downsell_funnel, upsell_funnel, previews_welcome_message, operation_active, vip_approval_mode, previas_approval_mode, pix_generating_message, pix_caption, success_button_text, welcome_media_ids, welcome_media_mode, pix_social_proof, pix_social_proof_text, pix_audio_url, pix_btn_check, pix_btn_qr, pix_btn_copy, pix_not_paid_message, previas_welcome_funnel, vip_welcome_funnel, pix_downsell_funnel, downsell_enabled, pix_downsell_enabled, upsell_enabled, effect_welcome, effect_pix, effect_success, previas_use_welcome, vip_use_welcome, dynamic_price_enabled, dynamic_price_cents, dynamic_price_direction, button_styles, renewal_funnel, renewal_enabled, intl_enabled, intl_ask_first, accept_card_br, welcome_message_en, welcome_message_es, success_button_text_en, success_button_text_es, pix_social_proof_text_en, pix_social_proof_text_es, checkout_generating_message, checkout_pay_button_text, checkout_pay_button_text_en, checkout_pay_button_text_es, checkout_check_button_text, checkout_check_button_text_en, checkout_check_button_text_es, checkout_show_check_button, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       bot_token = excluded.bot_token,
       bot_username = excluded.bot_username,
       id_vip = excluded.id_vip,
       id_aquecimento = excluded.id_aquecimento,
       id_registro = excluded.id_registro,
       support_username = excluded.support_username,
       welcome_message = excluded.welcome_message,
       welcome_media_tags = excluded.welcome_media_tags,
       success_message = excluded.success_message,
       success_message_en = excluded.success_message_en,
       success_message_es = excluded.success_message_es,
       downsell_funnel = excluded.downsell_funnel,
       upsell_funnel = excluded.upsell_funnel,
       previews_welcome_message = excluded.previews_welcome_message,
       operation_active = excluded.operation_active,
       vip_approval_mode = excluded.vip_approval_mode,
       previas_approval_mode = excluded.previas_approval_mode,
       pix_generating_message = excluded.pix_generating_message,
       pix_caption = excluded.pix_caption,
       success_button_text = excluded.success_button_text,
       welcome_media_ids = excluded.welcome_media_ids,
       welcome_media_mode = excluded.welcome_media_mode,
       pix_social_proof = excluded.pix_social_proof,
       pix_social_proof_text = excluded.pix_social_proof_text,
       pix_audio_url = excluded.pix_audio_url,
       pix_btn_check = excluded.pix_btn_check,
       pix_btn_qr = excluded.pix_btn_qr,
       pix_btn_copy = excluded.pix_btn_copy,
       pix_not_paid_message = excluded.pix_not_paid_message,
       previas_welcome_funnel = excluded.previas_welcome_funnel,
       vip_welcome_funnel = excluded.vip_welcome_funnel,
       pix_downsell_funnel = excluded.pix_downsell_funnel,
       downsell_enabled = excluded.downsell_enabled,
       pix_downsell_enabled = excluded.pix_downsell_enabled,
       upsell_enabled = excluded.upsell_enabled,
       effect_welcome = excluded.effect_welcome,
       effect_pix = excluded.effect_pix,
       effect_success = excluded.effect_success,
       previas_use_welcome = excluded.previas_use_welcome,
       vip_use_welcome = excluded.vip_use_welcome,
       dynamic_price_enabled = excluded.dynamic_price_enabled,
       dynamic_price_cents = excluded.dynamic_price_cents,
       dynamic_price_direction = excluded.dynamic_price_direction,
       button_styles = excluded.button_styles,
       renewal_funnel = excluded.renewal_funnel,
       renewal_enabled = excluded.renewal_enabled,
       intl_enabled = excluded.intl_enabled,
       intl_ask_first = excluded.intl_ask_first,
       accept_card_br = excluded.accept_card_br,
       welcome_message_en = excluded.welcome_message_en,
       welcome_message_es = excluded.welcome_message_es,
       success_button_text_en = excluded.success_button_text_en,
       success_button_text_es = excluded.success_button_text_es,
       pix_social_proof_text_en = excluded.pix_social_proof_text_en,
       pix_social_proof_text_es = excluded.pix_social_proof_text_es,
       checkout_generating_message = excluded.checkout_generating_message,
       checkout_pay_button_text = excluded.checkout_pay_button_text,
       checkout_pay_button_text_en = excluded.checkout_pay_button_text_en,
       checkout_pay_button_text_es = excluded.checkout_pay_button_text_es,
       checkout_check_button_text = excluded.checkout_check_button_text,
       checkout_check_button_text_en = excluded.checkout_check_button_text_en,
       checkout_check_button_text_es = excluded.checkout_check_button_text_es,
       checkout_show_check_button = excluded.checkout_show_check_button`
  ).run(
    id,
    config.profileId,
    config.botToken,
    config.botUsername || null,
    config.idVip,
    config.idAquecimento,
    config.idRegistro || null,
    config.supportUsername || null,
    config.welcomeMessage,
    config.welcomeMediaTags || null,
    config.successMessage,
    config.successMessageEn?.trim() || null,
    config.successMessageEs?.trim() || null,
    config.downsellFunnel || null,
    config.upsellFunnel || null,
    config.previewsWelcomeMessage || null,
    config.operationActive ? 1 : 0,
    toApprovalMode(config.vipApprovalMode, "subscribers"),
    toApprovalMode(config.previasApprovalMode, "all"),
    config.pixGeneratingMessage?.trim() || null,
    config.pixCaption?.trim() || null,
    config.successButtonText?.trim() || null,
    config.welcomeMediaIds?.length ? JSON.stringify(config.welcomeMediaIds.slice(0, 10)) : null,
    config.welcomeMediaMode === "separate" ? "separate" : "album",
    config.pixSocialProof ? 1 : 0,
    config.pixSocialProofText?.trim() || null,
    config.pixAudioUrl?.trim() || null,
    config.pixBtnCheck?.trim() || null,
    config.pixBtnQr?.trim() || null,
    config.pixBtnCopy?.trim() || null,
    config.pixNotPaidMessage?.trim() || null,
    config.previasWelcomeFunnel?.trim() || null,
    config.vipWelcomeFunnel?.trim() || null,
    config.pixDownsellFunnel?.trim() || null,
    config.downsellEnabled === false ? 0 : 1,
    config.pixDownsellEnabled === false ? 0 : 1,
    config.upsellEnabled === false ? 0 : 1,
    config.effectWelcome?.trim() || null,
    config.effectPix?.trim() || null,
    config.effectSuccess?.trim() || null,
    config.previasUseWelcome ? 1 : 0,
    config.vipUseWelcome ? 1 : 0,
    config.dynamicPrice?.enabled ? 1 : 0,
    Math.min(Math.max(Math.floor(Number(config.dynamicPrice?.cents) || 9), 1), 100),
    config.dynamicPrice?.direction === "up" || config.dynamicPrice?.direction === "down"
      ? config.dynamicPrice.direction
      : "random",
    config.buttonStyles ? JSON.stringify(sanitizeButtonStyles(config.buttonStyles)) : null,
    config.renewalFunnel?.trim() || null,
    config.renewalEnabled === false ? 0 : 1,
    config.intlEnabled === false ? 0 : 1,
    config.intlAskFirst ? 1 : 0,
    config.acceptCardBr ? 1 : 0,
    config.welcomeMessageEn?.trim() || null,
    config.welcomeMessageEs?.trim() || null,
    config.successButtonTextEn?.trim() || null,
    config.successButtonTextEs?.trim() || null,
    config.pixSocialProofTextEn?.trim() || null,
    config.pixSocialProofTextEs?.trim() || null,
    config.checkoutGeneratingMessage?.trim() || null,
    config.checkoutPayButtonText?.trim() || null,
    config.checkoutPayButtonTextEn?.trim() || null,
    config.checkoutPayButtonTextEs?.trim() || null,
    config.checkoutCheckButtonText?.trim() || null,
    config.checkoutCheckButtonTextEn?.trim() || null,
    config.checkoutCheckButtonTextEs?.trim() || null,
    config.checkoutShowCheckButton === false ? 0 : 1,
    now
  );
  // Lê PELO PERFIL, não pelo `id` que acabou de ser passado. O INSERT resolve
  // conflito por `profile_id`, então quando já existe um bot para o modelo a
  // linha atualizada MANTÉM o id antigo — buscar pelo id novo devolveria null,
  // e o `!` transformaria isso num erro obscuro lá na frente.
  return getBotConfigByProfile(config.profileId)!;
}

export function deleteBotConfig(profileId: string): void {
  getDb().prepare("DELETE FROM telegram_bots WHERE profile_id = ?").run(profileId);
}

/** JSON de botões → lista. Corrompido vira `undefined` em vez de derrubar o
 *  carregamento do bot inteiro. */
function parseButtons(raw: unknown): { text: string; url: string }[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return undefined;
    return v
      .filter((b: any) => b && typeof b.text === "string" && typeof b.url === "string")
      .map((b: any) => ({ text: b.text, url: b.url }));
  } catch {
    return undefined;
  }
}

function toPlan(r: any): TelegramPlan {
  const botoes = parseButtons(r.deliverable_buttons);
  const bumpBotoes = parseButtons(r.bump_deliverable_buttons);
  return {
    id: r.id,
    botId: r.bot_id,
    name: r.name,
    nameEn: r.name_en || undefined,
    priceCents: r.price_cents,
    priceUsdCents: r.price_usd_cents || undefined,
    intlAvailable: r.intl_available === undefined || r.intl_available === null ? true : !!r.intl_available,
    bump: {
      enabled: !!r.bump_enabled,
      name: r.bump_name || "",
      priceCents: r.bump_price_cents || 0,
      text: r.bump_text || "",
      acceptText: r.bump_accept_text || undefined,
      declineText: r.bump_decline_text || undefined,
      mediaIds: parseIds(r.bump_media_ids),
      audioUrl: r.bump_audio_url || undefined,
      deliverable: r.bump_deliverable || undefined,
      deliverableButtons: bumpBotoes?.length ? bumpBotoes : undefined,
    },
    durationDays: r.duration_days,
    kind: r.kind === "package" ? "package" : "subscription",
    deliverable: r.deliverable || undefined,
    sortOrder: r.sort_order ?? 0,
    active: r.active === undefined || r.active === null ? true : !!r.active,
    highlight: r.highlight || undefined,
    deliverableButtons: botoes?.length ? botoes : undefined,
  };
}

/** Todos os planos do bot, na ordem escolhida — inclui os desligados, porque o
 *  PAINEL precisa vê-los. Quem monta os botões do bot usa `listActivePlans`. */
export function listPlans(botId: string): TelegramPlan[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_plans WHERE bot_id = ? ORDER BY sort_order, rowid")
    .all(botId) as any[];
  return rows.map(toPlan);
}

/** Só o que o cliente deve ver no /start e nos funis. */
export function listActivePlans(botId: string): TelegramPlan[] {
  return listPlans(botId).filter((p) => p.active);
}

export function getPlan(id: string): TelegramPlan | null {
  const row = getDb().prepare("SELECT * FROM telegram_plans WHERE id = ?").get(id) as any;
  return row ? toPlan(row) : null;
}

/**
 * Monta as linhas de botão de uma lista de planos — um botão por linha,
 * `callback_data` no formato `<prefix><planId>[_<desconto>]`. Usado nos três
 * lugares que mostram plano pra escolher (PIX no `/start`, PIX no downsell, e
 * o menu internacional da Stripe), pra não duplicar a formatação de preço e
 * cor em cada um.
 *
 * Em `moeda: "USD"` só entram os planos com `priceUsdCents` cadastrado E
 * `intlAvailable !== false` — o preço decide SE é possível vender esse
 * plano lá fora, o interruptor decide se a modelo QUER vender agora.
 */
export function buildPlanKeyboardRows(
  bot: { buttonStyles?: ButtonStyles },
  plans: TelegramPlan[],
  opts: {
    moeda: "BRL" | "USD";
    discountPercent?: number;
    prefix: "buy_plan_" | "buy_intl_" | "buy_card_";
    /** Usa `plan.nameEn` (com fallback pro `name` em PT) no rótulo do botão —
     *  independente da moeda: o cartão no Brasil (`buy_card_`) continua em
     *  BRL, mas pode ser mostrado pra um lead que já está em inglês (ex.: no
     *  downsell traduzido). Padrão: acompanha `moeda === "USD"`. */
    nomeEmIngles?: boolean;
  },
): { text: string; callback_data: string; style?: string }[][] {
  const relevantes =
    opts.moeda === "USD"
      ? plans.filter((p) => (p.priceUsdCents || 0) > 0 && p.intlAvailable !== false)
      : plans;
  const sufixo = opts.discountPercent && opts.discountPercent > 0 ? `_${opts.discountPercent}` : "";
  const emIngles = opts.nomeEmIngles ?? opts.moeda === "USD";
  return relevantes.map((plan) => {
    const cents = opts.moeda === "USD" ? plan.priceUsdCents! : plan.priceCents;
    const priceStr = (cents / 100).toLocaleString(opts.moeda === "USD" ? "en-US" : "pt-BR", {
      style: "currency",
      currency: opts.moeda,
    });
    const nome = emIngles ? plan.nameEn?.trim() || plan.name : plan.name;
    return [
      {
        text: `${nome} - ${priceStr}`,
        callback_data: `${opts.prefix}${plan.id}${sufixo}`,
        ...planButtonStyleProps(bot, plan.highlight),
      },
    ];
  });
}

export function savePlan(plan: TelegramPlan): void {
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO telegram_plans (id, bot_id, name, name_en, price_cents, price_usd_cents, intl_available, duration_days, kind, deliverable, sort_order, active, highlight, deliverable_buttons, bump_enabled, bump_name, bump_price_cents, bump_text, bump_accept_text, bump_decline_text, bump_media_ids, bump_audio_url, bump_deliverable, bump_deliverable_buttons, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       name_en = excluded.name_en,
       price_cents = excluded.price_cents,
       price_usd_cents = excluded.price_usd_cents,
       intl_available = excluded.intl_available,
       duration_days = excluded.duration_days,
       kind = excluded.kind,
       deliverable = excluded.deliverable,
       sort_order = excluded.sort_order,
       active = excluded.active,
       highlight = excluded.highlight,
       deliverable_buttons = excluded.deliverable_buttons,
       bump_enabled = excluded.bump_enabled,
       bump_name = excluded.bump_name,
       bump_price_cents = excluded.bump_price_cents,
       bump_text = excluded.bump_text,
       bump_accept_text = excluded.bump_accept_text,
       bump_decline_text = excluded.bump_decline_text,
       bump_media_ids = excluded.bump_media_ids,
       bump_audio_url = excluded.bump_audio_url,
       bump_deliverable = excluded.bump_deliverable,
       bump_deliverable_buttons = excluded.bump_deliverable_buttons`
  ).run(
    plan.id,
    plan.botId,
    plan.name,
    plan.nameEn?.trim() || null,
    plan.priceCents,
    plan.priceUsdCents && plan.priceUsdCents > 0 ? Math.round(plan.priceUsdCents) : null,
    plan.intlAvailable === false ? 0 : 1,
    Math.max(0, Math.round(plan.durationDays) || 0),
    plan.kind || "subscription",
    plan.deliverable || null,
    plan.sortOrder ?? 0,
    plan.active === false ? 0 : 1,
    plan.highlight || null,
    plan.deliverableButtons?.length ? JSON.stringify(plan.deliverableButtons.slice(0, 6)) : null,
    plan.bump?.enabled ? 1 : 0,
    plan.bump?.name?.trim() || null,
    Math.max(0, Math.round(plan.bump?.priceCents || 0)),
    plan.bump?.text?.trim() || null,
    plan.bump?.acceptText?.trim() || null,
    plan.bump?.declineText?.trim() || null,
    plan.bump?.mediaIds?.length ? JSON.stringify(plan.bump.mediaIds.slice(0, 10)) : null,
    plan.bump?.audioUrl?.trim() || null,
    plan.bump?.deliverable?.trim() || null,
    plan.bump?.deliverableButtons?.length
      ? JSON.stringify(plan.bump.deliverableButtons.slice(0, 6))
      : null,
    now,
  );
}

/**
 * Quantas vendas PAGAS cada plano fez e quanto trouxe, em UMA consulta para o
 * bot inteiro — a lista de planos precisa disso para todos de uma vez.
 *
 * Passa por `telegram_subscriptions` (que guarda o plano comprado) e cruza com
 * `transactions` (que guarda o dinheiro e o status). É a mesma origem do painel
 * financeiro, então os números batem com o resto do sistema.
 */
export function planSalesStats(botId: string): Map<string, { count: number; cents: number }> {
  const rows = getDb()
    .prepare(
      `SELECT s.plan_id AS planId, COUNT(*) AS c, SUM(t.amount_cents) AS cents
         FROM telegram_subscriptions s
         JOIN transactions t ON t.id = s.transaction_id
        WHERE s.bot_id = ? AND s.plan_id IS NOT NULL AND t.status = 'paid'
        GROUP BY s.plan_id`,
    )
    .all(botId) as { planId: string; c: number; cents: number | null }[];
  const out = new Map<string, { count: number; cents: number }>();
  for (const r of rows) out.set(r.planId, { count: r.c, cents: r.cents || 0 });
  return out;
}

export function deletePlan(id: string): void {
  getDb().prepare("DELETE FROM telegram_plans WHERE id = ?").run(id);
}

function toSubscription(r: any): TelegramSubscription {
  return {
    id: r.id,
    botId: r.bot_id,
    transactionId: r.transaction_id || undefined,
    planId: r.plan_id || undefined,
    offerId: r.offer_id || undefined,
    telegramUserId: r.telegram_user_id,
    telegramUsername: r.telegram_username || undefined,
    inviteLink: r.invite_link || undefined,
    status: r.status,
    expiresAt: r.expires_at,
    lastUpsellAt: r.last_upsell_at || undefined,
    upsellStepIndex: r.upsell_step_index,
    createdAt: r.created_at,
    pixCode: r.pix_code || undefined,
    bumpCents: r.bump_cents || 0,
    pixStepIndex: r.pix_step_index || 0,
    lastPixStepAt: r.last_pix_step_at || undefined,
    renewalStepIndex: r.renewal_step_index || 0,
    stripeSubscriptionId: r.stripe_subscription_id || undefined,
    stripeCustomerId: r.stripe_customer_id || undefined,
  };
}

export function listSubscriptions(botId: string): TelegramSubscription[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_subscriptions WHERE bot_id = ? ORDER BY created_at DESC")
    .all(botId) as any[];
  return rows.map(toSubscription);
}

export function getSubscription(id: string): TelegramSubscription | null {
  const row = getDb().prepare("SELECT * FROM telegram_subscriptions WHERE id = ?").get(id) as any;
  return row ? toSubscription(row) : null;
}

export function findActiveSubscription(botId: string, telegramUserId: number): TelegramSubscription | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM telegram_subscriptions WHERE bot_id = ? AND telegram_user_id = ? AND status = 'active'"
    )
    .get(botId, telegramUserId) as any;
  return row ? toSubscription(row) : null;
}

/** PIX gerado e ainda não pago — usado pelo Downsell geral pra saber quando
 *  PARAR de mandar mensagem pra alguém que já passou a ser cuidado pelo
 *  Downsell de PIX gerado. */
export function findPendingSubscription(botId: string, telegramUserId: number): TelegramSubscription | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM telegram_subscriptions WHERE bot_id = ? AND telegram_user_id = ? AND status = 'pending'"
    )
    .get(botId, telegramUserId) as any;
  return row ? toSubscription(row) : null;
}

/**
 * Dá /start de novo com um PIX pendente na mão: aquele PIX vira "abandoned",
 * nunca mais "pending" — chamado a CADA /start, pra o lead recomeçar 100%
 * novo (Downsell geral E Downsell de cobrança nunca correm juntos, um
 * recomeço nunca herda o funil da tentativa anterior). A linha em si NUNCA é
 * apagada: se esse PIX velho for pago do nada, `deliverPaidTransaction`
 * ainda entrega (aceita "pending" OU "abandoned"), só que sem gerar nenhuma
 * mensagem nova de cobrança daqui pra frente.
 */
export function abandonPendingSubscriptions(botId: string, telegramUserId: number): void {
  getDb()
    .prepare(
      "UPDATE telegram_subscriptions SET status = 'abandoned' WHERE bot_id = ? AND telegram_user_id = ? AND status = 'pending'",
    )
    .run(botId, telegramUserId);
}

/** Quantos assinantes ativos o bot tem AGORA (alimenta a prova social real).
 *  `expires_at > 0` exclui os pacotes de compra única, que ficam "active" com
 *  expiração zero e não são assinantes. */
export function countActiveSubscriptions(botId: string): number {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) c FROM telegram_subscriptions
        WHERE bot_id = ? AND status = 'active' AND expires_at > ?`,
    )
    .get(botId, Date.now()) as { c: number };
  return r?.c || 0;
}

export function findSubscriptionByTransaction(transactionId: string): TelegramSubscription | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_subscriptions WHERE transaction_id = ?")
    .get(transactionId) as any;
  return row ? toSubscription(row) : null;
}

/** Acha a inscrição local pela Subscription da Stripe — é assim que o
 *  webhook de renovação (`invoice.paid`) sabe qual acesso estender quando a
 *  Stripe cobra um novo ciclo sozinha, sem o lead voltar a falar com o bot. */
export function findSubscriptionByStripeSubscriptionId(
  stripeSubscriptionId: string,
): TelegramSubscription | null {
  const row = getDb()
    .prepare("SELECT * FROM telegram_subscriptions WHERE stripe_subscription_id = ?")
    .get(stripeSubscriptionId) as any;
  return row ? toSubscription(row) : null;
}

export function saveSubscription(sub: TelegramSubscription): void {
  getDb().prepare(
    `INSERT INTO telegram_subscriptions (id, bot_id, transaction_id, plan_id, offer_id, telegram_user_id, telegram_username, invite_link, status, expires_at, last_upsell_at, upsell_step_index, created_at, pix_code, bump_cents, pix_step_index, last_pix_step_at, renewal_step_index, stripe_subscription_id, stripe_customer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       expires_at = excluded.expires_at,
       invite_link = excluded.invite_link,
       telegram_username = excluded.telegram_username,
       last_upsell_at = excluded.last_upsell_at,
       upsell_step_index = excluded.upsell_step_index,
       plan_id = excluded.plan_id,
       offer_id = excluded.offer_id,
       pix_code = excluded.pix_code,
       bump_cents = excluded.bump_cents,
       pix_step_index = excluded.pix_step_index,
       last_pix_step_at = excluded.last_pix_step_at,
       renewal_step_index = excluded.renewal_step_index,
       stripe_subscription_id = excluded.stripe_subscription_id,
       stripe_customer_id = excluded.stripe_customer_id`
  ).run(
    sub.id,
    sub.botId,
    sub.transactionId || null,
    sub.planId || null,
    sub.offerId || null,
    sub.telegramUserId,
    sub.telegramUsername || null,
    sub.inviteLink || null,
    sub.status,
    sub.expiresAt,
    sub.lastUpsellAt || null,
    sub.upsellStepIndex,
    sub.createdAt,
    sub.pixCode || null,
    Math.max(0, Math.round(sub.bumpCents || 0)),
    Math.max(0, Math.round(sub.pixStepIndex || 0)),
    sub.lastPixStepAt || null,
    Math.max(0, Math.round(sub.renewalStepIndex || 0)),
    sub.stripeSubscriptionId || null,
    sub.stripeCustomerId || null,
  );
}

// ---- Botões Personalizados ----
export type CustomButton = {
  id: string;
  botId: string;
  text: string;
  url: string;
  sortOrder: number;
};

export function listCustomButtons(botId: string): CustomButton[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_custom_buttons WHERE bot_id = ? ORDER BY sort_order")
    .all(botId) as any[];
  return rows.map((r) => ({
    id: r.id,
    botId: r.bot_id,
    text: r.text,
    url: r.url,
    sortOrder: r.sort_order,
  }));
}

export function saveCustomButton(btn: CustomButton): void {
  getDb().prepare(
    `INSERT INTO telegram_custom_buttons (id, bot_id, text, url, sort_order)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       text = excluded.text,
       url = excluded.url,
       sort_order = excluded.sort_order`
  ).run(btn.id, btn.botId, btn.text, btn.url, btn.sortOrder);
}

export function deleteCustomButton(id: string): void {
  getDb().prepare("DELETE FROM telegram_custom_buttons WHERE id = ?").run(id);
}

// ---- Chats que o bot já viu (alimenta o botão "Detectar") ----
export type SeenChat = { chatId: string; title?: string; type?: string; lastSeenAt: number };

/**
 * Anota um chat que apareceu num update. Só GRUPOS e CANAIS interessam — o
 * privado do lead não é candidato a "grupo VIP" e só poluiria a lista.
 *
 * O título é atualizado a cada visita (grupos são renomeados), mas nunca
 * apagado por um update que venha sem ele.
 */
export function recordSeenChat(
  botId: string,
  chat: { id?: number | string; title?: string; type?: string } | undefined,
): void {
  if (!chat?.id || !chat.type || chat.type === "private") return;
  getDb()
    .prepare(
      `INSERT INTO telegram_seen_chats (bot_id, chat_id, title, type, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bot_id, chat_id) DO UPDATE SET
         title = COALESCE(excluded.title, telegram_seen_chats.title),
         type = excluded.type,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(botId, String(chat.id), chat.title || null, chat.type, Date.now());
}

/**
 * IDEMPOTÊNCIA DO WEBHOOK — marca este `update_id` como processado e devolve
 * `true` se era a PRIMEIRA vez (o chamador deve seguir com o processamento);
 * `false` se já tinha sido visto antes (o chamador deve responder 200 e não
 * fazer nada de novo). `INSERT OR IGNORE` é atômico: mesmo duas requisições
 * concorrentes pro MESMO update (reenvio do Telegram chegando quase junto)
 * nunca passam as duas — só a que grava primeiro ganha `changes > 0`.
 *
 * Sem `updateId` (update sem o campo, nunca deveria acontecer de verdade),
 * deixa passar — mais seguro processar de mais do que travar o bot inteiro
 * por um formato inesperado.
 */
export function primeiraVezQueVejoEsteUpdate(botId: string, updateId: unknown): boolean {
  const id = Number(updateId);
  if (!Number.isFinite(id)) return true;
  const info = getDb()
    .prepare(`INSERT OR IGNORE INTO telegram_webhook_updates (bot_id, update_id, created_at) VALUES (?, ?, ?)`)
    .run(botId, id, Date.now());
  return info.changes > 0;
}

/** Faxina dos updates antigos — chamada uma vez por tick do cron de funis
 *  (a cada minuto), não a cada webhook. Só precisa reter updates recentes o
 *  bastante pra cobrir o reenvio do Telegram, que acontece em minutos, não
 *  em dias. */
export function limparUpdatesAntigos(maxIdadeMs = 24 * 60 * 60 * 1000): void {
  getDb().prepare(`DELETE FROM telegram_webhook_updates WHERE created_at < ?`).run(Date.now() - maxIdadeMs);
}

/** Canais/grupos que o MONITOR já consultou. Fonte extra para o "Detectar":
 *  ele roda com a operação desligada, então às vezes sabe de um chat que o
 *  webhook nunca viu. */
export function listMonitoredChats(botId: string): { chatId: string; title?: string }[] {
  const rows = getDb()
    .prepare("SELECT chat_id, title FROM telegram_group_stats WHERE bot_id = ?")
    .all(botId) as { chat_id: string; title: string | null }[];
  return rows.map((r) => ({ chatId: r.chat_id, title: r.title || undefined }));
}

export function listSeenChats(botId: string): SeenChat[] {
  const rows = getDb()
    .prepare("SELECT * FROM telegram_seen_chats WHERE bot_id = ? ORDER BY last_seen_at DESC")
    .all(botId) as any[];
  return rows.map((r) => ({
    chatId: r.chat_id,
    title: r.title || undefined,
    type: r.type || undefined,
    lastSeenAt: r.last_seen_at,
  }));
}

// ---- Leads (Downsell Remarketing) ----
export type TelegramLead = {
  id: string; // bot_id + chat_id
  profileId: string;
  chatId: string;
  lastInteractionAt: number;
  downsellStepIndex: number;
  createdAt: number;
  /** Início do funil de Downsell geral — reinicia a CADA /start (diferente
   *  de `createdAt`, que é o primeiro contato pra sempre). Ausente = lead
   *  gravado antes desta coluna existir; quem lê cai pra `createdAt`. */
  downsellStartedAt?: number;
  /** Código do deep-link que trouxe o lead (t.me/bot?start=CODIGO). */
  sourceCode?: string;
};

export function upsertTelegramLead(lead: TelegramLead): void {
  // O código de origem só é gravado na PRIMEIRA vez: se o mesmo lead voltar a
  // dar /start por outro link, a atribuição continua sendo do que o trouxe.
  getDb().prepare(
    `INSERT INTO telegram_leads (id, profile_id, chat_id, last_interaction_at, downsell_step_index, created_at, downsell_started_at, source_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_interaction_at = excluded.last_interaction_at,
       downsell_step_index = excluded.downsell_step_index,
       -- Só troca quando quem chamou de fato mandou um valor novo (o /start
       -- manda; os dois pontos do cron que só persistem o avanço do índice
       -- não mandam, e aí o que já estava salvo continua valendo).
       downsell_started_at = COALESCE(excluded.downsell_started_at, telegram_leads.downsell_started_at),
       source_code = COALESCE(telegram_leads.source_code, excluded.source_code)`
  ).run(
    lead.id, lead.profileId, lead.chatId, lead.lastInteractionAt,
    lead.downsellStepIndex, lead.createdAt, lead.downsellStartedAt || null, lead.sourceCode || null,
  );
}

export function getTelegramLead(id: string): TelegramLead | null {
  const row = getDb().prepare("SELECT * FROM telegram_leads WHERE id = ?").get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    chatId: row.chat_id,
    lastInteractionAt: row.last_interaction_at,
    downsellStepIndex: row.downsell_step_index,
    createdAt: row.created_at,
    downsellStartedAt: row.downsell_started_at || undefined,
    sourceCode: row.source_code || undefined,
  };
}

/** Contato do Telegram por trás de cada venda: é o que o webhook do gateway
 *  amarra na inscrição, e o que deixa o painel de pagamentos abrir a conversa
 *  com o lead. Consulta em lote — a tela lista centenas de cobranças. */
export function getTelegramContactsByTransactions(
  transactionIds: string[],
): Map<string, { userId: number; username?: string }> {
  const out = new Map<string, { userId: number; username?: string }>();
  if (transactionIds.length === 0) return out;

  // SQLite tem teto de parâmetros por consulta (999 no padrão antigo), então
  // vai em blocos em vez de um IN gigante.
  const CHUNK = 500;
  for (let i = 0; i < transactionIds.length; i += CHUNK) {
    const chunk = transactionIds.slice(i, i + CHUNK);
    const rows = getDb()
      .prepare(
        `SELECT transaction_id, telegram_user_id, telegram_username
           FROM telegram_subscriptions
          WHERE transaction_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk) as {
      transaction_id: string;
      telegram_user_id: number;
      telegram_username: string | null;
    }[];
    for (const r of rows) {
      if (!r.transaction_id) continue;
      out.set(r.transaction_id, {
        userId: r.telegram_user_id,
        username: r.telegram_username || undefined,
      });
    }
  }
  return out;
}

export function listLeadsForDownsell(): TelegramLead[] {
  const rows = getDb().prepare("SELECT * FROM telegram_leads").all() as any[];
  return rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    chatId: r.chat_id,
    lastInteractionAt: r.last_interaction_at,
    downsellStepIndex: r.downsell_step_index,
    createdAt: r.created_at,
    downsellStartedAt: r.downsell_started_at || undefined,
    sourceCode: r.source_code || undefined,
  }));
}

// ---- Fila da sequência de boas-vindas pós-aprovação ----
export type ApprovalQueueRow = {
  botId: string;
  telegramUserId: number;
  grupo: "vip" | "previas";
  chatId: string;
  approvedAt: number;
  stepIndex: number;
};

/**
 * Põe (ou reinicia) alguém na sequência de boas-vindas de um grupo.
 *
 * `INSERT OR REPLACE` de propósito: se a pessoa sair e entrar de novo, ela
 * recebe a sequência do começo em vez de continuar de onde parou meses atrás.
 */
export function enqueueApproval(row: Omit<ApprovalQueueRow, "stepIndex">): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO telegram_approval_queue
         (bot_id, telegram_user_id, grupo, chat_id, approved_at, step_index)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(row.botId, row.telegramUserId, row.grupo, row.chatId, row.approvedAt);
}

export function listApprovalQueue(): ApprovalQueueRow[] {
  const rows = getDb().prepare("SELECT * FROM telegram_approval_queue").all() as any[];
  return rows.map((r) => ({
    botId: r.bot_id,
    telegramUserId: r.telegram_user_id,
    grupo: r.grupo === "vip" ? "vip" : "previas",
    chatId: r.chat_id,
    approvedAt: r.approved_at,
    stepIndex: r.step_index,
  }));
}

export function advanceApproval(row: ApprovalQueueRow, proximo: number): void {
  getDb()
    .prepare(
      `UPDATE telegram_approval_queue SET step_index = ?
        WHERE bot_id = ? AND telegram_user_id = ? AND grupo = ?`,
    )
    .run(proximo, row.botId, row.telegramUserId, row.grupo);
}

export function dequeueApproval(row: ApprovalQueueRow): void {
  getDb()
    .prepare(
      "DELETE FROM telegram_approval_queue WHERE bot_id = ? AND telegram_user_id = ? AND grupo = ?",
    )
    .run(row.botId, row.telegramUserId, row.grupo);
}
