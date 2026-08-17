"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * PREVIEW AO VIVO do /start, dentro de uma tela de celular DE VERDADE.
 *
 * Não é enfeite: o que o operador precisa saber é o que cabe na primeira tela
 * do lead — onde a mensagem corta, se os botões aparecem sem rolar, se a foto
 * empurra tudo para baixo. Num painel largo, um preview solto sempre parece
 * confortável; no celular do lead, não é.
 *
 * Por isso as medidas são as do aparelho, não aproximações: 390×844 pt do
 * iPhone 12/13/14 (a linha comum, não Max nem Plus), com as áreas seguras e a
 * altura real de cada barra do Telegram descontadas. O que sobra é a janela de
 * conversa honesta.
 */

/** iPhone 12/13/14: 390×844 pontos, densidade 3×. */
const TELA = { largura: 390, altura: 844 };

/**
 * Alturas em pontos, medidas no aparelho.
 *
 * `seguraTopo` é a área do notch (47pt no 12/13/14); `seguraBase` é a faixa do
 * indicador de home (34pt). O cabeçalho de conversa do Telegram tem 44pt e a
 * barra de digitação, 50pt. Somadas, comem 175pt dos 844 — mais de um quinto
 * da tela, que é exatamente o erro que um preview sem moldura esconde.
 */
const ALTURAS = { seguraTopo: 47, cabecalho: 44, digitacao: 50, seguraBase: 34 };
const ALTURA_CONVERSA =
  TELA.altura - ALTURAS.seguraTopo - ALTURAS.cabecalho - ALTURAS.digitacao - ALTURAS.seguraBase;

/** O estilo é o MESMO que vai para o Telegram (Bot API 9.4). */
export type PreviewStyle = "" | "primary" | "success" | "danger";
type Btn = { text: string; kind: "plan" | "custom" | "support"; style?: PreviewStyle };

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
  const conversaRef = useRef<HTMLDivElement>(null);
  const [passaDaTela, setPassaDaTela] = useState(false);
  // Quais rótulos o Telegram vai cortar. Guardado por texto, não por índice:
  // reordenar os planos não pode fazer o aviso apontar para o botão errado.
  const [cortados, setCortados] = useState<string[]>([]);
  const marcarCorte = useCallback((texto: string, cortado: boolean) => {
    setCortados((antes) => {
      const tem = antes.includes(texto);
      if (cortado === tem) return antes;
      return cortado ? [...antes, texto] : antes.filter((t) => t !== texto);
    });
  }, []);

  // Passou da primeira tela? É a pergunta que o preview existe para responder,
  // e ela só pode ser medida DEPOIS de o conteúdo renderizar.
  const medir = useCallback(() => {
    const el = conversaRef.current;
    if (el) setPassaDaTela(el.scrollHeight > el.clientHeight + 2);
  }, []);
  useEffect(() => {
    medir();
    const t = setTimeout(medir, 400); // as miniaturas chegam depois
    return () => clearTimeout(t);
  }, [medir, welcomeMessage, welcomeMediaIds, welcomeMediaMode, buttons.length]);

  return (
    <Aparelho
      titulo={botUsername ? `@${botUsername}` : "seu bot"}
      inicial={(botUsername || "b").charAt(0).toUpperCase()}
      rodape={
        passaDaTela
          ? "A mensagem passa da primeira tela — o lead precisa rolar para ver o resto."
          : "Tudo cabe na primeira tela."
      }
      rodapeAlerta={passaDaTela}
      aviso={
        cortados.length > 0
          ? `O Telegram corta rótulo de botão em UMA linha, com reticências — não quebra em duas. ` +
            `Vai sair cortado: ${cortados.map((t) => `"${t}"`).join(", ")}. ` +
            `Encurte para o preço não sumir.`
          : undefined
      }
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
            Nenhum botão: sem plano cadastrado, o lead recebe a mensagem e não tem como comprar.
          </p>
        )}
      </div>
    </Aparelho>
  );
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
 * escondê-lo com uma segunda linha que o app não tem.
 */
function BotaoDoTeclado({
  botao,
  onCortado,
}: {
  botao: Btn;
  onCortado?: (texto: string, cortado: boolean) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cortado, setCortado] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 1px de folga: arredondamento de subpixel marcaria falso positivo.
    const passou = el.scrollWidth > el.clientWidth + 1;
    setCortado(passou);
    onCortado?.(botao.text, passou);
  }, [botao.text, onCortado]);

  return (
    <div
      className={`relative rounded-lg border px-3 py-2 ${CORES[botao.style || ""] || CORES[""]} ${
        cortado ? "ring-1 ring-amber-400/60" : ""
      }`}
      title={cortado ? `Cortado no Telegram: "${botao.text}"` : undefined}
    >
      <span
        ref={ref}
        className="block overflow-hidden text-ellipsis whitespace-nowrap text-center"
        style={{ fontSize: 15 }}
      >
        {botao.text}
      </span>
    </div>
  );
}

/**
 * A MOLDURA do aparelho.
 *
 * Desenha em pontos (1pt = 1px de CSS, que é a unidade em que o iOS mede a
 * tela) e depois encolhe o conjunto inteiro com `scale` para caber na coluna e
 * na janela. Encolher no fim preserva as proporções: 100% ou 62%, o que se vê
 * continua sendo a mesma tela, e o texto ocupa a mesma fatia dela.
 */
