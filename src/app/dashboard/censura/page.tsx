"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUpload } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import CensorCanvas, { type CensorCanvasHandle } from "@/components/censura/CensorCanvas";
import { CENSOR_EMOJIS } from "@/lib/censorEmojis";
import { BODY_PARTS, BODY_PART_LABELS, DEFAULT_PART_EMOJI, type BodyPart } from "@/lib/bodyParts";
import { type EditorObject, type EmojiObject } from "@/lib/editorObjects";
import {
  IconUpload,
  IconClose,
  IconSparkle,
  IconDownload,
  IconBlur,
  IconLock,
  IconCheck,
} from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/uploadLimit";

const MAX_DIM = 2000;
const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".m4v"];
/** Vídeo de prévia é curto por definição, e a rota impõe o mesmo limite. */
const VIDEO_SEG_MAX = 30;

type Status = "pendente" | "processando" | "pronto" | "erro";

type SaveState = "idle" | "salvando" | "salvo" | "erro";

/**
 * Um item da fila. Imagem e VÍDEO convivem na mesma lista porque é assim que
 * o material chega — um ensaio tem foto e vídeo juntos, e obrigar a separar em
 * duas telas era trabalho que a tela criava, não que existia.
 *
 * O que muda entre os dois é onde o trabalho acontece: a imagem é editada no
 * canvas do navegador (dá para arrastar o emoji com a mão) e o vídeo é
 * remontado no servidor, porque o navegador não tem ffmpeg. Por isso o vídeo
 * volta pronto, sem ajuste manual — e a tela diz isso no cartão.
 */
type Job = {
  id: string;
  kind: "image" | "video";
  file: File;
  url: string;
  img: HTMLImageElement | null;
  status: Status;
  error?: string;
  detected: boolean;
  regionsCount: number;
  objects: EditorObject[];
  save: SaveState;
  /** Só vídeo: o mp4 censurado que voltou do servidor. */
  resultUrl?: string;
  resultBlob?: Blob;
  /** Só vídeo: duração e diagnóstico da detecção. */
  duracao?: number;
  partesCobertas?: BodyPart[];
  amostras?: number;
};

function cappedDims(img: HTMLImageElement) {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) > MAX_DIM) {
    const s = MAX_DIM / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  return { w, h };
}

