"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import PageHeader from "@/components/PageHeader";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import { IconPlay } from "@/components/icons";
import ResultadosGerados from "@/components/ResultadosGerados";
import { salvarResultado } from "@/lib/resultadosDb";
import type { Cotacao } from "@/lib/cotacao";
import type { MediaItem } from "@/lib/types";
import {
  MODELOS_MOTION,
  modeloMotion,
  ORIENTACOES,
  MOTION_VIDEO_SEGUNDOS_MIN,
  MOTION_VIDEO_SEGUNDOS_MAX,
  MOTION_VIDEO_FORMATOS,
  MOTION_IMAGEM_FORMATOS,
  type ModeloMotionId,
  type OrientacaoMotion,
} from "@/lib/aiMediaOptions";

/**
 * MOTION CONTROL — Kling 2.6, pela Magnific.
 *
 * Pega o movimento de um vídeo de referência e faz a modelo executá-lo. É por
 * isso que tem tela própria em vez de virar um modo do Gerador de Vídeo: aqui
 * não se escolhe duração, resolução, formato, áudio nem seed — a Kling deriva
 * tudo do vídeo de entrada. O que existe é um par (foto + vídeo).
 *
 * A DIFERENÇA QUE MANDA NO DESENHO: a API não aceita base64. A foto e o vídeo
 * precisam de URL pública, então tudo o que é enviado aqui é gravado como
 * mídia OCULTA da modelo (fora da Galeria) só para ganhar um link público. Por
 * consequência, o app tem que estar publicado na internet — a tela confere
 * isso antes de deixar gerar, para o operador não pagar para descobrir.
 *
 * A geração é assíncrona e reaproveita o acompanhamento do Gerador de Vídeo
 * (/api/ai/video-gen/[jobId]), porque o id do job já vem carimbado com o
 * provedor.
 */

type Andamento = {
  id: string;
  jobId: string;
  status: "pending" | "in_progress" | "failed" | "cancelled" | "expired";
  erro?: string;
  legenda: string;
  createdAt: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Na fila…",
  in_progress: "Gerando… (pode levar alguns minutos)",
  completed: "Pronto",
  failed: "Falhou",
  cancelled: "Cancelado",
  expired: "Expirou",
};

/** Lê a duração do vídeo no próprio navegador, sem subir nada. */
function duracaoDoVideo(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(el.duration);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler o vídeo."));
    };
    el.src = url;
  });
}

function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i >= 0 ? nome.slice(i).toLowerCase() : "";
}

