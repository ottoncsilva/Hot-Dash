"use client";

import { useCallback, useEffect, useState } from "react";
import { apiSend } from "@/lib/api";

/**
 * PREVIEW AO VIVO do /start: o que o lead vê ao abrir a conversa com o bot.
 *
 * O ponto cego que isto fecha é a MÍDIA. As mensagens dá para reler no próprio
 * campo, mas a mídia de boas-vindas é escolhida por ETIQUETA e sorteada na
 * hora do envio — você escrevia "previa, quente" e não tinha como saber se
 * existia alguma mídia com aquela etiqueta, quantas eram, nem o que apareceria.
 * Um erro de digitação na etiqueta virava um /start sem foto nenhuma, e só o
 * lead descobria.
 *
 * A consulta usa o MESMO casamento de etiquetas que o webhook faz na hora de
 * enviar (rota `welcome-media`) — se divergisse, o preview mentiria.
 */
type PreviewMedia = { id: string; kind: "image" | "video"; updatedAt: number };
type Btn = { text: string; kind: "plan" | "custom" | "support" };

export default function BotPreview({
  profileId,
  botUsername,
  welcomeMessage,
  welcomeMediaTags,
  welcomeMediaIds,
  welcomeMediaMode,
  buttons,
}: {
  profileId: string;
  botUsername?: string;
  welcomeMessage: string;
  welcomeMediaTags: string;
  /** Mídias escolhidas a dedo. Quando há alguma, o bot ignora as etiquetas. */
  welcomeMediaIds?: string[];
  welcomeMediaMode?: "album" | "separate";
  buttons: Btn[];
}) {
  const [media, setMedia] = useState<PreviewMedia[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const explicitas = welcomeMediaIds && welcomeMediaIds.length > 0;

  const load = useCallback(async () => {
    if (!profileId || explicitas) return;
    setLoading(true);
    try {
      const r = await apiSend<{ ok: boolean; total: number; items: PreviewMedia[] }>(
        "/api/telegram",
        "POST",
        { action: "welcome-media", profileId, tags: welcomeMediaTags },
      );
      setMedia(r.items || []);
      setTotal(r.total || 0);
    } catch {
      setMedia([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [profileId, welcomeMediaTags, explicitas]);

  // Espera o operador parar de digitar antes de consultar: o campo de
  // etiquetas dispararia uma requisição por tecla.
  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load]);

  const texto = (welcomeMessage || "").replace(/{nome}/gi, "Otton");
  const semEtiquetas = !welcomeMediaTags.trim();

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

        {/* Duas fontes possíveis de mídia, e a explícita manda. Com etiquetas,
            mostramos TODAS as candidatas: o que importa para conferir a
            configuração é o conjunto de onde o bot vai sortear. */}
        {explicitas ? (
          <>
            <div
              className={`grid gap-1 overflow-hidden rounded-lg ${
                welcomeMediaIds!.length > 1 ? "grid-cols-2" : "grid-cols-1"
              }`}
            >
              {welcomeMediaIds!.slice(0, 4).map((id, i) => (
                <div key={id} className="relative aspect-[3/4] bg-ink-850">
                  <img src={`/api/media/${id}/thumbnail`} alt="" className="h-full w-full object-cover" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-zinc-500">
              {welcomeMediaIds!.length} mídia(s) fixa(s) ·{" "}
              {welcomeMediaMode === "separate" ? "uma mensagem por mídia" : "álbum único"}
              {welcomeMediaIds!.length > 4 && " · mostrando as 4 primeiras"}
            </p>
          </>
        ) : semEtiquetas ? (
          <p className="rounded-lg border border-dashed border-white/10 p-3 text-center text-[11px] text-zinc-500">
            Sem etiquetas de mídia: o /start sai só com o texto.
          </p>
        ) : loading ? (
          <div className="grid h-24 place-items-center">
            <div className="h-5 w-5 animate-spin rounded-full border border-white/15 border-t-white" />
          </div>
        ) : total === 0 ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/[0.07] p-3 text-center text-[11px] text-red-300">
            Nenhuma mídia com {welcomeMediaTags.trim()}. O /start vai sair sem foto — confira as
            etiquetas na Galeria.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-lg">
              {media.slice(0, 4).map((m) => (
                <div key={m.id} className="relative aspect-[3/4] bg-ink-850">
                  {/* A rota de miniatura é a mesma que a Galeria usa: serve o
                      pôster do vídeo e a versão leve da imagem. */}
                  <img
                    src={`/api/media/${m.id}/thumbnail?v=${m.updatedAt}`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {m.kind === "video" && (
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
                      vídeo
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-zinc-500">
              {total} mídia(s) com essas etiquetas — o bot sorteia <b>uma</b> a cada /start.
            </p>
          </>
        )}

        {/* Balão da mensagem. `whitespace-pre-wrap` porque a quebra de linha do
            campo é a mesma que o Telegram mostra. */}
        <div className="rounded-2xl rounded-tl-sm bg-sky-950/50 p-3">
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-100">
            {texto || <span className="text-zinc-500">(mensagem de boas-vindas vazia)</span>}
          </p>
        </div>

        {buttons.length > 0 && (
          <div className="space-y-1">
            {buttons.map((b, i) => (
              <div
                key={`${b.kind}-${i}`}
                className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-center text-[12px] text-sky-200"
              >
                {b.text}
              </div>
            ))}
          </div>
        )}
        {buttons.length === 0 && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-center text-[11px] text-amber-300">
            Nenhum botão: sem plano cadastrado, o lead recebe a mensagem e não tem como comprar.
          </p>
        )}
      </div>
    </div>
  );
}