export default function CensuraPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRefs = useRef<Record<string, CensorCanvasHandle | null>>({});

  // Configuração
  const [partEmoji, setPartEmoji] = useState<Record<BodyPart, string>>({ ...DEFAULT_PART_EMOJI });
  const [minScore, setMinScore] = useState(0.2);
  const [padding, setPadding] = useState(0.2);
  const [emojiScale, setEmojiScale] = useState(0.45);
  // Só para VÍDEO: borrão do quadro inteiro (teaser) ou emoji nas partes.
  // A escolha é da leva, não de cada arquivo — quem carrega dez vídeos quer o
  // mesmo tratamento nos dez.
  const [modoVideo, setModoVideo] = useState<"borrao" | "emoji">("borrao");
  const [intensidadeVideo, setIntensidadeVideo] = useState(0.65);

  // Modelo do menu — aqui ela é o DESTINO opcional do salvamento, não o
  // contexto da tela: censurar e baixar funcionam sem escolher nenhuma.
  const { profileId: saveProfileId, profile, profiles } = useProfile();

  // Libera os object URLs ao desmontar.
  useEffect(() => {
    return () => {
      jobs.forEach((j) => {
      URL.revokeObjectURL(j.url);
      if (j.resultUrl) URL.revokeObjectURL(j.resultUrl);
    });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
        const next: Job[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const ehVideo = VIDEO_EXTS.includes(ext);
      // Arquivo recusado SAI COM AVISO. Antes ele era descartado em silêncio:
      // o operador arrastava cinco arquivos, três apareciam na fila, e não
      // havia nada na tela dizendo por que os outros dois sumiram.
      if (!IMG_EXTS.includes(ext) && !ehVideo) {
        showToast(`"${file.name}": formato não suportado.`, "error");
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        showToast(`"${file.name}" passa de ${MAX_UPLOAD_MB} MB.`, "error");
        continue;
      }
      const url = URL.createObjectURL(file);
      const job: Job = {
        id: crypto.randomUUID(),
        kind: ehVideo ? "video" : "image",
        file,
        url,
        img: null,
        status: "pendente",
        detected: false,
        regionsCount: 0,
        objects: [],
        save: "idle",
      };
      next.push(job);
      if (ehVideo) {
        // Duração: é o que decide se o vídeo passa do limite, e só o navegador
        // sabe dizer sem baixar o arquivo de novo no servidor.
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => {
          setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, duracao: v.duration } : j)));
        };
        v.src = url;
        continue;
      }
      // Carrega a imagem para o canvas.
      const img = new Image();
      img.onload = () => {
        setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, img } : j)));
      };
      img.src = url;
    }
    if (next.length) setJobs((prev) => [...prev, ...next]);
  }, []);

  function removeJob(id: string) {
    setJobs((prev) => {
      const j = prev.find((x) => x.id === id);
      if (j) {
        URL.revokeObjectURL(j.url);
        if (j.resultUrl) URL.revokeObjectURL(j.resultUrl);
      }
      delete canvasRefs.current[id];
      return prev.filter((x) => x.id !== id);
    });
  }

  function clearAll() {
    jobs.forEach((j) => URL.revokeObjectURL(j.url));
    canvasRefs.current = {};
    setJobs([]);
  }

  function updateJobObjects(id: string, objects: EditorObject[]) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, objects } : j)));
  }

  /** Cria os emojis de censura a partir das regiões detectadas (relativas). */
  function buildObjects(img: HTMLImageElement, regions: { part: BodyPart; x: number; y: number; w: number; h: number }[]): EditorObject[] {
    const { w: W, h: H } = cappedDims(img);
    const objs: EmojiObject[] = [];
    for (const r of regions) {
      const emoji = partEmoji[r.part];
      if (!emoji) continue; // "Nenhum" → não censura essa parte
      const cx = (r.x + r.w / 2) * W;
      const cy = (r.y + r.h / 2) * H;
      const base = Math.max(r.w * W, r.h * H);
      const size = Math.max(24, base * (1 + padding) * emojiScale);
      objs.push({
        id: crypto.randomUUID(),
        type: "emoji",
        emoji,
        size,
        x: cx - size / 2,
        y: cy - size / 2,
      });
    }
    return objs;
  }

  async function detectAll() {
    // Imagem precisa estar carregada no canvas; vídeo não usa canvas nenhum.
    const targets = jobs.filter((j) => (j.kind === "video" ? true : Boolean(j.img)));
    if (targets.length === 0) return;
    setBusy(true);
    for (const job of targets) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "processando", error: undefined } : j)));

      // ---- VÍDEO: o trabalho todo é no servidor, e volta o mp4 pronto -----
      if (job.kind === "video") {
        try {
          if ((job.duracao ?? 0) > VIDEO_SEG_MAX + 0.5) {
            throw new Error(
              `Vídeo de ${job.duracao?.toFixed(0)}s — o limite é ${VIDEO_SEG_MAX}s. Corte antes no editor de vídeo.`,
            );
          }
          const form = new FormData();
          form.append("file", job.file);
          form.append("modo", modoVideo);
          if (modoVideo === "borrao") {
            form.append("intensidade", String(intensidadeVideo));
          } else {
            form.append("emojis", JSON.stringify(partEmoji));
            form.append("escala", String(emojiScale + 1));
            form.append("borrarPorBaixo", "1");
          }
          const res = await fetch("/api/ai/censor-video", { method: "POST", body: form });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Falha ao processar o vídeo.");
          }
          const blob = await res.blob();
          const partes = (res.headers.get("x-censura-partes") || "")
            .split(",")
            .filter(Boolean) as BodyPart[];
          const amostras = Number(res.headers.get("x-censura-amostras")) || 0;
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    status: "pronto",
                    detected: true,
                    regionsCount: partes.length,
                    resultUrl: URL.createObjectURL(blob),
                    resultBlob: blob,
                    partesCobertas: partes,
                    amostras,
                    save: "idle",
                  }
                : j,
            ),
          );
        } catch (e) {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? { ...j, status: "erro", error: e instanceof Error ? e.message : "Falha." }
                : j,
            ),
          );
        }
        continue;
      }

      // ---- IMAGEM: detecta e monta os emojis no canvas do navegador -------
      try {
        const form = new FormData();
        form.append("file", job.file);
        form.append("minScore", String(minScore));
        const data = await apiUpload<{ regions: { part: BodyPart; x: number; y: number; w: number; h: number }[] }>(
          "/api/ai/censor",
          form,
        );
        const regions = data.regions || [];
        const objects = job.img ? buildObjects(job.img, regions) : [];
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "pronto", detected: true, regionsCount: regions.length, objects, save: "idle" }
              : j,
          ),
        );
      } catch (e) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "erro", error: e instanceof Error ? e.message : "Falha na detecção." }
              : j,
          ),
        );
      }
    }
    setBusy(false);
  }

  async function downloadJob(job: Job) {
    const handle = canvasRefs.current[job.id];
    if (!handle) return;
    const blob = await handle.export();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${job.file.name.replace(/\.[^./\\]+$/, "")}-censurada.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Exporta o canvas de um job e envia para a galeria do perfil escolhido.
   *  A rota /api/profiles/[id]/media já remove os metadados no upload. */
  /**
   * Manda o resultado para a galeria da modelo.
   *
   * A origem do arquivo muda com o tipo: a FOTO sai do canvas (o operador pode
   * ter arrastado o emoji, e o que vale é o que está na tela); o VÍDEO já veio
   * pronto do servidor. Se isto olhasse só o canvas, o vídeo seria ignorado em
   * silêncio — censurado na tela e nunca salvo.
   */
  async function saveJobToGallery(job: Job): Promise<boolean> {
    if (!saveProfileId) return false;
    const baseName = job.file.name.replace(/\.[^./\\]+$/, "");

    let arquivo: File;
    if (job.kind === "video") {
      if (!job.resultBlob) return false;
      arquivo = new File([job.resultBlob], `${baseName}-censurado.mp4`, { type: "video/mp4" });
    } else {
      const handle = canvasRefs.current[job.id];
      if (!handle) return false;
      const blob = await handle.export();
      arquivo = new File([blob], `${baseName}-censurada.png`, { type: "image/png" });
    }

    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "salvando" } : j)));
    try {
      const form = new FormData();
      form.append("file", arquivo);
      form.append("tags", "Censurada");
      await apiUpload(`/api/profiles/${saveProfileId}/media`, form);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "salvo" } : j)));
      return true;
    } catch {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "erro" } : j)));
      return false;
    }
  }

  const [savingAll, setSavingAll] = useState(false);

  /** Envia TODAS as fotos prontas para a galeria da modelo selecionada. */
  async function sendAllToGallery() {
    if (!saveProfileId) {
      showToast("Escolha uma modelo no menu antes de enviar para a galeria.", "warning");
      return;
    }
    const targets = jobs.filter(
      (j) =>
        j.status === "pronto" &&
        j.save !== "salvo" &&
        (j.kind === "video" ? Boolean(j.resultBlob) : Boolean(j.img)),
    );
    if (targets.length === 0) {
      showToast("Nada pronto para enviar. Clique em 'Detectar e editar' primeiro.", "warning");
      return;
    }
    setSavingAll(true);
    let ok = 0;
    for (const job of targets) {
      if (await saveJobToGallery(job)) ok++;
    }
    setSavingAll(false);
    const modelo = profile?.name || "a galeria";
    if (ok === targets.length) {
      showToast(`${ok} arquivo(s) censurado(s) enviado(s) para ${modelo}.`, "success");
    } else {
      showToast(`Enviadas ${ok}/${targets.length}. Algumas falharam — tente de novo.`, "error");
    }
  }

  const temVideo = jobs.some((j) => j.kind === "video");
  // Imagem precisa estar carregada no canvas; vídeo não usa canvas nenhum e
  // está pronto assim que entra na fila. Testar `img` para os dois desligava o
  // botão numa leva só de vídeos.
  const temAlgoParaProcessar = jobs.some((j) => (j.kind === "video" ? true : Boolean(j.img)));

  const stats = {
    carregadas: jobs.length,
    detectadas: jobs.filter((j) => j.detected && j.regionsCount > 0).length,
    regioes: jobs.reduce((s, j) => s + j.regionsCount, 0),
    prontas: jobs.filter((j) => j.status === "pronto").length,
  };

  return (
    <div className="page px-4 py-6">
      <div className="mb-5">
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <IconBlur size={22} /> Censura com IA
            </span>
          }
          description="Detecta partes explícitas e cobre automaticamente. Foto sai pronta na tela; vídeo é processado no servidor."
        />
      </div>


      {/* Cards de status */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Carregadas", value: stats.carregadas },
          { label: "Detectadas", value: stats.detectadas },
          { label: "Regiões", value: stats.regioes },
          { label: "Prontas", value: stats.prontas },
        ].map((c) => (
          <div key={c.label} className="card p-4">
            <p className="eyebrow">{c.label}</p>
            <p className="mt-1 font-display text-3xl font-semibold text-white">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* Coluna de configuração */}
        <div className="card h-fit p-4">
          <h2 className="font-display text-lg font-semibold">Configurações</h2>

          {/* Upload */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
              dragging ? "border-white/40 bg-white/5" : "border-white/15 hover:bg-white/[0.03]"
            }`}
          >
            <IconUpload size={22} />
            <span className="text-sm font-medium text-zinc-200">
              Clique ou arraste fotos e vídeos
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              JPG · PNG · WEBP · MP4 · MOV
            </span>
            <span className="text-[11px] text-zinc-500">
              Pode misturar os dois na mesma leva · vídeo até {VIDEO_SEG_MAX}s
            </span>
            <input
              ref={inputRef}
              type="file"
              accept={[...IMG_EXTS, ...VIDEO_EXTS].join(",")}
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </label>

          {jobs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="eyebrow">{jobs.length} mídia(s)</p>
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center gap-2 panel px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{j.file.name}</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    {j.status}
                  </span>
                  <button
                    onClick={() => removeJob(j.id)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-red-400"
                    aria-label="Remover"
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Emoji por parte do corpo */}
          <p className="eyebrow mt-5">Emoji por parte do corpo</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {BODY_PARTS.map((part) => (
              <label key={part} className="flex items-center gap-2 panel px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{BODY_PART_LABELS[part]}</span>
                <select
                  value={partEmoji[part]}
                  onChange={(e) => setPartEmoji((p) => ({ ...p, [part]: e.target.value }))}
                  className="shrink-0 rounded bg-ink-850 px-1 py-0.5 text-lg outline-none"
                >
                  <option value="">∅</option>
                  {CENSOR_EMOJIS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {/* Vídeos da leva. Só aparece quando há vídeo na fila: quem só
              carregou fotos não tem por que ver escolha de vídeo. */}
          {temVideo && (
            <div className="mt-5 rounded-xl border border-white/10 bg-ink-850 p-3">
              <p className="eyebrow">Vídeos desta leva</p>
              <div className="mt-2 space-y-1.5">
                {(
                  [
                    ["borrao", "Borrão total", "Teaser: o vídeo inteiro fica ilegível. Não usa IA — nada escapa."],
                    ["emoji", "Emoji nas partes", "O vídeo segue assistível e só as partes ficam cobertas. Usa IA quadro a quadro."],
                  ] as ["borrao" | "emoji", string, string][]
                ).map(([k, titulo, desc]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setModoVideo(k)}
                    className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                      modoVideo === k
                        ? "border-emerald-500/40 bg-emerald-500/[0.07]"
                        : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <p className={`text-xs font-semibold ${modoVideo === k ? "text-emerald-300" : "text-zinc-200"}`}>
                      {titulo}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{desc}</p>
                  </button>
                ))}
              </div>
              {modoVideo === "borrao" && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="eyebrow">Intensidade</span>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {Math.round(intensidadeVideo * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={intensidadeVideo}
                    onChange={(e) => setIntensidadeVideo(Number(e.target.value))}
                    className="mt-1.5 w-full accent-white"
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                    Acima de uns 80% o quadro só fica mais escuro, não mais escondido — quem
                    esconde é o desfoque.
                  </p>
                </div>
              )}
              {modoVideo === "emoji" && (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  Usa os mesmos emojis escolhidos acima. O vídeo volta pronto — diferente da foto,
                  não dá para arrastar o emoji com a mão, porque quem monta é o servidor.
                </p>
              )}
            </div>
          )}

          {/* Sliders */}
          <div className="mt-4 space-y-3">
            <Slider label="Sensibilidade" value={minScore} min={0.1} max={0.9} step={0.05} onChange={setMinScore} />
            <Slider label="Folga ao redor" value={padding} min={0} max={0.5} step={0.02} onChange={setPadding} />
            <Slider label="Tamanho emoji" value={emojiScale} min={0.4} max={1.8} step={0.05} onChange={setEmojiScale} />
          </div>

          <button
            onClick={detectAll}
            disabled={busy || !temAlgoParaProcessar}
            className="btn-primary mt-4 w-full"
          >
            <IconSparkle size={16} />{" "}
            {busy
              ? "Analisando..."
              : temVideo && !jobs.some((j) => j.kind === "image")
                ? "Censurar vídeos"
                : "Detectar e editar"}
          </button>
          <button onClick={clearAll} disabled={jobs.length === 0} className="btn-ghost mt-2 w-full">
            Limpar tudo
          </button>

          {profiles.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="eyebrow">Galeria da modelo</p>
              {/* A modelo vem do seletor do menu. Aqui só se confirma PARA ONDE
                  os arquivos vão — errar o destino espalha material na galeria
                  errada. Sem modelo escolhida o envio fica desabilitado, mas o
                  resto da tela (censurar e baixar) continua funcionando. */}
              {saveProfileId ? (
                <p className="mt-1 text-xs text-zinc-500">
                  Ao concluir, os arquivos censurados vão para a galeria de{" "}
                  <b className="text-zinc-300">{profile?.name}</b>.
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-400/90">
                  Escolha uma modelo no seletor do menu para poder enviar os arquivos para a
                  galeria dela. Baixar funciona sem escolher.
                </p>
              )}
              <button
                onClick={sendAllToGallery}
                disabled={savingAll || !saveProfileId || stats.prontas === 0}
                className="btn-primary mt-2 w-full"
              >
                {savingAll
                  ? "Enviando..."
                  : `Enviar censurados para a galeria${stats.prontas ? ` (${stats.prontas})` : ""}`}
              </button>
              <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <IconLock size={12} /> Metadados removidos ao salvar
              </p>
            </div>
          )}
        </div>

        {/* Coluna do editor */}
        <div className="space-y-5">
          {jobs.length === 0 && (
            <div className="card grid place-items-center px-6 py-16 text-center">
              <IconBlur size={30} />
              <p className="mt-3 font-display text-lg text-zinc-300">Editor de censura</p>
              <p className="mt-1 max-w-sm text-sm text-zinc-500">
                Carregue fotos e vídeos — pode ser tudo junto — e clique em{" "}
                <b>Detectar e editar</b>. Aparecem aqui, um embaixo do outro, na ordem em que
                foram carregados.
              </p>
            </div>
          )}

          {jobs.map((job) => (
            <div key={job.id} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                  {job.file.name}
                </span>
                {job.kind === "video" && (
                  <span className="chip shrink-0">
                    vídeo{job.duracao != null && ` · ${job.duracao.toFixed(1)}s`}
                  </span>
                )}
                {job.status === "pronto" && job.kind === "image" && (
                  <span className="chip">{job.regionsCount} regiã(o/es)</span>
                )}
              </div>

              {job.error && (
                <p className="mb-2 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
                  {job.error}
                </p>
              )}

              {job.kind === "video" ? (
                <VideoJobCard
                  job={job}
                  podeSalvar={Boolean(saveProfileId)}
                  onSalvar={() => saveJobToGallery(job)}
                />
              ) : job.img ? (
                <>
                  <CensorCanvas
                    ref={(h) => {
                      canvasRefs.current[job.id] = h;
                    }}
                    image={job.img}
                    objects={job.objects}
                    onChange={(next) => updateJobObjects(job.id, next)}
                    maxDim={MAX_DIM}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button onClick={() => downloadJob(job)} className="btn-ghost px-3 py-2 text-sm">
                      <IconDownload size={15} /> Baixar
                    </button>
                    {saveProfileId && (
                      <button
                        onClick={() => saveJobToGallery(job)}
                        disabled={job.save === "salvando"}
                        className="btn-primary px-3 py-2 text-sm"
                      >
                        {job.save === "salvando"
                          ? "Salvando..."
                          : job.save === "salvo"
                            ? "Salvar de novo"
                            : "Salvar na galeria"}
                      </button>
                    )}
                    {job.save === "salvo" && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <IconCheck size={14} /> Na galeria
                      </span>
                    )}
                    {job.save === "erro" && (
                      <span className="text-xs text-red-400">Falha ao salvar</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="grid h-40 place-items-center">
                  <div className="h-7 w-7 animate-spin rounded-full border border-white/15 border-t-white" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * O cartão de um VÍDEO na fila.
 *
 * Diferente da foto, aqui não há canvas nem ajuste manual: o vídeo é remontado
 * no servidor e volta pronto. O que a tela deve, então, é (a) mostrar antes e
 * depois lado a lado, e (b) contar o que a IA achou — um vídeo em que ela não
 * encontrou nada volta INTACTO, e sem essa linha seria indistinguível de um
 * censurado.
 */
function VideoJobCard({
  job,
  podeSalvar,
  onSalvar,
}: {
  job: Job;
  podeSalvar: boolean;
  onSalvar: () => void;
}) {
  const nada = job.status === "pronto" && (job.partesCobertas?.length ?? 0) === 0;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="eyebrow mb-1.5">Original</p>
          <video src={job.url} controls playsInline className="w-full rounded-xl bg-black" />
        </div>
        <div>
          <p className="eyebrow mb-1.5">Censurado</p>
          {job.resultUrl ? (
            <video src={job.resultUrl} controls playsInline className="w-full rounded-xl bg-black" />
          ) : (
            <div className="grid h-full min-h-[160px] w-full place-items-center rounded-xl border border-dashed border-white/10 text-[11px] text-zinc-600">
              {job.status === "processando" ? "processando..." : "ainda não processado"}
            </div>
          )}
        </div>
      </div>

      {nada && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-amber-300">
          A IA não encontrou nenhuma das partes escolhidas em {job.amostras} quadro(s) analisado(s)
          — este vídeo voltou <b>sem alteração</b>. Use o borrão total, ou confira se a parte certa
          está marcada.
        </p>
      )}

      {job.status === "pronto" && !nada && job.partesCobertas && (
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          Coberto:{" "}
          <b className="text-zinc-300">
            {job.partesCobertas.map((p) => BODY_PART_LABELS[p] || p).join(", ")}
          </b>
          . Onde a detecção falhou, o emoji foi mantido na última posição e a região continuou
          borrada. Confira os trechos com movimento rápido antes de postar.
        </p>
      )}

      {job.resultUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={job.resultUrl}
            download={`${job.file.name.replace(/\.[^./\\]+$/, "")}-censurado.mp4`}
            className="btn-ghost px-3 py-2 text-sm"
          >
            <IconDownload size={15} /> Baixar
          </a>
          {podeSalvar && (
            <button
              onClick={onSalvar}
              disabled={job.save === "salvando"}
              className="btn-primary px-3 py-2 text-sm"
            >
              {job.save === "salvando"
                ? "Salvando..."
                : job.save === "salvo"
                  ? "Salvar de novo"
                  : "Salvar na galeria"}
            </button>
          )}
          {job.save === "salvo" && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
              <IconCheck size={14} /> Na galeria
            </span>
          )}
          {job.save === "erro" && <span className="text-xs text-red-400">Falha ao salvar</span>}
        </div>
      )}
    </>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <span className="font-mono text-[11px] text-zinc-400">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-white"
      />
    </div>
  );
}
