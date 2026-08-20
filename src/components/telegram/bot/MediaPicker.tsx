"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { IconPlus, IconClose, IconUpload } from "@/components/icons";

/**
 * Escolha de mídia da modelo — o controle ÚNICO de "escolher foto/vídeo" do
 * painel inteiro.
 *
 * Nasceu para as mídias de abertura do /start (até 10, na ORDEM em que serão
 * enviadas) e hoje serve também os geradores. A diferença para o campo de
 * etiquetas continua valendo onde os dois convivem: a etiqueta SORTEIA uma
 * mídia a cada /start (bom para variar entre leads), a lista explícita manda
 * sempre as mesmas, na ordem escolhida. Quando há lista, ela tem prioridade.
 *
 * ENVIO DO DISPOSITIVO: quem passa `onArquivo` ganha, como PRIMEIRO item da
 * grade, o atalho para pegar um arquivo do aparelho. É de propósito que não
 * exista um segundo botão fora daqui: antes cada tela tinha um "+" para a
 * Galeria e uma caixa tracejada separada para o upload, e ninguém entendia
 * que as duas eram a mesma pergunta ("qual foto?"). O arquivo escolhido não
 * entra na Galeria — quem chama decide o que fazer com ele e devolve a
 * pré-visualização em `locais`.
 */
type Item = { id: string; kind: "image" | "video"; updatedAt?: number; createdAt: number; filename: string };

/** Um arquivo já escolhido do dispositivo, para aparecer junto das da Galeria. */
export type ArquivoLocal = {
  /** URL de pré-visualização (normalmente um object URL). */
  url: string;
  kind: "image" | "video";
  onRemover: () => void;
};

