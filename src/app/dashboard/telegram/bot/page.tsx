"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useConfirm } from "@/hooks/useConfirm";

/** Assinatura do `confirm()` do useConfirm — passada adiante para quem
 *  precisa confirmar antes de uma ação destrutiva (ex.: "Puxar padrão"). */
type ConfirmFn = ReturnType<typeof useConfirm>["confirm"];
import Switch from "@/components/Switch";
import { MoneyInput } from "@/components/MoneyInput";
import {
  IconTelegram,
  IconClose,
  IconRefresh,
  IconMail,
  IconCheck,
  IconPayments,
  IconSend,
  IconPlus,
  IconTrash,
  IconCopy,
  IconUndo,
  IconChevronUp,
  IconChevronDown,
  IconSparkle,
  IconLink,
} from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import SectionRow, { resumo } from "@/components/telegram/bot/SectionRow";
import VarChips from "@/components/telegram/bot/VarChips";
import {
  FunnelPreview,
  SequencePreview,
  type PreviewStyle,
} from "@/components/telegram/bot/BotPreview";
import FormatToolbar from "@/components/telegram/bot/FormatToolbar";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import MessageEditor, { VARS_PADRAO } from "@/components/telegram/bot/MessageEditor";
import DetectChat from "@/components/telegram/bot/DetectChat";
import { DOWNSELL_GERAL_PADRAO, PIX_DOWNSELL_PADRAO } from "@/lib/telegramDownsellPadrao";

// ---- Tipos (espelham telegramDb.ts) ----
type Bot = {
  id: string;
  /** A API nunca devolve o token — só se existe um salvo. */
  hasToken?: boolean;
  botUsername?: string;
  idVip: string;
  idAquecimento: string;
  idRegistro?: string;
  /** Canal de Vendas — terceiro canal, opcional (editado na tela da modelo,
   *  junto do VIP e das Prévias). Recebe um relatório de cada venda aprovada. */
  idVendas?: string;
  supportUsername?: string;
  welcomeMessage: string;
  welcomeMediaTags?: string;
  successMessage: string;
  /** Traduções guardadas (botão "Traduzir") — usadas quando o lead escolheu
   *  esse idioma no menu internacional "Not from Brazil?". */
  successMessageEn?: string;
  successMessageEs?: string;
  downsellFunnel?: string;
  upsellFunnel?: string;
  previewsWelcomeMessage?: string;
  operationActive: boolean;
  vipApprovalMode: ApprovalMode;
  previasApprovalMode: ApprovalMode;
  pixGeneratingMessage?: string;
  pixCaption?: string;
  successButtonText?: string;
  successButtonTextEn?: string;
  successButtonTextEs?: string;
  welcomeMediaIds?: string[];
  welcomeMediaMode: "album" | "separate";
  pixSocialProof: boolean;
  pixSocialProofText?: string;
  pixSocialProofTextEn?: string;
  pixSocialProofTextEs?: string;
  pixAudioUrl?: string;
  pixBtnCheck?: string;
  pixBtnQr?: string;
  pixBtnCopy?: string;
  pixNotPaidMessage?: string;
  previasWelcomeFunnel?: string;
  vipWelcomeFunnel?: string;
  pixDownsellFunnel?: string;
  downsellEnabled?: boolean;
  pixDownsellEnabled?: boolean;
  upsellEnabled?: boolean;
  renewalFunnel?: string;
  renewalEnabled?: boolean;
  effectWelcome?: string;
  effectPix?: string;
  effectSuccess?: string;
  previasUseWelcome?: boolean;
  vipUseWelcome?: boolean;
  dynamicPrice?: DynamicPrice;
  buttonStyles?: ButtonStyles;
  intlEnabled?: boolean;
  /** Pergunta Brasil/International logo no /start, ANTES de mostrar
   *  qualquer coisa — em vez do botão "Not from Brazil?" no meio do funil. */
  intlAskFirst?: boolean;
  /** Mensagem e texto dos 2 botões da pergunta Brasil/International — vazio
   *  cai no texto padrão (bilíngue PT/EN). */
  originGateMessage?: string;
  originGateBtnBr?: string;
  originGateBtnIntl?: string;
  /** Botão extra pro lead brasileiro pagar no cartão (Stripe, em BRL), numa
   *  mensagem em sequência depois dos planos em PIX. */
  acceptCardBr?: boolean;
  /** Boas-vindas do ramo internacional — traduções GRAVADAS (mesmo padrão
   *  de `successMessageEn/Es`). Vazio cai num texto padrão em inglês/espanhol. */
  welcomeMessageEn?: string;
  welcomeMessageEs?: string;
  /** "Gerando cobrança..." do checkout no CARTÃO (Stripe) — separado do texto
   *  do PIX, senão quem paga com cartão via "Aceitar cartão no Brasil" via
   *  "Gerando cobrança PIX..." por engano. */
  checkoutGeneratingMessage?: string;
  /** Botão que abre o link de pagamento (Stripe) — tradução GRAVADA mesmo
   *  padrão dos outros campos *_en/*_es. */
  checkoutPayButtonText?: string;
  checkoutPayButtonTextEn?: string;
  checkoutPayButtonTextEs?: string;
  /** Botão "Verificar status" do MESMO checkout — `checkoutShowCheckButton`
   *  desligado some com ele, ficando só o link de pagamento. */
  checkoutCheckButtonText?: string;
  checkoutCheckButtonTextEn?: string;
  checkoutCheckButtonTextEs?: string;
  checkoutShowCheckButton?: boolean;
  /** Assinatura no cartão renova sozinha por padrão — desligado, vira
   *  sempre avulso, mesmo em plano de assinatura. */
  acceptCardRecurring?: boolean;
};
/** Cores dos botões DESTA modelo (não do painel). O preview usa as mesmas. */
type ButtonStyles = Record<string, "" | "primary" | "success" | "danger">;
type DynamicPrice = { enabled: boolean; cents: number; direction: "up" | "down" | "random" };
type ButtonRoleInfo = { key: string; label: string; hint: string };
type WelcomeStep = {
  delayMinutes: number;
  text: string;
  /** Mídias escolhidas a dedo, na ordem de envio. */
  mediaIds?: string[];
  mediaMode?: "album" | "separate";
  /** Etiquetas — legado. Saiu da tela, o envio ainda lê (lib/telegramSend.ts). */
  mediaTags?: string;
  /** none = sem botão · plans = lista de planos · custom = os daqui de baixo. */
  buttons?: "none" | "plans" | "custom";
  customButtons?: { text: string; url: string }[];
};

/**
 * Botão padrão de quem acabou de entrar nas Prévias.
 *
 * O destino é o PRÓPRIO BOT com deep-link de /start: a mensagem no grupo de
 * prévias não vende, ela puxa a pessoa para a conversa onde a oferta acontece.
 * A URL é montada com o @ da modelo, então cada bot aponta para si mesmo.
 */
const BOTAO_APROVACAO_PADRAO = "😈 VER MEUS CONTEÚDOS";
function linkDoBot(botUsername?: string): string {
  const u = (botUsername || "").replace(/^@/, "").trim();
  return u ? `https://t.me/${u}?start=start` : "";
}
type SeenChat = { chatId: string; title?: string; type?: string };
type ApprovalMode = "subscribers" | "all" | "manual";
type PixDefaults = {
  generatingMessage: string;
  caption: string;
  socialProofText: string;
  btnCheck: string;
  btnQr: string;
  btnCopy: string;
  notPaidMessage: string;
};
type CheckoutDefaults = {
  generatingMessage: string;
  payButton: string;
  checkButton: string;
};
type Plan = {
  id: string;
  name: string;
  /** Nome em inglês — tradução GRAVADA, populada sozinha quando `name` é
   *  salvo. Vazio cai no nome em PT. */
  nameEn?: string;
  priceCents: number;
  /** Preço em USD do MESMO plano, pro botão "Not from Brazil?" (Stripe).
   *  Ausente/0 = não entra na venda internacional. */
  priceUsdCents?: number;
  /** Controle A MAIS (além do preço em USD) pra incluir/excluir este plano
   *  da venda internacional. Padrão true. */
  intlAvailable?: boolean;
  /** 0 = vitalício. */
  durationDays: number;
  kind: "subscription" | "package";
  deliverable?: string;
  sortOrder?: number;
  active?: boolean;
  highlight?: string;
  deliverableButtons?: { text: string; url: string }[];
  sales?: { count: number; cents: number };
  bump?: Bump;
};
type Bump = {
  enabled: boolean;
  name: string;
  priceCents: number;
  text: string;
  acceptText?: string;
  declineText?: string;
  mediaIds?: string[];
  audioUrl?: string;
  deliverable?: string;
  deliverableButtons?: { text: string; url: string }[];
};
const BUMP_VAZIO: Bump = { enabled: false, name: "", priceCents: 0, text: "" };
type CustomButton = { id: string; text: string; url: string; sortOrder: number };
type Sub = {
  id: string;
  telegramUserId: number;
  telegramUsername?: string;
  status: "pending" | "active" | "expired" | "blocked";
  expiresAt: number;
  createdAt: number;
};
type FunnelStep = {
  delayMinutes: number;
  text: string;
  discountPercent?: number;
  /** Quais planos entram no teclado. */
  planMode?: "all" | "subs" | "packages" | "none";
  /** Para quem, dentro do público do funil. */
  audience?: "leads" | "expirados" | "todos";
  /** Mídias escolhidas a dedo, na ordem de envio. */
  mediaIds?: string[];
  mediaMode?: "album" | "separate";
  /** Etiquetas — legado. Saiu da tela, o envio ainda lê (lib/telegramSend.ts). */
  mediaTags?: string;
  isLoop?: boolean;
  /** Horário fixo do dia (ex.: "16:00") — ver o comentário em telegramCron.ts. */
  dailyTime?: string;
  /** "Só a partir do dia seguinte" — evita furar a fila; ver telegramCron.ts. */
  dailyTimeNextDay?: boolean;
};

/** Um botão como o preview desenha. Mesmo formato do BotPreview. */
type Btn = { text: string; kind: "plan" | "custom" | "support"; style?: PreviewStyle };

