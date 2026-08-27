"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  APARELHOS,
  APARELHO_PADRAO,
  CHROME,
  FONTES,
  alturaDaConversa,
  useAparelho,
  type Aparelho,
} from "./aparelhos";

/**
 * PREVIEW AO VIVO das mensagens do bot, dentro de uma tela de celular DE VERDADE.
 *
 * Não é enfeite: o que o operador precisa saber é o que cabe na primeira tela
 * do lead — onde a mensagem corta, se os botões aparecem sem rolar, se a foto
 * empurra tudo para baixo. Num painel largo, um preview solto sempre parece
 * confortável; no celular do lead, não é.
 *
 * Por isso as medidas são as do aparelho, não aproximações, e o aparelho é
 * ESCOLHIDO (ver aparelhos.ts): as áreas seguras e a altura de cada barra do
 * Telegram são descontadas de acordo com o modelo, e o que sobra é a janela de
 * conversa honesta daquele celular.
 */

/** O estilo é o MESMO que vai para o Telegram (Bot API 9.4). */
export type PreviewStyle = "" | "primary" | "success" | "danger";
type Btn = {
  text: string;
  kind: "plan" | "custom" | "support";
  style?: PreviewStyle;
  /** Só existe no preview: o Telegram real não devolve isso. Quando setado,
   *  o botão vira clicável (navegação simulada — ver `FunnelPreview`). */
  onClick?: () => void;
};

/**
 * As cores do preview espelham o que o Telegram desenha para cada `style`:
 * primary = azul, success = verde, danger = vermelho, vazio = o botão neutro.
 * Se estas classes divergirem do que o app mostra, o preview vira decoração —
 * é justamente a cor que o operador vem conferir aqui.
 */
const CORES: Record<string, string> = {
  primary: "border-sky-500/40 bg-sky-500/25 text-sky-100",
  success: "border-emerald-500/40 bg-emerald-500/25 text-emerald-100",
  danger: "border-red-500/40 bg-red-500/25 text-red-100",
  "": "border-white/10 bg-white/[0.10] text-zinc-100",
};

/** Emoji da animação escolhida — o efeito em si é do app, aqui vale a marca. */
const EFEITO_EMOJI: Record<string, string> = {
  fire: "🔥",
  party: "🎉",
  heart: "❤️",
  like: "👍",
  dislike: "👎",
  poop: "💩",
};

/**
 * O aparelho escolhido, para quem desenha o CONTEÚDO.
 *
 * O balão e o botão precisam do tamanho de fonte da plataforma (o Telegram do
 * Android desenha a mensagem 1pt menor que o do iOS, e é isso que decide onde a
 * linha quebra), mas eles são usados soltos em outras telas — a linha "usar a
 * mensagem de boas-vindas", por exemplo. Contexto com padrão resolve os dois
 * casos sem obrigar cada chamada a repassar o aparelho.
 */
const AparelhoCtx = createContext<Aparelho>(APARELHO_PADRAO);

export default function BotPreview({
  botUsername,
  welcomeMessage,
  welcomeMediaIds,
  welcomeMediaMode,
  buttons,
  effect,
}: {
  botUsername?: string;
  welcomeMessage: string;
  /** Mídias escolhidas a dedo, na ordem de envio. */
  welcomeMediaIds?: string[];
  welcomeMediaMode?: "album" | "separate";
  buttons: Btn[];
  /** Chave do efeito de mensagem aplicado ao /start. */
  effect?: string;
}) {
  const ids = welcomeMediaIds || [];
  const { conversaRef, passaDaTela, medir, cortados, marcarCorte } = useMedidas([
    welcomeMessage,
    ids.join(","),
    welcomeMediaMode,
    buttons.length,
  ]);

  return (
    <Celular
      titulo={botUsername ? `@${botUsername}` : "seu bot"}
      inicial={(botUsername || "b").charAt(0).toUpperCase()}
      rodape={
        passaDaTela
          ? "A mensagem passa da primeira tela — o lead precisa rolar para ver o resto."
          : "Tudo cabe na primeira tela."
      }
      rodapeAlerta={passaDaTela}
      aviso={avisoDeCorte(cortados)}
    >
      <div ref={conversaRef} className="h-full overflow-y-auto px-3 py-3" onLoad={medir}>
        <p className="mx-auto mb-2 w-fit rounded-full bg-white/10 px-2 py-0.5 text-[12px] text-zinc-300">
          /start
        </p>

        <PreviewBalao
          mediaIds={ids}
          mode={welcomeMediaMode}
          text={welcomeMessage}
          buttons={buttons}
          effect={effect}
          vazio="(mensagem de boas-vindas vazia)"
          onMedia={medir}
          onCortado={marcarCorte}
        />

        {buttons.length === 0 && (
          <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2 text-center text-[11px] text-amber-300">
            Sem plano cadastrado o lead recebe a mensagem e não tem como comprar.
          </p>
        )}
      </div>
    </Celular>
  );
}

/** Textos padrão da tela de pagamento — espelham `PIX_DEFAULTS` de
 *  `lib/telegramDb.ts`. Duplicados aqui (e não importados) porque aquele
 *  módulo puxa `getDb()`: importar de um componente client vazaria acesso a
 *  banco para o bundle do navegador. O painel já mantém os dois em sincronia
 *  via `pixDefaults` (vindo da API) — isto aqui é só o fallback ÚLTIMO, para
 *  quando nem a API respondeu ainda. */
const PIX_PADRAO_PREVIEW = {
  generatingMessage: "⏳ Gerando cobrança PIX...",
  socialProofText: "🔥 {vendas_hoje} pessoa(s) garantiram o acesso hoje.",
  btnCheck: "Verificar Status do Pagamento",
  btnQr: "Mostrar QR Code",
  btnCopy: "Copiar Chave Pix",
  notPaidMessage:
    "Ainda não identificamos seu pagamento. Se você já pagou, aguarde alguns instantes e tente novamente.",
};

/** Espelha `CHECKOUT_DEFAULTS` de `telegramDb.ts` — mesmo motivo do
 *  `PIX_PADRAO_PREVIEW` acima (evitar puxar `getDb()` para o navegador). */