export default function MotionControlPage() {
  const { profileId, profile } = useProfile();

  const [conectado, setConectado] = useState<boolean | null>(null);
  const [origemAviso, setOrigemAviso] = useState<string | null>(null);

  // Cada lado aceita duas origens que se excluem: a Galeria da modelo ou um
  // arquivo enviado na hora. O id de mídia é o denominador comum — o upload
  // vira mídia oculta assim que é escolhido.
  const [fotoGaleria, setFotoGaleria] = useState<string[]>([]);
  const [fotoEnviada, setFotoEnviada] = useState<MediaItem | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  const [videoGaleria, setVideoGaleria] = useState<string[]>([]);
  const [videoEnviado, setVideoEnviado] = useState<MediaItem | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [enviandoVideo, setEnviandoVideo] = useState(false);

  const [modelo, setModelo] = useState<ModeloMotionId>("kling26-pro");
  const [prompt, setPrompt] = useState("");
  const [orientacao, setOrientacao] = useState<OrientacaoMotion>("video");
  const [cfgScale, setCfgScale] = useState(0.5);
  const [avancadoAberto, setAvancadoAberto] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [andamento, setAndamento] = useState<Andamento[]>([]);
  const [recarregar, setRecarregar] = useState(0);
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const pollingRef = useRef<Set<string>>(new Set());
  /** Legenda de cada pedido, para etiquetar o vídeo quando ele ficar pronto
   *  (a essa altura o item já saiu da lista de andamento). */
  const andamentoRef = useRef<Record<string, string>>({});

  const infoModelo = modeloMotion(modelo);
  const fotoId = fotoEnviada?.id || fotoGaleria[0] || "";
  const videoId = videoEnviado?.id || videoGaleria[0] || "";
  const pronto = Boolean(fotoId && videoId);

  useEffect(() => {
    apiGet<{ settings: { magnific?: { enabled?: boolean; hasKey?: boolean } } }>("/api/settings/ai")
      .then((d) => setConectado(Boolean(d.settings?.magnific?.enabled && d.settings?.magnific?.hasKey)))
      .catch(() => setConectado(null));
    apiGet<{ cotacao: Cotacao | null }>("/api/cotacao")
      .then((d) => setCotacao(d.cotacao))
      .catch(() => setCotacao(null));
  }, []);

  // O aviso de origem vem do servidor porque é ele quem monta os links que a
  // Magnific vai buscar — o que o navegador vê na barra de endereço pode não
  // ser o que o app enxerga de si mesmo atrás do proxy.
  useEffect(() => {
    apiGet<{ publico: boolean; aviso: string | null }>("/api/ai/motion")
      .then((d) => setOrigemAviso(d.publico ? null : d.aviso))
      .catch(() => setOrigemAviso(null));
  }, []);

  useEffect(() => {
    return () => {
      if (fotoPreview) URL.revokeObjectURL(fotoPreview);
    };
  }, [fotoPreview]);

  useEffect(() => {
    return () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
    };
  }, [videoPreview]);

  /** Sobe o arquivo já marcado como oculto — ele existe só para ter link. */
  async function subirOculto(file: File): Promise<MediaItem> {
    const form = new FormData();
    form.append("file", file);
    form.append("hidden", "1");
    const r = await apiUpload<{ media: MediaItem }>(`/api/profiles/${profileId}/media`, form);
    return r.media;
  }

  async function escolherFoto(file: File | null) {
    if (!file) {
      setFotoEnviada(null);
      setFotoPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      return;
    }
    const ext = extensaoDe(file.name);
    if (!(MOTION_IMAGEM_FORMATOS as readonly string[]).includes(ext)) {
      showToast(`A foto precisa ser ${MOTION_IMAGEM_FORMATOS.join(", ")}.`, "error");
      return;
    }
    setEnviandoFoto(true);
    try {
      const media = await subirOculto(file);
      setFotoGaleria([]); // só uma foto por vez
      setFotoEnviada(media);
      setFotoPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return URL.createObjectURL(file);
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao enviar a foto.", "error");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function escolherVideo(file: File | null) {
    if (!file) {
      setVideoEnviado(null);
      setVideoPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      return;
    }
    const ext = extensaoDe(file.name);
    if (!(MOTION_VIDEO_FORMATOS as readonly string[]).includes(ext)) {
      showToast(`O vídeo precisa ser ${MOTION_VIDEO_FORMATOS.join(", ")}.`, "error");
      return;
    }
    // A duração é conferida ANTES de subir: um vídeo fora da faixa seria
    // recusado pela API só depois de gravado e cobrado o tempo do operador.
    try {
      const seg = await duracaoDoVideo(file);
      if (Number.isFinite(seg) && (seg < MOTION_VIDEO_SEGUNDOS_MIN || seg > MOTION_VIDEO_SEGUNDOS_MAX)) {
        showToast(
          `O vídeo tem ${seg.toFixed(1)}s — a Kling só aceita de ${MOTION_VIDEO_SEGUNDOS_MIN} a ${MOTION_VIDEO_SEGUNDOS_MAX}s. Corte antes de enviar.`,
          "error",
        );
        return;
      }
    } catch {
      // O navegador pode não saber abrir o arquivo (falta de codec) — nesse
      // caso não dá para barrar aqui sem recusar um vídeo possivelmente
      // válido. Quem confere de verdade é o servidor, com ffprobe, antes de
      // chamar a Magnific.
    }
    setEnviandoVideo(true);
    try {
      const media = await subirOculto(file);
      setVideoGaleria([]);
      setVideoEnviado(media);
      setVideoPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return URL.createObjectURL(file);
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao enviar o vídeo.", "error");
    } finally {
      setEnviandoVideo(false);
    }
  }

  function escolherFotoGaleria(ids: string[]) {
    setFotoGaleria(ids);
    if (ids.length > 0) escolherFoto(null);
  }

  function escolherVideoGaleria(ids: string[]) {
    setVideoGaleria(ids);
    if (ids.length > 0) escolherVideo(null);
  }

  const consultarJob = useCallback(async (id: string, jobId: string) => {
    if (pollingRef.current.has(jobId)) return;
    pollingRef.current.add(jobId);
    try {
      // Mesmo teto do Gerador de Vídeo: ~8 minutos a cada 4s. Um job que a
      // Magnific aceita e nunca processa ficaria "pending" para sempre.
      const MAX_TENTATIVAS = 120;
      let tentativas = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const r = await apiGet<{ status: string; costUsd?: number; errorMessage?: string }>(
          `/api/ai/video-gen/${encodeURIComponent(jobId)}`,
        );
        if (r.status === "pending" || r.status === "in_progress") {
          tentativas += 1;
          if (tentativas >= MAX_TENTATIVAS) {
            setAndamento((prev) =>
              prev.map((it) =>
                it.id === id
                  ? { ...it, status: "failed", erro: "Tempo limite — confira o andamento no painel da Magnific." }
                  : it,
              ),
            );
            break;
          }
          setAndamento((prev) =>
            prev.map((it) => (it.id === id ? { ...it, status: r.status as Andamento["status"] } : it)),
          );
          await new Promise((res) => setTimeout(res, 4000));
          continue;
        }
        if (r.status === "completed") {
          const res = await fetch(`/api/ai/video-gen/${encodeURIComponent(jobId)}/content`, {
            credentials: "same-origin",
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Falha ao baixar o vídeo pronto.");
          }
          const blob = await res.blob();
          const feito = andamentoRef.current[id];
          await salvarResultado({
            id,
            tipo: "video",
            blob,
            mediaType: blob.type || "video/mp4",
            costUsd: r.costUsd,
            legenda: feito || "motion control",
            createdAt: Date.now(),
          });
          delete andamentoRef.current[id];
          setAndamento((prev) => prev.filter((it) => it.id !== id));
          setRecarregar((n) => n + 1);
        } else {
          setAndamento((prev) =>
            prev.map((it) =>
              it.id === id ? { ...it, status: r.status as Andamento["status"], erro: r.errorMessage } : it,
            ),
          );
        }
        break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao acompanhar a geração.";
      setAndamento((prev) =>
        prev.some((it) => it.id === id)
          ? prev.map((it) => (it.id === id ? { ...it, status: "failed", erro: msg } : it))
          : prev,
      );
    } finally {
      pollingRef.current.delete(jobId);
    }
  }, []);

  async function gerar() {
    if (!profileId) return;
    if (!pronto) {
      showToast("Escolha a foto da modelo e o vídeo de referência.", "error");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await apiSend<{ job: { jobId: string; status: string } }>("/api/ai/motion", "POST", {
        profileId,
        modelo,
        fotoMediaId: fotoId,
        videoMediaId: videoId,
        prompt: prompt.trim() || undefined,
        orientacao,
        cfgScale,
      });
      const id = crypto.randomUUID();
      const legenda = `${infoModelo.nome} · ${orientacao === "video" ? "segue o vídeo" : "segue a foto"}`;
      andamentoRef.current[id] = legenda;
      setAndamento((prev) => [
        { id, jobId: r.job.jobId, status: "pending", legenda, createdAt: Date.now() },
        ...prev,
      ]);
      consultarJob(id, r.job.jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar o pedido.";
      setErro(msg);
      showToast(msg, "error");
    } finally {
      setEnviando(false);
    }
  }

  function descartar(item: Andamento) {
    delete andamentoRef.current[item.id];
    setAndamento((prev) => prev.filter((r) => r.id !== item.id));
  }

  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Motion Control" />
        <PrecisaDeModelo oQue="transferir movimento para uma foto" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconPlay size={22} /> Motion Control
          </span>
        }
      />

      {conectado === false && (
        <div className="card mt-4 border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-300">
          A Magnific ainda não está conectada.{" "}
          <Link href="/dashboard/settings/ia" className="underline underline-offset-2 hover:text-white">
            Ative e cole a chave em Configurações → Conexão com IA
          </Link>{" "}
          para gerar.
        </div>
      )}

      {origemAviso && (
        <div className="card mt-4 border-red-500/30 bg-red-500/[0.07] p-4 text-sm leading-relaxed text-red-300">
          {origemAviso}
        </div>
      )}

      <div className="card mt-4 p-4">
        <p className="text-[12px] leading-relaxed text-zinc-400">
          Uma foto de {profile?.name || "a modelo"} + um vídeo com o movimento, e ela repete a
          coreografia. Duração, resolução e formato saem do vídeo.
        </p>

        {/* FOTO DA MODELO */}
        <div className="mt-5">
          <label className="eyebrow">Foto da modelo</label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Quem executa o movimento. Mín. 300×300, até 10 MB.
          </p>
          <div className="mt-2">
            <MediaPicker
              profileId={profileId}
              selected={fotoGaleria}
              onChange={escolherFotoGaleria}
              max={1}
              apenasImagens
              onArquivo={escolherFoto}
              locais={
                fotoPreview
                  ? [{ url: fotoPreview, kind: "image", onRemover: () => escolherFoto(null) }]
                  : []
              }
              enviando={enviandoFoto}
            />
          </div>
        </div>

        {/* VÍDEO DE REFERÊNCIA */}
        <div className="mt-6">
          <label className="eyebrow">Vídeo de referência</label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            De onde vem o movimento. {MOTION_VIDEO_SEGUNDOS_MIN} a {MOTION_VIDEO_SEGUNDOS_MAX}s,
            em {MOTION_VIDEO_FORMATOS.join(", ")}.
          </p>
          <div className="mt-2">
            <MediaPicker
              profileId={profileId}
              selected={videoGaleria}
              onChange={escolherVideoGaleria}
              max={1}
              apenasVideos
              onArquivo={escolherVideo}
              locais={
                videoPreview
                  ? [{ url: videoPreview, kind: "video", onRemover: () => escolherVideo(null) }]
                  : []
              }
              enviando={enviandoVideo}
            />
          </div>
        </div>

        {/* MODELO */}
        <div className="mt-6">
          <label className="eyebrow">Modelo</label>
          <select
            className="input mt-1.5 max-w-[340px]"
            value={modelo}
            onChange={(e) => setModelo(e.target.value as ModeloMotionId)}
          >
            {MODELOS_MOTION.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            O Standard custa menos — bom para testar antes do Pro.
          </p>
        </div>

        {/* PROMPT */}
        <div className="mt-5">
          <label className="eyebrow">Prompt (opcional)</label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Ajusta cenário, roupa ou clima. O movimento vem do vídeo.
          </p>
          <textarea
            className="input mt-1 max-h-[220px] min-h-[80px] resize-y overflow-y-auto"
            placeholder="ex.: em um quarto com luz quente de fim de tarde"
            maxLength={2500}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        {/* ORIENTAÇÃO */}
        <div className="mt-5">
          <label className="eyebrow">Orientação do personagem</label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {ORIENTACOES.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOrientacao(o.value)}
                title={o.hint}
                className={`rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                  orientacao === o.value
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {o.label}
                <span className="ml-1.5 text-[11px] font-normal text-zinc-500">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* AVANÇADO */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setAvancadoAberto((v) => !v)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            {avancadoAberto ? "▾" : "▸"} avançado
          </button>
          {avancadoAberto && (
            <div className="mt-2 max-w-[320px]">
              <label className="eyebrow mb-1 block">Força do prompt ({cfgScale.toFixed(2)})</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cfgScale}
                onChange={(e) => setCfgScale(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Perto de 0 manda o vídeo; perto de 1 manda o prompt.
              </p>
            </div>
          )}
        </div>

        {erro && (
          <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {erro}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={gerar}
            disabled={enviando || !pronto || conectado === false || Boolean(origemAviso)}
            className="btn-primary"
          >
            <IconPlay size={16} /> {enviando ? "Enviando..." : "Gerar movimento"}
          </button>
          {/* Sem estimativa de custo de propósito: a Magnific cobra em crédito
              e não publica preço por unidade do motion control. Um número
              inventado aqui teria autoridade que não tem. */}
          <p className="text-[11px] leading-relaxed text-zinc-500">
            A Magnific cobra em créditos — o consumo aparece no painel dela.
          </p>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          ⚠️ A foto e o vídeo ganham um{" "}
          <strong className="text-zinc-400">link público permanente</strong> — é assim que a
          Magnific os baixa, e quem tiver a URL abre sem login.
        </p>
      </div>

      {/* EM ANDAMENTO — o vídeo pronto sai daqui e vai para a faixa abaixo. */}
      {andamento.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Em andamento</p>
          <div className="flex flex-col gap-2">
            {andamento.map((item) => {
              const falhou =
                item.status === "failed" || item.status === "cancelled" || item.status === "expired";
              return (
                <div key={item.id} className="card flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-2.5">
                    {!falhou && (
                      <span className="h-4 w-4 animate-spin rounded-full border border-white/15 border-t-white" />
                    )}
                    <div>
                      <p className={`text-xs ${falhou ? "text-red-300" : "text-zinc-300"}`}>
                        {STATUS_LABEL[item.status] || item.status}
                        {item.erro ? ` — ${item.erro}` : ""}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                        {item.legenda}
                      </p>
                    </div>
                  </div>
                  {falhou && (
                    <button onClick={() => descartar(item)} className="btn-ghost px-2 py-1 text-xs">
                      Descartar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ResultadosGerados
        tipo="video"
        profileId={profileId}
        recarregar={recarregar}
        brlPorUsd={cotacao?.brlPorUsd}
      />
    </div>
  );
}