export default function BotVendasPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  // Modelo escolhida no menu — vale para o painel inteiro.
  const { profileId } = useProfile();
  const [loading, setLoading] = useState(false);

  const [bot, setBot] = useState<Bot | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [buttons, setButtons] = useState<CustomButton[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [pixDefaults, setPixDefaults] = useState<PixDefaults | null>(null);
  const [checkoutDefaults, setCheckoutDefaults] = useState<CheckoutDefaults | null>(null);
  // Passos-modelo do "Puxar padrão" no Alerta de Renovação. Os três gatilhos
  // de Recuperação ainda não têm o deles — nascem vazios até serem definidos.
  const [renewalDefaults, setRenewalDefaults] = useState<FunnelStep[]>([]);
  const [tab, setTab] = useState<TabKey>("config");

  // A mensagem de boas-vindas e as etiquetas vivem AQUI, e não dentro da linha
  // que as edita: o preview à direita precisa acompanhar a digitação, e ele é
  // irmão do formulário, não filho.
  const [welcome, setWelcome] = useState("");
  const [welcomeIds, setWelcomeIds] = useState<string[]>([]);
  const [welcomeMode, setWelcomeMode] = useState<"album" | "separate">("album");
  // Boas-vindas do ramo internacional — tradução GRAVADA (mesmo padrão da
  // mensagem de sucesso), populada sozinha a cada save do texto em PT.
  const [welcomeEn, setWelcomeEn] = useState("");
  // Os 3 interruptores internacionais — moram aqui (não dentro do
  // IntlConfigCard) pelo mesmo motivo: o preview precisa acompanhar o
  // clique antes de salvar.
  const [intlOn, setIntlOn] = useState(true);
  const [askFirstOn, setAskFirstOn] = useState(false);
  // Mensagem e botões da pergunta Brasil/International — mesmo motivo dos 3
  // interruptores acima: o preview precisa mostrar exatamente o que a
  // pessoa está digitando, não o texto padrão fixo.
  const [gateMsg, setGateMsg] = useState("");
  const [gateBtnBr, setGateBtnBr] = useState("");
  const [gateBtnIntl, setGateBtnIntl] = useState("");
  const [cardBrOn, setCardBrOn] = useState(false);
  const [welcomeEs, setWelcomeEs] = useState("");
  // Efeitos de mensagem — editados aqui porque o preview precisa acompanhar.
  const [efeitoWelcome, setEfeitoWelcome] = useState("");
  const [efeitoPix, setEfeitoPix] = useState("");
  const [efeitoSuccess, setEfeitoSuccess] = useState("");

  // TELA DO PIX e MENSAGEM DE APROVAÇÃO — mesmo motivo das boas-vindas: o
  // preview do funil (aba "config") é irmão das linhas que editam cada uma,
  // não filho, e precisa acompanhar a digitação das três juntas.
  const [pixGerando, setPixGerando] = useState("");
  const [pixLegenda, setPixLegenda] = useState("");
  const [pixProva, setPixProva] = useState(false);
  const [pixProvaTexto, setPixProvaTexto] = useState("");
  const [pixProvaTextoEn, setPixProvaTextoEn] = useState("");
  const [pixProvaTextoEs, setPixProvaTextoEs] = useState("");
  const [pixBtnCheck, setPixBtnCheck] = useState("");
  const [pixBtnQr, setPixBtnQr] = useState("");
  const [pixBtnCopy, setPixBtnCopy] = useState("");
  const [pixAudio, setPixAudio] = useState("");
  // Números REAIS de hoje desta modelo — os mesmos 2 que o bot de verdade
  // confere antes de mandar a prova social (webhook: `hoje > 0 || assinantes
  // > 0`). O preview usa os dois pra só mostrar a linha quando o bot de
  // verdade também mostraria, em vez de fingir com números de exemplo.
  const [vendasHojeReal, setVendasHojeReal] = useState(0);
  const [assinantesAtivosReal, setAssinantesAtivosReal] = useState(0);
  // Resposta de "ainda não pago" — lifted pra navegação clicável do preview
  // conseguir mostrar ela quando o lead simulado toca em "Verificar Status"
  // antes do "pagamento" (que no preview é sempre simulado).
  const [pixNaoPago, setPixNaoPago] = useState("");
  // Checkout no CARTÃO (Stripe) — lifted: a navegação clicável do preview
  // simula essa tela também (ramo "pagar no cartão" e o internacional), e o
  // campo em PT também recebe de volta a tradução EN/ES gravada pelo
  // servidor ao salvar, mesmo mecanismo de pixProvaTextoEn/Es acima.
  const [checkoutGerando, setCheckoutGerando] = useState("");
  const [checkoutPay, setCheckoutPay] = useState("");
  const [checkoutPayEn, setCheckoutPayEn] = useState("");
  const [checkoutPayEs, setCheckoutPayEs] = useState("");
  const [checkoutShowCheck, setCheckoutShowCheck] = useState(true);
  const [checkoutCheck, setCheckoutCheck] = useState("");
  const [checkoutCheckEn, setCheckoutCheckEn] = useState("");
  const [checkoutCheckEs, setCheckoutCheckEs] = useState("");
  const [sucessoTexto, setSucessoTexto] = useState("");
  const [sucessoBotao, setSucessoBotao] = useState("");
  // Traduções GUARDADAS da mensagem de sucesso (botão "Traduzir" — fluxo
  // internacional "Not from Brazil?"). Vazio = ainda não traduzida.
  const [sucessoTextoEn, setSucessoTextoEn] = useState("");
  const [sucessoTextoEs, setSucessoTextoEs] = useState("");
  // Texto do botão de acesso, traduzido — a mensagem já traduzia, o botão
  // até aqui saía sempre em português.
  const [sucessoBotaoEn, setSucessoBotaoEn] = useState("");
  const [sucessoBotaoEs, setSucessoBotaoEs] = useState("");
  // Os papéis de botão são fixos do produto; as CORES vêm do bot da modelo.
  const [buttonRoles, setButtonRoles] = useState<ButtonRoleInfo[]>([]);

  // APROVAÇÃO AUTOMÁTICA. Mora aqui pelo mesmo motivo das boas-vindas: o
  // preview do aparelho é irmão do formulário, não filho dele, e precisa
  // acompanhar cada tecla digitada nas sequências.
  const [aprVip, setAprVip] = useState<ApprovalMode>("subscribers");
  const [aprPrevias, setAprPrevias] = useState<ApprovalMode>("all");
  const [seqPrevias, setSeqPrevias] = useState<WelcomeStep[]>([]);
  const [seqVip, setSeqVip] = useState<WelcomeStep[]>([]);
  const [usaPrevias, setUsaPrevias] = useState(false);
  const [usaVip, setUsaVip] = useState(false);
  /** Qual das duas sequências o preview desenha. */
  const [grupoPreview, setGrupoPreview] = useState<"previas" | "vip">("previas");

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const d = await apiGet<{
        bot: Bot | null;
        plans: Plan[];
        customButtons: CustomButton[];
        subscriptions: Sub[];
        pixDefaults: PixDefaults;
        checkoutDefaults: CheckoutDefaults;
        renewalDefaults: FunnelStep[];
        buttonRoles: ButtonRoleInfo[];
        metrics?: { today?: { paidCount?: number } };
        activeSubscriptions?: number;
      }>(`/api/telegram?profileId=${profileId}`);
      setBot(d.bot);
      setVendasHojeReal(d.metrics?.today?.paidCount || 0);
      setAssinantesAtivosReal(d.activeSubscriptions || 0);
      setPlans(d.plans || []);
      setButtons(d.customButtons || []);
      setSubs(d.subscriptions || []);
      setPixDefaults(d.pixDefaults || null);
      setCheckoutDefaults(d.checkoutDefaults || null);
      setRenewalDefaults(d.renewalDefaults || []);
      setWelcome(d.bot?.welcomeMessage || "");
      setWelcomeIds(d.bot?.welcomeMediaIds || []);
      setWelcomeMode(d.bot?.welcomeMediaMode || "album");
      setWelcomeEn(d.bot?.welcomeMessageEn || "");
      setWelcomeEs(d.bot?.welcomeMessageEs || "");
      setIntlOn(d.bot?.intlEnabled !== false);
      setAskFirstOn(Boolean(d.bot?.intlAskFirst));
      setGateMsg(d.bot?.originGateMessage || "");
      setGateBtnBr(d.bot?.originGateBtnBr || "");
      setGateBtnIntl(d.bot?.originGateBtnIntl || "");
      setCardBrOn(Boolean(d.bot?.acceptCardBr));
      setEfeitoWelcome(d.bot?.effectWelcome || "");
      setEfeitoPix(d.bot?.effectPix || "");
      setEfeitoSuccess(d.bot?.effectSuccess || "");
      // O texto padrão entra como VALOR de verdade, não só como placeholder
      // cinza — "Usando o padrão" ficava parecendo campo vazio, e a pessoa só
      // descobria o que ia ser mandado se abrisse a legenda em cinza. Assim já
      // chega preenchido, pronto pra editar por cima se quiser.
      setPixGerando(d.bot?.pixGeneratingMessage || d.pixDefaults?.generatingMessage || "");
      setPixLegenda(d.bot?.pixCaption || d.pixDefaults?.caption || "");
      setPixProva(Boolean(d.bot?.pixSocialProof));
      setPixProvaTexto(d.bot?.pixSocialProofText || d.pixDefaults?.socialProofText || "");
      setPixProvaTextoEn(d.bot?.pixSocialProofTextEn || "");
      setPixProvaTextoEs(d.bot?.pixSocialProofTextEs || "");
      setPixBtnCheck(d.bot?.pixBtnCheck || d.pixDefaults?.btnCheck || "");
      setPixBtnQr(d.bot?.pixBtnQr || d.pixDefaults?.btnQr || "");
      setPixBtnCopy(d.bot?.pixBtnCopy || d.pixDefaults?.btnCopy || "");
      setPixAudio(d.bot?.pixAudioUrl || "");
      setPixNaoPago(d.bot?.pixNotPaidMessage || d.pixDefaults?.notPaidMessage || "");
      setCheckoutGerando(d.bot?.checkoutGeneratingMessage || d.checkoutDefaults?.generatingMessage || "");
      setCheckoutPay(d.bot?.checkoutPayButtonText || d.checkoutDefaults?.payButton || "");
      setCheckoutPayEn(d.bot?.checkoutPayButtonTextEn || "");
      setCheckoutPayEs(d.bot?.checkoutPayButtonTextEs || "");
      setCheckoutShowCheck(d.bot?.checkoutShowCheckButton !== false);
      setCheckoutCheck(d.bot?.checkoutCheckButtonText || d.checkoutDefaults?.checkButton || "");
      setCheckoutCheckEn(d.bot?.checkoutCheckButtonTextEn || "");
      setCheckoutCheckEs(d.bot?.checkoutCheckButtonTextEs || "");
      setSucessoTexto(d.bot?.successMessage || "");
      setSucessoBotao(d.bot?.successButtonText || "");
      setSucessoTextoEn(d.bot?.successMessageEn || "");
      setSucessoTextoEs(d.bot?.successMessageEs || "");
      setSucessoBotaoEn(d.bot?.successButtonTextEn || "");
      setSucessoBotaoEs(d.bot?.successButtonTextEs || "");
      setButtonRoles(d.buttonRoles || []);
      setAprVip(d.bot?.vipApprovalMode || "subscribers");
      setAprPrevias(d.bot?.previasApprovalMode || "all");
      setSeqPrevias(parseSteps(d.bot?.previasWelcomeFunnel));
      setSeqVip(parseSteps(d.bot?.vipWelcomeFunnel));
      setUsaPrevias(Boolean(d.bot?.previasUseWelcome));
      setUsaVip(Boolean(d.bot?.vipUseWelcome));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  // O preview só faz sentido nas abas que mudam o que o lead RECEBE — o /start
  // e as boas-vindas de quem foi aprovado num grupo.
  const mostraPreview = tab === "config" || tab === "planos" || tab === "aprovacao";
  // A cor de cada botão segue a MESMA regra do envio (planButtonStyleProps):
  // a cor do plano manda; sem ela, vale o estilo do papel "plans".
  const CORES_DO_PLANO: ButtonStyles = { green: "success", blue: "primary", red: "danger" };
  const corDo = (v: string | undefined): PreviewStyle => (v as PreviewStyle) || "";
  // Plano ativo com preço em USD cadastrado e liberado pra outras moedas —
  // mesmo critério do /start de verdade. Usa os interruptores AO VIVO
  // (intlOn/askFirstOn), não o `bot` salvo, senão o preview ficaria um
  // clique atrasado do que o operador está configurando agora.
  const planosUsd = plans.filter(
    (p) => p.active !== false && (p.priceUsdCents || 0) > 0 && p.intlAvailable !== false,
  );
  // Ter plano em USD é o único requisito pra existir "ramo internacional" —
  // pergunta upfront (intlAskFirst) e botão "Not from Brazil?" são DOIS
  // caminhos INDEPENDENTES pra chegar nele (ver o comentário do webhook),
  // nenhum depende do outro estar ligado.
  const temPlanoUsd = planosUsd.length > 0;
  // Só o BOTÃO "Not from Brazil?" (meio do funil) depende de `intlOn` — a
  // pergunta upfront e a simulação do ramo intl no preview não.
  const podeMostrarBotaoNotFromBrazil = intlOn && temPlanoUsd;

  const previewButtons = [
    ...plans
      .filter((p) => p.active !== false)
      .map((p) => ({
        text: `${p.name} - ${(p.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        kind: "plan" as const,
        style: corDo((p.highlight && CORES_DO_PLANO[p.highlight]) || bot?.buttonStyles?.plans),
      })),
    // "Not from Brazil?" — some do meio do funil quando o modo bilíngue
    // pergunta lá na frente (ver `intlAskFirst` no webhook): os dois nunca
    // aparecem juntos pro mesmo lead.
    ...(podeMostrarBotaoNotFromBrazil
      ? [{ text: "🌎 Not from Brazil?", kind: "custom" as const, style: corDo(bot?.buttonStyles?.notFromBrazil) }]
      : []),
    ...buttons.map((b) => ({ text: b.text, kind: "custom" as const, style: corDo(bot?.buttonStyles?.redirect) })),
    ...(bot?.supportUsername
      ? [{ text: "💬 Suporte / Dúvidas", kind: "support" as const, style: corDo(bot?.buttonStyles?.support) }]
      : []),
  ];

  // MESMA lista, em USD — o que o lead vê no ramo internacional do preview.
  // Nome em inglês quando cadastrado (aba Planos), senão o nome em PT mesmo
  // (é exatamente o fallback que o bot de verdade usa).
  const previewButtonsUsd = planosUsd.map((p) => ({
    text: `${p.nameEn?.trim() || p.name} - ${((p.priceUsdCents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
    kind: "plan" as const,
    style: corDo((p.highlight && CORES_DO_PLANO[p.highlight]) || bot?.buttonStyles?.plans),
  }));

  // Botão extra "prefere pagar no cartão", em SEQUÊNCIA depois dos planos em
  // PIX — mesmo texto do webhook (`enviarAberturaBrasil`).
  const cardBrBotoes = cardBrOn
    ? [{ text: "💳 Pagar no cartão", kind: "custom" as const, style: corDo(bot?.buttonStyles?.cardBrOffer) }]
    : [];

  // Plano de EXEMPLO para o funil (o primeiro ativo) — é o que substitui
  // {plano} e {valor} na legenda do PIX, igual ao webhook faz de verdade.
  const planoExemplo = plans.find((p) => p.active !== false);
  const planoNome = planoExemplo?.name || "Plano";
  const planoValor = ((planoExemplo?.priceCents ?? 2990) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  // Os três botões da tela do PIX, com o texto real (ou o padrão) e a cor do
  // papel — a mesma regra dos botões do /start.
  const pixButtons = [
    { text: pixBtnCheck.trim() || pixDefaults?.btnCheck || "Verificar Status do Pagamento", kind: "custom" as const, style: corDo(bot?.buttonStyles?.pixCheck) },
    { text: pixBtnQr.trim() || pixDefaults?.btnQr || "Mostrar QR Code", kind: "custom" as const, style: corDo(bot?.buttonStyles?.pixQr) },
    { text: pixBtnCopy.trim() || pixDefaults?.btnCopy || "Copiar Chave Pix", kind: "custom" as const, style: corDo(bot?.buttonStyles?.pixCopy) },
  ];
  const successButtons = [
    { text: sucessoBotao.trim() || "🔒 Acessar Conteúdo", kind: "custom" as const, style: corDo(bot?.buttonStyles?.access) },
  ];

  // ---- Ramo INTERNACIONAL do preview — mesmos fallbacks do webhook de
  // verdade (welcomeEn/Es vazio cai num texto padrão em inglês; mensagem/
  // botão de sucesso vazios caem no texto em PT, igual `deliverPayment.ts`). ----
  const WELCOME_INTL_PADRAO = "Hi {nome}! 🔥 Choose your VIP access below 👇";
  const PROVA_SOCIAL_INTL_PADRAO = "🔥 {vendas_hoje} people joined today · {assinantes} active subscribers";
  const welcomeIntlEfetivo = welcomeEn.trim() || WELCOME_INTL_PADRAO;
  const provaSocialIntlEfetivo = pixProvaTextoEn.trim() || PROVA_SOCIAL_INTL_PADRAO;
  const sucessoTextoIntlEfetivo = sucessoTextoEn.trim() || sucessoTexto;
  const successButtonsIntl = [
    {
      text: sucessoBotaoEn.trim() || sucessoBotao.trim() || "🔒 Access content",
      kind: "custom" as const,
      style: corDo(bot?.buttonStyles?.access),
    },
  ];
  // Trocar de modelo no menu tem que ZERAR `bot` — é o gatilho de
  // `{bot && (...)}` logo abaixo, que desmonta TODOS os cards da aba
  // "config" e das outras abas (Planos, Recuperação, Renovação, Preço
  // dinâmico, Cores dos botões...). Vários desses cards semeiam o próprio
  // estado local a partir das props NA MONTAGEM (`useState(plans...)`,
  // `useState(bot.dynamicPrice...)` etc.) e não re-sincronizam sozinhos se
  // as props mudarem por baixo — sem desmontar, trocar de modelo continuava
  // mostrando os planos/preço/funil da modelo ANTERIOR até a pessoa clicar
  // em algo que forçasse um novo mount. `load()` (efeito de baixo) nunca
  // zera `bot` sozinho de propósito — é o que faz um "Salvar" não resetar a
  // aba de Recuperação escolhida — mas aqui é troca de PERFIL, não save, e
  // esses dois casos precisam de comportamentos diferentes.
  useEffect(() => {
    setBot(null);
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  // Sem modelo escolhida no menu ("Todas"), esta tela não tem o que
  // mostrar: bot, mailing e usuários são sempre de UMA modelo. Antes a tela
  // escolhia a primeira sozinha; com o seletor no menu isso viraria mentira.
  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Bot de vendas" />
        <PrecisaDeModelo oQue="configurar o bot de vendas" />
      </div>
    );
  }

  return (
    <div className="page px-1 py-2">
      {ConfirmDialog}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconTelegram size={22} /> Bot de vendas
          </span>
        }
      />
      <div className="mb-5" />

      {/* Só a carga INICIAL passa pelo spinner/vazio — um "Salvar" chama
          `load()` de novo pra trazer o dado fresco do servidor, e gatear
          isso em `loading` desmontava a tela inteira a cada save (a aba de
          Recuperação selecionada, por exemplo, voltava sempre pra
          "Downsell geral"). `bot` continua populado durante o reload
          (`load()` nunca zera pra null antes do fetch), então basta ele
          existir pra manter o conteúdo montado — o reload só atualiza os
          dados, sem resetar nenhum estado local da tela. */}
      {loading && !bot && (
        <div className="grid place-items-center py-10">
          <div className="h-7 w-7 animate-spin rounded-full border border-white/15 border-t-white" />
        </div>
      )}

      {!loading && !bot && (
        <div className="card p-6 text-center text-sm text-zinc-400">
          Bot ainda não configurado. Em <b>Modelos → editar → Bot do Telegram</b>, salve o{" "}
          <b>Token</b> e os <b>IDs dos canais VIP e Prévias</b>.
        </div>
      )}

      {bot && (
        <div className="space-y-5">
          {/* Abas em vez de uma rolagem com tudo aberto: cada assunto do bot
              ocupa a tela sozinho, e o preview do /start acompanha à direita. */}
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  tab === t.key
                    ? "bg-white/10 font-semibold text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 414px = os 390pt da tela do iPhone mais a moldura. Abaixo disso o
              preview encolheria por falta de espaço, e o ponto dele é ser do
              tamanho do aparelho. */}
          <div className={mostraPreview ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_414px]" : ""}>
            <div className="min-w-0 space-y-3">
              {tab === "config" && (
                <>
                  <WebhookCard profileId={profileId} bot={bot} onSaved={load} />
                  <WelcomeRow
                    profileId={profileId}
                    bot={bot}
                    welcome={welcome}
                    setWelcome={setWelcome}
                    mediaIds={welcomeIds}
                    setMediaIds={setWelcomeIds}
                    mode={welcomeMode}
                    setMode={setWelcomeMode}
                    efeito={efeitoWelcome}
                    setEfeito={setEfeitoWelcome}
                    welcomeEn={welcomeEn}
                    setWelcomeEn={setWelcomeEn}
                    welcomeEs={welcomeEs}
                    setWelcomeEs={setWelcomeEs}
                    onSaved={load}
                  />
                  <IntlConfigCard
                    profileId={profileId}
                    bot={bot}
                    intlOn={intlOn}
                    setIntlOn={setIntlOn}
                    askFirstOn={askFirstOn}
                    setAskFirstOn={setAskFirstOn}
                    gateMsg={gateMsg}
                    setGateMsg={setGateMsg}
                    gateBtnBr={gateBtnBr}
                    setGateBtnBr={setGateBtnBr}
                    gateBtnIntl={gateBtnIntl}
                    setGateBtnIntl={setGateBtnIntl}
                    cardBrOn={cardBrOn}
                    setCardBrOn={setCardBrOn}
                    onSaved={load}
                  />
                  <PixRow
                    profileId={profileId}
                    bot={bot}
                    pixDefaults={pixDefaults}
                    checkoutDefaults={checkoutDefaults}
                    gerando={pixGerando}
                    setGerando={setPixGerando}
                    legenda={pixLegenda}
                    setLegenda={setPixLegenda}
                    prova={pixProva}
                    setProva={setPixProva}
                    provaTexto={pixProvaTexto}
                    setProvaTexto={setPixProvaTexto}
                    provaTextoEn={pixProvaTextoEn}
                    setProvaTextoEn={setPixProvaTextoEn}
                    provaTextoEs={pixProvaTextoEs}
                    setProvaTextoEs={setPixProvaTextoEs}
                    audio={pixAudio}
                    setAudio={setPixAudio}
                    btnCheck={pixBtnCheck}
                    setBtnCheck={setPixBtnCheck}
                    btnQr={pixBtnQr}
                    setBtnQr={setPixBtnQr}
                    btnCopy={pixBtnCopy}
                    setBtnCopy={setPixBtnCopy}
                    naoPago={pixNaoPago}
                    setNaoPago={setPixNaoPago}
                    efeito={efeitoPix}
                    setEfeito={setEfeitoPix}
                    checkoutGerando={checkoutGerando}
                    setCheckoutGerando={setCheckoutGerando}
                    checkoutPay={checkoutPay}
                    setCheckoutPay={setCheckoutPay}
                    checkoutPayEn={checkoutPayEn}
                    setCheckoutPayEn={setCheckoutPayEn}
                    checkoutPayEs={checkoutPayEs}
                    setCheckoutPayEs={setCheckoutPayEs}
                    checkoutShowCheck={checkoutShowCheck}
                    setCheckoutShowCheck={setCheckoutShowCheck}
                    checkoutCheck={checkoutCheck}
                    setCheckoutCheck={setCheckoutCheck}
                    checkoutCheckEn={checkoutCheckEn}
                    setCheckoutCheckEn={setCheckoutCheckEn}
                    checkoutCheckEs={checkoutCheckEs}
                    setCheckoutCheckEs={setCheckoutCheckEs}
                    onSaved={load}
                  />
                  <SuccessRow
                    profileId={profileId}
                    bot={bot}
                    texto={sucessoTexto}
                    setTexto={setSucessoTexto}
                    botao={sucessoBotao}
                    setBotao={setSucessoBotao}
                    textoEn={sucessoTextoEn}
                    setTextoEn={setSucessoTextoEn}
                    textoEs={sucessoTextoEs}
                    setTextoEs={setSucessoTextoEs}
                    botaoEn={sucessoBotaoEn}
                    setBotaoEn={setSucessoBotaoEn}
                    botaoEs={sucessoBotaoEs}
                    setBotaoEs={setSucessoBotaoEs}
                    efeito={efeitoSuccess}
                    setEfeito={setEfeitoSuccess}
                    onSaved={load}
                  />
                  <ExtrasRow profileId={profileId} bot={bot} onSaved={load} />
                  <ButtonsCard profileId={profileId} buttons={buttons} onSaved={load} />
                  {/* Estas duas valem para TODAS as modelos, e mesmo assim
                      moram aqui: é nesta tela que se configura o bot, e mandar
                      o operador para outra página só para escolher uma cor era
                      o motivo de ninguém achá-las. O aviso dentro de cada uma
                      diz o alcance. */}
                  <PrecoDinamicoRow profileId={profileId} bot={bot} onSaved={load} />
                  <CoresBotoesRow
                    profileId={profileId}
                    bot={bot}
                    roles={buttonRoles}
                    onSaved={load}
                  />
                </>
              )}
              {tab === "planos" && (
                <PlansCard profileId={profileId} plans={plans} onSaved={load} />
              )}
              {tab === "recuperacao" && (
                <FunnelCard profileId={profileId} bot={bot} planos={plans} onSaved={load} confirm={confirm} />
              )}
              {tab === "renovacao" && (
                <RenewalCard
                  profileId={profileId}
                  bot={bot}
                  planos={plans}
                  onSaved={load}
                  confirm={confirm}
                  padrao={renewalDefaults}
                />
              )}
              {tab === "aprovacao" && (
                <ApprovalCard
                  profileId={profileId}
                  bot={bot}
                  vip={aprVip}
                  setVip={setAprVip}
                  previas={aprPrevias}
                  setPrevias={setAprPrevias}
                  seqPrevias={seqPrevias}
                  setSeqPrevias={setSeqPrevias}
                  seqVip={seqVip}
                  setSeqVip={setSeqVip}
                  usaPrevias={usaPrevias}
                  setUsaPrevias={setUsaPrevias}
                  usaVip={usaVip}
                  setUsaVip={setUsaVip}
                  onSaved={load}
                />
              )}
            </div>

            {/* O preview da aprovação desenha a CONVERSA de quem acabou de ser
                aprovado; o das outras abas, o /start. É o mesmo aparelho e o
                mesmo seletor — o que muda é a mensagem que se está escrevendo. */}
            {mostraPreview &&
              (tab === "aprovacao" ? (
                <SequencePreview
                  botUsername={bot.botUsername}
                  titulo={grupoPreview === "previas" ? "Entrou nas Prévias" : "Entrou no VIP"}
                  usarBoasVindas={grupoPreview === "previas" ? usaPrevias : usaVip}
                  boasVindas={welcome}
                  boasVindasMedia={welcomeIds}
                  boasVindasModo={welcomeMode}
                  passos={grupoPreview === "previas" ? seqPrevias : seqVip}
                  planos={previewButtons}
                  cabecalho={
                    <div className="mb-2 flex w-full max-w-[300px] gap-1 rounded-lg bg-white/5 p-1">
                      {(
                        [
                          ["previas", "Prévias"],
                          ["vip", "VIP"],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setGrupoPreview(k)}
                          className={`flex-1 rounded-md px-2 py-1 text-xs transition-colors ${
                            grupoPreview === k
                              ? "bg-white/10 font-semibold text-white"
                              : "text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  }
                />
              ) : (
                // O funil inteiro: /start → escolhe o plano → tela do PIX →
                // pagamento confirmado. Mesma prévia nas duas abas que mexem
                // nessa conversa (Planos e Configuração) — o que muda é só o
                // formulário ao lado, a leitura da conversa é sempre a mesma.
                //
                // Sem seletor Brasil/International aqui: com a navegação
                // clicável, o RAMO é uma escolha do lead simulado, feita
                // tocando os botões dentro da conversa (a pergunta, quando
                // `intlAskFirst` está ligado, ou "Not from Brazil?" no meio
                // do funil) — os dois conteúdos (Brasil e internacional) vão
                // prontos por baixo, e o preview decide sozinho qual mostrar
                // conforme o clique, do jeito que o bot de verdade decide.
                <FunnelPreview
                  botUsername={bot.botUsername}
                  welcomeMessage={welcome}
                  welcomeMediaIds={welcomeIds}
                  welcomeMediaMode={welcomeMode}
                  effectWelcome={efeitoWelcome}
                  buttons={previewButtons}
                  planoNome={planoNome}
                  planoValor={planoValor}
                  pixGeneratingMessage={pixGerando}
                  pixCaption={pixLegenda}
                  pixSocialProof={pixProva}
                  pixSocialProofText={pixProvaTexto}
                  vendasHojeReal={vendasHojeReal}
                  assinantesAtivosReal={assinantesAtivosReal}
                  pixButtons={pixButtons}
                  pixAudioUrl={pixAudio}
                  effectPix={efeitoPix}
                  successMessage={sucessoTexto}
                  successButtons={successButtons}
                  effectSuccess={efeitoSuccess}
                  intlAskFirst={askFirstOn && temPlanoUsd}
                  originGateMessage={gateMsg}
                  originGateBtnBr={gateBtnBr}
                  originGateBtnIntl={gateBtnIntl}
                  welcomeMessageIntl={temPlanoUsd ? welcomeIntlEfetivo : undefined}
                  welcomeButtonsIntl={temPlanoUsd ? previewButtonsUsd : undefined}
                  pixSocialProofTextIntl={temPlanoUsd ? provaSocialIntlEfetivo : undefined}
                  successMessageIntl={temPlanoUsd ? sucessoTextoIntlEfetivo : undefined}
                  successButtonsIntl={temPlanoUsd ? successButtonsIntl : undefined}
                  cardBrButtons={cardBrBotoes}
                  originGateStyle={corDo(bot?.buttonStyles?.originGate)}
                  pixCheckStyle={corDo(bot?.buttonStyles?.pixCheck)}
                  checkoutPayStyle={corDo(bot?.buttonStyles?.checkoutPay)}
                  checkoutPayTextoIntl={checkoutPayEn}
                  checkoutCheckTextoIntl={checkoutCheckEn}
                  checkoutShowCheck={checkoutShowCheck}
                  checkoutGerandoBr={checkoutGerando}
                  checkoutPayTextoBr={checkoutPay}
                  checkoutCheckTextoBr={checkoutCheck}
                  notPaidMessage={pixNaoPago}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: "config", label: "Configuração" },
  { key: "planos", label: "Planos" },
  { key: "recuperacao", label: "Recuperação" },
  { key: "renovacao", label: "Alerta de Renovação" },
  { key: "aprovacao", label: "Aprovação Automática" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ---------------------------------------------------------------------------
// Métricas de venda (reaproveita o overview financeiro)
// ---------------------------------------------------------------------------
const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------------------------------------------------------------------------
// Conexão + Webhook
// ---------------------------------------------------------------------------
function WebhookCard({ profileId, bot, onSaved }: { profileId: string; bot: Bot; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [status, setStatus] = useState<
    { matches?: boolean; url?: string; error?: string; tokenRecusado?: boolean } | null
  >(null);
  // Endereço público que este app usaria para receber os updates. Vale a
  // consulta MESMO COM A OPERAÇÃO DESLIGADA: é o que deixa o operador ver que
  // a base está errada antes de tentar ligar e tomar o erro cru do Telegram.
  const [origin, setOrigin] = useState<{ url?: string; problem?: string | null } | null>(null);
  // Saúde dos grupos: o bot é admin onde precisa ser? Sem isso ele não gera o
  // convite do VIP, e a falha só apareceria depois de alguém pagar.
  const [grupos, setGrupos] = useState<
    { rotulo: string; chatId: string; title?: string; ok: boolean; motivo?: string }[] | null
  >(null);

  const active = bot.operationActive;
  // Confirmação antes de LIGAR o controle total — TOMA o bot de qualquer
  // sistema que esteja rodando ele agora. Um clique errado aqui derruba quem
  // estiver operando de verdade.
  const { confirm, ConfirmDialog } = useConfirm();

  const checkGrupos = useCallback(async () => {
    try {
      const r = await apiSend<{ ok: boolean; grupos?: typeof grupos }>("/api/telegram", "POST", {
        action: "group-health",
        profileId,
      });
      setGrupos(r.grupos || null);
    } catch {
      setGrupos(null);
    }
  }, [profileId]);

  const checkOrigin = useCallback(async () => {
    try {
      const r = await apiSend<{ ok: boolean; url?: string; problem?: string | null }>(
        "/api/telegram",
        "POST",
        { action: "webhook-origin", profileId },
      );
      setOrigin({ url: r.url, problem: r.problem });
    } catch {
      setOrigin(null);
    }
  }, [profileId]);

  const checkStatus = useCallback(async () => {
    try {
      const r = await apiSend<{
        ok: boolean;
        info?: { url?: string; last_error_message?: string };
        matches?: boolean;
        message?: string;
        tokenRecusado?: boolean;
      }>("/api/telegram", "POST", { action: "webhook-status", profileId });
      if (r.ok) setStatus({ matches: r.matches, url: r.info?.url, error: r.info?.last_error_message });
      else setStatus({ error: r.message, tokenRecusado: r.tokenRecusado });
    } catch (e) {
      setStatus({ error: e instanceof Error ? e.message : "falha" });
    }
  }, [profileId]);

  useEffect(() => {
    checkOrigin();
  }, [checkOrigin]);

  useEffect(() => {
    checkGrupos();
  }, [checkGrupos]);

  useEffect(() => {
    if (active) checkStatus();
    else setStatus(null);
  }, [checkStatus, active]);

  async function setOperation(next: boolean) {
    // Só confirma ao LIGAR — desligar é sempre a direção segura (devolve o
    // bot pra quem estava com ele).
    if (next) {
      const ok = await confirm({
        title: "Assumir o bot?",
        message:
          "Isso faz o Hot-Dash MANDAR as mensagens deste bot a partir de agora (funil, PIX, aprovação) — " +
          "quem estiver operando ele hoje (outro sistema, ex.: o Bobz) para de receber qualquer coisa " +
          "na hora. Só ligue se a intenção é essa.",
        confirmLabel: "Sim, assumir o bot",
      });
      if (!ok) return;
    }
    setToggling(true);
    try {
      const r = await apiSend<{ ok: boolean; message?: string }>("/api/telegram", "POST", {
        action: "set-operation",
        profileId,
        active: next,
      });
      if (r.ok) {
        showToast(next ? "Operação LIGADA — o Hot-Dash assumiu o bot." : "Operação DESLIGADA — bot liberado.", "success");
        onSaved();
      } else {
        showToast(r.message || "Falha ao alterar a operação.", "error");
        // Falhou ao ligar → o motivo quase sempre é a base pública. Recarrega
        // o diagnóstico para o card explicar o que fazer (o toast some).
        await checkOrigin();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setToggling(false);
    }
  }

  async function register() {
    setBusy(true);
    try {
      const r = await apiSend<{ webhook: { ok: boolean; message?: string } }>("/api/telegram", "POST", {
        action: "register-webhook",
        profileId,
      });
      if (r.webhook.ok) showToast("Webhook reenviado ao Telegram.", "success");
      else showToast(r.webhook.message || "Falha ao registrar webhook.", "error");
      await Promise.all([checkStatus(), checkOrigin()]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Operação do bot</h2>

      {/* Base pública quebrada: o Telegram não tem como alcançar este app, e
          ligar a operação vai falhar. Avisa ANTES, com o que fazer. */}
      {origin?.problem && (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3.5">
          <p className="text-sm font-semibold text-red-300">
            Endereço público não configurado — o webhook não pode ser registrado
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">{origin.problem}</p>
        </div>
      )}

      {/* Liga/desliga da operação (cutover do sistema atual → Hot-Dash): toma
          o bot de qualquer sistema que esteja rodando ele agora, e por isso
          pede confirmação (ver setOperation). */}
      <div
        className={`mt-3 rounded-xl border-2 p-3.5 ${
          active ? "border-emerald-500/40 bg-emerald-500/[0.08]" : "border-amber-500/30 bg-amber-500/[0.04]"
        }`}
      >
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-400">
          Controle total — o Hot-Dash MANDA as mensagens
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">
              {active ? "LIGADO — o Hot-Dash está no comando" : "Desligado"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {active
                ? "O bot recebe leads, gera PIX e aprova entradas pelo Hot-Dash. Ninguém mais manda mensagem por ele."
                : "Ligar isto TOMA o bot na hora de quem estiver operando ele agora (ex.: o Bobz). Desligado, o Hot-Dash não encosta neste bot — só registra as vendas dele pelo Canal de Vendas."}
            </p>
          </div>
          <Switch checked={active} onChange={setOperation} disabled={toggling} ariaLabel="Controle total do bot" />
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Bot" value={bot.botUsername ? `@${bot.botUsername}` : "—"} />
        <Info label="Canal VIP" value={bot.idVip || "—"} />
        <Info label="Canal Prévias" value={bot.idAquecimento || "—"} />
        <Info label="Canal Vendas" value={bot.idVendas || "— (opcional)"} />
      </div>
      {/* Sem ser ADMIN do VIP o bot não gera o convite — e a falha só
          apareceria depois de alguém pagar. Por isso a checagem fica à vista. */}
      {grupos && grupos.some((g) => !g.ok) && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3.5">
          <p className="text-sm font-semibold text-amber-300">
            O bot ainda não consegue operar todos os canais
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-zinc-300">
            {grupos.map((g) => (
              <li key={g.rotulo} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={g.ok ? "text-emerald-400" : "text-amber-400"}>
                  {g.ok ? "✓" : "✕"}
                </span>
                <b>{g.rotulo}</b>
                {g.title && <span className="text-zinc-500">({g.title})</span>}
                {!g.ok && <span className="text-amber-300">— {g.motivo}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
            Promova o bot a <b>administrador</b> nos canais, com <b>convidar por link</b> e{" "} <b>remover
            membros</b>. Sem isso não há convite do VIP nem aprovação.
          </p>
        </div>
      )}

      {origin?.url && (
        <div className="mt-2 panel px-3 py-2">
          <p className="eyebrow">URL do webhook (o Telegram chama este endereço)</p>
          <p
            className={`mt-0.5 break-all font-mono text-xs ${
              origin.problem ? "text-red-300" : "text-zinc-200"
            }`}
          >
            {origin.url}
          </p>
        </div>
      )}

      <p className="mt-2 text-xs text-zinc-500">
        Token e IDs dos canais VIP/Prévias vêm do <b>cadastro da modelo</b> (Modelos → editar). A
        postagem automática funciona independentemente deste liga/desliga.
      </p>

      {active && (
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`chip ${
              status?.tokenRecusado
                ? "text-rose-400"
                : status?.matches
                  ? "text-emerald-400"
                  : "text-amber-400"
            }`}
            title={status?.error || status?.url || ""}
          >
            {status == null
              ? "verificando…"
              : status.tokenRecusado
                ? "token recusado"
                : status.matches
                  ? "webhook ativo"
                  : "webhook pendente"}
          </span>
          <button onClick={register} disabled={busy} className="btn-ghost px-2.5 py-1.5 text-xs">
            <IconRefresh size={14} /> {busy ? "Reenviando..." : "Reenviar webhook"}
          </button>
        </div>
      )}
      {active && status?.error && (
        <p className={`mt-2 text-xs ${status.tokenRecusado ? "text-rose-400" : "text-amber-400"}`}>
          {status.tokenRecusado ? "O bot está parado. " : "Último erro do Telegram: "}
          {status.error}
        </p>
      )}
      {ConfirmDialog}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-3 py-2">
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 truncate font-mono text-xs text-zinc-200">{value}</p>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Mensagens — uma linha colapsada por assunto, no lugar do formulário único
// ---------------------------------------------------------------------------

/** Salva um pedaço das mensagens. A rota preserva o que não for enviado, então
 *  cada linha manda só os seus campos. */
async function salvarMensagens(profileId: string, patch: Record<string, string>) {
  await apiSend("/api/telegram", "POST", { action: "save-bot-messages", profileId, ...patch });
}

/**
 * EFEITO DE MENSAGEM: a animação nativa que o Telegram roda quando a mensagem
 * chega. É do aplicativo, então aqui só dá para escolher qual — o preview
 * marca a escolha com o emoji, mas quem anima é o Telegram.
 *
 * Vale só em CONVERSA PRIVADA, que é onde o bot de vendas fala com o lead o
 * tempo todo. Num grupo o Telegram recusaria a mensagem inteira, por isso o
 * envio reenvia sem o efeito se ele for barrado.
 */
const EFEITOS: { key: string; label: string; emoji: string }[] = [
  { key: "", label: "Sem efeito", emoji: "—" },
  { key: "fire", label: "Fogo", emoji: "🔥" },
  { key: "party", label: "Comemoração", emoji: "🎉" },
  { key: "heart", label: "Coração", emoji: "❤️" },
  { key: "like", label: "Joinha", emoji: "👍" },
  { key: "dislike", label: "Negativo", emoji: "👎" },
  { key: "poop", label: "Cocô", emoji: "💩" },
];

function EfeitoPicker({
  valor,
  onChange,
  hint,
}: {
  valor: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="mt-4">
      <label className="eyebrow block">Efeito de mensagem</label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {EFEITOS.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={() => onChange(e.key)}
            title={e.label}
            className={`rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
              valor === e.key
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-ink-850 text-zinc-400 hover:border-white/20"
            }`}
          >
            {e.emoji} <span className="text-[11px]">{e.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        {hint || "A animação roda quando a mensagem chega. Só funciona no privado."}
      </p>
    </div>
  );
}

/**
 * "Gerar com IA" de uma mensagem AVULSA (sem sequência) — boas-vindas,
 * pagamento aprovado, telas do PIX. Mesmo motor do Downsell
 * (`/api/ai/bot-message`, persona + voz do /start), só que pra campos que
 * não fazem parte de nenhuma escalada de tempo/desconto.
 */
function BotaoGerarMensagem({
  profileId,
  campo,
  rascunho,
  onGerado,
}: {
  profileId: string;
  campo: "welcome" | "success" | "pixGenerating" | "pixCaption" | "pixSocialProof" | "pixNotPaid";
  rascunho?: string;
  onGerado: (texto: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function gerar() {
    setBusy(true);
    try {
      const { text } = await apiSend<{ text: string }>("/api/ai/bot-message", "POST", {
        profileId,
        campo,
        rascunho,
      });
      onGerado(text);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao gerar a mensagem.", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={gerar}
      disabled={busy}
      className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-50"
      title="Gera este texto com IA, usando a persona da modelo e o /start dela como base"
    >
      <IconSparkle size={13} /> {busy ? "Gerando…" : "Gerar com IA"}
    </button>
  );
}

/**
 * "Traduzir" — mesmo padrão do "Gerar com IA" (botão + IA + guarda o
 * resultado), só que traduzindo um texto já escrito em vez de gerar do
 * zero. Usado na mensagem de pagamento aprovado (D.4 do fluxo
 * internacional "Not from Brazil?").
 */
function BotaoTraduzir({
  profileId,
  texto,
  idioma,
  label,
  onTraduzido,
}: {
  profileId: string;
  /** Texto em português a traduzir. */
  texto: string;
  idioma: "en" | "es";
  label: string;
  onTraduzido: (texto: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function traduzir() {
    if (!texto.trim()) {
      showToast("Escreva a mensagem em português antes de traduzir.", "error");
      return;
    }
    setBusy(true);
    try {
      const { text } = await apiSend<{ text: string }>("/api/ai/translate-bot-message", "POST", {
        profileId,
        idioma,
        texto,
      });
      onTraduzido(text);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao traduzir a mensagem.", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={traduzir}
      disabled={busy}
      className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-50"
      title={`Traduz o texto em português acima pra ${idioma === "en" ? "inglês" : "espanhol"} com IA e guarda o resultado`}
    >
      <IconSparkle size={13} /> {busy ? "Traduzindo…" : label}
    </button>
  );
}

function WelcomeRow({
  profileId,
  bot,
  welcome,
  setWelcome,
  mediaIds,
  setMediaIds,
  mode,
  setMode,
  efeito,
  setEfeito,
  welcomeEn,
  setWelcomeEn,
  welcomeEs,
  setWelcomeEs,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  welcome: string;
  setWelcome: (v: string) => void;
  mediaIds: string[];
  setMediaIds: (v: string[]) => void;
  mode: "album" | "separate";
  setMode: (v: "album" | "separate") => void;
  efeito: string;
  setEfeito: (v: string) => void;
  welcomeEn: string;
  setWelcomeEn: (v: string) => void;
  welcomeEs: string;
  setWelcomeEs: (v: string) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-bot-messages",
        profileId,
        welcomeMessage: welcome,
        welcomeMediaIds: mediaIds,
        welcomeMediaMode: mode,
        effectWelcome: efeito,
      });
      showToast("Boas-vindas salvas.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function salvarTraducoes() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-bot-messages",
        profileId,
        welcomeMessageEn: welcomeEn,
        welcomeMessageEs: welcomeEs,
      });
      showToast("Traduções salvas.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionRow
      icon={<IconMail size={16} />}
      title="Mensagem de boas-vindas"
      summary={resumo(bot.welcomeMessage) || "(vazia)"}
      status={bot.welcomeMessage?.trim() ? undefined : { label: "vazia", tone: "warn" }}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="eyebrow block">Texto enviado no /start</label>
        <BotaoGerarMensagem profileId={profileId} campo="welcome" rascunho={welcome} onGerado={setWelcome} />
      </div>
      <div className="mt-1.5">
        <MessageEditor
          profileId={profileId}
          text={welcome}
          onText={setWelcome}
          mediaIds={mediaIds}
          onMediaIds={setMediaIds}
          mode={mode}
          onMode={setMode}
          vars={VARS_PADRAO}
          placeholder="Oi meu amor... use {nome}"
          minHeight={140}
        />
      </div>
      {/* As ETIQUETAS saíram: a mídia da abertura é escolhida a dedo, sempre.
          Sortear significava não saber o que o lead ia ver na primeira tela da
          conversa. O sorteio continua funcionando para quem já tinha etiquetas
          salvas (ver lib/telegramSend.ts), mas não se configura mais aqui. */}

      <EfeitoPicker valor={efeito} onChange={setEfeito} />

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar mensagem"}
      </button>

      {/* Traduções GRAVADAS — populadas sozinhas quando o texto em PT acima é
          salvo (ver `/api/telegram`); a modelo mesmo assim pode ajustar por
          cima. Só entram em jogo pro lead internacional (mesma mídia da
          abertura em PT). */}
      <div className="mt-6 border-t border-white/10 pt-4">
        <p className="eyebrow">tradução (leads internacionais)</p>
        <p className="mt-1 text-xs text-zinc-500">
          Traduz sozinha ao salvar o texto em português. Sem IA configurada, cai no padrão.
        </p>

        <label className="eyebrow mt-3 block">🇬🇧 English</label>
        <textarea
          className="input mt-1.5 min-h-[90px]"
          value={welcomeEn}
          onChange={(e) => setWelcomeEn(e.target.value)}
          placeholder="(padrão em inglês)"
        />

        <label className="eyebrow mt-3 block">🇪🇸 Español</label>
        <textarea
          className="input mt-1.5 min-h-[90px]"
          value={welcomeEs}
          onChange={(e) => setWelcomeEs(e.target.value)}
          placeholder="(padrão em español)"
        />

        <button onClick={salvarTraducoes} disabled={busy} className="btn-ghost mt-3 text-xs">
          {busy ? "Salvando..." : "Salvar traduções"}
        </button>
      </div>
    </SectionRow>
  );
}

/**
 * Configurações internacionais — os 3 interruptores (Not from Brazil?, modo
 * bilíngue, cartão no Brasil) MORAVAM na aba Planos; agora moram aqui, logo
 * abaixo da boas-vindas, como uma categoria própria. "Traduzir tudo" força
 * uma tradução nova (IA, Grok primeiro na fila) de TODO campo traduzível do
 * bot de uma vez — boas-vindas, aprovação, botão de acesso, prova social,
 * nome de cada plano e cada passo dos dois funis de recuperação — em vez de
 * esperar o operador salvar cada um manualmente pra disparar a tradução
 * automática.
 */
function IntlConfigCard({
  profileId,
  bot,
  intlOn,
  setIntlOn,
  askFirstOn,
  setAskFirstOn,
  gateMsg,
  setGateMsg,
  gateBtnBr,
  setGateBtnBr,
  gateBtnIntl,
  setGateBtnIntl,
  cardBrOn,
  setCardBrOn,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  // Os 3 interruptores (e agora a mensagem/botões da pergunta) vivem no
  // componente PAI (não aqui dentro) pelo mesmo motivo da boas-vindas: o
  // preview ao vivo é irmão deste formulário, não filho, e precisa
  // acompanhar a digitação ANTES de salvar.
  intlOn: boolean;
  setIntlOn: (v: boolean) => void;
  askFirstOn: boolean;
  setAskFirstOn: (v: boolean) => void;
  gateMsg: string;
  setGateMsg: (v: string) => void;
  gateBtnBr: string;
  setGateBtnBr: (v: string) => void;
  gateBtnIntl: string;
  setGateBtnIntl: (v: string) => void;
  cardBrOn: boolean;
  setCardBrOn: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [busyTraduzir, setBusyTraduzir] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-intl-config",
        profileId,
        intlEnabled: intlOn,
        intlAskFirst: askFirstOn,
        originGateMessage: gateMsg,
        originGateBtnBr: gateBtnBr,
        originGateBtnIntl: gateBtnIntl,
        acceptCardBr: cardBrOn,
      });
      showToast("Configurações internacionais salvas.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function traduzirTudo() {
    setBusyTraduzir(true);
    try {
      await apiSend("/api/telegram", "POST", { action: "translate-all", profileId });
      showToast("Tudo traduzido — boas-vindas, aprovação, planos e funis atualizados.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao traduzir.", "error");
    } finally {
      setBusyTraduzir(false);
    }
  }

  const resumoTexto = [
    intlOn ? "Not from Brazil? ligado" : null,
    askFirstOn ? "modo bilíngue ligado" : null,
    cardBrOn ? "cartão no Brasil ligado" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SectionRow
      icon={<IconLink size={16} />}
      title="Configurações internacionais"
      summary={resumoTexto || "Tudo desligado (só português/PIX)"}
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-850 p-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">🌎 Botão &quot;Not from Brazil?&quot;</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            Abre o checkout internacional (cartão, Stripe). Precisa de plano com preço em USD (aba Planos).
          </p>
        </div>
        <Switch checked={intlOn} onChange={setIntlOn} ariaLabel='Ativar botão "Not from Brazil?"' />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-850 p-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">🌐 Modo internacional (bilíngue)</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            No <code>/start</code>, escolhe <b>🇧🇷 Brasil</b> ou <b>🌎 International</b> antes de tudo, em
            vez do botão no meio do funil. Requer o interruptor de cima ligado.
          </p>
        </div>
        <Switch checked={askFirstOn} onChange={setAskFirstOn} ariaLabel="Ativar modo internacional bilíngue" />
      </div>

      {askFirstOn && (
        <div className="mt-3 rounded-xl border border-white/10 bg-ink-850 p-3.5">
          <p className="text-sm font-medium text-white">✏️ Mensagem e botões da pergunta</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            O que o lead vê antes de tudo, com o modo bilíngue ligado. Em branco, usa o texto padrão.
          </p>
          <label className="eyebrow mb-1.5 mt-3 block">Mensagem</label>
          <textarea
            className="input min-h-[70px]"
            placeholder={"🌎 Choose your language · Escolha o idioma\n\nWhere are you talking to me from? / De onde você fala comigo?"}
            value={gateMsg}
            onChange={(e) => setGateMsg(e.target.value)}
          />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="eyebrow mb-1.5 block">Botão · Brasil</label>
              <input
                className="input"
                placeholder="🇧🇷 Brasil (Português)"
                value={gateBtnBr}
                onChange={(e) => setGateBtnBr(e.target.value)}
              />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Botão · International</label>
              <input
                className="input"
                placeholder="🌐 International (English)"
                value={gateBtnIntl}
                onChange={(e) => setGateBtnIntl(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-850 p-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">💳 Aceitar cartão no Brasil também</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            Botão extra depois dos planos, pra pagar no cartão em vez de Pix. Requer Stripe conectada.
          </p>
        </div>
        <Switch checked={cardBrOn} onChange={setCardBrOn} ariaLabel="Aceitar cartão no Brasil também" />
      </div>

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar"}
      </button>

      <div className="mt-6 border-t border-white/10 pt-4">
        <p className="eyebrow">tradução automática</p>
        <p className="mt-1 text-xs text-zinc-500">
          Tudo traduz sozinho (EN/ES) ao salvar. O botão abaixo força retraduzir tudo de novo.
        </p>
        <button onClick={traduzirTudo} disabled={busyTraduzir} className="btn-ghost mt-3 text-xs">
          <IconSparkle size={13} /> {busyTraduzir ? "Traduzindo tudo..." : "Traduzir tudo"}
        </button>
      </div>
    </SectionRow>
  );
}

function SuccessRow({
  profileId,
  bot,
  texto,
  setTexto,
  botao,
  setBotao,
  textoEn,
  setTextoEn,
  textoEs,
  setTextoEs,
  botaoEn,
  setBotaoEn,
  botaoEs,
  setBotaoEs,
  efeito,
  setEfeito,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  texto: string;
  setTexto: (v: string) => void;
  botao: string;
  setBotao: (v: string) => void;
  textoEn: string;
  setTextoEn: (v: string) => void;
  textoEs: string;
  setTextoEs: (v: string) => void;
  botaoEn: string;
  setBotaoEn: (v: string) => void;
  botaoEs: string;
  setBotaoEs: (v: string) => void;
  efeito: string;
  setEfeito: (v: string) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [busyTraducao, setBusyTraducao] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Sem {link_vip} escrito no texto, o envio ANEXA o link no fim e sempre põe o
  // botão de acesso — o cliente nunca fica sem caminho para o grupo. Ainda
  // assim o aviso continua, porque o texto sai diferente do que está escrito
  // aqui, e é melhor o operador saber disso antes da primeira venda.
  const semMarcador = !/{link_vip}/i.test(texto);

  // Tradução pode ficar desatualizada se o PT for editado depois — aviso
  // simples, sem re-traduzir sozinho (decisão do plano: só o operador decide
  // quando re-traduzir).
  const traducaoDesatualizada = (t: string) => t.trim() && texto !== bot.successMessage;

  async function save() {
    setBusy(true);
    try {
      await salvarMensagens(profileId, {
        successMessage: texto,
        successButtonText: botao,
        effectSuccess: efeito,
      });
      showToast("Mensagem de aprovação salva.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function salvarTraducoes() {
    setBusyTraducao(true);
    try {
      await salvarMensagens(profileId, {
        successMessageEn: textoEn,
        successMessageEs: textoEs,
        successButtonTextEn: botaoEn,
        successButtonTextEs: botaoEs,
      });
      showToast("Traduções salvas.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusyTraducao(false);
    }
  }

  return (
    <SectionRow
      icon={<IconCheck size={16} />}
      title="Mensagem de pagamento aprovado"
      summary={resumo(bot.successMessage) || "(vazia)"}
      status={semMarcador ? { label: "link anexado no fim", tone: "warn" } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="eyebrow block">Enviada assim que o PIX é confirmado</label>
        <BotaoGerarMensagem profileId={profileId} campo="success" rascunho={texto} onGerado={setTexto} />
      </div>
      <textarea
        ref={areaRef}
        className="input mt-1.5 min-h-[110px]"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <VarChips
        vars={[["{link_vip}", "link de convite do canal VIP, gerado na hora"]]}
        targetRef={areaRef}
        onChange={setTexto}
      />

      <label className="eyebrow mt-4 block">Texto do botão de acesso (opcional)</label>
      <input
        className="input mt-1.5"
        placeholder="🔒 Acessar o VIP"
        value={botao}
        onChange={(e) => setBotao(e.target.value)}
      />
      <p className="mt-1 text-[11px] text-zinc-500">
        Vai sempre. Vazio, sai como &quot;{"🔒 Acessar Conteúdo"}&quot;.
      </p>

      {semMarcador && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-xs text-amber-300">
          Sem <b>{"{link_vip}"}</b>, o link entra no fim da mensagem.
        </p>
      )}

      <EfeitoPicker
        valor={efeito}
        onChange={setEfeito}
        hint="É a única mensagem que o cliente recebe DEPOIS de pagar — vale comemorar."
      />

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar mensagem"}
      </button>

      {/* Traduções — só entram em jogo pra quem clicou "Not from Brazil?" e
          escolheu idioma. Sem tradução salva, esse lead recebe o texto em
          português acima mesmo (comportamento de hoje, sem quebrar nada). */}
      <div className="mt-6 border-t border-white/10 pt-4">
        <p className="eyebrow">tradução (leads internacionais)</p>
        <p className="mt-1 text-xs text-zinc-500">
          Só pra quem escolheu esse idioma. Sem tradução, cai no texto em português.
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="eyebrow block">🇬🇧 English</label>
          <BotaoTraduzir profileId={profileId} texto={texto} idioma="en" label="Traduzir" onTraduzido={setTextoEn} />
        </div>
        <textarea
          className="input mt-1.5 min-h-[90px]"
          value={textoEn}
          onChange={(e) => setTextoEn(e.target.value)}
          placeholder="(sem tradução salva)"
        />
        <input
          className="input mt-1.5"
          placeholder="Texto do botão (EN) — vazio cai no botão em PT"
          value={botaoEn}
          onChange={(e) => setBotaoEn(e.target.value)}
        />
        {traducaoDesatualizada(textoEn) && (
          <p className="mt-1 text-[11px] text-amber-400/80">Tradução pode estar desatualizada.</p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="eyebrow block">🇪🇸 Español</label>
          <BotaoTraduzir profileId={profileId} texto={texto} idioma="es" label="Traduzir" onTraduzido={setTextoEs} />
        </div>
        <textarea
          className="input mt-1.5 min-h-[90px]"
          value={textoEs}
          onChange={(e) => setTextoEs(e.target.value)}
          placeholder="(sem tradução salva)"
        />
        <input
          className="input mt-1.5"
          placeholder="Texto do botão (ES) — vazio cai no botão em PT"
          value={botaoEs}
          onChange={(e) => setBotaoEs(e.target.value)}
        />
        {traducaoDesatualizada(textoEs) && (
          <p className="mt-1 text-[11px] text-amber-400/80">Tradução pode estar desatualizada.</p>
        )}

        <button onClick={salvarTraducoes} disabled={busyTraducao} className="btn-ghost mt-3 text-xs">
          {busyTraducao ? "Salvando..." : "Salvar traduções"}
        </button>
      </div>
    </SectionRow>
  );
}

function PixRow({
  profileId,
  bot,
  pixDefaults,
  checkoutDefaults,
  gerando,
  setGerando,
  legenda,
  setLegenda,
  prova,
  setProva,
  provaTexto,
  setProvaTexto,
  provaTextoEn,
  setProvaTextoEn,
  provaTextoEs,
  setProvaTextoEs,
  audio,
  setAudio,
  btnCheck,
  setBtnCheck,
  btnQr,
  setBtnQr,
  btnCopy,
  setBtnCopy,
  naoPago,
  setNaoPago,
  efeito,
  setEfeito,
  checkoutGerando,
  setCheckoutGerando,
  checkoutPay,
  setCheckoutPay,
  checkoutPayEn,
  setCheckoutPayEn,
  checkoutPayEs,
  setCheckoutPayEs,
  checkoutShowCheck,
  setCheckoutShowCheck,
  checkoutCheck,
  setCheckoutCheck,
  checkoutCheckEn,
  setCheckoutCheckEn,
  checkoutCheckEs,
  setCheckoutCheckEs,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  pixDefaults: PixDefaults | null;
  checkoutDefaults: CheckoutDefaults | null;
  gerando: string;
  setGerando: (v: string) => void;
  legenda: string;
  setLegenda: (v: string) => void;
  prova: boolean;
  setProva: (v: boolean) => void;
  provaTexto: string;
  setProvaTexto: (v: string) => void;
  provaTextoEn: string;
  setProvaTextoEn: (v: string) => void;
  provaTextoEs: string;
  setProvaTextoEs: (v: string) => void;
  audio: string;
  setAudio: (v: string) => void;
  btnCheck: string;
  setBtnCheck: (v: string) => void;
  btnQr: string;
  setBtnQr: (v: string) => void;
  btnCopy: string;
  setBtnCopy: (v: string) => void;
  naoPago: string;
  setNaoPago: (v: string) => void;
  efeito: string;
  setEfeito: (v: string) => void;
  checkoutGerando: string;
  setCheckoutGerando: (v: string) => void;
  checkoutPay: string;
  setCheckoutPay: (v: string) => void;
  checkoutPayEn: string;
  setCheckoutPayEn: (v: string) => void;
  checkoutPayEs: string;
  setCheckoutPayEs: (v: string) => void;
  checkoutShowCheck: boolean;
  setCheckoutShowCheck: (v: boolean) => void;
  checkoutCheck: string;
  setCheckoutCheck: (v: string) => void;
  checkoutCheckEn: string;
  setCheckoutCheckEn: (v: string) => void;
  checkoutCheckEs: string;
  setCheckoutCheckEs: (v: string) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const provaRef = useRef<HTMLTextAreaElement>(null);
  // Não entra no preview (não muda nada visível na conversa), então fica
  // local — sem precisar subir pro componente pai como os campos vizinhos.
  const [cardRecurring, setCardRecurring] = useState(bot.acceptCardRecurring !== false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-pix",
        profileId,
        pixGeneratingMessage: gerando,
        pixCaption: legenda,
        pixSocialProof: prova,
        pixSocialProofText: provaTexto,
        pixSocialProofTextEn: provaTextoEn,
        pixSocialProofTextEs: provaTextoEs,
        pixAudioUrl: audio,
        pixBtnCheck: btnCheck,
        pixBtnQr: btnQr,
        pixBtnCopy: btnCopy,
        pixNotPaidMessage: naoPago,
        effectPix: efeito,
        checkoutGeneratingMessage: checkoutGerando,
        checkoutPayButtonText: checkoutPay,
        checkoutPayButtonTextEn: checkoutPayEn,
        checkoutPayButtonTextEs: checkoutPayEs,
        checkoutCheckButtonText: checkoutCheck,
        checkoutCheckButtonTextEn: checkoutCheckEn,
        checkoutCheckButtonTextEs: checkoutCheckEs,
        checkoutShowCheckButton: checkoutShowCheck,
        acceptCardRecurring: cardRecurring,
      });
      showToast("Tela de pagamento salva.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionRow
      icon={<IconPayments size={16} />}
      title="Tela de pagamento"
      summary={
        bot.pixCaption || bot.pixGeneratingMessage
          ? resumo(bot.pixCaption || bot.pixGeneratingMessage)
          : "Usando os textos padrão"
      }
    >
      <p className="text-xs text-zinc-500">
        O que o lead vê entre clicar no plano e pagar. Vazio usa o texto padrão.
      </p>

      {/* PIX — código copia-e-cola + QR. Nunca aparece pra quem paga no
          cartão (seção própria logo abaixo). */}
      <div className="mt-4 rounded-xl border border-white/10 bg-ink-850 p-3.5">
        <p className="text-sm font-semibold text-white">PIX</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">Copia-e-cola + QR Code.</p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="eyebrow block">Aviso enquanto a cobrança é criada</label>
          <BotaoGerarMensagem profileId={profileId} campo="pixGenerating" rascunho={gerando} onGerado={setGerando} />
        </div>
        <input
          className="input mt-1.5"
          placeholder={pixDefaults?.generatingMessage}
          value={gerando}
          onChange={(e) => setGerando(e.target.value)}
        />

        <div className="mt-4 flex items-center justify-between gap-2">
          <label className="eyebrow block">Legenda do PIX (vai junto do QR Code)</label>
          <BotaoGerarMensagem profileId={profileId} campo="pixCaption" rascunho={legenda} onGerado={setLegenda} />
        </div>
        <textarea
          ref={areaRef}
          className="input mt-1.5 min-h-[140px] font-mono text-xs"
          placeholder={pixDefaults?.caption}
          value={legenda}
          onChange={(e) => setLegenda(e.target.value)}
        />
        <VarChips
          vars={[
            ["{pix_code}", "o código copia-e-cola — sem ele o cliente não tem o que copiar"],
            ["{plano}", "nome do plano ou da oferta comprada"],
            ["{valor}", "valor já com o desconto aplicado"],
          ]}
          targetRef={areaRef}
          onChange={setLegenda}
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Aceita <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;code&gt;</code>. Sem{" "}
          <b>{"{pix_code}"}</b>, o código entra no fim mesmo assim.
        </p>

        <label className="eyebrow mt-4 block">Botões que acompanham o PIX</label>
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className="input text-xs"
            placeholder={pixDefaults?.btnCheck}
            value={btnCheck}
            onChange={(e) => setBtnCheck(e.target.value)}
          />
          <input
            className="input text-xs"
            placeholder={pixDefaults?.btnQr}
            value={btnQr}
            onChange={(e) => setBtnQr(e.target.value)}
          />
          <input
            className="input text-xs"
            placeholder={pixDefaults?.btnCopy}
            value={btnCopy}
            onChange={(e) => setBtnCopy(e.target.value)}
          />
        </div>

        <label className="eyebrow mt-4 block">Áudio do PIX (URL pública .ogg)</label>
        <input
          className="input mt-1.5 font-mono text-xs"
          placeholder="https://... .ogg"
          value={audio}
          onChange={(e) => setAudio(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Vai como voz depois do PIX. Fora de OGG/OPUS, o Telegram entrega como arquivo comum.
        </p>
      </div>

      {/* Checkout no CARTÃO (Stripe) — internacional (plano em USD) ou
          "Aceitar cartão no Brasil" (Configurações internacionais). Link e
          botão de status são SEMPRE deste checkout; o PIX acima nunca passa
          por aqui. */}
      <div className="mt-4 rounded-xl border border-white/10 bg-ink-850 p-3.5">
        <p className="text-sm font-semibold text-white">Checkout no cartão (Stripe)</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
          Depois de escolher plano em dólar ou "pagar no cartão" no Brasil — link, não Pix.
        </p>

        <label className="eyebrow mt-3 block">Aviso enquanto a cobrança é criada</label>
        <input
          className="input mt-1.5"
          placeholder={checkoutDefaults?.generatingMessage}
          value={checkoutGerando}
          onChange={(e) => setCheckoutGerando(e.target.value)}
        />

        <label className="eyebrow mt-3 block">Botão "Pagar" (abre o link)</label>
        <input
          className="input mt-1.5 text-xs"
          placeholder={checkoutDefaults?.payButton}
          value={checkoutPay}
          onChange={(e) => setCheckoutPay(e.target.value)}
        />
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          <input
            className="input text-xs"
            placeholder="🇬🇧 English — vazio cai num padrão em inglês"
            value={checkoutPayEn}
            onChange={(e) => setCheckoutPayEn(e.target.value)}
          />
          <input
            className="input text-xs"
            placeholder="🇪🇸 Español — vazio cai num padrão em español"
            value={checkoutPayEs}
            onChange={(e) => setCheckoutPayEs(e.target.value)}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">Botão "Verificar status"</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Desligado, o cliente fica só com o link de pagamento — sem um segundo botão pra conferir se
              já caiu.
            </p>
          </div>
          <Switch checked={checkoutShowCheck} onChange={setCheckoutShowCheck} ariaLabel='Mostrar botão "Verificar status"' />
        </div>
        {checkoutShowCheck && (
          <>
            <input
              className="input mt-2 text-xs"
              placeholder={checkoutDefaults?.checkButton}
              value={checkoutCheck}
              onChange={(e) => setCheckoutCheck(e.target.value)}
            />
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              <input
                className="input text-xs"
                placeholder="🇬🇧 English — vazio cai num padrão em inglês"
                value={checkoutCheckEn}
                onChange={(e) => setCheckoutCheckEn(e.target.value)}
              />
              <input
                className="input text-xs"
                placeholder="🇪🇸 Español — vazio cai num padrão em español"
                value={checkoutCheckEs}
                onChange={(e) => setCheckoutCheckEs(e.target.value)}
              />
            </div>
          </>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">
          Tradução EN/ES em branco grava sozinha ao salvar. Cor dos botões: "Cores dos botões".
        </p>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">Renovação automática</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Assinatura no cartão cobra sozinha todo ciclo (USD ou BRL). Desligado, vira sempre avulso.
            </p>
          </div>
          <Switch checked={cardRecurring} onChange={setCardRecurring} ariaLabel="Renovação automática no cartão" />
        </div>
      </div>

      {/* Prova social — números REAIS, e só isso. Não existe campo para
          inventar quantidade: é a primeira coisa que o lead vê depois dos
          planos, e um número falso ali é propaganda enganosa por quem
          opera, não pelo painel. */}
      <div className="mt-4 rounded-xl border border-white/10 bg-ink-850 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Prova social</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Última mensagem do <code>/start</code>, com os números <b>reais</b> desta modelo. Só sai quando
              já existe venda hoje ou assinante ativo — sem isso o bot fica calado (não manda "0 pessoas
              hoje"), e o preview ao lado reflete a mesma regra com os números reais de agora.
            </p>
          </div>
          <Switch checked={prova} onChange={setProva} ariaLabel="Prova social" />
        </div>
        {prova && (
          <>
            <div className="mt-3 flex justify-end">
              <BotaoGerarMensagem
                profileId={profileId}
                campo="pixSocialProof"
                rascunho={provaTexto}
                onGerado={setProvaTexto}
              />
            </div>
            <textarea
              ref={provaRef}
              className="input mt-1.5 min-h-[60px]"
              placeholder={PROVA_PADRAO}
              value={provaTexto}
              onChange={(e) => setProvaTexto(e.target.value)}
            />
            <VarChips
              vars={[
                ["{vendas_hoje}", "vendas pagas hoje, do painel financeiro"],
                ["{assinantes}", "assinantes VIP ativos agora"],
              ]}
              targetRef={provaRef}
              onChange={setProvaTexto}
            />

            {/* Tradução GRAVADA — populada sozinha quando o texto acima é
                salvo. Só aparece pro lead internacional. */}
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">tradução (leads internacionais)</p>
              <input
                className="input mt-1.5 text-xs"
                placeholder="🇬🇧 English — vazio cai num padrão em inglês"
                value={provaTextoEn}
                onChange={(e) => setProvaTextoEn(e.target.value)}
              />
              <input
                className="input mt-1.5 text-xs"
                placeholder="🇪🇸 Español — vazio cai num padrão em español"
                value={provaTextoEs}
                onChange={(e) => setProvaTextoEs(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      {/* Compartilhado entre PIX e cartão: os dois botões "Verificar status"
          (o do PIX e o do checkout Stripe) caem no MESMO handler e usam a
          mesma resposta de "ainda não pago"; o efeito de chegada também vale
          pras duas telas — por isso ficam fora dos quadros de cima. */}
      <p className="mt-5 text-[11px] uppercase tracking-wide text-zinc-500">Vale pros dois — PIX e cartão</p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="eyebrow block">Resposta quando o pagamento ainda não consta</label>
        <BotaoGerarMensagem profileId={profileId} campo="pixNotPaid" rascunho={naoPago} onGerado={setNaoPago} />
      </div>
      <textarea
        className="input mt-1.5 min-h-[60px]"
        placeholder={pixDefaults?.notPaidMessage}
        value={naoPago}
        onChange={(e) => setNaoPago(e.target.value)}
      />
      <p className="mt-1 text-[11px] text-zinc-500">
        Ao tocar em <b>Verificar Status</b> sem constar pago ainda. Se já pagou, o bot reenvia o acesso.
      </p>

      <EfeitoPicker
        valor={efeito}
        onChange={setEfeito}
        hint="Marca a chegada da cobrança em vez de ela passar como mais uma mensagem."
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setGerando("");
            setLegenda("");
            setBtnCheck("");
            setBtnQr("");
            setBtnCopy("");
            setNaoPago("");
            setEfeito("");
            setCheckoutGerando("");
            setCheckoutPay("");
            setCheckoutPayEn("");
            setCheckoutPayEs("");
            setCheckoutShowCheck(true);
            setCheckoutCheck("");
            setCheckoutCheckEn("");
            setCheckoutCheckEs("");
          }}
          className="btn-ghost"
        >
          <IconUndo size={14} /> Restaurar padrão
        </button>
      </div>
    </SectionRow>
  );
}

const PROVA_PADRAO = "🔥 {vendas_hoje} pessoa(s) garantiram o acesso hoje.";

function ExtrasRow({ profileId, bot, onSaved }: { profileId: string; bot: Bot; onSaved: () => void }) {
  const [previews, setPreviews] = useState(bot.previewsWelcomeMessage || "");
  const [support, setSupport] = useState(bot.supportUsername || "");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    setBusy(true);
    try {
      await salvarMensagens(profileId, {
        previewsWelcomeMessage: previews,
        supportUsername: support,
      });
      showToast("Salvo.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionRow
      icon={<IconSend size={16} />}
      title="Prévias e suporte"
      summary={
        [
          previews.trim() && "boas-vindas das prévias",
          support.trim() && `suporte ${support}`,
        ]
          .filter(Boolean)
          .join(" · ") || "nada configurado"
      }
    >
      <label className="eyebrow block">Boas-vindas nas prévias (canal grátis)</label>
      <textarea
        ref={areaRef}
        className="input mt-1.5 min-h-[80px]"
        placeholder="Opcional. Enviada no privado do lead quando ele é aprovado nas prévias."
        value={previews}
        onChange={(e) => setPreviews(e.target.value)}
      />
      <VarChips
        vars={VARS_PADRAO}
        targetRef={areaRef}
        onChange={setPreviews}
      />
      <p className="mt-1 text-[11px] text-zinc-500">Só chega se o lead já tiver dado /start.</p>

      <div className="mt-4">
        <label className="eyebrow block">Suporte (@usuário ou link)</label>
        <input className="input mt-1.5" value={support} onChange={(e) => setSupport(e.target.value)} />
        <p className="mt-1 text-[11px] text-zinc-500">Vira um botão no fim do /start.</p>
      </div>

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar"}
      </button>
    </SectionRow>
  );
}

// ---------------------------------------------------------------------------
// Planos / Ofertas
// ---------------------------------------------------------------------------
const PERIODOS: { label: string; days: number }[] = [
  { label: "Semanal", days: 7 },
  { label: "Mensal", days: 30 },
  { label: "Trimestral", days: 90 },
  { label: "Semestral", days: 180 },
  { label: "Anual", days: 365 },
  { label: "Vitalício", days: 0 },
];

function periodoLabel(days: number): string {
  if (days <= 0) return "Vitalício";
  return PERIODOS.find((p) => p.days === days)?.label || `${days} dias`;
}

const CORES: { key: string; label: string; dot: string; ring: string }[] = [
  { key: "", label: "Padrão", dot: "bg-zinc-500", ring: "border-white/10" },
  { key: "green", label: "Verde", dot: "bg-emerald-400", ring: "border-emerald-500/50" },
  { key: "blue", label: "Azul", dot: "bg-indigo-400", ring: "border-indigo-500/50" },
  { key: "red", label: "Vermelho", dot: "bg-red-400", ring: "border-red-500/50" },
];

type PlanRow = {
  id?: string;
  name: string;
  /** Nome em inglês — tradução GRAVADA, populada sozinha quando `name` é
   *  salvo. Vazio cai no nome em PT. */
  nameEn: string;
  price: string;
  priceUsd: string;
  intlAvailable: boolean;
  durationDays: number;
  kind: "subscription" | "package";
  deliverable: string;
  active: boolean;
  highlight: string;
  deliverableButtons: { text: string; url: string }[];
  sales?: { count: number; cents: number };
  bump: Bump;
};

function PlansCard({
  profileId,
  plans,
  onSaved,
}: {
  profileId: string;
  plans: Plan[];
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<PlanRow[]>(
    plans.map((p) => ({
      id: p.id,
      name: p.name,
      nameEn: p.nameEn || "",
      price: (p.priceCents / 100).toFixed(2),
      priceUsd: p.priceUsdCents ? (p.priceUsdCents / 100).toFixed(2) : "",
      intlAvailable: p.intlAvailable !== false,
      durationDays: p.durationDays,
      kind: p.kind || "subscription",
      deliverable: p.deliverable || "",
      active: p.active !== false,
      highlight: p.highlight || "",
      deliverableButtons: p.deliverableButtons || [],
      sales: p.sales,
      bump: p.bump || { ...BUMP_VAZIO },
    })),
  );
  const [aberto, setAberto] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function update(i: number, patch: Partial<PlanRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  /** Move um plano na lista. A POSIÇÃO é a ordem dos botões no /start — é por
   *  isso que ela é salva, e não um campo de número à mostra. */
  function mover(i: number, delta: number) {
    setRows((r) => {
      const j = i + delta;
      if (j < 0 || j >= r.length) return r;
      const copia = [...r];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
    setAberto((a) => (a === i ? i + delta : a === i + delta ? i : a));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = rows
        .map((r) => ({
          id: r.id,
          name: r.name.trim(),
          nameEn: r.nameEn.trim(),
          priceCents: Math.round(parseFloat(r.price.replace(",", ".")) * 100) || 0,
          priceUsdCents: r.priceUsd.trim()
            ? Math.round(parseFloat(r.priceUsd.replace(",", ".")) * 100) || undefined
            : undefined,
          intlAvailable: r.intlAvailable,
          durationDays: r.durationDays,
          kind: r.kind,
          deliverable: r.deliverable.trim() || undefined,
          active: r.active,
          highlight: r.highlight || undefined,
          deliverableButtons: r.deliverableButtons.filter((b) => b.text.trim() && b.url.trim()),
          bump: {
            ...r.bump,
            deliverableButtons: (r.bump.deliverableButtons || []).filter(
              (b) => b.text.trim() && b.url.trim(),
            ),
          },
        }))
        .filter((r) => r.name && r.priceCents > 0);
      const res = await apiSend<{ ok: boolean; plans: Plan[] }>("/api/telegram", "POST", {
        action: "save-plans",
        profileId,
        plans: payload,
      });
      showToast("Ofertas salvas.", "success");
      if (res.plans) {
        setRows(
          res.plans.map((p) => ({
            id: p.id,
            name: p.name,
            nameEn: p.nameEn || "",
            price: (p.priceCents / 100).toFixed(2),
            priceUsd: p.priceUsdCents ? (p.priceUsdCents / 100).toFixed(2) : "",
            intlAvailable: p.intlAvailable !== false,
            durationDays: p.durationDays,
            kind: p.kind || "subscription",
            deliverable: p.deliverable || "",
            active: p.active !== false,
            highlight: p.highlight || "",
            deliverableButtons: p.deliverableButtons || [],
            sales: p.sales,
            bump: p.bump || { ...BUMP_VAZIO },
          })),
        );
      }
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  const assinaturas = rows.filter((r) => r.kind === "subscription").length;
  const pacotes = rows.filter((r) => r.kind === "package").length;

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <p className="text-xs leading-relaxed text-zinc-400">
          <b className="text-white">Assinaturas</b> dão acesso ao VIP por um período (semanal,
          mensal, anual… ou vitalício). <b className="text-white">Pacotes</b> são produtos avulsos,
          fora do VIP — packs, conteúdo especial, chamada. Os dois aparecem juntos para o cliente no{" "}
          <code>/start</code>, na ordem desta lista.
        </p>
        <div className="mt-2 flex gap-4 text-[11px] text-zinc-500">
          <span>
            <b className="text-zinc-300">{assinaturas}</b> assinatura(s)
          </span>
          <span>
            <b className="text-zinc-300">{pacotes}</b> pacote(s)
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => {
          const cor = CORES.find((c) => c.key === r.highlight) || CORES[0];
          const estaAberto = aberto === i;
          return (
            <div
              key={r.id || `novo-${i}`}
              className={`card overflow-hidden border ${estaAberto ? "border-emerald-500/25" : cor.ring} ${
                r.active ? "" : "opacity-55"
              }`}
            >
              {/* Cabeçalho: o que dá para ler sem abrir. */}
              <div className="flex items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setAberto(estaAberto ? null : i)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                    {r.highlight && <span className={`h-2 w-2 shrink-0 rounded-full ${cor.dot}`} />}
                    {r.name || <span className="text-zinc-500">(sem nome)</span>}
                    {r.bump.enabled && (
                      <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                        + bump
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    <span className="text-emerald-400">
                      {money(Math.round(parseFloat(r.price.replace(",", ".")) * 100) || 0)}
                    </span>
                    {" · "}
                    {r.kind === "package" ? "Pacote" : periodoLabel(r.durationDays)}
                    {!r.active && " · desligado"}
                  </p>
                  {r.sales && r.sales.count > 0 && (
                    <span className="mt-1 inline-block rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      {r.sales.count} venda(s) · {money(r.sales.cents)}
                    </span>
                  )}
                </button>

                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => mover(i, -1)}
                    disabled={i === 0}
                    className="grid h-5 w-6 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-white disabled:opacity-25"
                    aria-label="Subir"
                  >
                    <IconChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(i, 1)}
                    disabled={i === rows.length - 1}
                    className="grid h-5 w-6 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-white disabled:opacity-25"
                    aria-label="Descer"
                  >
                    <IconChevronDown size={13} />
                  </button>
                </div>

                {/* Ligar/desligar: some dos botões do bot, mas fica no painel
                    com o histórico de vendas. Antes, tirar do ar era apagar. */}
                <button
                  type="button"
                  onClick={() => update(i, { active: !r.active })}
                  title={r.active ? "Desligar (some do bot)" : "Ligar"}
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                    r.active
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-white/10 text-zinc-600"
                  }`}
                >
                  <IconCheck size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRows((rr) => rr.filter((_, idx) => idx !== i));
                    setAberto(null);
                  }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-500 hover:border-red-500/40 hover:text-red-400"
                  aria-label="Remover"
                >
                  <IconClose size={15} />
                </button>
              </div>

              {estaAberto && (
                <div className="border-t border-white/10 p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_120px_120px]">
                    <input
                      className="input"
                      placeholder="Nome do plano"
                      value={r.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                    <MoneyInput
                      currency="BRL"
                      value={r.price}
                      onChange={(v) => update(i, { price: v })}
                    />
                    <MoneyInput
                      currency="USD"
                      placeholder="opcional"
                      title="Preço em USD — vazio, esse plano não entra no botão &quot;Not from Brazil?&quot; (Stripe)"
                      value={r.priceUsd}
                      onChange={(v) => update(i, { priceUsd: v })}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Preço em USD é opcional — vazio, esse plano não aparece no botão internacional
                    (&quot;Not from Brazil?&quot;, pago via Stripe).
                  </p>
                  <input
                    className="input mt-2 text-xs"
                    placeholder="Nome (EN) — traduz sozinho quando salva, ou edite aqui"
                    value={r.nameEn}
                    onChange={(e) => update(i, { nameEn: e.target.value })}
                  />
                  {r.priceUsd.trim() && (
                    <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={r.intlAvailable}
                        onChange={(e) => update(i, { intlAvailable: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
                      />
                      Disponível pra outras moedas (desmarcado, some do botão internacional mesmo
                      com preço em USD).
                    </label>
                  )}

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      className="input"
                      value={r.kind}
                      onChange={(e) => update(i, { kind: e.target.value as PlanRow["kind"] })}
                    >
                      <option value="subscription">Assinatura (acesso ao VIP)</option>
                      <option value="package">Pacote (produto avulso)</option>
                    </select>
                    {r.kind === "subscription" && (
                      <select
                        className="input"
                        value={String(r.durationDays)}
                        onChange={(e) => update(i, { durationDays: Number(e.target.value) })}
                      >
                        {PERIODOS.map((p) => (
                          <option key={p.label} value={p.days}>
                            {p.label}
                            {p.days > 0 ? ` (${p.days} dias)` : " (não expira)"}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <label className="eyebrow mt-3 block">
                    Entregável · enviado ao pagar{" "}
                    {r.kind === "package" ? "(obrigatório no pacote)" : "(opcional)"}
                  </label>
                  <textarea
                    className="input mt-1.5 min-h-[70px]"
                    placeholder={
                      r.kind === "package"
                        ? "Link ou texto do que o cliente comprou."
                        : "Bônus junto do acesso. Vazio usa só a mensagem de aprovação."
                    }
                    value={r.deliverable}
                    onChange={(e) => update(i, { deliverable: e.target.value })}
                  />

                  <label className="eyebrow mt-3 block">Cor de destaque na lista</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {CORES.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => update(i, { highlight: c.key })}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                          r.highlight === c.key
                            ? `${c.ring} bg-white/5 text-white`
                            : "border-white/10 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                        {c.label}
                      </button>
                    ))}
                  </div>

                  <label className="eyebrow mt-3 block">Botões do entregável</label>
                  <p className="mb-1.5 mt-0.5 text-[11px] text-zinc-500">
                    Vão junto da entrega, clicáveis — em vez do link solto no texto.
                  </p>
                  <div className="space-y-1.5">
                    {r.deliverableButtons.map((b, bi) => (
                      <div key={bi} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          className="input text-xs"
                          placeholder="Texto do botão"
                          value={b.text}
                          onChange={(e) =>
                            update(i, {
                              deliverableButtons: r.deliverableButtons.map((x, xi) =>
                                xi === bi ? { ...x, text: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <input
                          className="input font-mono text-xs"
                          placeholder="https://"
                          value={b.url}
                          onChange={(e) =>
                            update(i, {
                              deliverableButtons: r.deliverableButtons.map((x, xi) =>
                                xi === bi ? { ...x, url: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            update(i, {
                              deliverableButtons: r.deliverableButtons.filter((_, xi) => xi !== bi),
                            })
                          }
                          className="btn-ghost px-2.5"
                          aria-label="Remover botão"
                        >
                          <IconClose size={13} />
                        </button>
                      </div>
                    ))}
                    {r.deliverableButtons.length < 6 && (
                      <button
                        type="button"
                        onClick={() =>
                          update(i, {
                            deliverableButtons: [...r.deliverableButtons, { text: "", url: "" }],
                          })
                        }
                        className="btn-ghost px-2.5 py-1 text-xs"
                      >
                        <IconPlus size={13} /> Botão
                      </button>
                    )}
                  </div>

                  <BumpEditor
                    profileId={profileId}
                    plano={r.name || "este plano"}
                    precoPlano={Math.round(parseFloat(r.price.replace(",", ".")) * 100) || 0}
                    bump={r.bump}
                    setBump={(b) => update(i, { bump: b })}
                  />
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="card p-6 text-center text-sm text-zinc-500">
            Nenhuma oferta ainda. Sem pelo menos uma, o <code>/start</code> sai sem botão de compra.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setRows((r) => [
              ...r,
              {
                name: "",
                nameEn: "",
                price: "",
                priceUsd: "",
                intlAvailable: true,
                durationDays: 30,
                kind: "subscription",
                deliverable: "",
                active: true,
                highlight: "",
                deliverableButtons: [],
                bump: { ...BUMP_VAZIO },
              },
            ]);
            setAberto(rows.length);
          }}
          className="btn-ghost"
        >
          <IconPlus size={14} /> Adicionar oferta
        </button>
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Salvando..." : "Salvar ofertas"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funis (downsell / upsell)
// ---------------------------------------------------------------------------
function parseFunnel(json?: string): FunnelStep[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function FunnelCard({
  profileId,
  bot,
  planos,
  onSaved,
  confirm,
}: {
  profileId: string;
  bot: Bot;
  /** Os planos ativos, para cada passo mostrar o preço já com o desconto. */
  planos: Plan[];
  onSaved: () => void;
  confirm: ConfirmFn;
}) {
  const [downsell, setDownsell] = useState<FunnelStep[]>(parseFunnel(bot.downsellFunnel));
  const [pixDownsell, setPixDownsell] = useState<FunnelStep[]>(parseFunnel(bot.pixDownsellFunnel));
  const [upsell, setUpsell] = useState<FunnelStep[]>(parseFunnel(bot.upsellFunnel));
  const [onDownsell, setOnDownsell] = useState(bot.downsellEnabled !== false);
  const [onPix, setOnPix] = useState(bot.pixDownsellEnabled !== false);
  const [onUpsell, setOnUpsell] = useState(bot.upsellEnabled !== false);
  const [busy, setBusy] = useState(false);
  // Sub-aba: em vez dos três gatilhos empilhados em cartões retráteis, uma
  // fileira igual à das abas principais decide qual sequência aparece embaixo
  // — o LED avisa o estado sem precisar abrir nada.
  const [subTab, setSubTab] = useState<"geral" | "pix" | "upsell">("geral");
  // Sobe a cada "Puxar padrão" — força o FunnelEditor a REMONTAR as linhas
  // (ver o comentário no `key` do map de passos). Sem isso, uma linha que já
  // existia antes de puxar o padrão mantém o <select> de tempo/desconto com
  // o modo (lista/personalizado) calculado da mensagem ANTIGA daquele
  // índice — o texto muda (vem direto da prop), mas o tempo selecionado
  // fica errado, porque aquele estado só é calculado uma vez, no mount.
  const [versaoPadrao, setVersaoPadrao] = useState(0);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-funnels",
        profileId,
        downsellFunnel: JSON.stringify(downsell),
        pixDownsellFunnel: JSON.stringify(pixDownsell),
        upsellFunnel: JSON.stringify(upsell),
        downsellEnabled: onDownsell,
        pixDownsellEnabled: onPix,
        upsellEnabled: onUpsell,
      });
      showToast("Funis salvos.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  // Os três gatilhos, cada um com o que muda entre eles — a sub-aba lê daqui,
  // então adicionar um quarto gatilho um dia é só entrar nesta lista.
  // `padrao` do Downsell geral e do de PIX puxa de `DOWNSELL_GERAL_PADRAO`/
  // `PIX_DOWNSELL_PADRAO` (chega a 50% em 24h, depois alterna hora a hora —
  // ver o comentário de cada constante). Upsell ainda não tem cronograma
  // pronto pro "Puxar padrão" (fica pra uma próxima leva), mas já ganha
  // "Gerar com IA" por mensagem igual aos outros dois. O botão "Puxar
  // padrão" é sempre OPT-IN — nunca substitui sozinho o que a modelo já tem
  // configurado.
  const grupos: {
    key: "geral" | "pix" | "upsell";
    titulo: string;
    resumo: string;
    aviso: string;
    ativo: boolean;
    setAtivo: (v: boolean) => void;
    steps: FunnelStep[];
    setSteps: (s: FunnelStep[]) => void;
    padrao: FunnelStep[];
    /** Só os dois downsells geram mensagem com IA — Upsell fica de fora por
     * ora, combinado. */
    permiteGerarIA?: boolean;
  }[] = [
    {
      key: "geral",
      titulo: "Downsell geral",
      resumo: "Quem deu /start e ainda não comprou",
      aviso: "Tempo de cada mensagem conta a partir do /start (nunca da anterior). Para quando paga ou gera um PIX — daí quem cuida é o Downsell de PIX, abaixo.",
      ativo: onDownsell,
      setAtivo: setOnDownsell,
      steps: downsell,
      setSteps: setDownsell,
      padrao: DOWNSELL_GERAL_PADRAO,
      permiteGerarIA: true,
    },
    {
      key: "pix",
      titulo: "Downsell de PIX gerado",
      resumo: "Quem chegou a gerar o PIX e não pagou",
      aviso: "Já escolheu o plano e viu a cobrança — vale outra conversa e outro desconto. Tempo conta a partir da cobrança gerada, para quando ela é paga.",
      ativo: onPix,
      setAtivo: setOnPix,
      steps: pixDownsell,
      setSteps: setPixDownsell,
      padrao: PIX_DOWNSELL_PADRAO,
      permiteGerarIA: true,
    },
    {
      key: "upsell",
      titulo: "Upsell",
      resumo: "Pós-venda para quem já é assinante",
      aviso: "Conta a partir da confirmação do pagamento. Serve para oferecer o plano maior, um pacote ou a renovação.",
      ativo: onUpsell,
      setAtivo: setOnUpsell,
      steps: upsell,
      setSteps: setUpsell,
      padrao: [],
      permiteGerarIA: true,
    },
  ];
  const atual = grupos.find((g) => g.key === subTab) || grupos[0];

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h2 className="font-display text-lg font-semibold">Recuperação</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Três gatilhos, com sequências separadas. Cada etapa dispara depois do tempo indicado, contado da
          anterior — e <b>para sozinha</b> assim que a
          pessoa muda de estado (pagou, no caso dos downsells).
        </p>
      </div>

      {/* Mesma barra das abas principais, com um LED avisando o estado de
          cada gatilho sem precisar abrir nada. */}
      <div className="flex flex-wrap gap-1.5">
        {grupos.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setSubTab(g.key)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              subTab === g.key
                ? "bg-white/10 font-semibold text-white"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${g.ativo ? "bg-emerald-400" : "bg-zinc-600"}`}
              aria-hidden
            />
            {g.titulo}
          </button>
        ))}
      </div>

      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{atual.titulo}</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {atual.resumo} · {atual.steps.length} mensagem(ns)
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              disabled={atual.padrao.length === 0}
              title={
                atual.padrao.length === 0
                  ? "Ainda sem modelo pronto para este gatilho."
                  : "Substitui as mensagens atuais pelo modelo pronto."
              }
              onClick={async () => {
                const ok = await confirm({
                  title: "Puxar padrão?",
                  message: `Isso substitui ${atual.steps.length ? `as ${atual.steps.length} mensagem(ns) atuais` : "a lista vazia atual"} de "${atual.titulo}" pelo modelo pronto. Só vale depois de "Salvar funis".`,
                  confirmLabel: "Puxar padrão",
                });
                if (ok) {
                  atual.setSteps(aplicarPadraoMantendoFotos(atual.padrao, atual.steps));
                  setVersaoPadrao((v) => v + 1);
                }
              }}
              className="btn-ghost text-xs"
            >
              Puxar padrão
            </button>
            <Switch checked={atual.ativo} onChange={atual.setAtivo} ariaLabel={`Ativar ${atual.titulo}`} />
          </div>
        </div>
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-200/90">
          {atual.aviso}
        </p>
        <FunnelEditor
          title=""
          profileId={profileId}
          steps={atual.steps}
          setSteps={atual.setSteps}
          planos={planos}
          permiteGerarIA={atual.permiteGerarIA}
          funnelType={atual.key}
          confirm={confirm}
          versaoPadrao={versaoPadrao}
        />
      </div>

      {/* Fixo embaixo da tela — com 50+ passos no Downsell, rolar até o fim
          só pra salvar era o tipo de atrito que fazia alguém perder uma
          edição por engano. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-white/10 bg-ink-900/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Salvando..." : "Salvar funis"}
        </button>
      </div>
    </div>
  );
}

/**
 * ALERTA DE RENOVAÇÃO — mesma peça dos funis de recuperação (`FunilRetratil` +
 * `FunnelEditor`), mas com a contagem AO CONTRÁRIO: os outros três contam PARA
 * FRENTE desde um evento (último contato, PIX gerado, última venda); este
 * conta PARA TRÁS até o vencimento da assinatura. Por isso vive na própria
 * aba, e não dentro de "Recuperação" — misturar as duas contagens na mesma
 * tela ia confundir qual "tempo" está sendo configurado em cada mensagem.
 */
function RenewalCard({
  profileId,
  bot,
  planos,
  onSaved,
  confirm,
  padrao,
}: {
  profileId: string;
  bot: Bot;
  planos: Plan[];
  onSaved: () => void;
  confirm: ConfirmFn;
  /** Modelo pronto do botão "Puxar padrão". */
  padrao: FunnelStep[];
}) {
  const [steps, setSteps] = useState<FunnelStep[]>(parseFunnel(bot.renewalFunnel));
  const [ativo, setAtivo] = useState(bot.renewalEnabled !== false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-funnels",
        profileId,
        renewalFunnel: JSON.stringify(steps),
        renewalEnabled: ativo,
      });
      showToast("Alerta de renovação salvo.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h2 className="font-display text-lg font-semibold">Alerta de renovação</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Avisa quem está VIP do vencimento, com desconto pra renovar. Configure do mais distante
          pro mais perto do vencimento (ex.: 12h, 6h, 1h antes).
        </p>
      </div>

      <FunilRetratil
        titulo="Alerta de renovação"
        resumo="Assinantes VIP a caminho do vencimento"
        aviso="Conta regressivo até o vencimento. Some da lista quando renova ou quando vence de vez."
        ativo={ativo}
        setAtivo={setAtivo}
        steps={steps}
        setSteps={setSteps}
        profileId={profileId}
        planos={planos}
        modoRenovacao
        padrao={padrao}
        confirm={confirm}
        permiteGerarIA
        funnelType="renewal"
      />

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar alerta"}
      </button>
    </div>
  );
}

/** Tempos oferecidos na Recuperação. Lista fechada porque digitar minutos
 *  soltos convidava a "1440" quando a intenção era "1 dia". */
const TEMPOS = [
  { min: 5, label: "5 min" },
  { min: 10, label: "10 min" },
  { min: 15, label: "15 min" },
  { min: 20, label: "20 min" },
  { min: 25, label: "25 min" },
  { min: 30, label: "30 min" },
  { min: 45, label: "45 min" },
  { min: 60, label: "1 hora" },
  { min: 120, label: "2 horas" },
  { min: 180, label: "3 horas" },
  { min: 360, label: "6 horas" },
  { min: 720, label: "12 horas" },
  { min: 1440, label: "1 dia" },
  { min: 2880, label: "2 dias" },
  { min: 4320, label: "3 dias" },
];

const DESCONTOS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70];

/** Sequência sugerida do Alerta de Renovação — 12h, 6h e 1h antes de vencer,
 *  a mesma progressão do exemplo mais comum. Da quarta mensagem em diante cai
 *  num intervalo fixo (ver uso). */
const PADRAO_RENOVACAO = [720, 360, 60];

/** Quais planos vão no teclado da mensagem. */
const MODOS_BOTAO: { key: NonNullable<FunnelStep["planMode"]>; label: string }[] = [
  { key: "all", label: "Todos os planos" },
  { key: "subs", label: "Só assinaturas" },
  { key: "packages", label: "Só pacotes" },
  { key: "none", label: "Sem botões" },
];

/** Para quem esta mensagem vale, dentro do público do funil. */
const PUBLICOS: { key: NonNullable<FunnelStep["audience"]>; label: string; hint: string }[] = [
  { key: "leads", label: "Só leads (não compraram)", hint: "Nunca comprou nada." },
  { key: "expirados", label: "Expirados", hint: "Já comprou e o acesso venceu." },
  { key: "todos", label: "Todos", hint: "Leads e expirados." },
];

/**
 * Aplica o modelo pronto ("Puxar padrão") SEM apagar as fotos que a modelo já
 * tinha colocado em cada mensagem — os modelos prontos (`DOWNSELL_GERAL_PADRAO`
 * etc.) nunca vêm com mídia própria (é sempre texto/tempo/desconto), então dá
 * pra herdar sem risco de sobrescrever uma mídia "oficial" do padrão.
 *
 * Só herda pelo ÍNDICE: se a mensagem daquele número JÁ EXISTIA na sequência
 * antiga, a foto dela continua; se o padrão tem mais mensagens do que a
 * sequência tinha antes, as novas (que não existiam) nascem sem mídia, como
 * sempre.
 */
function aplicarPadraoMantendoFotos(padrao: FunnelStep[], antigos: FunnelStep[]): FunnelStep[] {
  return padrao.map((s, i) => {
    const antiga = antigos[i];
    return antiga?.mediaIds?.length
      ? { ...s, mediaIds: antiga.mediaIds, mediaMode: antiga.mediaMode }
      : { ...s };
  });
}

/** Minutos → a maior unidade inteira, para o campo personalizado abrir certo. */
function decompoeMinutos(min: number): { valor: number; unidade: "min" | "h" | "d" } {
  if (min > 0 && min % 1440 === 0) return { valor: min / 1440, unidade: "d" };
  if (min > 0 && min % 60 === 0) return { valor: min / 60, unidade: "h" };
  return { valor: min, unidade: "min" };
}

function paraMinutos(valor: number, unidade: "min" | "h" | "d"): number {
  const v = Math.max(1, Math.floor(valor) || 1);
  return unidade === "d" ? v * 1440 : unidade === "h" ? v * 60 : v;
}

function rotuloDoTempo(min: number): string {
  const achado = TEMPOS.find((t) => t.min === min);
  if (achado) return achado.label;
  const { valor, unidade } = decompoeMinutos(min);
  return `${valor} ${unidade === "d" ? "dia(s)" : unidade === "h" ? "hora(s)" : "min"}`;
}

/**
 * Campo de TEMPO com lista fechada mais "Personalizado".
 *
 * A lista cobre o que se usa no dia a dia; o personalizado existe porque
 * fechar a lista de vez obrigaria a escolher o valor errado quando o certo não
 * está nela. E ele pede a UNIDADE, em vez de minutos: "3 dias" digitado como
 * 4320 é onde se erra uma casa e a mensagem sai um mês depois.
 */
function TempoDoPasso({
  minutos,
  onChange,
  dailyTime,
  onChangeDailyTime,
  dailyTimeNextDay,
  onChangeDailyTimeNextDay,
  rotulo,
  permiteHorarioFixo = true,
  modoRenovacao,
  ancoraTexto = "da anterior",
}: {
  minutos: number;
  onChange: (v: number) => void;
  /** Horário fixo do dia (ex.: "16:00") — ver o comentário em telegramCron.ts. */
  dailyTime?: string;
  onChangeDailyTime?: (v: string | undefined) => void;
  /** "Só a partir do dia seguinte" — ver o comentário em telegramCron.ts
   *  (`FunnelStep.dailyTimeNextDay`). Evita o passo furar a fila quando o
   *  passo anterior sai perto do horário marcado no mesmo dia. */
  dailyTimeNextDay?: boolean;
  onChangeDailyTimeNextDay?: (v: boolean) => void;
  /** Padrão "Tempo de espera" — o Alerta de Renovação usa outro, já que aqui
   *  a contagem é regressiva até o vencimento, não progressiva desde um evento. */
  rotulo?: string;
  /** "Horário marcado" só existe nos funis que o motor sabe ler esse campo
   *  (downsell, upsell, aprovação) — o Alerta de Renovação conta REGRESSIVO
   *  até o vencimento por outro caminho e ignora `dailyTime`, então a opção
   *  fica escondida lá pra não prometer algo que não funciona. */
  permiteHorarioFixo?: boolean;
  /** Frase do aviso embaixo fica bem diferente na Renovação (regressivo até
   *  vencer, não progressivo desde um evento). */
  modoRenovacao?: boolean;
  /** A que este tempo se refere — "depois do /start", "depois da geração do
   *  PIX"... Downsell geral/PIX contam do FATO GERADOR (fixo, nunca
   *  reinicia); Upsell e outros ainda contam "da anterior" (cada passo soma
   *  ao tempo do passo de cima). Ver o comentário de `passoPronto`. */
  ancoraTexto?: string;
}) {
  const naLista = TEMPOS.some((t) => t.min === minutos);
  const modoInicial: "lista" | "custom" | "horario" = dailyTime ? "horario" : naLista ? "lista" : "custom";
  const [modo, setModo] = useState<"lista" | "custom" | "horario">(modoInicial);
  const inicial = decompoeMinutos(minutos);
  const [valor, setValor] = useState(inicial.valor || 1);
  const [unidade, setUnidade] = useState<"min" | "h" | "d">(inicial.unidade);

  return (
    <div>
      <label className="eyebrow block">{rotulo || "Tempo de espera"}</label>
      <select
        className="input mt-1 h-9 py-0 text-xs"
        value={modo === "lista" ? String(minutos) : modo}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") {
            setModo("custom");
            onChangeDailyTime?.(undefined);
            const d = decompoeMinutos(minutos);
            setValor(d.valor || 1);
            setUnidade(d.unidade);
          } else if (v === "horario") {
            setModo("horario");
            onChange(0);
            onChangeDailyTime?.(dailyTime || "12:00");
          } else {
            setModo("lista");
            onChangeDailyTime?.(undefined);
            onChange(Number(v));
          }
        }}
      >
        {TEMPOS.map((t) => (
          <option key={t.min} value={t.min}>
            {t.label}
          </option>
        ))}
        <option value="custom">Personalizado…</option>
        {permiteHorarioFixo && <option value="horario">Horário marcado…</option>}
      </select>

      {modo === "custom" && (
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="number"
            min={1}
            className="input h-9 w-20 py-0 text-xs"
            value={valor}
            onChange={(e) => {
              const v = Number(e.target.value);
              setValor(v);
              onChange(paraMinutos(v, unidade));
            }}
          />
          <select
            className="input h-9 flex-1 py-0 text-xs"
            value={unidade}
            onChange={(e) => {
              const u = e.target.value as "min" | "h" | "d";
              setUnidade(u);
              onChange(paraMinutos(valor, u));
            }}
          >
            <option value="min">minutos</option>
            <option value="h">horas</option>
            <option value="d">dias</option>
          </select>
        </div>
      )}

      {modo === "horario" && (
        <>
          <input
            type="time"
            className="input mt-1.5 h-9 py-0 text-xs"
            value={dailyTime || "12:00"}
            onChange={(e) => onChangeDailyTime?.(e.target.value)}
          />
          <label className="mt-1.5 flex items-center gap-1 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              className="accent-white"
              checked={Boolean(dailyTimeNextDay)}
              onChange={(e) => onChangeDailyTimeNextDay?.(e.target.checked)}
            />
            só a partir do dia seguinte (não fura a fila)
          </label>
        </>
      )}

      <p className="mt-1 text-[11px] text-zinc-500">
        {modo === "horario"
          ? dailyTimeNextDay
            ? `A partir de amanhã, todo dia às ${dailyTime || "12:00"}.`
            : `Todo dia às ${dailyTime || "12:00"}.`
          : modoRenovacao
            ? `Envia quando faltam ${rotuloDoTempo(minutos)} para o vencimento.`
            : `Envia ${rotuloDoTempo(minutos)} ${ancoraTexto}.`}
      </p>
    </div>
  );
}

/** Desconto com lista fechada mais "Personalizado". */
function DescontoDoPasso({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  const [personalizado, setPersonalizado] = useState(!DESCONTOS.includes(valor));

  return (
    <div>
      <label className="eyebrow block">Desconto</label>
      <select
        className="input mt-1 h-9 py-0 text-xs"
        value={personalizado ? "custom" : String(valor)}
        onChange={(e) => {
          if (e.target.value === "custom") setPersonalizado(true);
          else {
            setPersonalizado(false);
            onChange(Number(e.target.value));
          }
        }}
      >
        {DESCONTOS.map((d) => (
          <option key={d} value={d}>
            {d === 0 ? "Sem desconto" : `${d}%`}
          </option>
        ))}
        <option value="custom">Personalizado…</option>
      </select>

      {personalizado && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={100}
            className="input h-9 w-20 py-0 text-xs"
            value={valor}
            // Acima de 100% o preço viraria negativo e o gateway recusaria a
            // cobrança — o limite é do mundo real, não da tela.
            onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
          />
          <span className="text-xs text-zinc-500">%</span>
        </div>
      )}
    </div>
  );
}

/**
 * Um passo da RECUPERAÇÃO.
 *
 * Mesmo editor das outras telas (texto, variáveis, mídia escolhida) mais o que
 * só existe aqui: quando a mensagem sai, quanto de desconto ela leva, e a
 * lista dos PLANOS ENVIADOS já com o desconto aplicado — porque o desconto é
 * um número solto que só significa alguma coisa depois de virar preço, e
 * conferir isso de cabeça a cada mudança é como se erra o valor da oferta.
 */
function FunnelEditor({
  profileId,
  title,
  steps,
  setSteps,
  planos,
  modoRenovacao,
  permiteGerarIA,
  funnelType,
  confirm,
  versaoPadrao,
}: {
  profileId: string;
  title: string;
  steps: FunnelStep[];
  setSteps: (s: FunnelStep[]) => void;
  planos: Plan[];
  /** Ver o comentário em `FunilRetratil`. */
  modoRenovacao?: boolean;
  /** Mostra o botão "Gerar com IA" em cada mensagem — só nos dois downsells
   * por ora (Upsell fica de fora, combinado). */
  permiteGerarIA?: boolean;
  /** Qual dos dois downsells é este, para o prompt calibrar o tom certo. */
  funnelType?: "geral" | "pix" | "upsell" | "renewal" | "aprovacao";
  /** Confirmação antes de gerar TODAS as mensagens de uma vez — com 50+
   * passos isso sobrescreve muita coisa junta, vale um "tem certeza?". */
  confirm?: ConfirmFn;
  /** Sobe a cada "Puxar padrão" — entra na `key` de cada linha pra forçar o
   * remount (ver o comentário em `FunnelCard`). */
  versaoPadrao?: number;
}) {
  function update(i: number, patch: Partial<FunnelStep>) {
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  // Índice do passo sendo gerado agora (só um por vez), para travar o botão
  // certo sem travar os outros passos da sequência.
  const [geradorBusy, setGeradorBusy] = useState<number | null>(null);

  async function gerarComIA(i: number) {
    setGeradorBusy(i);
    try {
      const { text } = await apiSend<{ text: string }>("/api/ai/downsell-message", "POST", {
        profileId,
        funnelType: funnelType || "geral",
        stepIndex: i,
        steps,
      });
      update(i, { text });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao gerar a mensagem.", "error");
    } finally {
      setGeradorBusy(null);
    }
  }

  // Gera a sequência INTEIRA de uma vez — com 50+ passos, clicar um por um
  // não é opção. Poucas chamadas em paralelo (não uma de cada vez, que
  // levaria minutos, nem todas juntas, que estouraria limite de taxa da IA).
  const [gerandoTodos, setGerandoTodos] = useState(false);
  const [progressoTodos, setProgressoTodos] = useState<{ feitos: number; total: number } | null>(null);
  const CONCORRENCIA_GERACAO = 3;

  async function gerarTodosComIA() {
    if (gerandoTodos || steps.length === 0) return;
    const ok = await confirm?.({
      title: "Gerar todas as mensagens com IA?",
      message: `Isso reescreve o texto das ${steps.length} mensagens desta sequência, puxando a persona da modelo. Mensagens já editadas à mão também serão substituídas. Só vale depois de salvar.`,
      confirmLabel: "Gerar todas",
    });
    if (confirm && !ok) return;

    setGerandoTodos(true);
    setProgressoTodos({ feitos: 0, total: steps.length });
    // Cópia local: é a fonte de verdade DESTE lote — evita que chamadas
    // concorrentes se pisem lendo `steps` desatualizado a cada iteração.
    const atual = steps.map((s) => ({ ...s }));
    let feitos = 0;
    let falhas = 0;
    let proximo = 0;

    async function worker() {
      while (proximo < atual.length) {
        const i = proximo++;
        try {
          const { text } = await apiSend<{ text: string }>("/api/ai/downsell-message", "POST", {
            profileId,
            funnelType: funnelType || "geral",
            stepIndex: i,
            steps: atual,
          });
          atual[i] = { ...atual[i], text };
        } catch {
          falhas++;
        } finally {
          feitos++;
          setProgressoTodos({ feitos, total: atual.length });
          setSteps(atual.map((s) => ({ ...s })));
        }
      }
    }

    await Promise.all(Array.from({ length: CONCORRENCIA_GERACAO }, worker));

    setGerandoTodos(false);
    setProgressoTodos(null);
    if (falhas > 0) {
      showToast(
        `${atual.length - falhas} de ${atual.length} mensagens geradas. ${falhas} falharam — gera essas de novo uma a uma.`,
        "error",
      );
    } else {
      showToast(`${atual.length} mensagens geradas com IA.`, "success");
    }
  }

  const todosAtivos = planos.filter((p) => p.active !== false);

  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title ? <p className="eyebrow">{title}</p> : <span />}
        {permiteGerarIA && steps.length > 0 && (
          <div className="flex items-center gap-2">
            {progressoTodos && (
              <span className="text-[11px] text-zinc-500">
                Gerando {progressoTodos.feitos}/{progressoTodos.total}…
              </span>
            )}
            <button
              type="button"
              onClick={gerarTodosComIA}
              disabled={gerandoTodos || geradorBusy !== null}
              className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-50"
              title="Gera o texto de TODAS as mensagens desta sequência de uma vez"
            >
              <IconSparkle size={13} /> {gerandoTodos ? "Gerando todas…" : `Gerar todas com IA (${steps.length})`}
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 space-y-3">
        {steps.map((s, i) => {
          const desconto = s.discountPercent ?? 0;
          // O "Planos enviados" mostra EXATAMENTE o que vai no teclado — se
          // ignorasse o modo de botões, o operador conferiria uma lista que
          // não é a que o lead recebe.
          const modo = s.planMode || "all";
          const ativos = todosAtivos.filter((p) =>
            modo === "subs" ? p.kind !== "package" : modo === "packages" ? p.kind === "package" : true,
          );
          // A chave inclui `steps.length`: "Duplicar"/"Excluir" também
          // deslocam o índice de toda mensagem depois do ponto mexido, e sem
          // isso o React reaproveitava a linha da posição (mesma chave, dado
          // novo) em vez de remontar — o mesmo motivo que já exigia
          // `versaoPadrao` pro "Puxar padrão" (ver comentário acima), só que
          // pra esses dois botões também.
          return (
            <div key={`${versaoPadrao ?? 0}-${steps.length}-${i}`} className="panel p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="chip">Mensagem {i + 1}</span>
                {/* Loop não existe no Alerta de Renovação: repetir a última
                    mensagem "ad infinitum" aqui significaria mandá-la de novo
                    a CADA MINUTO depois de cruzar o limiar — a contagem é
                    regressiva até um vencimento fixo, não avança sozinha como
                    nos outros funis.
                    Fora daqui, "repetir" só pode ligar com "Horário marcado"
                    (dailyTime) escolhido no tempo do passo: o tempo AQUI
                    embaixo sempre conta do fato gerador fixo (/start, PIX
                    gerado) e nunca do último envio — um passo que repete
                    com tempo comum ficaria pronto pra sempre depois da 1ª
                    vez e disparava a cada minuto (bug já visto e corrigido).
                    Só o horário marcado tem uma referência que avança pra
                    repetir de verdade. */}
                {!modoRenovacao && (
                  <label
                    className={`flex items-center gap-1 text-[11px] ${s.dailyTime ? "text-zinc-400" : "text-zinc-600"}`}
                    title={
                      s.dailyTime
                        ? undefined
                        : 'Escolha "Horário marcado…" no tempo do passo antes de repetir — sem isso a mensagem dispararia a cada minuto depois do prazo, sem parar.'
                    }
                  >
                    <input
                      type="checkbox"
                      className="accent-white"
                      checked={Boolean(s.isLoop)}
                      disabled={!s.dailyTime}
                      onChange={(e) => update(i, { isLoop: e.target.checked })}
                    />
                    repetir (loop)
                  </label>
                )}
                {/* Config antiga (de antes desta trava existir) com loop
                    ligado mas sem horário marcado — ainda pode estar salva
                    no banco. Sinaliza pra o operador trocar pra "Horário
                    marcado", em vez de deixar o problema invisível. */}
                {!modoRenovacao && s.isLoop && !s.dailyTime && (
                  <span className="chip border border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-300">
                    ⚠️ repete sem horário marcado — troque o tempo pra "Horário marcado…"
                  </span>
                )}
                {/* Puxa a persona da modelo + a mensagem real de /start dela
                    (mesma voz) e escreve por cima do texto deste passo,
                    calibrando pelo tempo/desconto já configurados aqui. */}
                {permiteGerarIA && (
                  <button
                    type="button"
                    onClick={() => gerarComIA(i)}
                    disabled={geradorBusy !== null || gerandoTodos}
                    className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
                    title="Gera o texto desta mensagem com IA, usando a persona da modelo e o /start dela como base"
                  >
                    <IconSparkle size={13} /> {geradorBusy === i ? "Gerando…" : "Gerar com IA"}
                  </button>
                )}
                {/* Duplicar poupa refazer texto, mídia e desconto quando a
                    mensagem seguinte é uma variação da anterior — que é o caso
                    na maior parte das sequências de recuperação. */}
                <button
                  onClick={() => setSteps([...steps.slice(0, i + 1), { ...s }, ...steps.slice(i + 1)])}
                  className={`rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white ${permiteGerarIA ? "" : "ml-auto"}`}
                >
                  Duplicar
                </button>
                <button
                  onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                  className="rounded px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10"
                >
                  Excluir
                </button>
              </div>

              <MessageEditor
                profileId={profileId}
                text={s.text}
                onText={(v) => update(i, { text: v })}
                mediaIds={s.mediaIds || []}
                onMediaIds={(v) => update(i, { mediaIds: v })}
                mode={s.mediaMode}
                onMode={(v) => update(i, { mediaMode: v })}
                vars={VARS_PADRAO}
                placeholder="Texto da mensagem · use {nome}"
                minHeight={90}
              />

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <TempoDoPasso
                  minutos={s.delayMinutes ?? 60}
                  onChange={(v) => update(i, { delayMinutes: v })}
                  dailyTime={s.dailyTime}
                  onChangeDailyTime={(v) =>
                    // Tirar o horário marcado desliga o loop junto — "repetir"
                    // só é seguro com uma referência que avança (ver o aviso
                    // no checkbox), então não pode sobreviver sozinho aqui.
                    update(i, { dailyTime: v, isLoop: v ? s.isLoop : false })
                  }
                  dailyTimeNextDay={s.dailyTimeNextDay}
                  onChangeDailyTimeNextDay={(v) => update(i, { dailyTimeNextDay: v })}
                  rotulo={modoRenovacao ? "Quanto tempo ANTES de vencer" : undefined}
                  permiteHorarioFixo={!modoRenovacao}
                  modoRenovacao={modoRenovacao}
                  ancoraTexto={
                    funnelType === "geral"
                      ? "depois do /start"
                      : funnelType === "pix"
                        ? "depois da geração do PIX"
                        : "depois da anterior"
                  }
                />
                <DescontoDoPasso
                  valor={desconto}
                  onChange={(v) => update(i, { discountPercent: v })}
                />
                {/* No Downsell de PIX gerado o botão NUNCA reabre a lista de
                    planos — o lead já escolheu um item na hora que gerou o
                    PIX, e o passo só reoferece ESSE mesmo item com o
                    desconto configurado aqui (ver `buildPixDownsellMarkup`
                    em telegramCron.ts). Mostrar o seletor de "Modo dos
                    botões" aqui prometia um comportamento que o motor não
                    faz — por isso fica escondido, com uma nota no lugar. */}
                {funnelType === "pix" ? (
                  <div>
                    <label className="eyebrow block">Botão</label>
                    <p className="input mt-1 flex h-9 items-center py-0 text-xs text-zinc-500">
                      O item que ele já escolheu, com desconto
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="eyebrow block">Modo dos botões</label>
                    <select
                      className="input mt-1 h-9 py-0 text-xs"
                      value={s.planMode || "all"}
                      onChange={(e) =>
                        update(i, { planMode: e.target.value as FunnelStep["planMode"] })
                      }
                    >
                      {MODOS_BOTAO.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Destinatários (leads/expirados/todos) é do público de quem
                    NÃO tem assinatura ativa — não se aplica aqui: este funil
                    já fala só com quem ESTÁ VIP e vencendo. */}
                {!modoRenovacao && (
                  <div>
                    <label className="eyebrow block">Destinatários</label>
                    <select
                      className="input mt-1 h-9 py-0 text-xs"
                      value={s.audience || "leads"}
                      onChange={(e) =>
                        update(i, { audience: e.target.value as FunnelStep["audience"] })
                      }
                    >
                      {PUBLICOS.map((pb) => (
                        <option key={pb.key} value={pb.key}>
                          {pb.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {PUBLICOS.find((pb) => pb.key === (s.audience || "leads"))?.hint}
                    </p>
                  </div>
                )}
              </div>

              {funnelType === "pix" ? (
                <div className="mt-3 rounded-xl border border-dashed border-white/10 p-2.5">
                  <p className="eyebrow mb-1.5">Botão enviado</p>
                  <p className="text-xs text-zinc-400">
                    O plano (ou oferta) que o lead já escolheu na hora que gerou o PIX, com{" "}
                    {desconto > 0 ? `${desconto}% de desconto` : "o preço cheio"} aplicado só nele —
                    nunca a lista inteira de novo.
                  </p>
                </div>
              ) : (
                ativos.length > 0 &&
                s.planMode !== "none" && (
                  <div className="mt-3 rounded-xl border border-dashed border-white/10 p-2.5">
                    <p className="eyebrow mb-1.5">Planos enviados</p>
                    <div className="space-y-1">
                    {ativos.map((p) => {
                      const cheio = p.priceCents;
                      const comDesconto =
                        desconto > 0 ? Math.floor(cheio * (1 - desconto / 100)) : cheio;
                      return (
                        <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-zinc-300">
                            {desconto > 0 && <span className="text-amber-400">🔥 (-{desconto}%) </span>}
                            {p.highlight === "green" && "⭐ "}
                            {p.name}
                          </span>
                          <span className="shrink-0 font-mono">
                            {desconto > 0 && (
                              <span className="mr-1.5 text-zinc-600 line-through">
                                {brl(cheio)}
                              </span>
                            )}
                            <span className={desconto > 0 ? "text-emerald-400" : "text-zinc-300"}>
                              {brl(comDesconto)}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={() =>
          setSteps([
            ...steps,
            {
              // Renovação nasce sugerindo a sequência do exemplo mais comum —
              // 12h, depois 6h, depois 1h antes de vencer — em vez de "1440"
              // (o padrão dos outros funis, que conta pra FRENTE e não faz
              // sentido pedindo "1 dia antes" logo de cara).
              delayMinutes: modoRenovacao
                ? (PADRAO_RENOVACAO[steps.length] ?? 30)
                : steps.length === 0
                  ? 60
                  : 1440,
              text: "",
              discountPercent: modoRenovacao ? 50 : 0,
            },
          ])
        }
        className="btn-ghost mt-2 text-sm"
      >
        <IconPlus size={13} /> Adicionar mensagem
      </button>
      {todosAtivos.length === 0 && (
        <p className="mt-2 text-[11px] text-amber-400">
          Nenhum plano ativo: estas mensagens sairiam sem botão de compra.
        </p>
      )}
    </div>
  );
}

/** Centavos → R$ 0,00. */
function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Preço dinâmico e cores dos botões — DA MODELO
//
// Nasceram como configuração global do painel, e isso estava errado: tudo no
// bot de vendas é decidido modelo a modelo — preço, planos, textos, funis.
// Duas modelos podem ter paletas e políticas de preço diferentes, e com um
// valor só uma delas sempre estaria com a configuração da outra.
// ---------------------------------------------------------------------------

/** As três cores que o Telegram aceita (Bot API 9.4), mais o padrão. */
const CORES_BOTAO: { key: string; label: string; dot: string; ring: string }[] = [
  { key: "", label: "Padrão", dot: "bg-zinc-500", ring: "border-white/10 text-zinc-300" },
  { key: "primary", label: "Azul", dot: "bg-indigo-400", ring: "border-indigo-500/50 text-indigo-300" },
  { key: "success", label: "Verde", dot: "bg-emerald-400", ring: "border-emerald-500/50 text-emerald-300" },
  { key: "danger", label: "Vermelho", dot: "bg-red-400", ring: "border-red-500/50 text-red-300" },
];

const PRECO_VAZIO: DynamicPrice = { enabled: false, cents: 9, direction: "random" };

function PrecoDinamicoRow({
  profileId,
  bot,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  onSaved: () => void;
}) {
  const [preco, setPreco] = useState<DynamicPrice>(bot.dynamicPrice || PRECO_VAZIO);
  const [busy, setBusy] = useState(false);

  async function salvar() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-dynamic-price",
        profileId,
        dynamicPrice: preco,
      });
      showToast("Preço dinâmico salvo.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  const direcao =
    preco.direction === "up" ? "para cima" : preco.direction === "down" ? "para baixo" : "aleatório";

  return (
    <SectionRow
      icon={<IconPayments size={16} />}
      title="Preço dinâmico"
      summary={
        preco.enabled
          ? `Ligado · até ${preco.cents} centavo(s) · ${direcao}`
          : "Desligado — todo mundo paga o mesmo valor"
      }
      status={preco.enabled ? { label: "ligado", tone: "ok" } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs leading-relaxed text-zinc-400">
          Varia alguns centavos por cliente (fixo pelo ID do Telegram) — assim o PIX identifica quem pagou.
        </p>
        <Switch
          checked={preco.enabled}
          onChange={(v) => setPreco({ ...preco, enabled: v })}
          ariaLabel="Preço dinâmico"
        />
      </div>

      {preco.enabled && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="eyebrow block">Variação em centavos</label>
            <input
              type="number"
              min={1}
              max={100}
              className="input mt-1.5"
              value={preco.cents}
              onChange={(e) => setPreco({ ...preco, cents: Number(e.target.value) })}
            />
            <p className="mt-1 text-[11px] text-zinc-500">De 1 até 100 centavos.</p>
          </div>
          <div>
            <label className="eyebrow block">Direção da variação</label>
            <select
              className="input mt-1.5"
              value={preco.direction}
              onChange={(e) =>
                setPreco({ ...preco, direction: e.target.value as DynamicPrice["direction"] })
              }
            >
              <option value="random">Aleatório (fixo por lead)</option>
              <option value="up">Sempre para cima</option>
              <option value="down">Sempre para baixo</option>
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">Aleatório também fica fixo por cliente.</p>
          </div>
        </div>
      )}

      <button onClick={salvar} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar preço dinâmico"}
      </button>
    </SectionRow>
  );
}

function CoresBotoesRow({
  profileId,
  bot,
  roles,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  roles: ButtonRoleInfo[];
  onSaved: () => void;
}) {
  const [estilos, setEstilos] = useState<ButtonStyles>(bot.buttonStyles || {});
  const [busy, setBusy] = useState(false);

  async function salvar() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-button-styles",
        profileId,
        buttonStyles: estilos,
      });
      showToast("Cores salvas.", "success");
      // Recarrega: o PREVIEW ao lado desenha os botões com essas cores e
      // mentiria até o próximo F5.
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  const comCor = roles.filter((r) => estilos[r.key]).length;

  return (
    <SectionRow
      icon={<IconSparkle size={16} />}
      title="Cores dos botões"
      summary={
        comCor > 0
          ? `${comCor} de ${roles.length} papéis com cor própria`
          : "Todos na cor padrão do Telegram"
      }
      status={comCor > 0 ? { label: `${comCor} com cor`, tone: "ok" } : undefined}
    >
      <p className="text-xs leading-relaxed text-zinc-400">
        Cor de cada botão, por papel. Um plano com cor própria ignora a cor da lista.
      </p>
      <p className="mt-2 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.07] p-2.5 text-[11px] leading-relaxed text-zinc-300">
        Recurso da Bot API 9.4 — em apps antigos, o botão sai na cor padrão.
      </p>

      <div className="mt-4 space-y-3">
        {roles.map((r) => (
          <div key={r.key} className="panel p-3">
            <p className="text-sm font-semibold text-white">{r.label}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{r.hint}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CORES_BOTAO.map((c) => {
                const ativo = (estilos[r.key] || "") === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setEstilos({ ...estilos, [r.key]: c.key as ButtonStyles[string] })}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      ativo ? `${c.ring} bg-white/5` : "border-white/10 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {roles.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">Carregando…</p>}
      </div>

      <button onClick={salvar} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar cores"}
      </button>
    </SectionRow>
  );
}

// ---------------------------------------------------------------------------
// Botões personalizados
// ---------------------------------------------------------------------------
function ButtonsCard({
  profileId,
  buttons,
  onSaved,
}: {
  profileId: string;
  buttons: CustomButton[];
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<{ id?: string; text: string; url: string }[]>(
    buttons.map((b) => ({ id: b.id, text: b.text, url: b.url })),
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const payload = rows.filter((r) => r.text.trim() && r.url.trim());
      await apiSend("/api/telegram", "POST", { action: "save-buttons", profileId, buttons: payload });
      showToast("Botões salvos.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Botões personalizados</h2>
      <p className="mt-1 text-xs text-zinc-500">Links extras que aparecem no /start (ex.: redes, prévias).</p>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 panel p-2">
            <input
              className="input min-w-[120px] flex-1"
              placeholder="Texto do botão"
              value={r.text}
              onChange={(e) => setRows((rr) => rr.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)))}
            />
            <input
              className="input min-w-[160px] flex-[2] font-mono"
              placeholder="https://..."
              value={r.url}
              onChange={(e) => setRows((rr) => rr.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))}
            />
            <button
              onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))}
              className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
              aria-label="Remover"
            >
              <IconClose size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => setRows((r) => [...r, { text: "", url: "" }])} className="btn-ghost">
          + Adicionar botão
        </button>
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Salvando..." : "Salvar botões"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assinantes
function parseSteps(json?: string): WelcomeStep[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** O que o bot faz com cada pedido de entrada. Espelha os modos do servidor. */
const MODOS: { key: ApprovalMode; label: string; desc: string }[] = [
  {
    key: "subscribers",
    label: "Só assinantes",
    desc: "Aprova quem tem assinatura ativa e RECUSA o resto. É o normal do VIP.",
  },
  {
    key: "all",
    label: "Aprovar todos",
    desc: "Aceita qualquer pedido. É o normal do canal de prévias, que é gratuito.",
  },
  {
    key: "manual",
    label: "Deixar na fila",
    desc: "O bot não decide: o pedido espera na fila do Telegram para você aprovar na mão.",
  },
];

/**
 * Regras de aprovação e as duas sequências de boas-vindas.
 *
 * O estado mora na PÁGINA (ver BotVendasPage), não aqui: o preview do aparelho
 * é irmão deste cartão, e precisa redesenhar a cada tecla. Guardar as
 * sequências aqui dentro deixaria o preview sempre uma edição atrás.
 */
function ApprovalCard({
  profileId,
  bot,
  vip,
  setVip,
  previas,
  setPrevias,
  seqPrevias,
  setSeqPrevias,
  seqVip,
  setSeqVip,
  usaPrevias,
  setUsaPrevias,
  usaVip,
  setUsaVip,
  onSaved,
}: {
  profileId: string;
  bot: Bot;
  vip: ApprovalMode;
  setVip: (v: ApprovalMode) => void;
  previas: ApprovalMode;
  setPrevias: (v: ApprovalMode) => void;
  seqPrevias: WelcomeStep[];
  setSeqPrevias: (s: WelcomeStep[]) => void;
  seqVip: WelcomeStep[];
  setSeqVip: (s: WelcomeStep[]) => void;
  usaPrevias: boolean;
  setUsaPrevias: (v: boolean) => void;
  usaVip: boolean;
  setUsaVip: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", {
        action: "save-approval",
        profileId,
        vipApprovalMode: vip,
        previasApprovalMode: previas,
        previasWelcomeFunnel: seqPrevias,
        vipWelcomeFunnel: seqVip,
        previasUseWelcome: usaPrevias,
        vipUseWelcome: usaVip,
      });
      showToast("Aprovação salva.", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-display text-lg font-semibold">Aprovação automática</h2>
      <p className="mt-1 text-xs text-zinc-500">
        O que o bot faz quando alguém pede para entrar em cada canal. Vale só para canais com{" "}
        <b>&quot;aprovar novos membros&quot;</b> ligado nas configurações do Telegram — sem isso nenhuma regra aqui tem efeito.
      </p>

      <GrupoAprovacao
        titulo="Canal VIP"
        subtitulo={bot.idVip || "sem ID configurado"}
        valor={vip}
        onChange={setVip}
      />
      <GrupoAprovacao
        titulo="Canal de Prévias"
        subtitulo={bot.idAquecimento || "sem ID configurado"}
        valor={previas}
        onChange={setPrevias}
      />

      <WelcomeSequence
        profileId={profileId}
        titulo="Boas-vindas ao entrar nas Prévias"
        steps={seqPrevias}
        setSteps={setSeqPrevias}
        usarBoasVindas={usaPrevias}
        setUsarBoasVindas={setUsaPrevias}
        botUsername={bot.botUsername}
      />
      <WelcomeSequence
        profileId={profileId}
        titulo="Boas-vindas ao entrar no VIP"
        steps={seqVip}
        setSteps={setSeqVip}
        usarBoasVindas={usaVip}
        setUsarBoasVindas={setUsaVip}
        botUsername={bot.botUsername}
      />

      <p className="mt-4 rounded-lg border border-white/10 bg-ink-850 p-3 text-xs text-zinc-400">
        O bot precisa ser <b>administrador</b> do canal, com permissão de convidar por link.
      </p>

      <button onClick={save} disabled={busy} className="btn-primary mt-4">
        {busy ? "Salvando..." : "Salvar regras"}
      </button>
    </div>
  );
}

function GrupoAprovacao({
  titulo,
  subtitulo,
  valor,
  onChange,
}: {
  titulo: string;
  subtitulo: string;
  valor: ApprovalMode;
  onChange: (v: ApprovalMode) => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-semibold text-white">{titulo}</p>
        <p className="truncate font-mono text-[11px] text-zinc-500">{subtitulo}</p>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {MODOS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              valor === m.key
                ? "border-emerald-500/40 bg-emerald-500/[0.07]"
                : "border-white/10 bg-ink-850 hover:border-white/20"
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                valor === m.key ? "text-emerald-300" : "text-zinc-200"
              }`}
            >
              {m.label}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{m.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Mostra uma URL com botão de copiar. Links relativos ganham a origem do
 *  navegador na hora de copiar — é o endereço que o operador vai colar fora. */
const ATRASOS = [
  { min: 0, label: "Imediato" },
  { min: 2, label: "2 min depois" },
  { min: 10, label: "10 min depois" },
  { min: 30, label: "30 min depois" },
  { min: 60, label: "1 hora depois" },
  { min: 180, label: "3 horas depois" },
  { min: 1440, label: "1 dia depois" },
];

/**
 * Editor da SEQUÊNCIA de boas-vindas de um grupo.
 *
 * Parecido com o editor de funil, mas sem desconto nem loop: aqui não se está
 * perseguindo quem não comprou, e sim recebendo quem acabou de entrar. Em
 * compensação tem o modo de botão, para decidir se aquele passo já mostra as
 * ofertas ou é só conversa.
 *
 * O atraso é ACUMULADO desde a entrada: passos de 0 e 10 saem na hora e 10
 * minutos depois. Vazio = nada é enviado (a aprovação continua acontecendo).
 */
function WelcomeSequence({
  profileId,
  titulo,
  steps,
  setSteps,
  usarBoasVindas,
  setUsarBoasVindas,
  botUsername,
}: {
  profileId: string;
  titulo: string;
  steps: WelcomeStep[];
  setSteps: (s: WelcomeStep[]) => void;
  usarBoasVindas: boolean;
  setUsarBoasVindas: (v: boolean) => void;
  /** @ do bot desta modelo — monta o link padrão do botão próprio. */
  botUsername?: string;
}) {
  function update(i: number, patch: Partial<WelcomeStep>) {
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  // Mesmo motor do Downsell, com "aprovacao" como tipo — persona da modelo +
  // /start real, mas sem desconto/urgência: o objetivo aqui é dar boas-vindas
  // de verdade, não vender.
  const [geradorBusy, setGeradorBusy] = useState<number | null>(null);
  async function gerarComIA(i: number) {
    setGeradorBusy(i);
    try {
      const { text } = await apiSend<{ text: string }>("/api/ai/downsell-message", "POST", {
        profileId,
        funnelType: "aprovacao",
        stepIndex: i,
        steps,
      });
      update(i, { text });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao gerar a mensagem.", "error");
    } finally {
      setGeradorBusy(null);
    }
  }

  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-white">{titulo}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
        Vão no privado de quem foi aprovado, só se já tiver dado <code>/start</code>.
      </p>

      {/* REUSAR A MENSAGEM DE BOAS-VINDAS. É a mesma conversa: quem entra no
          canal precisa ver a mesma oferta de quem chega pelo /start. Manter as
          duas em sincronia na mão era garantia de elas divergirem. */}
      <div className="mt-2.5 rounded-xl border border-white/10 bg-ink-850 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">Usar a mensagem de boas-vindas</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Mesma mensagem do <code>/start</code> — editar as boas-vindas muda as duas.
            </p>
          </div>
          <Switch
            checked={usarBoasVindas}
            onChange={setUsarBoasVindas}
            ariaLabel="Usar a mensagem de boas-vindas"
          />
        </div>

        {usarBoasVindas && (
          <p className="mt-2 text-[11px] text-zinc-500">
            As mensagens abaixo saem depois desta. Veja a conversa no celular ao lado.
          </p>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">
                Mensagem {usarBoasVindas ? i + 2 : i + 1}
              </span>
              <select
                className="input h-8 w-auto py-0 text-xs"
                value={String(s.delayMinutes ?? 0)}
                onChange={(e) => update(i, { delayMinutes: Number(e.target.value) })}
              >
                {ATRASOS.map((a) => (
                  <option key={a.min} value={a.min}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select
                className="input h-8 w-auto py-0 text-xs"
                value={s.buttons || "none"}
                onChange={(e) => update(i, { buttons: e.target.value as WelcomeStep["buttons"] })}
              >
                <option value="none">Sem botões</option>
                <option value="plans">Com os planos</option>
                <option value="custom">Botões próprios desta mensagem</option>
              </select>
              <button
                type="button"
                onClick={() => gerarComIA(i)}
                disabled={geradorBusy !== null}
                className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
                title="Gera o texto desta mensagem com IA, usando a persona da modelo e o /start dela como base"
              >
                <IconSparkle size={13} /> {geradorBusy === i ? "Gerando…" : "Gerar com IA"}
              </button>
              <button
                onClick={() => setSteps([...steps.slice(0, i + 1), { ...s }, ...steps.slice(i + 1)])}
                className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                Duplicar
              </button>
              <button
                onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                className="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                aria-label="Remover mensagem"
              >
                <IconClose size={14} />
              </button>
            </div>

            <div className="mt-2">
              <MessageEditor
                profileId={profileId}
                text={s.text}
                onText={(v) => update(i, { text: v })}
                mediaIds={s.mediaIds || []}
                onMediaIds={(v) => update(i, { mediaIds: v })}
                mode={s.mediaMode}
                onMode={(v) => update(i, { mediaMode: v })}
                vars={VARS_PADRAO}
                placeholder="Texto da mensagem · use {nome}"
                minHeight={80}
              />
            </div>

            {s.buttons === "custom" && (
              <BotoesDoPasso
                botoes={s.customButtons || []}
                setBotoes={(v) => update(i, { customButtons: v })}
                botUsername={botUsername}
              />
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => setSteps([...steps, { delayMinutes: steps.length === 0 ? 0 : 10, text: "", buttons: "none" }])}
        className="btn-ghost mt-2 px-2.5 py-1 text-xs"
      >
        <IconPlus size={13} /> Mensagem
      </button>
    </div>
  );
}

/**
 * Botões próprios de UM passo da sequência de aprovação.
 *
 * O caso comum tem um botão só e sempre o mesmo: levar quem entrou no grupo
 * de prévias para a conversa do bot, onde a oferta acontece. Por isso o "+"
 * já nasce preenchido com esse botão — o operador não precisa lembrar do
 * formato do deep-link, e o link aponta para o bot DESTA modelo.
 */
function BotoesDoPasso({
  botoes,
  setBotoes,
  botUsername,
}: {
  botoes: { text: string; url: string }[];
  setBotoes: (v: { text: string; url: string }[]) => void;
  botUsername?: string;
}) {
  const padrao = linkDoBot(botUsername);

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-ink-850 p-3">
      <p className="eyebrow">Botões desta mensagem</p>
      <div className="mt-2 space-y-2">
        {botoes.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              className="input min-w-[140px] flex-1"
              placeholder="Texto do botão"
              value={b.text}
              onChange={(e) =>
                setBotoes(botoes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
              }
            />
            <input
              className="input min-w-[180px] flex-[2] font-mono text-xs"
              placeholder="https://t.me/..."
              value={b.url}
              onChange={(e) =>
                setBotoes(botoes.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
              }
            />
            <button
              onClick={() => setBotoes(botoes.filter((_, j) => j !== i))}
              className="grid h-8 w-8 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
              aria-label="Remover botão"
            >
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setBotoes([...botoes, { text: BOTAO_APROVACAO_PADRAO, url: padrao }])}
        className="btn-ghost mt-2 px-2.5 py-1 text-xs"
      >
        <IconPlus size={13} /> Botão
      </button>

      {botoes.length === 0 && (
        <p className="mt-1.5 text-[11px] text-amber-400">
          Sem botão, esta mensagem sai só com o texto.
        </p>
      )}
      {!padrao && (
        <p className="mt-1.5 text-[11px] text-amber-400">
          @ do bot ainda não lido — salve as credenciais em Modelos.
        </p>
      )}
    </div>
  );
}

/**
 * ORDER BUMP de um plano — a oferta extra mostrada entre escolher o plano e
 * gerar o PIX.
 *
 * O aceite SOMA o valor à mesma cobrança, em vez de criar uma segunda: dois
 * PIX deixariam um em aberto se o cliente desistisse no meio, e o painel
 * mostraria uma venda pendente que nunca fecharia.
 */
function BumpEditor({
  profileId,
  plano,
  precoPlano,
  bump,
  setBump,
}: {
  profileId: string;
  plano: string;
  precoPlano: number;
  bump: Bump;
  setBump: (b: Bump) => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<Bump>) => setBump({ ...bump, ...patch });
  const total = precoPlano + bump.priceCents;

  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Order Bump</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Oferta extra depois de escolher o plano, antes do PIX. O aceite soma ao <b>mesmo</b> pagamento.
          </p>
        </div>
        <Switch
          checked={bump.enabled}
          onChange={(v) => set({ enabled: v })}
          ariaLabel="Ativar Order Bump"
        />
      </div>

      {bump.enabled && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
            <input
              className="input"
              placeholder="Nome do Order Bump"
              value={bump.name}
              onChange={(e) => set({ name: e.target.value })}
            />
            <MoneyInput
              value={bump.priceCents ? (bump.priceCents / 100).toFixed(2) : ""}
              onChange={(v) =>
                set({ priceCents: v ? Math.round(parseFloat(v) * 100) : 0 })
              }
            />
          </div>
          {bump.priceCents > 0 && precoPlano > 0 && (
            <p className="mt-1 text-[11px] text-zinc-500">
              O cliente pagaria <b className="text-emerald-400">{money(total)}</b> ao aceitar
              ({money(precoPlano)} do plano + {money(bump.priceCents)} do bump).
            </p>
          )}

          <label className="eyebrow mt-3 block">Texto da oferta</label>
          <textarea
            ref={areaRef}
            className="input mt-1.5 min-h-[80px]"
            placeholder="Explique o que é a oferta e por que vale a pena…"
            value={bump.text}
            onChange={(e) => set({ text: e.target.value })}
          />
          <VarChips
            vars={[
              ["{selected_plan_name}", "nome do plano escolhido"],
              ["{order_bump_name}", "nome desta oferta"],
              ["{order_bump_value}", "valor desta oferta"],
              ["{total_value}", "plano + oferta, já somados"],
            ]}
            targetRef={areaRef}
            onChange={(v) => set({ text: v })}
          />

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="eyebrow block">Texto do botão aceitar</label>
              <input
                className="input mt-1.5"
                placeholder="Aceitar"
                value={bump.acceptText || ""}
                onChange={(e) => set({ acceptText: e.target.value })}
              />
            </div>
            <div>
              <label className="eyebrow block">Texto do botão recusar</label>
              <input
                className="input mt-1.5"
                placeholder="Recusar"
                value={bump.declineText || ""}
                onChange={(e) => set({ declineText: e.target.value })}
              />
            </div>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            Lado a lado, ganham ✅/❌ sozinhos. Cor em <b>Cores dos botões</b>.
          </p>

          <label className="eyebrow mt-3 block">Mídia da oferta (opcional)</label>
          <div className="mt-1.5">
            <MediaPicker
              profileId={profileId}
              selected={bump.mediaIds || []}
              onChange={(ids) => set({ mediaIds: ids })}
              max={10}
            />
          </div>

          <label className="eyebrow mt-3 block">Áudio da oferta (URL pública .ogg)</label>
          <input
            className="input mt-1.5 font-mono text-xs"
            placeholder="https://… .ogg"
            value={bump.audioUrl || ""}
            onChange={(e) => set({ audioUrl: e.target.value })}
          />

          <label className="eyebrow mt-3 block">Entregável da oferta</label>
          <textarea
            className="input mt-1.5 min-h-[70px]"
            placeholder="O que o cliente recebe ao pagar com a oferta aceita."
            value={bump.deliverable || ""}
            onChange={(e) => set({ deliverable: e.target.value })}
          />
          <p className="mt-1 text-[11px] text-zinc-500">
            Enviado <b>depois</b> do acesso principal — o cliente veio pelo plano, o extra não pode
            chegar antes.
          </p>

          <label className="eyebrow mt-3 block">Botões do entregável da oferta</label>
          <div className="mt-1.5 space-y-1.5">
            {(bump.deliverableButtons || []).map((b, bi) => (
              <div key={bi} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  className="input text-xs"
                  placeholder="Texto do botão"
                  value={b.text}
                  onChange={(e) =>
                    set({
                      deliverableButtons: (bump.deliverableButtons || []).map((x, xi) =>
                        xi === bi ? { ...x, text: e.target.value } : x,
                      ),
                    })
                  }
                />
                <input
                  className="input font-mono text-xs"
                  placeholder="https://"
                  value={b.url}
                  onChange={(e) =>
                    set({
                      deliverableButtons: (bump.deliverableButtons || []).map((x, xi) =>
                        xi === bi ? { ...x, url: e.target.value } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    set({
                      deliverableButtons: (bump.deliverableButtons || []).filter((_, xi) => xi !== bi),
                    })
                  }
                  className="btn-ghost px-2.5"
                  aria-label="Remover botão"
                >
                  <IconClose size={13} />
                </button>
              </div>
            ))}
            {(bump.deliverableButtons || []).length < 6 && (
              <button
                type="button"
                onClick={() =>
                  set({ deliverableButtons: [...(bump.deliverableButtons || []), { text: "", url: "" }] })
                }
                className="btn-ghost px-2.5 py-1 text-xs"
              >
                <IconPlus size={13} /> Botão
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Uma das três sequências de recuperação, em bloco retrátil.
 *
 * Retrátil porque são três sequências de várias mensagens cada: abertas ao
 * mesmo tempo, a aba viraria uma rolagem em que não dá para ver o conjunto.
 * Fechado, o cabeçalho já diz o essencial — o gatilho, se está ligado e
 * quantas mensagens tem.
 */
function FunilRetratil({
  titulo,
  resumo,
  aviso,
  ativo,
  setAtivo,
  steps,
  setSteps,
  profileId,
  planos,
  modoRenovacao,
  padrao,
  confirm,
  permiteGerarIA,
  funnelType,
}: {
  titulo: string;
  resumo: string;
  aviso: string;
  ativo: boolean;
  setAtivo: (v: boolean) => void;
  steps: FunnelStep[];
  setSteps: (s: FunnelStep[]) => void;
  profileId: string;
  planos: Plan[];
  /** Passos contam PARA TRÁS até o vencimento, não para frente desde um
   *  evento — troca o rótulo do tempo e esconde loop/destinatários, que não
   *  fazem sentido nesse funil. */
  modoRenovacao?: boolean;
  /** Modelo pronto do botão "Puxar padrão" — vazio some com ele. */
  padrao?: FunnelStep[];
  confirm?: ConfirmFn;
  /** Ver o comentário em `FunnelEditor`. */
  permiteGerarIA?: boolean;
  funnelType?: "geral" | "pix" | "upsell" | "renewal" | "aprovacao";
}) {
  // O Alerta de Renovação é o conteúdo INTEIRO da própria aba — sem outros
  // dois funis ao lado como na Recuperação —, então já abre sozinho em vez de
  // exigir um clique a mais só para ver o que tem lá dentro.
  const [aberto, setAberto] = useState(Boolean(modoRenovacao));
  // Ver o comentário equivalente em `FunnelCard` — força o FunnelEditor a
  // remontar as linhas depois de "Puxar padrão", pra não deixar o <select>
  // de tempo/desconto de uma linha reaproveitada com o modo calculado da
  // mensagem antiga daquele índice.
  const [versaoPadrao, setVersaoPadrao] = useState(0);

  return (
    <div className={`card overflow-hidden ${aberto ? "border-emerald-500/25" : ""}`}>
      <div className="flex items-center gap-3 p-4">
        <button type="button" onClick={() => setAberto((v) => !v)} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            {titulo}
            <span
              className={`chip border text-[10px] ${
                ativo
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-white/10 text-zinc-500"
              }`}
            >
              {ativo ? "ativo" : "desligado"}
            </span>
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {resumo} · {steps.length} mensagem(ns)
          </p>
        </button>
        {confirm && (
          <button
            type="button"
            disabled={!padrao || padrao.length === 0}
            title={
              !padrao || padrao.length === 0
                ? "Ainda sem modelo pronto para este gatilho."
                : "Substitui as mensagens atuais pelo modelo pronto."
            }
            onClick={async () => {
              const ok = await confirm({
                title: "Puxar padrão?",
                message: `Isso substitui ${steps.length ? `as ${steps.length} mensagem(ns) atuais` : "a lista vazia atual"} de "${titulo}" pelo modelo pronto. Só vale depois de salvar.`,
                confirmLabel: "Puxar padrão",
              });
              if (ok && padrao) {
                setSteps(aplicarPadraoMantendoFotos(padrao, steps));
                setVersaoPadrao((v) => v + 1);
              }
            }}
            className="btn-ghost shrink-0 text-xs"
          >
            Puxar padrão
          </button>
        )}
        <Switch checked={ativo} onChange={setAtivo} ariaLabel={`Ativar ${titulo}`} />
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
          aria-expanded={aberto}
        >
          {aberto ? "Fechar" : "Abrir"}
          {aberto ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>

      {aberto && (
        <div className="border-t border-white/10 p-4">
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-200/90">
            {aviso}
          </p>
          <div className="mt-1">
            <FunnelEditor
              title=""
              profileId={profileId}
              steps={steps}
              setSteps={setSteps}
              planos={planos}
              modoRenovacao={modoRenovacao}
              permiteGerarIA={permiteGerarIA}
              funnelType={funnelType}
              confirm={confirm}
              versaoPadrao={versaoPadrao}
            />
          </div>
        </div>
      )}
    </div>
  );
}