export default function MediaPicker({
  profileId,
  selected,
  onChange,
  max = 10,
  apenasImagens = false,
  apenasVideos = false,
  onArquivo,
  locais = [],
  enviando = false,
}: {
  profileId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  /** Esconde vídeo da grade de escolha — usado onde só faz sentido imagem
   *  (ex.: referência para o gerador de imagem). Não filtra as JÁ escolhidas,
   *  para nunca sumir uma seleção antiga por baixo dos panos. */
  apenasImagens?: boolean;
  /** O inverso: só vídeo (ex.: a referência de movimento do Motion Control). */
  apenasVideos?: boolean;
  /** Liga o atalho "do dispositivo". Sem isto, só a Galeria aparece. */
  onArquivo?: (file: File) => void;
  /** Pré-visualização do que veio do dispositivo — conta para o `max`. */
  locais?: ArquivoLocal[];
  /** Mostra o arquivo local ainda subindo. */
  enviando?: boolean;
}) {
  const [allRaw, setAll] = useState<Item[]>([]);
  const all = apenasImagens
    ? allRaw.filter((m) => m.kind === "image")
    : apenasVideos
      ? allRaw.filter((m) => m.kind === "video")
      : allRaw;
  const [abrindo, setAbrindo] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    if (all.length > 0) return;
    setCarregando(true);
    try {
      const d = await apiGet<{ media: Item[] }>(`/api/profiles/${profileId}/media`);
      setAll(d.media || []);
    } catch {
      setAll([]);
    } finally {
      setCarregando(false);
    }
  }, [profileId, all.length]);

  useEffect(() => {
    if (abrindo) carregar();
  }, [abrindo, carregar]);

  // As escolhidas são renderizadas na ORDEM da seleção, não na da galeria —
  // essa ordem é a que o Telegram vai mostrar.
  const escolhidas = selected
    .map((id) => all.find((m) => m.id === id) || { id, kind: "image" as const, createdAt: 0, filename: "" })
    .filter(Boolean);

  const total = selected.length + locais.length;
  const aceita = apenasVideos ? "video/*" : apenasImagens ? "image/*" : "image/*,video/*";

  function alternar(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : total >= max
          ? selected
          : [...selected, id],
    );
  }

  function receber(file: File | null | undefined) {
    if (!file || !onArquivo) return;
    onArquivo(file);
    setAbrindo(false);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {escolhidas.map((m, i) => (
          <div key={m.id} className="relative h-20 w-16 overflow-hidden rounded-lg border border-white/10">
            <img
              src={`/api/media/${m.id}/thumbnail?v=${m.updatedAt || m.createdAt}`}
              alt=""
              className="h-full w-full object-cover"
            />
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
              {i + 1}
              {m.kind === "video" ? " ▸" : ""}
            </span>
            <button
              type="button"
              onClick={() => onChange(selected.filter((s) => s !== m.id))}
              className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white"
              aria-label="Remover mídia"
            >
              <IconClose size={10} />
            </button>
          </div>
        ))}

        {/* O que veio do dispositivo fica no MESMO lugar das da Galeria: para
            quem usa, a origem do arquivo é detalhe, o que importa é o que foi
            escolhido. */}
        {locais.map((l, i) => (
          <div
            key={`local-${i}`}
            className="relative h-20 w-16 overflow-hidden rounded-lg border border-white/10"
          >
            {l.kind === "video" ? (
              <video src={l.url} muted playsInline className="h-full w-full object-cover" />
            ) : (
              <img src={l.url} alt="" className="h-full w-full object-cover" />
            )}
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
              {escolhidas.length + i + 1}
              {l.kind === "video" ? " ▸" : ""}
            </span>
            <button
              type="button"
              onClick={l.onRemover}
              className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white"
              aria-label="Remover mídia"
            >
              <IconClose size={10} />
            </button>
          </div>
        ))}

        {enviando && (
          <div className="grid h-20 w-16 place-items-center rounded-lg border border-dashed border-white/15">
            <span className="h-4 w-4 animate-spin rounded-full border border-white/15 border-t-white" />
          </div>
        )}

        {total < max && !enviando && (
          <button
            type="button"
            onClick={() => setAbrindo((v) => !v)}
            onDragOver={onArquivo ? (e) => e.preventDefault() : undefined}
            onDrop={
              onArquivo
                ? (e) => {
                    e.preventDefault();
                    receber(e.dataTransfer.files?.[0]);
                  }
                : undefined
            }
            className="grid h-20 w-16 place-items-center rounded-lg border border-dashed border-white/15 text-zinc-500 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
            aria-label="Escolher mídia"
          >
            <IconPlus size={16} />
          </button>
        )}
      </div>

      {abrindo && (
        <div className="mt-2 rounded-xl border border-white/10 bg-ink-850 p-2">
          {carregando ? (
            <div className="grid h-24 place-items-center">
              <div className="h-5 w-5 animate-spin rounded-full border border-white/15 border-t-white" />
            </div>
          ) : (
            <>
              <div className="grid max-h-64 grid-cols-5 gap-1.5 overflow-y-auto sm:grid-cols-8">
                {/* PRIMEIRO item: o aparelho. Fica na grade, e não num botão à
                    parte, porque a pergunta é a mesma das outras casinhas. */}
                {onArquivo && (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="grid aspect-[3/4] place-items-center gap-0.5 rounded-md border border-dashed border-white/20 text-zinc-500 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
                  >
                    <IconUpload size={15} />
                    <span className="px-0.5 text-center text-[9px] leading-tight">do aparelho</span>
                  </button>
                )}
                {all.map((m) => {
                  const i = selected.indexOf(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => alternar(m.id)}
                      className={`relative aspect-[3/4] overflow-hidden rounded-md border transition-colors ${
                        i >= 0 ? "border-emerald-500" : "border-transparent hover:border-white/30"
                      }`}
                    >
                      <img
                        src={`/api/media/${m.id}/thumbnail?v=${m.updatedAt || m.createdAt}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      {i >= 0 && (
                        <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[10px] font-bold text-black">
                          {i + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {all.length === 0 && (
                <p className="pt-2 text-center text-xs text-zinc-500">
                  Nenhuma mídia na Galeria desta modelo ainda.
                </p>
              )}
            </>
          )}
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            {total}/{max} escolhidas · clique para incluir ou tirar
          </p>
          {onArquivo && (
            <input
              ref={inputRef}
              type="file"
              accept={aceita}
              className="hidden"
              onChange={(e) => {
                receber(e.target.files?.[0]);
                e.target.value = ""; // permite reescolher o mesmo arquivo
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
