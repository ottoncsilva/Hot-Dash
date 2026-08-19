"use client";

import { useEffect, useMemo, useState } from "react";
import { apiUpload } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { IconDownload, IconCheck, IconTrash, IconChevronRight, IconArrowLeft } from "@/components/icons";
import Modal from "@/components/Modal";
import {
  listarResultados,
  removerResultado,
  type ResultadoGerado,
  type TipoResultado,
} from "@/lib/resultadosDb";
import { formatarUsd, formatarBrl } from "@/lib/aiMediaOptions";
import type { MediaItem } from "@/lib/types";

/**
 * A faixa de resultados dos dois geradores.
 *
 * É um componente só porque imagem e vídeo precisam exatamente do mesmo
 * comportamento — rolagem lateral, seleção múltipla, salvar/baixar/descartar
 * em lote — e duas cópias disso divergiriam na primeira correção.
 *
 * A rolagem é LATERAL de propósito: os resultados se acumulam entre sessões
 * (ver resultadosDb), então uma grade vertical empurraria o formulário para
 * fora da tela conforme o dia rende.
 */

function extensaoDe(mediaType: string, tipo: TipoResultado): string {
  if (tipo === "video") return ".mp4";
  if (mediaType.includes("png")) return ".png";
  if (mediaType.includes("webp")) return ".webp";
  return ".jpg";
}

/**
 * Baixa o arquivo SEM metadados.
 *
 * Passa pelo servidor (exiftool/ffmpeg) porque limpar metadado no navegador
 * não é possível para vídeo, e para imagem só daria recodificando — o que
 * perderia qualidade à toa. A Galeria não precisa disso: a rota de upload já
 * limpa tudo antes de gravar.
 */