const CHECKOUT_PADRAO_PREVIEW = {
  generatingMessage: "⏳ Gerando cobrança no cartão...",
  payButton: "Pagar 👉",
  checkButton: "Verificar status",
};

/** Código de exemplo — só para o preview ter algo para substituir {pix_code}. */
const PIX_CODIGO_EXEMPLO = "00020126580014BR.GOV.BCB.PIX...(código de exemplo)...6304EXPL";

/**
 * PREVIEW DO FUNIL INTEIRO: /start → lead escolhe um plano → tela do PIX →
 * pagamento confirmado. As outras telas do preview mostram UMA mensagem; esta
 * existe porque PIX e "pagamento aprovado" só fazem sentido lidos em SEQUÊNCIA
 * — a legenda do PIX cita o plano e o valor, e é o "antes/depois" que mostra
 * se a promessa de uma mensagem bate com a entrega da outra.
 */
export function FunnelPreview({
  botUsername,
  welcomeMessage,
  welcomeMediaIds,
  welcomeMediaMode,
  effectWelcome,
  buttons,
  planoNome,
  planoValor,
  pixGeneratingMessage,
  pixCaption,
  pixSocialProof,
  pixSocialProofText,
  pixButtons,
  pixAudioUrl,
  effectPix,
  successMessage,
  successButtons,
  effectSuccess,
  intlAskFirst,
  welcomeMessageIntl,
  welcomeButtonsIntl,
  pixSocialProofTextIntl,
  successMessageIntl,
  successButtonsIntl,
  cardBrButtons,
  originGateStyle,
  pixCheckStyle,
  checkoutPayStyle,
  checkoutGerandoIntl,
  checkoutPayTextoIntl,
  checkoutCheckTextoIntl,
  checkoutShowCheck = true,
  checkoutGerandoBr,
  checkoutPayTextoBr,
  checkoutCheckTextoBr,
  notPaidMessage,
}: {
  botUsername?: string;
  /** Conteúdo do ramo BRASIL — o que qualquer lead vê até (e a menos que)
   *  escolher o internacional dentro da própria conversa. */
  welcomeMessage: string;
  welcomeMediaIds?: string[];
  welcomeMediaMode?: "album" | "separate";
  effectWelcome?: string;
  buttons: Btn[];
  /** Nome e valor do plano de exemplo — o primeiro ativo, para substituir
   *  {plano} e {valor} na legenda do PIX. */
  planoNome: string;
  planoValor: string;
  pixGeneratingMessage: string;
  pixCaption: string;
  pixSocialProof: boolean;
  pixSocialProofText: string;
  pixButtons: Btn[];
  pixAudioUrl?: string;
  effectPix?: string;
  successMessage: string;
  successButtons: Btn[];
  effectSuccess?: string;
  /** Modo internacional bilíngue LIGADO — mostra a pergunta "Brasil ou
   *  International?" como a PRIMEIRA coisa da conversa, antes da
   *  boas-vindas, do jeito que o /start de verdade faz. Sem isso, o único
   *  jeito de o lead simulado chegar no ramo internacional é o botão "Not
   *  from Brazil?" (quando existe em `buttons`) — mesmas duas portas do
   *  bot de verdade, nenhum seletor de fora precisa decidir por ele. */
  intlAskFirst?: boolean;
  /** Mesmo trio welcome/botões/plano acima, só que do ramo internacional —
   *  só existem quando há plano elegível em USD (ver `temPlanoUsd` em
   *  `page.tsx`); a navegação clicável troca de um pro outro sozinha
   *  conforme o lead simulado responde a pergunta ou toca "Not from
   *  Brazil?", sem precisar de nenhum seletor fora do aparelho. */
  welcomeMessageIntl?: string;
  welcomeButtonsIntl?: Btn[];
  pixSocialProofTextIntl?: string;
  successMessageIntl?: string;
  successButtonsIntl?: Btn[];
  /** Botão extra "pagar no cartão" — só no ramo Brasil (é uma opção A MAIS
   *  pro brasileiro, não existe do lado internacional). */
  cardBrButtons?: Btn[];
  /** Cor da pergunta "Brasil ou International?" (papel "originGate") — os
   *  botões desta pergunta especificamente, quando `intlAskFirst` está
   *  ligado. O "Not from Brazil?" e o "pagar no cartão" já vêm com a cor
   *  própria deles embutida em `buttons`/`cardBrButtons` (papéis
   *  "notFromBrazil"/"cardBrOffer", calculados em `page.tsx`). */
  originGateStyle?: PreviewStyle;
  /** Cor do botão "Verificar status"/"Check payment status" (papel
   *  "pixCheck") — mesmo botão nos dois provedores. */
  pixCheckStyle?: PreviewStyle;
  /** Cor do botão "Make payment"/"Pagar" do checkout Stripe (papel
   *  "checkoutPay") — botão que abre o link, separado do "Verificar status". */
  checkoutPayStyle?: PreviewStyle;
  /** Trio do checkout internacional (EN) — CHECKOUT_INTL_TEXTS no webhook.
   *  Vazio cai no ilustrativo em inglês. */
  checkoutGerandoIntl?: string;
  checkoutPayTextoIntl?: string;
  checkoutCheckTextoIntl?: string;
  /** Espelha `checkoutShowCheckButton` do bot — desligado, o botão de
   *  verificar status some da tela, ficando só o link de pagamento. */
  checkoutShowCheck?: boolean;
  /** Mesmo trio do checkout acima, mas em PT — usado quando o lead
   *  brasileiro clica em "pagar no cartão" (`cardBrButtons`): o cartão no
   *  Brasil abre o MESMO tipo de tela (link Stripe), só que com os textos
   *  editáveis em português, não os traduzidos. */
  checkoutGerandoBr?: string;
  checkoutPayTextoBr?: string;
  checkoutCheckTextoBr?: string;
  /** Resposta de "Verificar status" quando ainda não consta pago — mesma
   *  mensagem nos dois provedores (PIX e cartão). Vazio cai no padrão. */
  notPaidMessage?: string;
}) {
  const welcomeIds = welcomeMediaIds || [];
  const temRamoIntl = Boolean(welcomeMessageIntl || (welcomeButtonsIntl && welcomeButtonsIntl.length > 0));

  // ---- NAVEGAÇÃO CLICÁVEL --------------------------------------------------
  // O preview passa a se comportar como o app de verdade: cada balão só
  // ganha o próximo depois de um clique, e não antes, e o ramo (Brasil ou
  // International) só muda quando o LEAD SIMULADO toca num botão dentro da
  // própria conversa — sem seletor nenhum do lado de fora, porque um lead de
  // verdade também não tem um. O conteúdo de cada tela continua vindo pronto
  // por prop (de `page.tsx`); aqui só se decide QUANDO revelar cada uma e
  // QUAL ramo está em uso. Nenhum clique chama API real nem gera PIX de
  // verdade — é tudo ilustrativo, inclusive a confirmação de pagamento.
  const [origemEscolhida, setOrigemEscolhida] = useState<"br" | "intl" | null>(null);
  const [pagamento, setPagamento] = useState<{ via: "pix" | "cartaoIntl" | "cartaoBr"; label: string } | null>(null);
  const [statusChecadas, setStatusChecadas] = useState(0);
  const [abrindoPagamento, setAbrindoPagamento] = useState(false);
  const [pagamentoConfirmado, setPagamentoConfirmado] = useState(false);

  function reiniciar() {
    setOrigemEscolhida(null);
    setPagamento(null);
    setStatusChecadas(0);
    setAbrindoPagamento(false);
    setPagamentoConfirmado(false);
  }

  function escolherOrigem(r: "br" | "intl") {
    setOrigemEscolhida(r);
    // Escolher de novo no meio da conversa ("Not from Brazil?") reabre o
    // ramo internacional — o que vinha depois (tela de pagamento) não vale
    // mais para esse ramo, então reinicia daqui pra frente.
    setPagamento(null);
    setStatusChecadas(0);
    setAbrindoPagamento(false);
    setPagamentoConfirmado(false);
  }

  // "Pagar" abre um link de verdade — aqui simula o lead saindo pro
  // navegador e voltando já pago, depois de um instante (mesma sensação de
  // "algo aconteceu" que o clique precisa dar, sem precisar de mais um
  // clique manual pra "confirmar").
  useEffect(() => {
    if (!abrindoPagamento || pagamentoConfirmado) return;
    const t = setTimeout(() => setPagamentoConfirmado(true), 1400);
    return () => clearTimeout(t);
  }, [abrindoPagamento, pagamentoConfirmado]);

  const intl = origemEscolhida === "intl";
  // Com a pergunta Brasil/International ligada, nada depois dela existe até
  // o lead simulado responder — igual ao /start de verdade.
  const origemPronta = !intlAskFirst || origemEscolhida !== null;
  const podeReiniciar = origemEscolhida !== null || pagamento !== null;

  const welcomeAtivo = intl ? welcomeMessageIntl || "" : welcomeMessage;
  const welcomeBotoesAtivos = intl ? welcomeButtonsIntl || [] : buttons;
  const pixSocialProofTextoAtivo = intl ? pixSocialProofTextIntl || "" : pixSocialProofText;
  const successMessageAtivo = intl ? successMessageIntl || successMessage : successMessage;
  const successButtonsAtivos = intl ? successButtonsIntl || successButtons : successButtons;

  const { conversaRef, passaDaTela, medir, cortados, marcarCorte } = useMedidas([
    welcomeAtivo,
    welcomeIds.join(","),
    welcomeMediaMode,
    JSON.stringify(welcomeBotoesAtivos.map((b) => b.text)),
    pixGeneratingMessage,
    pixCaption,
    pixSocialProof,
    pixSocialProofTextoAtivo,
    JSON.stringify(pixButtons.map((b) => b.text)),
    Boolean(pixAudioUrl),
    successMessageAtivo,
    JSON.stringify(successButtonsAtivos.map((b) => b.text)),
    Boolean(intlAskFirst),
    JSON.stringify((cardBrButtons || []).map((b) => b.text)),
    checkoutGerandoIntl,
    checkoutPayTextoIntl,
    checkoutCheckTextoIntl,
    checkoutShowCheck,
    checkoutGerandoBr,
    checkoutPayTextoBr,
    checkoutCheckTextoBr,
    notPaidMessage,
    origemEscolhida,
    pagamento?.via,
    statusChecadas,
    abrindoPagamento,
    pagamentoConfirmado,
  ]);

  // Rola pro FIM da conversa a cada passo revelado — é o que um app de
  // verdade faz sozinho quando chega mensagem nova, e sem isso o lead
  // simulado "clica no vazio": o balão novo nasce fora da tela, embaixo do
  // que já tinha, e some da vista até o operador rolar na mão. Pula o
  // PRIMEIRO render (nada foi clicado ainda, não há pra onde rolar) — só
  // entra em ação depois de um clique de verdade.
  const primeiraRenderizacao = useRef(true);
  useEffect(() => {
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    // Um instante pro DOM assentar o balão novo (mesmo motivo do setTimeout
    // de `useMedidas` — sem ele a rolagem mede a altura de ANTES do balão
    // entrar e para curta).
    const t = setTimeout(() => {
      conversaRef.current?.scrollTo({ top: conversaRef.current.scrollHeight, behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origemEscolhida, pagamento?.via, statusChecadas, abrindoPagamento, pagamentoConfirmado]);

  // Mesma montagem do webhook (ver app/api/webhooks/telegram/[botId]/route.ts):
  // {plano}/{valor} primeiro, depois {pix_code} (ou o código no fim, se o
  // operador apagou o marcador). PIX só existe do lado Brasil.
  let legenda = pixCaption.trim();
  if (legenda) {
    legenda = legenda.replace(/{plano}/gi, planoNome).replace(/{valor}/gi, planoValor);
    legenda = /{pix_code}/i.test(legenda)
      ? legenda.replace(/{pix_code}/gi, PIX_CODIGO_EXEMPLO)
      : `${legenda}\n\n${PIX_CODIGO_EXEMPLO}`;
  }
  // Números de EXEMPLO (3 vendas hoje, 128 assinantes) — só pra ilustrar
  // como a linha fica; o bot de verdade usa os números reais desta modelo.
  const provaSocialLinha = pixSocialProof
    ? (pixSocialProofTextoAtivo.trim() || PIX_PADRAO_PREVIEW.socialProofText)
        .replace(/{vendas_hoje}/gi, "3")
        .replace(/{assinantes}/gi, "128")
    : "";

  // "Verificar Status" confirma no SEGUNDO toque — mesma sensação de "toquei
  // de novo depois de pagar de verdade" que o lead teria, sem precisar de um
  // botão extra só de preview pra "forçar" a confirmação.
  function verificarStatus() {
    setStatusChecadas((n) => {
      const proxima = n + 1;
      if (proxima >= 2) setPagamentoConfirmado(true);
      return proxima;
    });
  }

  return (
    <Celular
      titulo={botUsername ? `@${botUsername}` : "seu bot"}
      inicial={(botUsername || "b").charAt(0).toUpperCase()}
      rodape={
        passaDaTela
          ? "O funil passa de uma tela — cada mensagem chega no seu momento, isto é só a leitura corrida."
          : "O funil inteiro cabe numa tela."
      }
      rodapeAlerta={passaDaTela}
      aviso={avisoDeCorte(cortados)}
      acaoTopo={
        <button
          type="button"
          onClick={reiniciar}
          disabled={!podeReiniciar}
          title="Reiniciar a simulação"
          aria-label="Reiniciar a simulação"
          className={`ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full text-[15px] transition-colors ${
            podeReiniciar
              ? "text-zinc-300 hover:bg-white/10 hover:text-white"
              : "cursor-default text-zinc-600"
          }`}
        >
          ↺
        </button>
      }
    >
      <div ref={conversaRef} className="h-full overflow-y-auto px-3 py-3" onLoad={medir}>
        <p className="mx-auto mb-1 w-fit rounded-full bg-white/10 px-2 py-0.5 text-[12px] text-zinc-300">/start</p>
        {!podeReiniciar && (
          <p className="mb-2 text-center text-[11px] text-zinc-500">👆 toque nos botões da conversa</p>
        )}

        {/* Modo internacional bilíngue: a PRIMEIRA coisa que qualquer lead
            vê, antes de qualquer conteúdo — os dois ramos passam por aqui. */}
        {intlAskFirst && (
          <>
            <PreviewBalao
              mediaIds={[]}
              text="🌎 Brasil ou fora do Brasil? / From Brazil or international?"
              buttons={[
                {
                  text: "🇧🇷 Brasil",
                  kind: "custom",
                  style: originGateStyle,
                  onClick: origemEscolhida ? undefined : () => escolherOrigem("br"),
                },
                {
                  text: "🌎 International",
                  kind: "custom",
                  style: originGateStyle,
                  onClick: origemEscolhida ? undefined : () => escolherOrigem("intl"),
                },
              ]}
              vazio=""
              onMedia={medir}
              onCortado={marcarCorte}
            />
            {origemEscolhida && (
              <Momento label={`Lead toca em "${origemEscolhida === "intl" ? "🌎 International" : "🇧🇷 Brasil"}"`} />
            )}
          </>
        )}

        {origemPronta && (
          <>
            <PreviewBalao
              mediaIds={welcomeIds}
              mode={welcomeMediaMode}
              text={welcomeAtivo}
              buttons={welcomeBotoesAtivos.map((b) => {
                if (pagamento) return b;
                if (b.kind === "plan") {
                  return { ...b, onClick: () => setPagamento({ via: intl ? "cartaoIntl" : "pix", label: b.text }) };
                }
                if (!intl && temRamoIntl && b.kind === "custom" && /not from brazil/i.test(b.text)) {
                  return { ...b, onClick: () => escolherOrigem("intl") };
                }
                // Links extras/suporte: não fazem parte do funil de
                // pagamento, então não navegam a simulação — ficam quietos.
                return b;
              })}
              effect={effectWelcome}
              vazio="(mensagem de boas-vindas vazia)"
              onMedia={medir}
              onCortado={marcarCorte}
            />

            {/* Cartão no Brasil — botão EXTRA, em mensagem PRÓPRIA depois dos
                planos em PIX. Só existe do lado brasileiro. */}
            {!intl && cardBrButtons && cardBrButtons.length > 0 && (
              <PreviewBalao
                mediaIds={[]}
                text="💳 Prefere pagar no cartão?"
                buttons={cardBrButtons.map((b) => ({
                  ...b,
                  onClick: pagamento ? undefined : () => setPagamento({ via: "cartaoBr", label: b.text }),
                }))}
                vazio=""
                onMedia={medir}
                onCortado={marcarCorte}
              />
            )}

            {/* Prova social — SEMPRE por último: depois dos planos, do "Not
                from Brazil?" (já embutido na mensagem de boas-vindas, em
                `buttons`) e do "pagar no cartão" acima. Fecha a abertura,
                não fica no meio dela. Fonte menor: é um aviso de canto, não
                parte da conversa. */}
            {provaSocialLinha && (
              <PreviewBalao
                mediaIds={[]}
                text={provaSocialLinha}
                buttons={[]}
                vazio=""
                pequeno
                onMedia={medir}
                onCortado={marcarCorte}
              />
            )}
          </>
        )}

        {pagamento && (
          <>
            <Momento label={`Lead toca em "${pagamento.label}"`} />

            {pagamento.via === "pix" ? (
              <>
                {pixGeneratingMessage.trim() && (
                  <PreviewBalao
                    mediaIds={[]}
                    text={pixGeneratingMessage}
                    buttons={[]}
                    vazio=""
                    onMedia={medir}
                    onCortado={marcarCorte}
                  />
                )}

                <PreviewBalao
                  mediaIds={[]}
                  text={legenda}
                  buttons={pixButtons.map((b, i) => ({
                    // Só "Verificar Status" (sempre o primeiro dos três)
                    // avança a simulação — QR/Copiar continuam mostrando o
                    // botão, sem revelar tela nenhuma depois deles.
                    ...b,
                    onClick: i === 0 && !pagamentoConfirmado ? verificarStatus : undefined,
                  }))}
                  effect={effectPix}
                  vazio="(sem legenda do PIX)"
                  onMedia={medir}
                  onCortado={marcarCorte}
                />

                {pixAudioUrl?.trim() && (
                  <div className="mt-1.5 flex w-fit items-center gap-1.5 rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2 text-[13px] text-zinc-300">
                    🎤 <span>Áudio</span>
                  </div>
                )}
              </>
            ) : (
              // Checkout no cartão (Stripe) — internacional ou brasileiro
              // (`acceptCardBr`): mesmo tipo de tela, o que muda é o idioma
              // dos textos. Ver CHECKOUT_INTL_TEXTS no webhook pro lado intl.
              <>
                <PreviewBalao
                  mediaIds={[]}
                  text={
                    pagamento.via === "cartaoIntl"
                      ? checkoutGerandoIntl?.trim() || "⏳ Generating your payment link..."
                      : checkoutGerandoBr?.trim() || CHECKOUT_PADRAO_PREVIEW.generatingMessage
                  }
                  buttons={[]}
                  vazio=""
                  onMedia={medir}
                  onCortado={marcarCorte}
                />
                <PreviewBalao
                  mediaIds={[]}
                  text={
                    pagamento.via === "cartaoIntl"
                      ? "Finish the payment through the link below."
                      : "Finalize o pagamento pelo link abaixo."
                  }
                  buttons={[
                    {
                      text:
                        pagamento.via === "cartaoIntl"
                          ? checkoutPayTextoIntl?.trim() || "Make payment 👉"
                          : checkoutPayTextoBr?.trim() || CHECKOUT_PADRAO_PREVIEW.payButton,
                      kind: "custom",
                      style: checkoutPayStyle,
                      // "Pagar" simula o lead saindo pro navegador e
                      // voltando já pago — ver o useEffect de abrindoPagamento.
                      onClick: pagamentoConfirmado || abrindoPagamento ? undefined : () => setAbrindoPagamento(true),
                    },
                    ...(checkoutShowCheck
                      ? [
                          {
                            text:
                              pagamento.via === "cartaoIntl"
                                ? checkoutCheckTextoIntl?.trim() || "Check payment status"
                                : checkoutCheckTextoBr?.trim() || CHECKOUT_PADRAO_PREVIEW.checkButton,
                            kind: "custom" as const,
                            style: pixCheckStyle,
                            onClick: pagamentoConfirmado ? undefined : verificarStatus,
                          },
                        ]
                      : []),
                  ]}
                  effect={effectPix}
                  vazio=""
                  onMedia={medir}
                  onCortado={marcarCorte}
                />
              </>
            )}

            {abrindoPagamento && !pagamentoConfirmado && (
              <Momento label="🌐 Lead abre o link de pagamento no navegador..." />
            )}

            {statusChecadas > 0 && !pagamentoConfirmado && (
              <PreviewBalao
                mediaIds={[]}
                text={notPaidMessage?.trim() || PIX_PADRAO_PREVIEW.notPaidMessage}
                buttons={[]}
                vazio=""
                onMedia={medir}
                onCortado={marcarCorte}
              />
            )}

            {pagamentoConfirmado && (
              <>
                <Momento label={pagamento.via === "cartaoIntl" ? "Payment confirmed" : "Pagamento confirmado"} />
                <PreviewBalao
                  mediaIds={[]}
                  text={successMessageAtivo}
                  buttons={successButtonsAtivos}
                  effect={effectSuccess}
                  vazio="(mensagem vazia)"
                  onMedia={medir}
                  onCortado={marcarCorte}
                />
              </>
            )}
          </>
        )}
      </div>
    </Celular>
  );
}

/**
 * PREVIEW DA SEQUÊNCIA de boas-vindas da Aprovação Automática.
 *
 * A tela de aprovação monta uma CONVERSA, não uma mensagem: a de boas-vindas
 * (quando reaproveitada) e depois cada passo, cada um com o seu atraso. Sem ver
 * isso num aparelho, o operador escreve quatro mensagens que sozinhas parecem
 * curtas e o lead recebe um muro de texto.
 *
 * O atraso aparece como separador entre os balões porque ele é parte do que se
 * está configurando: "imediato, +10 min, +1 h" é a diferença entre uma recepção
 * e uma metralhadora.
 */
export type PreviewPasso = {
  delayMinutes?: number;
  text: string;
  mediaIds?: string[];
  mediaMode?: "album" | "separate";
  /** Os mesmos modos do editor: sem botões, com os planos, ou próprios. */
  buttons?: "none" | "plans" | "custom";
  customButtons?: { text: string; url: string }[];
};

export function SequencePreview({
  botUsername,
  titulo,
  usarBoasVindas,
  boasVindas,
  boasVindasMedia,
  boasVindasModo,
  passos,
  planos,
  cabecalho,
}: {
  botUsername?: string;
  /** Qual sequência está desenhada — vira o rótulo de cima. */
  titulo: string;
  usarBoasVindas: boolean;
  boasVindas: string;
  boasVindasMedia: string[];
  boasVindasModo?: "album" | "separate";
  passos: PreviewPasso[];
  /** Os botões dos planos, para os passos com `buttons: "plans"`. */
  planos: Btn[];
  /** Seletor de qual grupo mostrar, desenhado acima do aparelho. */
  cabecalho?: React.ReactNode;
}) {
  const { conversaRef, passaDaTela, medir, cortados, marcarCorte } = useMedidas([
    usarBoasVindas,
    boasVindas,
    JSON.stringify(passos),
    planos.length,
  ]);

  const nenhuma = !usarBoasVindas && passos.length === 0;
  // O atraso de cada passo é ACUMULADO desde a entrada no grupo — é assim que o
  // servidor agenda, e mostrar o número do campo (que é o acumulado, não o
  // intervalo) evita o operador achar que "10" significa "10 min depois da
  // anterior".
  let acumulado = 0;

  return (
    <Celular
      titulo={botUsername ? `@${botUsername}` : "seu bot"}
      inicial={(botUsername || "b").charAt(0).toUpperCase()}
      // Aqui a régua NÃO é a mesma do /start. As mensagens chegam em horários
      // diferentes, então passar de uma tela somadas não é defeito — o que
      // importa é o tamanho de cada uma. Por isso o rodapé informa, e só fica
      // amarelo quando não há mensagem nenhuma configurada, que é erro de fato.
      rodape={
        nenhuma
          ? "Nada configurado: quem for aprovado entra no grupo e não recebe mensagem nenhuma."
          : passaDaTela
            ? "Somadas, as mensagens passam de uma tela — cada uma chega no seu horário."
            : "A conversa inteira cabe em uma tela."
      }
      rodapeAlerta={nenhuma}
      aviso={avisoDeCorte(cortados)}
      cabecalho={cabecalho}
    >
      <div ref={conversaRef} className="h-full overflow-y-auto px-3 py-3" onLoad={medir}>
        <p className="mx-auto mb-2 w-fit rounded-full bg-white/10 px-2 py-0.5 text-[12px] text-zinc-300">
          {titulo}
        </p>

        {usarBoasVindas && (
          <>
            <Momento label="Ao ser aprovado" />
            <PreviewBalao
              mediaIds={boasVindasMedia}
              mode={boasVindasModo}
              text={boasVindas}
              buttons={planos}
              vazio="(mensagem de boas-vindas vazia)"
              onMedia={medir}
              onCortado={marcarCorte}
            />
          </>
        )}

        {passos.map((p, i) => {
          acumulado = p.delayMinutes ?? 0;
          const botoes: Btn[] =
            p.buttons === "plans"
              ? planos
              : p.buttons === "custom"
                ? (p.customButtons || [])
                    .filter((b) => b.text.trim())
                    .map((b) => ({ text: b.text, kind: "custom" as const }))
                : [];
          return (
            <div key={i}>
              <Momento label={rotuloDeAtraso(acumulado)} />
              <PreviewBalao
                mediaIds={p.mediaIds || []}
                mode={p.mediaMode}
                text={p.text}
                buttons={botoes}
                vazio="(mensagem vazia)"
                onMedia={medir}
                onCortado={marcarCorte}
              />
            </div>
          );
        })}

        {nenhuma && (
          <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2 text-center text-[11px] text-amber-300">
            Nenhuma mensagem configurada para este grupo.
          </p>
        )}
      </div>
    </Celular>
  );
}

/** Separador de tempo entre os balões, no estilo da data do Telegram. */
function Momento({ label }: { label: string }) {
  return (
    <p className="mx-auto my-2 w-fit rounded-full bg-black/40 px-2 py-0.5 text-[11px] text-zinc-400">
      {label}
    </p>
  );
}

/** "Imediato", "+10 min", "+3 h", "+2 dias" — sempre a partir da entrada. */
function rotuloDeAtraso(min: number): string {
  if (min <= 0) return "Imediato";
  if (min < 60) return `+${min} min`;
  if (min < 1440) {
    const h = min / 60;
    return `+${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  }
  const d = min / 1440;
  return `+${Number.isInteger(d) ? d : d.toFixed(1)} ${d === 1 ? "dia" : "dias"}`;
}

function avisoDeCorte(cortados: string[]): string | undefined {
  if (cortados.length === 0) return undefined;
  return (
    "O Telegram corta rótulo de botão em UMA linha, com reticências — não quebra em duas. " +
    `Vai sair cortado: ${cortados.map((t) => `"${t}"`).join(", ")}. ` +
    "Encurte para o preço não sumir."
  );
}

/**
 * As duas medidas que o preview existe para dar: passou da primeira tela, e
 * quais rótulos o Telegram vai cortar.
 *
 * Vive num hook porque as duas telas fazem a mesma pergunta — e porque a
 * medição só pode acontecer DEPOIS de o conteúdo renderizar, o que é fácil de
 * errar de formas diferentes em cada cópia.
 */
function useMedidas(deps: unknown[]) {
  const conversaRef = useRef<HTMLDivElement>(null);
  const [passaDaTela, setPassaDaTela] = useState(false);
  // Guardado por texto, não por índice: reordenar os planos não pode fazer o
  // aviso apontar para o botão errado.
  const [cortados, setCortados] = useState<string[]>([]);

  const marcarCorte = useCallback((texto: string, cortado: boolean) => {
    setCortados((antes) => {
      const tem = antes.includes(texto);
      if (cortado === tem) return antes;
      return cortado ? [...antes, texto] : antes.filter((t) => t !== texto);
    });
  }, []);

  const medir = useCallback(() => {
    const el = conversaRef.current;
    if (el) setPassaDaTela(el.scrollHeight > el.clientHeight + 2);
  }, []);

  useEffect(() => {
    medir();
    const t = setTimeout(medir, 400); // as miniaturas chegam depois
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medir, ...deps]);

  return { conversaRef, passaDaTela, medir, cortados, marcarCorte };
}

/**
 * UM botão do teclado inline.
 *
 * O Telegram NÃO quebra o rótulo em duas linhas: ele corta e põe reticências.
 * Quem escreve "VIP Semestral + WHATSAPP 🔞 - R$ 69,90" num painel largo não
 * vê problema; no celular do lead o texto vira "VIP Semestral + WHATSAPP…" e
 * o PREÇO some — que é a informação pela qual o botão existe.
 *
 * Por isso o corte é reproduzido aqui (uma linha, com ellipsis) e, quando
 * acontece, o botão fica marcado: a tela precisa mostrar o estrago, não
 * escondê-lo com uma segunda linha que o app não tem. Trocar de aparelho muda
 * a resposta, e é exatamente para isso que se troca de aparelho.
 */
function BotaoDoTeclado({
  botao,
  onCortado,
}: {
  botao: Btn;
  onCortado?: (texto: string, cortado: boolean) => void;
}) {
  const aparelho = useContext(AparelhoCtx);
  const ref = useRef<HTMLSpanElement>(null);
  const [cortado, setCortado] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 1px de folga: arredondamento de subpixel marcaria falso positivo.
    const passou = el.scrollWidth > el.clientWidth + 1;
    setCortado(passou);
    onCortado?.(botao.text, passou);
    // A largura do botão vem da largura da TELA: o mesmo rótulo cabe no Pro Max
    // e corta no Galaxy, então trocar de aparelho tem que remedir.
  }, [botao.text, onCortado, aparelho.id]);

  const clicavel = Boolean(botao.onClick);

  return (
    <div
      role={clicavel ? "button" : undefined}
      tabIndex={clicavel ? 0 : undefined}
      onClick={botao.onClick}
      onKeyDown={
        clicavel
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                botao.onClick?.();
              }
            }
          : undefined
      }
      className={`relative rounded-lg border px-3 py-2 ${CORES[botao.style || ""] || CORES[""]} ${
        cortado ? "ring-1 ring-amber-400/60" : ""
      } ${clicavel ? "cursor-pointer transition-transform hover:brightness-125 active:scale-[0.98]" : ""}`}
      title={cortado ? `Cortado no Telegram: "${botao.text}"` : undefined}
    >
      <span
        ref={ref}
        className="block overflow-hidden text-ellipsis whitespace-nowrap text-center"
        style={{ fontSize: FONTES[aparelho.plataforma].botao }}
      >
        {botao.text}
      </span>
    </div>
  );
}

/**
 * A MOLDURA do aparelho, com o seletor de modelo.
 *
 * Desenha em pontos (1pt = 1px de CSS, que é a unidade em que o iOS e o Android
 * medem a tela) e depois encolhe o conjunto inteiro com `scale` para caber na
 * coluna e na janela. Encolher no fim preserva as proporções: 100% ou 62%, o
 * que se vê continua sendo a mesma tela, e o texto ocupa a mesma fatia dela.
 */
function Celular({
  titulo,
  inicial,
  rodape,
  rodapeAlerta,
  aviso,
  cabecalho,
  acaoTopo,
  children,
}: {
  titulo: string;
  inicial: string;
  rodape: string;
  rodapeAlerta: boolean;
  /** Problema concreto encontrado no que está desenhado. */
  aviso?: string;
  /** Controle extra da tela que hospeda o preview (ex.: qual grupo mostrar). */
  cabecalho?: React.ReactNode;
  /** Ação fixa no cabeçalho DA CONVERSA (dentro do aparelho, ao lado do nome
   *  do bot) — sempre visível, no lugar de um ícone de app de verdade. Existe
   *  pra coisas que precisam ser achadas sem rolar a conversa, como
   *  "reiniciar a simulação" da navegação clicável. */
  acaoTopo?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [aparelho, escolherAparelho] = useAparelho();
  const chrome = CHROME[aparelho.plataforma];
  const alturaConversa = alturaDaConversa(aparelho);
  const larguraTotal = aparelho.largura + aparelho.moldura * 2;
  const alturaTotal = aparelho.altura + aparelho.moldura * 2;

  const caixaRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  useEffect(() => {
    function ajustar() {
      const largura = caixaRef.current?.clientWidth || larguraTotal;
      // 180px reservados no eixo vertical para o seletor, a legenda e o aviso.
      const porLargura = largura / larguraTotal;
      const porAltura = (window.innerHeight - 180) / alturaTotal;
      setEscala(Math.min(1, porLargura, porAltura));
    }
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [larguraTotal, alturaTotal]);

  return (
    <AparelhoCtx.Provider value={aparelho}>
      <div className="sticky top-4">
        <div ref={caixaRef} className="flex flex-col items-center">
          {cabecalho}

          {/* O seletor fica ACIMA do aparelho: é a primeira decisão do preview
              ("no celular de quem?"), não um detalhe de rodapé. */}
          <select
            className="input mb-2 h-8 w-full max-w-[300px] py-0 text-xs"
            value={aparelho.id}
            onChange={(e) => escolherAparelho(e.target.value)}
            aria-label="Aparelho do preview"
          >
            {APARELHOS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome} · {a.largura}×{a.altura}
              </option>
            ))}
          </select>

          <div style={{ width: larguraTotal * escala, height: alturaTotal * escala }}>
            <div
              style={{
                width: larguraTotal,
                height: alturaTotal,
                transform: `scale(${escala})`,
                transformOrigin: "top left",
              }}
            >
              {/* Moldura preta em volta da tela — mais fina no Android. */}
              <div
                className="h-full w-full bg-black shadow-2xl ring-1 ring-white/10"
                style={{
                  borderRadius: aparelho.raio + aparelho.moldura,
                  padding: aparelho.moldura,
                }}
              >
                <div
                  className="relative overflow-hidden bg-[#0e1621]"
                  style={{
                    width: aparelho.largura,
                    height: aparelho.altura,
                    borderRadius: aparelho.raio,
                  }}
                >
                  <BarraDeStatus aparelho={aparelho} />

                  {/* Cabeçalho da conversa */}
                  <div
                    className="flex items-center gap-2 border-b border-white/10 bg-[#17212b] px-3"
                    style={{ height: chrome.cabecalho }}
                  >
                    <span className="text-[20px] leading-none text-[#5eb5f7]">
                      {aparelho.plataforma === "ios" ? "‹" : "←"}
                    </span>
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-sky-500/30 text-[13px] font-semibold text-sky-100">
                      {inicial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold leading-tight text-white">
                        {titulo}
                      </p>
                      <p className="text-[12px] leading-tight text-zinc-400">bot</p>
                    </div>
                    {acaoTopo}
                  </div>

                  {/* A conversa. Esta altura é a que decide o que cabe. */}
                  <div style={{ height: alturaConversa }}>{children}</div>

                  {/* Barra de digitação */}
                  <div
                    className="flex items-center gap-2 border-t border-white/10 bg-[#17212b] px-3"
                    style={{ height: chrome.digitacao }}
                  >
                    <span className="text-[18px] text-zinc-500">📎</span>
                    <span className="flex-1 text-[15px] text-zinc-500">Mensagem</span>
                    <span className="text-[18px] text-zinc-500">🎤</span>
                  </div>

                  {/* Indicador de home (iOS) ou barra de gestos (Android) */}
                  <div
                    className="flex items-center justify-center"
                    style={{ height: chrome.seguraBase }}
                  >
                    <span
                      className="rounded-full bg-white/60"
                      style={{
                        height: aparelho.plataforma === "ios" ? 5 : 4,
                        width: aparelho.plataforma === "ios" ? 134 : 108,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p
            className={`mt-2 max-w-[300px] text-center text-[11px] leading-relaxed ${
              rodapeAlerta ? "text-amber-400" : "text-zinc-500"
            }`}
          >
            {rodape}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
            {aparelho.nome} · {aparelho.largura}×{aparelho.altura}{" "}
            {aparelho.plataforma === "ios" ? "pt" : "dp"}
            {escala < 1 && ` · exibido a ${Math.round(escala * 100)}%`}
          </p>

          {aviso && (
            <p className="mt-2 max-w-[380px] rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-amber-300">
              {aviso}
            </p>
          )}
        </div>
      </div>
    </AparelhoCtx.Provider>
  );
}

/**
 * Barra de status com o recorte do topo.
 *
 * O recorte não é enfeite: no iPhone com notch ele reserva 47pt e na ilha, 59 —
 * doze pontos que saem da conversa. Desenhá-lo do jeito certo é o que faz a
 * altura restante ser crível.
 */
function BarraDeStatus({ aparelho }: { aparelho: Aparelho }) {
  const ios = aparelho.plataforma === "ios";
  return (
    <div
      className={`relative flex items-end justify-between ${ios ? "px-7 pb-1.5" : "px-4 pb-0.5"}`}
      style={{ height: aparelho.seguraTopo }}
    >
      <span className={`font-semibold text-white ${ios ? "text-[15px]" : "text-[11px]"}`}>9:41</span>

      {aparelho.topo === "notch" && (
        <div className="absolute left-1/2 top-0 h-[30px] w-[157px] -translate-x-1/2 rounded-b-[18px] bg-black" />
      )}
      {aparelho.topo === "ilha" && (
        <div className="absolute left-1/2 top-[11px] h-[37px] w-[125px] -translate-x-1/2 rounded-full bg-black" />
      )}
      {aparelho.topo === "furo" && (
        <div className="absolute left-1/2 top-[7px] h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-black" />
      )}

      <span className={`flex items-center gap-1 text-white ${ios ? "text-[12px]" : "text-[10px]"}`}>
        ▮▮▮ <span className={ios ? "text-[11px]" : "text-[9px]"}>WiFi</span>
        <span
          className="ml-0.5 inline-block rounded-[3px] border border-white/70 p-[1.5px]"
          style={{ height: ios ? 11 : 9, width: ios ? 22 : 18 }}
        >
          <span className="block h-full w-3/4 rounded-[1px] bg-white" />
        </span>
      </span>
    </div>
  );
}

/**
 * UM balão — mídias, texto e botões.
 *
 * Vive separado porque a Recuperação e as sequências de aprovação mostram a
 * mesma coisa passo a passo: uma mensagem só. Se cada tela desenhasse o seu
 * próprio balão, "ver como fica" significaria coisas diferentes em cada uma.
 *
 * O tamanho do texto é o do Telegram no aparelho escolhido (17pt no iOS, 16 no
 * Android), não o da nossa interface: é ele que decide quantas linhas a
 * mensagem ocupa no celular do lead.
 */
export function PreviewBalao({
  mediaIds,
  mode,
  text,
  buttons,
  effect,
  vazio = "(mensagem vazia)",
  pequeno,
  onMedia,
  onCortado,
}: {
  mediaIds: string[];
  mode?: "album" | "separate";
  text: string;
  buttons: Btn[];
  effect?: string;
  vazio?: string;
  /** Fonte menor e cor mais apagada — pra um aviso de canto (prova social)
   *  se diferenciar visualmente de uma fala de verdade da conversa. */
  pequeno?: boolean;
  /** Avisa quem mede a altura de que uma miniatura acabou de carregar. */
  onMedia?: () => void;
  /** Avisa que um botão não coube numa linha e vai sair cortado. */
  onCortado?: (texto: string, cortado: boolean) => void;
}) {
  const aparelho = useContext(AparelhoCtx);
  const fontes = FONTES[aparelho.plataforma];
  // Separadas = o texto e os botões vão na ÚLTIMA mídia; em álbum eles vêm
  // numa mensagem própria logo abaixo. É diferença que o lead enxerga, não só
  // detalhe de como o servidor envia.
  const separadas = mode === "separate" && mediaIds.length > 1;
  const texto = (text || "").replace(/{nome}/gi, "Otton");

  return (
    <div className="space-y-1.5">
      {mediaIds.length > 0 && (
        <div
          className={`grid gap-0.5 overflow-hidden rounded-2xl rounded-tl-md ${
            mediaIds.length > 1 && !separadas ? "grid-cols-2" : "grid-cols-1"
          }`}
          style={{ maxWidth: separadas ? "70%" : "80%" }}
        >
          {mediaIds.map((id, i) => (
            <div key={id} className="relative aspect-[3/4] bg-black/40">
              <img
                src={`/api/media/${id}/thumbnail`}
                alt=""
                className="h-full w-full object-cover"
                onLoad={onMedia}
              />
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
                {i + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        className="relative w-fit rounded-2xl rounded-tl-md bg-[#182533] px-3 py-2"
        style={{ maxWidth: "85%" }}
      >
        {EFEITO_EMOJI[effect || ""] && (
          <span
            className="absolute -right-2 -top-2 rounded-full bg-[#0e1621] px-1.5 py-0.5 text-[12px]"
            title="Efeito de mensagem: a animação roda quando a mensagem chega (só no privado)"
          >
            {EFEITO_EMOJI[effect || ""]}
          </span>
        )}
        {/* `whitespace-pre-wrap` porque a quebra de linha do campo é a mesma que
            o app mostra. */}
        <p
          className={`whitespace-pre-wrap break-words ${pequeno ? "text-zinc-400" : "text-white"}`}
          style={{
            fontSize: pequeno ? Math.round(fontes.texto * 0.82) : fontes.texto,
            lineHeight: `${Math.round((pequeno ? fontes.linha * 0.82 : fontes.linha))}px`,
          }}
        >
          {texto || <span className="text-zinc-500">{vazio}</span>}
        </p>
      </div>

      {buttons.length > 0 && (
        <div className="space-y-0.5" style={{ maxWidth: "85%" }}>
          {buttons.map((b, i) => (
            <BotaoDoTeclado key={`${b.kind}-${i}`} botao={b} onCortado={onCortado} />
          ))}
        </div>
      )}
    </div>
  );
}
