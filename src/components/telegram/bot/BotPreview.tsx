"use client";

/**
 * PREVIEW AO VIVO do /start: o que o lead vê ao abrir a conversa com o bot.
 *
 * Mostra as três coisas que decidem se a abertura funciona e que, separadas,
 * ninguém confere de cabeça: as MÍDIAS na ordem em que vão sair, o TEXTO como
 * ele vai chegar e os BOTÕES nas CORES REAIS — a cor do plano quando ele tem
 * uma, e o estilo configurado em Configurações quando não tem, que é
 * exatamente a regra do envio.
 *
 * O sorteio por etiqueta saiu daqui junto com o campo que o alimentava. O
 * preview de um sorteio só podia mostrar o conjunto de onde ele sortearia —
 * ou seja, nunca a mensagem de verdade.
 */
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
  primary: "border-sky-500/40 bg-sky-500/15 text-sky-200",
  success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  danger: "border-red-500/40 bg-red-500/15 text-red-200",
  "": "border-white/15 bg-white/[0.06] text-zinc-200",
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

  return (
    <div className="card sticky top-4 overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-white/10 p-3.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-300">
          {(botUsername || "b").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {botUsername ? `@${botUsername}` : "seu bot"}
          </p>
          <p className="text-[11px] text-zinc-500">bot</p>
        </div>
        <span className="eyebrow shrink-0">Preview ao vivo</span>
      </div>

      <div className="max-h-[70vh] space-y-2.5 overflow-y-auto bg-ink-900/60 p-3.5">
        <p className="mx-auto w-fit rounded-full bg-white/5 px-2.5 py-0.5 font-mono text-[11px] text-zinc-400">
          /start
        </p>

        {ids.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/10 p-3 text-center text-[11px] text-zinc-500">
            Sem mídia escolhida: o /start sai só com o texto.
          </p>
        )}

        <PreviewBalao
          mediaIds={ids}
          mode={welcomeMediaMode}
          text={welcomeMessage}
          buttons={buttons}
          effect={effect}
          vazio="(mensagem de boas-vindas vazia)"
        />

        {buttons.length === 0 && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-center text-[11px] text-amber-300">
            Nenhum botão: sem plano cadastrado, o lead recebe a mensagem e não tem como comprar.
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
 */
export function PreviewBalao({
  mediaIds,
  mode,
  text,
  buttons,
  effect,
  vazio = "(mensagem vazia)",
}: {
  mediaIds: string[];
  mode?: "album" | "separate";
  text: string;
  buttons: Btn[];
  effect?: string;
  vazio?: string;
}) {
  // Separadas = o texto e os botões vão na ÚLTIMA mídia; em álbum eles vêm
  // numa mensagem própria logo abaixo. É diferença que o lead enxerga, não só
  // detalhe de como o servidor envia.
  const separadas = mode === "separate" && mediaIds.length > 1;
  const texto = (text || "").replace(/{nome}/gi, "Otton");

  return (
    <div className="space-y-2">
      {mediaIds.length > 0 && (
        <>
          <div
            className={`grid gap-1 overflow-hidden rounded-lg ${
              mediaIds.length > 1 && !separadas ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {mediaIds.slice(0, 6).map((id, i) => (
              <div key={id} className="relative aspect-[3/4] bg-ink-850">
                <img src={`/api/media/${id}/thumbnail`} alt="" className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
          <p className="text-center text-[11px] text-zinc-500">
            {mediaIds.length} mídia(s) ·{" "}
            {separadas
              ? "uma mensagem por mídia"
              : mediaIds.length > 1
                ? "álbum único"
                : "mensagem única"}
          </p>
        </>
      )}

      <div className="relative rounded-2xl rounded-tl-sm bg-sky-950/50 p-3">
        {EFEITO_EMOJI[effect || ""] && (
          <span
            className="absolute -right-1 -top-2 rounded-full border border-white/10 bg-ink-850 px-1.5 py-0.5 text-[11px]"
            title="Efeito de mensagem: a animação roda quando a mensagem chega (só no privado)"
          >
            {EFEITO_EMOJI[effect || ""]}
          </span>
        )}
        {/* `whitespace-pre-wrap` porque a quebra de linha do campo é a mesma
            que o Telegram mostra. */}
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-100">
          {texto || <span className="text-zinc-500">{vazio}</span>}
        </p>
      </div>

      {buttons.length > 0 && (
        <div className="space-y-1">
          {buttons.map((b, i) => (
            <div
              key={`${b.kind}-${i}`}
              className={`rounded-lg border px-3 py-2 text-center text-[12px] ${CORES[b.style || ""] || CORES[""]}`}
            >
              {b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
