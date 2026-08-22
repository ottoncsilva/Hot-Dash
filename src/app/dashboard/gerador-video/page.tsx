"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import { IconFilm, IconSparkle } from "@/components/icons";
import type { Profile } from "@/lib/types";
import {
  FORMATOS,
  VIDEO_DURACOES,
  VIDEO_RESOLUCOES,
  custoVideo,
  formatarUsd,
  formatarBrl,
  MODELOS_VIDEO,
  modeloVideo,
  resolucaoVideoValida,
  formatoVideoValido,
  duracaoValida,
  NOME_PROVEDOR,
  provedoresComModelo,
  CHAVES_DO_PROVEDOR,
  MAX_QUANTIDADE,
  type ModeloVideoId,
} from "@/lib/aiMediaOptions";
import ResultadosGerados from "@/components/ResultadosGerados";
import { salvarResultado } from "@/lib/resultadosDb";
import type { Cotacao } from "@/lib/cotacao";
import {
  PROMPT_VIDEO_BASE_PADRAO,
  PROMPT_VIDEO_CONTROLE_PADRAO,
  VARIAVEIS_CONTROLE,
  RE_VARIAVEIS_CONTROLE,
} from "@/lib/aiMediaPrompts";
import PromptComFotos from "@/components/PromptComFotos";
import { CitacoesPintadas } from "@/components/TextoComCitacoes";

/**
 * GERADOR DE VÍDEO — família Seedance 2.0, via OpenRouter.
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

/**
 * Job de vídeo AINDA NÃO PRONTO. O vídeo que termina sai desta lista e vai
 * para a faixa de resultados (que persiste em banco local) — aqui ficam só os
 * que estão na fila, gerando, ou que falharam.
 */
