"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import {
  IconFilm,
  IconUpload,
  IconDownload,
  IconClose,
  IconCheck,
  IconTrash,
  IconSparkle,
} from "@/components/icons";
import type { MediaItem, Profile } from "@/lib/types";
import {
  FORMATOS,
  VIDEO_DURACOES,
  VIDEO_RESOLUCOES,
  custoVideo,
  formatarUsd,
} from "@/lib/aiMediaOptions";
import { PROMPT_VIDEO_BASE_PADRAO, PROMPT_VIDEO_CONTROLE_PADRAO } from "@/lib/aiMediaPrompts";

/**
 * GERADOR DE VÍDEO — bytedance/seedance-2.0, via OpenRouter.
 *
 * Irmã da tela de Gerador de Imagem, com uma diferença de fundo: aqui não há
 * um conjunto de referências, e sim UM "primeiro frame" — a foto de onde o
 * vídeo começa a se mover. Por isso o prompt padrão só tem duas variações
 * (com/sem primeiro frame), não quatro.
 *
 * A geração é ASSÍNCRONA (a Video API devolve um job, não o vídeo pronto):
 * o pedido some POST /api/ai/video-gen, e esta tela consulta o andamento em
 * /api/ai/video-gen/[jobId] de tempos em tempos até `completed`, e só então
 * baixa os bytes por /api/ai/video-gen/[jobId]/content.
 */

type Resolucao = (typeof VIDEO_RESOLUCOES)[number];
type Formato = (typeof FORMATOS)[number];
type Duracao = (typeof VIDEO_DURACOES)[number];

/** Os dois jeitos de chegar num vídeo. Mudam só COMO o prompt nasce — dali
 *  para a frente (frame, duração, formato, geração) o caminho é o mesmo. */
type Modo = "livre" | "caixinha";

function promptLivrePadrao(temFrame: boolean): string {
  if (temFrame) {
    return (
      "Anime esta imagem como uma cena de vídeo curta — [descreva o movimento de câmera, a ação e a " +
      "expressão]. Mantenha fielmente o rosto, o corpo e o cenário da imagem original. Resultado " +
      "fotorrealista, sem marca d'água, sem texto na tela."
    );
  }
  return (
    "Um vídeo fotorrealista, still de câmera profissional, cena cinematográfica. [descreva o cenário, a " +
    "ação, o movimento de câmera e a iluminação]. Sem marca d'água, sem texto na tela."
  );
}

type Resultado = {
  id: string;
  jobId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  videoUrl?: string;
  costUsd?: number;
  erro?: string;
  duration: Duracao;
  resolution: Resolucao;
  aspectRatio: Formato;
  createdAt: number;
  salvando: "idle" | "salvando" | "salvo";
};

/** Mesmo redimensionamento usado na Imagem a copiar do Gerador de Imagem —
 *  o primeiro frame enviado do celular do assinante não precisa ir cru. */
function arquivoParaBase64Redimensionado(file: File, maxDim = 1280, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Arquivo não é uma imagem válida."));
      img.onload = () => {
        const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * escala);
        const h = Math.round(img.height * escala);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponível."));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(file);
  });
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Na fila…",
  in_progress: "Gerando… (pode levar alguns minutos)",
  completed: "Pronto",
  failed: "Falhou",
  cancelled: "Cancelado",
  expired: "Expirou",
};