function Aparelho({
  titulo,
  inicial,
  rodape,
  rodapeAlerta,
  aviso,
  children,
}: {
  titulo: string;
  inicial: string;
  rodape: string;
  rodapeAlerta: boolean;
  /** Problema concreto encontrado no que está desenhado. */
  aviso?: string;
  children: React.ReactNode;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  useEffect(() => {
    function ajustar() {
      const largura = caixaRef.current?.clientWidth || TELA.largura;
      // 24pt de folga da moldura de cada lado, e 140px reservados no eixo
      // vertical para o cabeçalho do cartão e a legenda de baixo.
      const porLargura = largura / (TELA.largura + 24);
      const porAltura = (window.innerHeight - 140) / (TELA.altura + 24);
      setEscala(Math.min(1, porLargura, porAltura));
    }
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);

  return (
    <div className="sticky top-4">
      <div ref={caixaRef} className="flex flex-col items-center">
        <div
          style={{
            width: (TELA.largura + 24) * escala,
            height: (TELA.altura + 24) * escala,
          }}
        >
          <div
            style={{
              width: TELA.largura + 24,
              height: TELA.altura + 24,
              transform: `scale(${escala})`,
              transformOrigin: "top left",
            }}
          >
            {/* Bezel: 12pt de moldura preta em volta da tela. */}
            <div className="h-full w-full rounded-[59px] bg-black p-3 shadow-2xl ring-1 ring-white/10">
              <div
                className="relative overflow-hidden rounded-[47px] bg-[#0e1621]"
                style={{ width: TELA.largura, height: TELA.altura }}
              >
                {/* Barra de status + notch */}
                <div
                  className="relative flex items-end justify-between px-7 pb-1.5"
                  style={{ height: ALTURAS.seguraTopo }}
                >
                  <span className="text-[15px] font-semibold text-white">9:41</span>
                  <div className="absolute left-1/2 top-0 h-[30px] w-[157px] -translate-x-1/2 rounded-b-[18px] bg-black" />
                  <span className="flex items-center gap-1 text-[12px] text-white">
                    ▮▮▮ <span className="text-[11px]">WiFi</span>
                    <span className="ml-0.5 inline-block h-[11px] w-[22px] rounded-[3px] border border-white/70 p-[1.5px]">
                      <span className="block h-full w-3/4 rounded-[1px] bg-white" />
                    </span>
                  </span>
                </div>

                {/* Cabeçalho da conversa */}
                <div
                  className="flex items-center gap-2 border-b border-white/10 bg-[#17212b] px-3"
                  style={{ height: ALTURAS.cabecalho }}
                >
                  <span className="text-[20px] leading-none text-[#5eb5f7]">‹</span>
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-sky-500/30 text-[13px] font-semibold text-sky-100">
                    {inicial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold leading-tight text-white">{titulo}</p>
                    <p className="text-[12px] leading-tight text-zinc-400">bot</p>
                  </div>
                </div>

                {/* A conversa. Esta altura é a que decide o que cabe. */}
                <div style={{ height: ALTURA_CONVERSA }}>{children}</div>

                {/* Barra de digitação */}
                <div
                  className="flex items-center gap-2 border-t border-white/10 bg-[#17212b] px-3"
                  style={{ height: ALTURAS.digitacao }}
                >
                  <span className="text-[18px] text-zinc-500">📎</span>
                  <span className="flex-1 text-[15px] text-zinc-500">Mensagem</span>
                  <span className="text-[18px] text-zinc-500">🎤</span>
                </div>

                {/* Indicador de home */}
                <div
                  className="flex items-center justify-center"
                  style={{ height: ALTURAS.seguraBase }}
                >
                  <span className="h-[5px] w-[134px] rounded-full bg-white/60" />
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
          iPhone 12/13/14 · 390×844 pt{escala < 1 && ` · exibido a ${Math.round(escala * 100)}%`}
        </p>

        {aviso && (
          <p className="mt-2 max-w-[380px] rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-amber-300">
            {aviso}
          </p>
        )}
      </div>
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
 * O tamanho do texto é o do Telegram no iOS (17pt), não o da nossa interface:
 * é ele que decide quantas linhas a mensagem ocupa no celular do lead.
 */
export function PreviewBalao({
  mediaIds,
  mode,
  text,
  buttons,
  effect,
  vazio = "(mensagem vazia)",
  onMedia,
  onCortado,
}: {
  mediaIds: string[];
  mode?: "album" | "separate";
  text: string;
  buttons: Btn[];
  effect?: string;
  vazio?: string;
  /** Avisa quem mede a altura de que uma miniatura acabou de carregar. */
  onMedia?: () => void;
  /** Avisa que um botão não coube numa linha e vai sair cortado. */
  onCortado?: (texto: string, cortado: boolean) => void;
}) {
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
        {/* 17px é o corpo de texto do Telegram no iOS. `whitespace-pre-wrap`
            porque a quebra de linha do campo é a mesma que o app mostra. */}
        <p
          className="whitespace-pre-wrap break-words text-white"
          style={{ fontSize: 17, lineHeight: "22px" }}
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