async function baixarLimpo(item: ResultadoGerado): Promise<void> {
  const ext = extensaoDe(item.mediaType, item.tipo);
  const nome = `${item.tipo === "video" ? "seedance" : "seedream"}-${item.id.slice(0, 8)}${ext}`;
  const form = new FormData();
  form.append("file", new File([item.blob], nome, { type: item.mediaType }));

  const res = await fetch("/api/metadata/clean", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Falha ao limpar os metadados.");
  }

  const limpo = await res.blob();
  const url = URL.createObjectURL(limpo);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ResultadosGerados({
  tipo,
  profileId,
  recarregar,
  brlPorUsd,
}: {
  tipo: TipoResultado;
  profileId: string;
  /** Muda de valor quando o gerador acabou de guardar um resultado novo. */
  recarregar: number;
  /** Cotação do dia; ausente mostra só o dólar. */
  brlPorUsd?: number;
}) {
  const [itens, setItens] = useState<ResultadoGerado[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  /** Índice do item ampliado, ou null. Clicar na mídia abre; não marca. */
  const [ampliado, setAmpliado] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    listarResultados(tipo).then((lista) => {
      if (vivo) setItens(lista);
    });
    return () => {
      vivo = false;
    };
  }, [tipo, recarregar]);

  // Um object URL por item, criado uma vez e revogado quando o item sai —
  // recriar a cada render vazaria memória com vídeo grande.
  useEffect(() => {
    setUrls((antigos) => {
      const novos: Record<string, string> = {};
      for (const item of itens) {
        novos[item.id] = antigos[item.id] || URL.createObjectURL(item.blob);
      }
      for (const [id, url] of Object.entries(antigos)) {
        if (!novos[id]) URL.revokeObjectURL(url);
      }
      return novos;
    });
  }, [itens]);

  const selecao = useMemo(() => itens.filter((i) => selecionados.has(i.id)), [itens, selecionados]);

  function alternar(id: string) {
    setSelecionados((antes) => {
      const novo = new Set(antes);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function descartar(ids: string[]) {
    for (const id of ids) await removerResultado(id);
    setItens((antes) => antes.filter((i) => !ids.includes(i.id)));
    setSelecionados(new Set());
  }

  async function salvarNaGaleria(alvos: ResultadoGerado[]) {
    if (!profileId || alvos.length === 0) return;
    setOcupado(true);
    let salvos = 0;
    try {
      for (const item of alvos) {
        const ext = extensaoDe(item.mediaType, item.tipo);
        const nome = `${item.tipo === "video" ? "seedance" : "seedream"}-${item.id.slice(0, 8)}${ext}`;
        const form = new FormData();
        form.append("file", new File([item.blob], nome, { type: item.mediaType }));
        try {
          // A rota de upload limpa os metadados antes de gravar.
          await apiUpload<{ media: MediaItem }>(`/api/profiles/${profileId}/media`, form);
          await removerResultado(item.id);
          salvos += 1;
        } catch (e) {
          showToast(e instanceof Error ? e.message : "Falha ao salvar um item.", "error");
        }
      }
      if (salvos > 0) {
        const ids = alvos.slice(0, salvos).map((i) => i.id);
        setItens((antes) => antes.filter((i) => !ids.includes(i.id)));
        setSelecionados(new Set());
        showToast(salvos === 1 ? "Salvo na Galeria." : `${salvos} salvos na Galeria.`, "success");
      }
    } finally {
      setOcupado(false);
    }
  }

  async function baixar(alvos: ResultadoGerado[]) {
    setOcupado(true);
    try {
      for (const item of alvos) {
        try {
          await baixarLimpo(item);
        } catch (e) {
          showToast(e instanceof Error ? e.message : "Falha ao baixar.", "error");
        }
      }
    } finally {
      setOcupado(false);
    }
  }

  if (itens.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">
          Guardados aqui ({itens.length}) · somem ao salvar na Galeria
        </p>
        {selecao.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-zinc-400">{selecao.length} selecionados</span>
            <button
              onClick={() => salvarNaGaleria(selecao)}
              disabled={ocupado}
              className="btn-ghost px-2 py-1 text-[11px]"
            >
              Salvar na Galeria
            </button>
            <button
              onClick={() => baixar(selecao)}
              disabled={ocupado}
              className="btn-ghost px-2 py-1 text-[11px]"
            >
              Baixar
            </button>
            <button
              onClick={() => descartar(selecao.map((i) => i.id))}
              disabled={ocupado}
              className="btn-ghost px-2 py-1 text-[11px] text-red-300"
            >
              Descartar
            </button>
            <button
              onClick={() => setSelecionados(new Set())}
              className="px-1 text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              limpar
            </button>
          </div>
        )}
      </div>

      {/* Rolagem lateral própria: a faixa cresce para o lado, não para baixo. */}
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {itens.map((item, i) => {
          const marcado = selecionados.has(item.id);
          return (
            <div
              key={item.id}
              className={`card w-[210px] shrink-0 snap-start overflow-hidden p-0 transition-colors ${
                marcado ? "border-emerald-500/50" : ""
              }`}
            >
              <div className="relative">
                {/* Clicar na mídia AMPLIA. Marcar tem botão próprio: antes o
                    clique na foto marcava, e não havia como olhar de perto o
                    que se acabou de gerar — que é o que se quer fazer antes
                    de salvar. Vídeo mantém os controles nativos, então a
                    ampliação vem pelo botão sobre ele. */}
                {item.tipo === "video" ? (
                  <>
                    <video src={urls[item.id]} controls className="h-[280px] w-full bg-black/30 object-contain" />
                    <button
                      type="button"
                      onClick={() => setAmpliado(i)}
                      className="absolute bottom-2 right-2 rounded-lg bg-black/70 px-2 py-1 text-[11px] text-white hover:bg-black/90"
                    >
                      Ampliar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAmpliado(i)}
                    className="block w-full cursor-zoom-in"
                    aria-label="Ampliar"
                  >
                    <img src={urls[item.id]} alt="" className="h-[280px] w-full bg-black/30 object-contain" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    alternar(item.id);
                  }}
                  aria-label={marcado ? "Desmarcar" : "Selecionar"}
                  title={marcado ? "Desmarcar" : "Selecionar"}
                  className={`absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full border transition-colors ${
                    marcado
                      ? "border-emerald-400 bg-emerald-500 text-black"
                      : "border-white/50 bg-black/60 text-transparent hover:border-emerald-400 hover:text-white/60"
                  }`}
                >
                  <IconCheck size={12} />
                </button>
              </div>

              <div className="p-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {item.legenda}
                  {typeof item.costUsd === "number" && (
                    <>
                      {" · "}
                      {formatarUsd(item.costUsd)}
                      {brlPorUsd ? ` · ${formatarBrl(item.costUsd, brlPorUsd)}` : ""}
                    </>
                  )}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => salvarNaGaleria([item])}
                    disabled={ocupado}
                    className="btn-ghost flex-1 px-2 py-1.5 text-xs"
                  >
                    Salvar
                  </button>
                  <button
                    onClick={() => baixar([item])}
                    disabled={ocupado}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"
                    aria-label="Baixar sem metadados"
                  >
                    <IconDownload size={15} />
                  </button>
                  <button
                    onClick={() => descartar([item.id])}
                    disabled={ocupado}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-red-400"
                    aria-label="Descartar"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* AMPLIAÇÃO — Modal já é portal com foco preso e Esc (components/Modal). */}
      <Modal open={ampliado !== null} onClose={() => setAmpliado(null)} maxWidth="max-w-5xl">
        {ampliado !== null && itens[ampliado] && (
          <div>
            {itens[ampliado].tipo === "video" ? (
              <video
                src={urls[itens[ampliado].id]}
                controls
                autoPlay
                className="max-h-[75vh] w-full rounded-lg bg-black object-contain"
              />
            ) : (
              <img
                src={urls[itens[ampliado].id]}
                alt=""
                className="max-h-[75vh] w-full rounded-lg bg-black object-contain"
              />
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                {itens[ampliado].legenda}
                {typeof itens[ampliado].costUsd === "number" && (
                  <>
                    {" · "}
                    {formatarUsd(itens[ampliado].costUsd as number)}
                    {brlPorUsd ? ` · ${formatarBrl(itens[ampliado].costUsd as number, brlPorUsd)}` : ""}
                  </>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-500">
                  {ampliado + 1}/{itens.length}
                </span>
                <button
                  onClick={() => setAmpliado((n) => (n === null ? null : (n - 1 + itens.length) % itens.length))}
                  disabled={itens.length < 2}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                  aria-label="Anterior"
                >
                  <IconArrowLeft size={16} />
                </button>
                <button
                  onClick={() => setAmpliado((n) => (n === null ? null : (n + 1) % itens.length))}
                  disabled={itens.length < 2}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                  aria-label="Próxima"
                >
                  <IconChevronRight size={16} />
                </button>
                <button onClick={() => setAmpliado(null)} className="btn-ghost px-3 py-1.5 text-xs">
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