export default function GeradorVideoPage() {
  const { profileId, profile } = useProfile();

  const [conectado, setConectado] = useState<boolean | null>(null);
  const [frameGaleria, setFrameGaleria] = useState<string[]>([]);
  const [frameFile, setFrameFile] = useState<File | null>(null);
  const [framePreview, setFramePreview] = useState<string | null>(null);
  const [frameBase64, setFrameBase64] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("livre");
  const [prompt, setPrompt] = useState("");
  const [caixinha, setCaixinha] = useState("");
  const [promptFinal, setPromptFinal] = useState("");
  const [montando, setMontando] = useState(false);
  const [promptBase, setPromptBase] = useState("");
  const [promptControle, setPromptControle] = useState("");
  /** Qual dos dois prompts da modelo está aberto no editor, se algum. */
  const [editor, setEditor] = useState<null | "base" | "controle">(null);
  const [rascunho, setRascunho] = useState("");
  const [salvandoPrompt, setSalvandoPrompt] = useState(false);
  const [duration, setDuration] = useState<Duracao>(5);
  const [resolution, setResolution] = useState<Resolucao>("720p");
  const [aspectRatio, setAspectRatio] = useState<Formato>("9:16");
  const [generateAudio, setGenerateAudio] = useState(false);
  const [seed, setSeed] = useState("");
  const [avancadoAberto, setAvancadoAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    apiGet<{ settings: { openrouter?: { enabled?: boolean; hasKey?: boolean } } }>("/api/settings/ai")
      .then((d) => setConectado(Boolean(d.settings?.openrouter?.enabled && d.settings?.openrouter?.hasKey)))
      .catch(() => setConectado(null));
  }, []);

  useEffect(() => {
    return () => {
      if (framePreview) URL.revokeObjectURL(framePreview);
    };
  }, [framePreview]);

  // Os prompts são da MODELO, não da tela — trocar de modelo troca os dois.
  useEffect(() => {
    if (!profileId) return;
    setPromptBase("");
    setPromptControle("");
    apiGet<{ profile: Profile }>(`/api/profiles/${profileId}`)
      .then((d) => {
        setPromptBase(d.profile?.videogenPromptBase || "");
        setPromptControle(d.profile?.videogenPromptControle || "");
      })
      .catch(() => {});
  }, [profileId]);

  const custoTotal = resultados.reduce((s, r) => s + (r.costUsd || 0), 0);
  const custoEstimado = custoVideo(resolution, aspectRatio, duration);
  const temFrame = frameGaleria.length > 0 || Boolean(frameBase64);
  /** O texto que vai ao Seedance: no modo livre é o prompt escrito à mão, no
   *  modo caixinha é o roteiro que a IA montou (e que dá para editar). */
  const promptEfetivo = (modo === "caixinha" ? promptFinal : prompt).trim();

  const textoBase = promptBase.trim() || PROMPT_VIDEO_BASE_PADRAO;
  const textoControle = promptControle.trim() || PROMPT_VIDEO_CONTROLE_PADRAO;

  function abrirEditor(qual: "base" | "controle") {
    setRascunho(qual === "base" ? textoBase : textoControle);
    setEditor(qual);
  }

  async function salvarPrompt() {
    if (!profileId || !editor) return;
    setSalvandoPrompt(true);
    const campo = editor === "base" ? "videogenPromptBase" : "videogenPromptControle";
    try {
      await apiSend(`/api/profiles/${profileId}`, "PATCH", { [campo]: rascunho });
      if (editor === "base") setPromptBase(rascunho.trim());
      else setPromptControle(rascunho.trim());
      setEditor(null);
      showToast("Prompt salvo.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    } finally {
      setSalvandoPrompt(false);
    }
  }

  /** Roda a IA de texto que funde a caixinha com o roteiro base, lendo também
   *  a foto do primeiro frame. Só ESCREVE o prompt — não gera vídeo: o
   *  operador confere e edita antes de gastar com a geração. */
  async function montarPromptFinal() {
    if (!profileId) return;
    if (!caixinha.trim()) {
      showToast("Cole a pergunta e a resposta da caixinha.", "error");
      return;
    }
    setMontando(true);
    setErro(null);
    try {
      const r = await apiSend<{ prompt: string }>("/api/ai/video-prompt", "POST", {
        profileId,
        caixinha: caixinha.trim(),
        promptBase: textoBase,
        promptControle: textoControle,
        firstFrameBase64: frameBase64 || undefined,
        firstFrameMediaId: frameGaleria[0],
      });
      setPromptFinal(r.prompt);
      showToast("Prompt final montado — confira antes de gerar.", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao montar o prompt.";
      setErro(msg);
      showToast(msg, "error");
    } finally {
      setMontando(false);
    }
  }

  async function escolherFrameArquivo(file: File | null) {
    if (!file) {
      setFrameFile(null);
      setFramePreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      setFrameBase64(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      showToast("Escolha um arquivo de imagem.", "error");
      return;
    }
    setFrameGaleria([]); // só um frame por vez — enviar arquivo substitui a escolha da Galeria
    setFrameFile(file);
    setFramePreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return URL.createObjectURL(file);
    });
    try {
      setFrameBase64(await arquivoParaBase64Redimensionado(file));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao ler a imagem.", "error");
      setFrameBase64(null);
    }
  }

  function escolherFrameGaleria(ids: string[]) {
    setFrameGaleria(ids);
    if (ids.length > 0) escolherFrameArquivo(null); // idem, no sentido inverso
  }

  function usarPromptPadrao() {
    setPrompt(promptLivrePadrao(temFrame));
  }

  const consultarJob = useCallback(async (id: string, jobId: string) => {
    if (pollingRef.current.has(jobId)) return;
    pollingRef.current.add(jobId);
    try {
      // A Video API pode aceitar o job (202) e só falhar DEPOIS, ao processar
      // — nesse caso o status fica "pending" para sempre, sem nunca virar
      // "failed" (é o próprio provedor quem documenta esse caso). Por isso o
      // acompanhamento tem um teto: ~8 minutos de tentativas a cada 4s, tempo
      // de sobra para uma geração real de até 15s de vídeo.
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
            setResultados((prev) =>
              prev.map((it) =>
                it.id === id
                  ? {
                      ...it,
                      status: "failed",
                      erro: "Tempo limite aguardando o vídeo — confira o andamento direto em openrouter.ai.",
                    }
                  : it,
              ),
            );
            break;
          }
          setResultados((prev) =>
            prev.map((it) => (it.id === id ? { ...it, status: r.status as Resultado["status"] } : it)),
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
          const videoUrl = URL.createObjectURL(blob);
          setResultados((prev) =>
            prev.map((it) =>
              it.id === id ? { ...it, status: "completed", videoUrl, costUsd: r.costUsd } : it,
            ),
          );
        } else {
          setResultados((prev) =>
            prev.map((it) =>
              it.id === id
                ? { ...it, status: r.status as Resultado["status"], erro: r.errorMessage }
                : it,
            ),
          );
        }
        break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao acompanhar a geração.";
      setResultados((prev) => (prev.some((it) => it.id === id) ? prev.map((it) => (it.id === id ? { ...it, status: "failed", erro: msg } : it)) : prev));
    } finally {
      pollingRef.current.delete(jobId);
    }
  }, []);

  async function gerar() {
    if (!profileId) return;
    if (!promptEfetivo) {
      showToast(
        modo === "caixinha"
          ? "Monte o prompt final antes de gerar."
          : "Escreva o prompt do vídeo.",
        "error",
      );
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const seedNum = seed.trim() ? Number(seed.trim()) : undefined;
      const r = await apiSend<{ jobId: string; status: string }>("/api/ai/video-gen", "POST", {
        prompt: promptEfetivo,
        duration,
        resolution,
        aspectRatio,
        generateAudio,
        seed: seedNum,
        firstFrameBase64: frameBase64 || undefined,
        firstFrameMediaId: frameGaleria[0],
      });
      const id = crypto.randomUUID();
      setResultados((prev) => [
        {
          id,
          jobId: r.jobId,
          status: "pending",
          duration,
          resolution,
          aspectRatio,
          createdAt: Date.now(),
          salvando: "idle",
        },
        ...prev,
      ]);
      consultarJob(id, r.jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar o pedido de vídeo.";
      setErro(msg);
      showToast(msg, "error");
    } finally {
      setEnviando(false);
    }
  }

  async function salvarNaGaleria(item: Resultado) {
    if (!profileId || !item.videoUrl) return;
    setResultados((prev) => prev.map((r) => (r.id === item.id ? { ...r, salvando: "salvando" } : r)));
    try {
      const res = await fetch(item.videoUrl);
      const blob = await res.blob();
      const form = new FormData();
      form.append("file", new File([blob], `seedance-${item.id.slice(0, 8)}.mp4`, { type: "video/mp4" }));
      await apiUpload<{ media: MediaItem }>(`/api/profiles/${profileId}/media`, form);
      setResultados((prev) => prev.map((r) => (r.id === item.id ? { ...r, salvando: "salvo" } : r)));
      showToast("Salvo na Galeria.", "success");
    } catch (e) {
      setResultados((prev) => prev.map((r) => (r.id === item.id ? { ...r, salvando: "idle" } : r)));
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    }
  }

  function baixar(item: Resultado) {
    if (!item.videoUrl) return;
    const a = document.createElement("a");
    a.href = item.videoUrl;
    a.download = `seedance-${item.id.slice(0, 8)}.mp4`;
    a.click();
  }

  function descartar(item: Resultado) {
    if (item.videoUrl) URL.revokeObjectURL(item.videoUrl);
    setResultados((prev) => prev.filter((r) => r.id !== item.id));
  }

  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Gerador de Vídeo" />
        <PrecisaDeModelo oQue="gerar vídeos com IA" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconFilm size={22} /> Gerador de Vídeo
          </span>
        }
      />

      {conectado === false && (
        <div className="card mt-4 border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-300">
          O OpenRouter ainda não está conectado.{" "}
          <Link href="/dashboard/settings/ia" className="underline underline-offset-2 hover:text-white">
            Ative e cole a chave em Configurações → Conexão com IA
          </Link>{" "}
          para gerar vídeos.
        </div>
      )}

      <div className="card mt-4 p-4">
        {/* MODO */}
        <div className="mb-5">
          <label className="eyebrow">Como montar o vídeo</label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(
              [
                { v: "livre" as const, label: "Prompt livre", hint: "Você escreve o roteiro." },
                {
                  v: "caixinha" as const,
                  label: "Caixinha de perguntas",
                  hint: "Cole a caixinha e a IA escreve o roteiro.",
                },
              ]
            ).map((m) => (
              <button
                key={m.v}
                type="button"
                onClick={() => setModo(m.v)}
                title={m.hint}
                className={`rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                  modo === m.v
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* PRIMEIRO FRAME */}
        <div>
          <label className="eyebrow">
            Primeiro frame {modo === "caixinha" ? "(a foto que a IA vai analisar)" : "(opcional)"}
          </label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            A imagem de onde o vídeo começa a se mover. Escolha uma foto da Galeria de{" "}
            {profile?.name || "a modelo"} ou envie uma direto — as duas são a mesma coisa, escolher uma
            substitui a outra.
          </p>
          <div className="mt-2">
            <MediaPicker
              profileId={profileId}
              selected={frameGaleria}
              onChange={escolherFrameGaleria}
              max={1}
              apenasImagens
            />
          </div>
          <p className="my-2 text-center text-[11px] text-zinc-600">ou</p>
          <div>
            {framePreview ? (
              <div className="relative inline-block">
                <img
                  src={framePreview}
                  alt=""
                  className="h-32 w-24 rounded-lg border border-white/10 object-cover"
                />
                <button
                  type="button"
                  onClick={() => escolherFrameArquivo(null)}
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/80 text-white hover:bg-red-500/80"
                  aria-label="Remover primeiro frame"
                >
                  <IconClose size={13} />
                </button>
              </div>
            ) : (
              <div
                ref={dropRef}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  escolherFrameArquivo(e.dataTransfer.files?.[0] || null);
                }}
                className="grid h-32 w-24 cursor-pointer place-items-center rounded-lg border border-dashed border-white/15 text-zinc-500 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                onClick={() => document.getElementById("frame-input")?.click()}
              >
                <IconUpload size={18} />
                <input
                  id="frame-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => escolherFrameArquivo(e.target.files?.[0] || null)}
                />
              </div>
            )}
          </div>
        </div>

        {modo === "livre" ? (
          /* PROMPT LIVRE */
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <label className="eyebrow">Prompt</label>
              <button type="button" onClick={usarPromptPadrao} className="btn-ghost px-2 py-1 text-[11px]">
                Usar prompt padrão
              </button>
            </div>
            <textarea
              className="input mt-1 min-h-[110px] resize-y"
              placeholder="Descreva o vídeo — ou clique em “Usar prompt padrão” para começar de um modelo pronto."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
        ) : (
          /* MODO CAIXINHA: cola a caixinha → IA monta o roteiro → confere → gera */
          <div className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <label className="eyebrow">Pergunta e resposta da caixinha</label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => abrirEditor("base")}
                  className="btn-ghost px-2 py-1 text-[11px]"
                >
                  Editar roteiro base
                </button>
                <button
                  type="button"
                  onClick={() => abrirEditor("controle")}
                  className="btn-ghost px-2 py-1 text-[11px]"
                >
                  Editar prompt de controle
                </button>
              </div>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Cole o texto como veio do Instagram. A IA lê a foto do primeiro frame, junta com o
              roteiro base de {profile?.name || "a modelo"} e escreve o prompt final.
            </p>
            <textarea
              className="input mt-1 min-h-[90px] resize-y"
              placeholder={"Pergunta: ...\nResposta: ..."}
              value={caixinha}
              onChange={(e) => setCaixinha(e.target.value)}
            />

            {editor && (
              <div className="mt-3 rounded-xl border border-white/10 bg-ink-850 p-3">
                <label className="eyebrow">
                  {editor === "base" ? "Roteiro base da modelo" : "Prompt de controle"}
                </label>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  {editor === "base"
                    ? "Quem ela é, como a câmera olha para ela e o que nunca muda entre um vídeo e outro. Os campos entre colchetes são preenchidos pela IA a cada geração."
                    : "As instruções que a IA segue para fundir a caixinha com o roteiro base. Use {{ROTEIRO_BASE}} e {{CAIXINHA}} para marcar onde cada peça entra."}
                </p>
                <textarea
                  className="input mt-1.5 min-h-[220px] resize-y font-mono text-[12px]"
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button onClick={salvarPrompt} disabled={salvandoPrompt} className="btn-primary px-3 py-1.5 text-xs">
                    {salvandoPrompt ? "Salvando..." : "Salvar"}
                  </button>
                  <button onClick={() => setEditor(null)} className="btn-ghost px-3 py-1.5 text-xs">
                    Cancelar
                  </button>
                  <button
                    onClick={() =>
                      setRascunho(
                        editor === "base" ? PROMPT_VIDEO_BASE_PADRAO : PROMPT_VIDEO_CONTROLE_PADRAO,
                      )
                    }
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    Restaurar texto de fábrica
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3">
              <button
                onClick={montarPromptFinal}
                disabled={montando || !caixinha.trim()}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                <IconSparkle size={14} /> {montando ? "Montando..." : "Montar prompt final com IA"}
              </button>
            </div>

            <div className="mt-4">
              <label className="eyebrow">Prompt final (confira antes de gerar)</label>
              <textarea
                className="input mt-1 min-h-[150px] resize-y font-mono text-[12px]"
                placeholder="Clique em “Montar prompt final com IA” — o roteiro aparece aqui e pode ser ajustado à mão."
                value={promptFinal}
                onChange={(e) => setPromptFinal(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* DURAÇÃO */}
        <div className="mt-5">
          <label className="eyebrow">Duração</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {VIDEO_DURACOES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  duration === d
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>

        {/* RESOLUÇÃO */}
        <div className="mt-5">
          <label className="eyebrow">Resolução</label>
          <div className="mt-1.5 flex gap-2">
            {VIDEO_RESOLUCOES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setResolution(r)}
                className={`rounded-lg border px-4 py-1.5 text-sm transition-colors ${
                  resolution === r
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* FORMATO */}
        <div className="mt-5">
          <label className="eyebrow">Formato</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {FORMATOS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setAspectRatio(f)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[12px] transition-colors ${
                  aspectRatio === f
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {f}
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
            <div className="mt-2 flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(e) => setGenerateAudio(e.target.checked)}
                />
                Gerar áudio junto com o vídeo
              </label>
              <div className="max-w-[220px]">
                <label className="eyebrow mb-1 block">Seed (opcional)</label>
                <input
                  className="input font-mono"
                  type="number"
                  placeholder="aleatória"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  A mesma seed tende a repetir o mesmo resultado — útil para variar só um detalhe do
                  prompt sem perder o resto da composição.
                </p>
              </div>
            </div>
          )}
        </div>

        {erro && (
          <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {erro}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={gerar} disabled={enviando || conectado === false} className="btn-primary">
            <IconFilm size={16} /> {enviando ? "Enviando..." : "Gerar vídeo"}
          </button>
          <span
            className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-[12px] text-zinc-300"
            title="Preço de tabela do Seedance, calculado pela fórmula dele: largura × altura × duração × 24 ÷ 1024 tokens, à taxa da resolução escolhida. O valor real da geração aparece embaixo de cada resultado."
          >
            ~{formatarUsd(custoEstimado)}
          </span>
          <p className="text-[11px] text-zinc-500">
            {temFrame ? "com primeiro frame" : "sem primeiro frame (texto para vídeo)"}
            {custoTotal > 0 && ` · gasto nesta sessão: ${formatarUsd(custoTotal)}`}
          </p>
        </div>
      </div>

      {/* RESULTADOS */}
      {resultados.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Resultados desta sessão</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resultados.map((item) => (
              <div key={item.id} className="card overflow-hidden p-0">
                {item.status === "completed" && item.videoUrl ? (
                  <video src={item.videoUrl} controls className="w-full bg-black/30" />
                ) : (
                  <div className="grid h-40 w-full place-items-center bg-black/20 text-center text-xs text-zinc-500">
                    {item.status === "failed" || item.status === "cancelled" || item.status === "expired" ? (
                      <span className="px-3 text-red-300">
                        {STATUS_LABEL[item.status]}
                        {item.erro ? ` — ${item.erro}` : ""}
                      </span>
                    ) : (
                      <span className="flex flex-col items-center gap-2">
                        <span className="h-5 w-5 animate-spin rounded-full border border-white/15 border-t-white" />
                        {STATUS_LABEL[item.status] || item.status}
                      </span>
                    )}
                  </div>
                )}
                <div className="p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    {item.duration}s · {item.resolution} · {item.aspectRatio}
                    {typeof item.costUsd === "number" && ` · ${formatarUsd(item.costUsd)}`}
                  </p>
                  {item.status === "completed" && item.videoUrl && (
                    <div className="mt-2 flex gap-1.5">
                      <button
                        onClick={() => salvarNaGaleria(item)}
                        disabled={item.salvando !== "idle"}
                        className="btn-ghost flex-1 px-2 py-1.5 text-xs"
                      >
                        {item.salvando === "salvando" ? (
                          "Salvando..."
                        ) : item.salvando === "salvo" ? (
                          <>
                            <IconCheck size={13} /> Salvo
                          </>
                        ) : (
                          "Salvar na Galeria"
                        )}
                      </button>
                      <button
                        onClick={() => baixar(item)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"
                        aria-label="Baixar"
                      >
                        <IconDownload size={15} />
                      </button>
                      <button
                        onClick={() => descartar(item)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-red-400"
                        aria-label="Descartar"
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  )}
                  {(item.status === "failed" || item.status === "cancelled" || item.status === "expired") && (
                    <div className="mt-2">
                      <button
                        onClick={() => descartar(item)}
                        className="btn-ghost w-full px-2 py-1.5 text-xs"
                      >
                        Descartar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
