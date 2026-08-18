"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { IconPlus, IconClose } from "@/components/icons";

/**
 * Escolha das mídias de abertura do /start — até 10, na ORDEM em que serão
 * enviadas.
 *
 * Convive com o campo de etiquetas, e a diferença entre os dois é intencional:
 * a etiqueta SORTEIA uma mídia a cada /start (bom para variar entre leads), a
 * lista explícita manda sempre as mesmas, na ordem escolhida (bom para uma
 * abertura montada, tipo uma sequência que conta uma história). Quando há
 * lista, ela tem prioridade — é o que o webhook faz.
 */
type Item = { id: string; kind: "image" | "video"; updatedAt?: number; createdAt: number; filename: string };

export default function MediaPicker({
  profileId,
  selected,
  onChange,
  max = 10,
  apenasImagens = false,
}: {
  profileId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  /** Esconde vídeo da grade de escolha — usado onde só faz sentido imagem
   *  (ex.: referência para o gerador de imagem). Não filtra as JÁ escolhidas,
   *  para nunca sumir uma seleção antiga por baixo dos panos. */
  apenasImagens?: boolean;
}) {
  const [allRaw, setAll] = useState<Item[]>([]);
  const all = apenasImagens ? allRaw.filter((m) => m.kind === "image") : allRaw;
  const [abrindo, setAbrindo] = useState(false);
  const [carregando, setCarregando] = useState(false);

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

  function alternar(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : selected.length >= max
          ? selected
          : [...selected, id],
    );
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
        {selected.length < max && (
          <button
            type="button"
            onClick={() => setAbrindo((v) => !v)}
            className="grid h-20 w-16 place-items-center rounded-lg border border-dashed border-white/15 text-zinc-500 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
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
          ) : all.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">
              Nenhuma mídia na Galeria desta modelo ainda.
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-5 gap-1.5 overflow-y-auto sm:grid-cols-8">
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
          )}
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            {selected.length}/{max} escolhidas · clique para incluir ou tirar
          </p>
        </div>
      )}
    </div>
  );
}