type Resultado = {
  id: string;
  jobId: string;
  status: "pending" | "in_progress" | "failed" | "cancelled" | "expired";
  erro?: string;
  duration: Duracao;
  resolution: Resolucao;
  aspectRatio: Formato;
  createdAt: number;
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

  // As configurações inteiras, e não só o OpenRouter: o que precisa estar
  // conectado depende do PROVEDOR do modelo escolhido (ver CHAVES_DO_PROVEDOR).
  const [ajustes, setAjustes] = useState<Record<string, { enabled?: boolean; hasKey?: boolean }> | null>(null);
  const [frameGaleria, setFrameGaleria] = useState<string[]>([]);
  // Último frame e referências: os dois saem da Galeria, e o teto de
  // referências é do modelo. Ver `aceitaUltimoFrame` e `referencias` no catálogo.
  const [ultimoGaleria, setUltimoGaleria] = useState<string[]>([]);
  const [referencias, setReferencias] = useState<string[]>([]);
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
  const [modelo, setModelo] = useState<ModeloVideoId>("seedance");
  const [quantidade, setQuantidade] = useState(1);
  const [duration, setDuration] = useState<Duracao>(5);
  const [resolution, setResolution] = useState<Resolucao>("720p");
  const [aspectRatio, setAspectRatio] = useState<Formato>("9:16");
  // Áudio ligado por padrão: vídeo de caixinha sem voz não serve para nada.
  const [generateAudio, setGenerateAudio] = useState(true);
  // Filtro de conteúdo do provedor. Começa LIGADO, que é o padrão da API —
  // desligar é uma escolha consciente, não algo que acontece por descuido.
  const [filtroSeguranca, setFiltroSeguranca] = useState(true);
  // Só a BytePlus tem os dois. A marca d'água começa DESLIGADA: um vídeo de
  // venda com selo de IA no canto não serve, e o padrão da plataforma é ligado.
  const [marcaDagua, setMarcaDagua] = useState(false);
  const [cameraFixa, setCameraFixa] = useState(false);
  const [seed, setSeed] = useState("");
  const [avancadoAberto, setAvancadoAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [recarregar, setRecarregar] = useState(0);
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const pollingRef = useRef<Set<string>>(new Set());
  /** Parâmetros de cada pedido, para etiquetar o vídeo quando ele ficar pronto
   *  (a essa altura o item já saiu da lista de andamento). */
  const pedidoRef = useRef<
    Record<string, { duration: Duracao; resolution: Resolucao; aspectRatio: Formato; modelo: string }>
  >({});

  useEffect(() => {
    apiGet<{ settings: Record<string, { enabled?: boolean; hasKey?: boolean }> }>("/api/settings/ai")
      .then((d) => setAjustes(d.settings || {}))
      .catch(() => setAjustes(null));
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

  const infoModelo = modeloVideo(modelo);
  /**
   * Se o provedor DESTE modelo está pronto. `null` enquanto as configurações
   * não chegaram — aí o botão não trava, para não piscar desabilitado.
   */
  const conectado =
    ajustes === null
      ? null
      : CHAVES_DO_PROVEDOR[infoModelo.provedor].some(
          (k) => ajustes[k]?.enabled && ajustes[k]?.hasKey,
        );
  const custoEstimado = custoVideo(modelo, resolution, aspectRatio, duration, quantidade);
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
        lastFrameMediaId: ultimoGaleria[0],
        referenciaMediaIds: referencias,
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

  /** Trocar de modelo pode invalidar a resolução (o 2.0 vai até 4K, Mini e
   *  Fast param no 720p), então ela é reajustada junto. */
  function trocarModelo(id: ModeloVideoId) {
    setModelo(id);
    // A ordem importa: a duração válida depende da resolução já reajustada
    // (no Veo, 1080p e 4k exigem a duração máxima).
    const novaRes = resolucaoVideoValida(id, resolution);
    setResolution(novaRes);
    setAspectRatio((f) => formatoVideoValido(id, f) as Formato);
    setDuration(duracaoValida(id, novaRes, duration) as Duracao);
    // O modelo novo pode não aceitar o que estava escolhido — deixar a seleção
    // pendurada faria a tela prometer algo que o pedido não leva.
    const novo = modeloVideo(id);
    if (!novo.aceitaUltimoFrame) setUltimoGaleria([]);
    if (!novo.referencias) setReferencias([]);
    else setReferencias((r) => r.slice(0, novo.referencias!.max));
  }

  /** Trocar a resolução também pode forçar a duração (regra do Veo). */
  function trocarResolucao(r: Resolucao) {
    setResolution(r);
    setDuration((d) => duracaoValida(modelo, r, d) as Duracao);
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
          const feito = pedidoRef.current[id];
          await salvarResultado({
            id,
            tipo: "video",
            blob,
            mediaType: blob.type || "video/mp4",
            costUsd: r.costUsd,
            legenda: feito
              ? `${feito.modelo} · ${feito.duration}s · ${feito.resolution} · ${feito.aspectRatio}`
              : "vídeo",
            createdAt: Date.now(),
          });
          delete pedidoRef.current[id];
          setResultados((prev) => prev.filter((it) => it.id !== id));
          setRecarregar((n) => n + 1);
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

  useEffect(() => {
    apiGet<{ cotacao: Cotacao | null }>("/api/cotacao")
      .then((d) => setCotacao(d.cotacao))
      .catch(() => setCotacao(null));
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
      const r = await apiSend<{
        jobs: { jobId: string; status: string }[];
        aviso?: string;
      }>("/api/ai/video-gen", "POST", {
        prompt: promptEfetivo,
        modelo,
        quantidade,
        duration,
        resolution,
        aspectRatio,
        generateAudio,
        filtroSeguranca,
        marcaDagua,
        cameraFixa,
        seed: seedNum,
        firstFrameBase64: frameBase64 || undefined,
        firstFrameMediaId: frameGaleria[0],
        lastFrameMediaId: ultimoGaleria[0],
        referenciaMediaIds: referencias,
      });

      // Cada job aceito vira uma linha em andamento, acompanhada em paralelo.
      for (const job of r.jobs) {
        const id = crypto.randomUUID();
        pedidoRef.current[id] = { duration, resolution, aspectRatio, modelo: infoModelo.nome };
        setResultados((prev) => [
          { id, jobId: job.jobId, status: "pending", duration, resolution, aspectRatio, createdAt: Date.now() },
          ...prev,
        ]);
        consultarJob(id, job.jobId);
      }
      // Parte dos jobs entrou e o resto falhou: os aceitos seguem, e o motivo
      // aparece em vez de sumir.
      if (r.aviso) setErro(`${r.jobs.length} de ${quantidade} enviados — ${r.aviso}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar o pedido de vídeo.";
      setErro(msg);
      showToast(msg, "error");
    } finally {
      setEnviando(false);
    }
  }

  function descartar(item: Resultado) {
    delete pedidoRef.current[item.id];
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
          {`${NOME_PROVEDOR[infoModelo.provedor]} ainda não está conectado — é o provedor do ${infoModelo.nome}.`}{" "}
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
                className={`rounded-lg border px-3.5 py-2 text-sm transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
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
            A imagem de onde o vídeo começa a se mover.
          </p>
          <div className="mt-2">
            <MediaPicker
              profileId={profileId}
              selected={frameGaleria}
              onChange={escolherFrameGaleria}
              max={1}
              apenasImagens
              onArquivo={escolherFrameArquivo}
              locais={
                framePreview
                  ? [
                      {
                        url: framePreview,
                        kind: "image",
                        onRemover: () => escolherFrameArquivo(null),
                      },
                    ]
                  : []
              }
            />
          </div>
        </div>

        {/* ÚLTIMO FRAME — só faz sentido com o primeiro escolhido, e só nos
            modelos que aceitam. Na Magnific o Veo e o Kling não aceitam. */}
        {infoModelo.aceitaUltimoFrame && temFrame && (
          <div className="mt-5">
            <label className="eyebrow">Último frame (opcional)</label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              O vídeo faz a transição do primeiro frame para este.
            </p>
            <div className="mt-2">
              <MediaPicker
                profileId={profileId}
                selected={ultimoGaleria}
                onChange={setUltimoGaleria}
                max={1}
                apenasImagens
              />
            </div>
          </div>
        )}

        {/* REFERÊNCIAS — guiam quem é a pessoa e o estilo, sem fixar quadro.
            É o que mantém a mesma modelo reconhecível entre vídeos. */}
        {infoModelo.referencias && (
          <div className="mt-5">
            <label className="eyebrow">
              Referências (opcional, até {infoModelo.referencias.max})
            </label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              Guiam a aparência da modelo e o estilo, sem fixar nenhum quadro.
            </p>
            {/* O AVISO QUE EVITA UMA GERAÇÃO JOGADA FORA.
                Na OpenRouter a documentação é explícita: mandando primeiro
                frame E referências, o frame vence e as referências são
                descartadas em silêncio. Na Magnific as duas coisas convivem. */}
            {infoModelo.referencias.exclusivas && temFrame && referencias.length > 0 && (
              <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-300">
                Com primeiro frame escolhido, o {infoModelo.nome} ignora as referências —
                é regra da OpenRouter, não do painel. Tire o primeiro frame para as
                referências valerem, ou gere pela Magnific, onde as duas coisas somam.
              </p>
            )}
            <div className="mt-2">
              <MediaPicker
                profileId={profileId}
                selected={referencias}
                onChange={setReferencias}
                max={Math.min(infoModelo.referencias.max, 6)}
                apenasImagens
              />
            </div>
          </div>
        )}

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
              className="input mt-1 max-h-[260px] min-h-[110px] resize-y overflow-y-auto"
              placeholder="Descreva o vídeo."
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
              Cole como veio do Instagram. A IA lê o primeiro frame, junta com o roteiro base de{" "}
              {profile?.name || "a modelo"} e escreve o prompt final.
            </p>
            <textarea
              className="input mt-1 max-h-[220px] min-h-[90px] resize-y overflow-y-auto"
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
                    ? "Quem ela é e o que nunca muda entre um vídeo e outro. Os colchetes a IA preenche a cada geração."
                    : "Como a IA funde a caixinha com o roteiro base. Digite @ para: @transcrição, @roteiro base, @first frame."}
                </p>
                {editor === "base" ? (
                  <textarea
                    className="input mt-1.5 max-h-[420px] min-h-[220px] resize-y overflow-y-auto font-mono text-[12px]"
                    value={rascunho}
                    onChange={(e) => setRascunho(e.target.value)}
                  />
                ) : (
                  <PromptComFotos
                    className="input mt-1.5 max-h-[420px] min-h-[220px] w-full resize-y overflow-y-auto font-mono text-[12px]"
                    value={rascunho}
                    onChange={setRascunho}
                    fotos={VARIAVEIS_CONTROLE}
                    padrao={RE_VARIAVEIS_CONTROLE}
                  />
                )}
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
                className="input mt-1 max-h-[420px] min-h-[150px] w-full resize-y overflow-y-auto font-mono text-[12px]"
                placeholder="O roteiro montado pela IA aparece aqui — dá para ajustar à mão."
                value={promptFinal}
                onChange={(e) => setPromptFinal(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* MODELO */}
        <div className="mt-5">
          <label className="eyebrow">Modelo</label>
          <select
            className="input mt-1.5 max-w-[340px]"
            value={modelo}
            onChange={(e) => trocarModelo(e.target.value as ModeloVideoId)}
          >
            {provedoresComModelo(MODELOS_VIDEO).map((prov) => (
              <optgroup key={prov} label={NOME_PROVEDOR[prov]}>
                {MODELOS_VIDEO.filter((m) => m.provedor === prov).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* A frase enumerava as durações uma a uma. Serviu enquanto todo
              modelo fazia 4 a 15; com o Seedance 2.5 indo a 30 viraria uma
              parede de números. Agora diz o INTERVALO, e só detalha os
              formatos quando o modelo restringe algum. */}
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            {`${infoModelo.resolucoes[0]} a ${
              infoModelo.resolucoes[infoModelo.resolucoes.length - 1]
            }, de ${infoModelo.duracoes[0]} a ${
              infoModelo.duracoes[infoModelo.duracoes.length - 1]
            }s`}
            {infoModelo.formatos.length < FORMATOS.length &&
              `, só em ${infoModelo.formatos.join(" e ")}`}
            .
          </p>
        </div>

        {/* A TRAVA DE ROSTO DA BYTEPLUS.
            A 2.0 e a 2.5 de lá recusam retrato humano vindo de fora — só
            aceitam foto gerada na própria ModelArk, mesma conta, sem edição,
            em 30 dias. Não bloqueamos a tela: gerar a partir de texto continua
            valendo. Mas dizer isso ANTES é o que evita pagar para descobrir. */}
        {infoModelo.exigeFotoDaPlataforma && temFrame && (
          <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-300">
            O {infoModelo.nome} pela BytePlus recusa foto com rosto humano que não
            tenha sido gerada lá. Se a imagem veio da Galeria ou foi editada aqui, o
            pedido volta com erro — use a Seedance 1.5 Pro, que não tem essa trava,
            ou gere sem primeiro frame.
          </p>
        )}

        {/* QUANTIDADE */}
        <div className="mt-5">
          <label className="eyebrow">Quantidade</label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Cada um é um vídeo separado — o custo acompanha.
          </p>
          <div className="mt-1.5 flex gap-2">
            {Array.from({ length: MAX_QUANTIDADE }, (_, i) => i + 1).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuantidade(q)}
                className={`rounded-lg border px-4 py-1.5 text-sm transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
                  quantidade === q
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* DURAÇÃO */}
        <div className="mt-5">
          <label className="eyebrow">Duração</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {infoModelo.duracoes.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d as Duracao)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
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
            {infoModelo.resolucoes.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => trocarResolucao(r)}
                className={`rounded-lg border px-4 py-1.5 text-sm transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
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
            {infoModelo.formatos.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setAspectRatio(f)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[12px] transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4 ${
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
            className="inline-flex items-center text-[11px] text-zinc-500 hover:text-zinc-300 [@media(pointer:coarse)]:min-h-[44px]"
          >
            {avancadoAberto ? "▾" : "▸"} avançado
          </button>
          {avancadoAberto && (
            <div className="mt-2 flex flex-col gap-3">
              {/* O Veo sempre gera áudio, e isso não muda o preço — oferecer
                  um interruptor que não faz nada seria mentira. */}
              {infoModelo.audioSempre ? (
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  O {infoModelo.nome} sempre gera áudio, sem custo extra.
                </p>
              ) : (
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={generateAudio}
                    onChange={(e) => setGenerateAudio(e.target.checked)}
                  />
                  Gerar áudio junto com o vídeo
                </label>
              )}
              {/* MARCA D'ÁGUA E CÂMERA FIXA — só a BytePlus tem os dois. */}
              {infoModelo.provedor === "byteplus" && (
                <>
                  <div>
                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={marcaDagua}
                        onChange={(e) => setMarcaDagua(e.target.checked)}
                      />
                      Marca d&apos;água de IA no vídeo
                    </label>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      A BytePlus adiciona por padrão, no canto inferior direito. O painel
                      manda desligado.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={cameraFixa}
                      onChange={(e) => setCameraFixa(e.target.checked)}
                    />
                    Câmera fixa (tripé)
                  </label>
                </>
              )}

              {/* FILTRO DE CONTEÚDO.
                  Só a Magnific expõe isto, e só em alguns modelos — o Seedance
                  Mini não tem o campo, e a OpenRouter e o Google não têm nada
                  parecido na API de vídeo. Mostrar o interruptor onde ele não
                  faz nada seria mentir sobre o que o pedido leva. */}
              {infoModelo.aceitaFiltroSeguranca && (
                <div>
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={filtroSeguranca}
                      onChange={(e) => setFiltroSeguranca(e.target.checked)}
                    />
                    Filtro de conteúdo do provedor
                  </label>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                    Desligado, o {infoModelo.nome} deixa de aplicar o próprio filtro —
                    mas a Magnific pode recusar a geração mesmo assim, pelas regras da
                    conta dela.
                  </p>
                </div>
              )}
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
                  A mesma seed tende a repetir o resultado — bom para mudar só um detalhe.
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
          {/* Sem estimativa quando não há tabela — ver o mesmo trecho no
              gerador de imagem. A Magnific cobra em crédito. */}
          <span
            className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-[12px] text-zinc-300"
            title={
              custoEstimado === null
                ? `O ${infoModelo.nome} pela Magnific é cobrado em crédito, e ela não publica valor por unidade. O consumo aparece no painel da Magnific.`
                : `Preço de tabela do ${infoModelo.nome}, pela fórmula do Seedance: largura × altura × duração × 24 ÷ 1024 tokens, à taxa da resolução, vezes a quantidade. O valor real aparece embaixo de cada resultado.`
            }
          >
            {custoEstimado === null ? (
              "em créditos"
            ) : (
              <>
                ~{formatarUsd(custoEstimado)}
                {cotacao && ` · ~${formatarBrl(custoEstimado, cotacao.brlPorUsd)}`}
              </>
            )}
          </span>
          <p className="text-[11px] text-zinc-500">
            {temFrame ? "com primeiro frame" : "sem primeiro frame (texto para vídeo)"}
            {custoEstimado !== null &&
              cotacao &&
              ` · dólar a R$ ${cotacao.brlPorUsd.toFixed(2).replace(".", ",")} (${cotacao.fonte})`}
          </p>
        </div>
      </div>

      {/* JOBS EM ANDAMENTO — o vídeo pronto sai daqui e vai para a faixa abaixo. */}
      {resultados.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Em andamento</p>
          <div className="flex flex-col gap-2">
            {resultados.map((item) => {
              const falhou =
                item.status === "failed" || item.status === "cancelled" || item.status === "expired";
              return (
                <div
                  key={item.id}
                  className="card flex flex-wrap items-center justify-between gap-3 p-3"
                >
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
                        {item.duration}s · {item.resolution} · {item.aspectRatio}
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
