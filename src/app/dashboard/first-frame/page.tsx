"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUpload } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import FramePicker, {
  type FramePickerHandle,
  type FrameStatusPatch,
} from "@/components/firstframe/FramePicker";
import {
  baseName,
  formatTimecode,
  isVideoFile,
  FRAME_EXT,
  VIDEO_EXTS,
  type FrameFormat,
} from "@/lib/videoFrame";
import { buildZipBlob, uniqueZipName, type ZipEntry } from "@/lib/zipClient";
import {
  IconUpload,
  IconClose,
  IconDownload,
  IconFilm,
  IconLock,
  IconCheck,
} from "@/components/icons";
import PageHeader from "@/components/PageHeader";

/** Passos de navegação (não é o fps real do arquivo — só o tamanho do pulo). */
const FPS_OPTIONS = [24, 25, 30, 60];

type Status = "carregando" | "pronto" | "erro";
type SaveState = "idle" | "salvando" | "salvo" | "erro";

type Job = {
  id: string;
  file: File;
  url: string;
  status: Status;
  error?: string;
  duration: number;
  time: number;
  save: SaveState;
};

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // O Safari ainda está lendo o blob quando o clique retorna — revogar na hora
  // cancela o download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function FirstFramePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const [format, setFormat] = useState<FrameFormat>("image/jpeg");
  const [quality, setQuality] = useState(0.92);
  const [fps, setFps] = useState(30);
  const [zipping, setZipping] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRefs = useRef<Record<string, FramePickerHandle | null>>({});

  // Os object URLs seguram o arquivo inteiro na memória — libera ao sair.
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;
  useEffect(() => {
    return () => {
      jobsRef.current.forEach((j) => URL.revokeObjectURL(j.url));
    };
  }, []);

  // Modelo do menu — aqui ela é só o DESTINO opcional dos frames. Baixar o ZIP
  // funciona sem escolher nenhuma.
  const { profileId: saveProfileId, profile, profiles } = useProfile();

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: Job[] = [];
    let ignored = 0;
    for (const file of Array.from(files)) {
      if (!isVideoFile(file.name)) {
        ignored++;
        continue;
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        status: "carregando",
        duration: 0,
        time: 0,
        save: "idle",
      });
    }
    if (next.length) setJobs((prev) => [...prev, ...next]);
    if (ignored > 0) {
      showToast(`${ignored} arquivo(s) ignorado(s) — só vídeos são aceitos aqui.`, "warning");
    }
  }, []);

  const patchJob = useCallback((id: string, patch: FrameStatusPatch) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  function removeJob(id: string) {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job) URL.revokeObjectURL(job.url);
      delete pickerRefs.current[id];
      return prev.filter((j) => j.id !== id);
    });
  }

  function clearAll() {
    jobs.forEach((j) => URL.revokeObjectURL(j.url));
    pickerRefs.current = {};
    setJobs([]);
  }

  function resetAll() {
    jobs.forEach((j) => pickerRefs.current[j.id]?.reset());
  }

  const readyJobs = jobs.filter((j) => j.status === "pronto");

  /** Gera a imagem do frame escolhido de um vídeo. */
  async function captureJob(job: Job): Promise<Blob | null> {
    const handle = pickerRefs.current[job.id];
    if (!handle) return null;
    return handle.capture(format, quality);
  }

  /** Mesmo nome do vídeo de origem + "-ff" (ex.: "clipe.mp4" → "clipe-ff.jpg"),
   *  para o frame ficar sempre ao lado do vídeo na hora de ordenar a pasta. */
  function frameFileName(job: Job): string {
    return `${baseName(job.file.name)}-ff${FRAME_EXT[format]}`;
  }

  async function downloadOne(job: Job) {
    const blob = await captureJob(job);
    if (!blob) {
      showToast("Não foi possível gerar o frame deste vídeo.", "error");
      return;
    }
    downloadBlob(blob, frameFileName(job));
  }

  /** Empacota TODOS os frames prontos num único ZIP, montado no navegador. */
  async function downloadZip() {
    if (readyJobs.length === 0) {
      showToast("Carregue os vídeos e espere a prévia aparecer.", "warning");
      return;
    }
    setZipping(true);
    try {
      const used = new Set<string>();
      const entries: ZipEntry[] = [];
      for (const job of readyJobs) {
        const blob = await captureJob(job);
        if (!blob) continue;
        entries.push({
          name: uniqueZipName(frameFileName(job), used),
          data: new Uint8Array(await blob.arrayBuffer()),
        });
      }
      if (entries.length === 0) {
        showToast("Nenhum frame pôde ser gerado.", "error");
        return;
      }
      downloadBlob(buildZipBlob(entries), `first-frame-${timestamp()}.zip`);
      showToast(`${entries.length} frame(s) no ZIP.`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao montar o ZIP.", "error");
    } finally {
      setZipping(false);
    }
  }

  /** Envia o frame para a galeria da modelo escolhida no menu.
   *  A rota /api/profiles/[id]/media já remove os metadados no upload. */
  async function saveJobToGallery(job: Job): Promise<boolean> {
    if (!saveProfileId) return false;
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "salvando" } : j)));
    try {
      const blob = await captureJob(job);
      if (!blob) throw new Error("Frame indisponível.");
      const name = frameFileName(job);
      const form = new FormData();
      form.append("file", new File([blob], name, { type: format }));
      form.append("tags", "Frame");
      await apiUpload(`/api/profiles/${saveProfileId}/media`, form);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "salvo" } : j)));
      return true;
    } catch {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "erro" } : j)));
      return false;
    }
  }

  async function sendAllToGallery() {
    if (!saveProfileId) {
      showToast("Escolha uma modelo no menu antes de enviar para a galeria.", "warning");
      return;
    }
    const targets = readyJobs.filter((j) => j.save !== "salvo");
    if (targets.length === 0) {
      showToast("Nenhum frame pronto para enviar.", "warning");
      return;
    }
    setSavingAll(true);
    let ok = 0;
    for (const job of targets) {
      if (await saveJobToGallery(job)) ok++;
    }
    setSavingAll(false);
    if (ok === targets.length) {
      showToast(`${ok} frame(s) enviado(s) para ${profile?.name || "a galeria"}.`, "success");
    } else {
      showToast(`Enviados ${ok}/${targets.length}. Alguns falharam — tente de novo.`, "error");
    }
  }

  const stats = {
    videos: jobs.length,
    prontos: readyJobs.length,
    ajustados: jobs.filter((j) => j.status === "pronto" && j.time > 0).length,
    erros: jobs.filter((j) => j.status === "erro").length,
  };

  return (
    <div className="page px-4 py-6">
      <div className="mb-5">
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <IconFilm size={22} /> First Frame
            </span>
          }
          description="Suba vários vídeos e pegue o primeiro frame de cada um — ou outro quadro, pela linha do
          tempo. Baixa tudo num ZIP."
        />
      </div>

      {/* Cards de status */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Vídeos", value: stats.videos },
          { label: "Prontos", value: stats.prontos },
          { label: "Ajustados", value: stats.ajustados },
          { label: "Erros", value: stats.erros },
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
            <span className="text-sm font-medium text-zinc-200">Clique ou arraste os vídeos</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              MP4 · MOV · WEBM · MKV
            </span>
            <input
              ref={inputRef}
              type="file"
              accept={[...VIDEO_EXTS, "video/*"].join(",")}
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Os vídeos ficam no navegador — nada sobe para o servidor.
          </p>

          {jobs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="eyebrow">{jobs.length} vídeo(s)</p>
              {jobs.map((j) => (
                <div key={j.id} className="panel flex items-center gap-2 px-2.5 py-1.5">
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

          {/* Formato de saída */}
          <p className="eyebrow mt-5">Formato do frame</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                { value: "image/jpeg", label: "JPG", hint: "menor" },
                { value: "image/png", label: "PNG", hint: "sem perda" },
              ] as { value: FrameFormat; label: string; hint: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFormat(opt.value)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  format === opt.value
                    ? "border-white/40 bg-white/10 text-white"
                    : "border-white/10 text-zinc-400 hover:bg-white/5"
                }`}
              >
                {opt.label}
                <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {opt.hint}
                </span>
              </button>
            ))}
          </div>

          {format === "image/jpeg" && (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Qualidade</span>
                <span className="font-mono text-[11px] text-zinc-400">{quality.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.01}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="mt-1.5 w-full accent-white"
              />
            </div>
          )}

          {/* Passo das setas */}
          <p className="eyebrow mt-4">Passo das setas</p>
          <div className="mt-2 flex gap-2">
            {FPS_OPTIONS.map((v) => (
              <button
                key={v}
                onClick={() => setFps(v)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                  fps === v
                    ? "border-white/40 bg-white/10 text-white"
                    : "border-white/10 text-zinc-400 hover:bg-white/5"
                }`}
              >
                {v} fps
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Define o tamanho do pulo das setas (1/{fps}s por clique).
          </p>

          <button
            onClick={downloadZip}
            disabled={zipping || stats.prontos === 0}
            className="btn-primary mt-4 w-full"
          >
            <IconDownload size={16} />{" "}
            {zipping ? "Montando ZIP..." : `Baixar todos em ZIP${stats.prontos ? ` (${stats.prontos})` : ""}`}
          </button>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Sai como <span className="font-mono">clipe.mp4</span> →{" "}
            <span className="font-mono">clipe-ff{FRAME_EXT[format]}</span>.
          </p>
          <button onClick={resetAll} disabled={stats.ajustados === 0} className="btn-ghost mt-2 w-full">
            Voltar todos ao primeiro frame
          </button>
          <button onClick={clearAll} disabled={jobs.length === 0} className="btn-ghost mt-2 w-full">
            Limpar tudo
          </button>

          {profiles.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="eyebrow">Galeria da modelo</p>
              {saveProfileId ? (
                <p className="mt-1 text-xs text-zinc-500">
                  Os frames também podem ir para a galeria de{" "}
                  <b className="text-zinc-300">{profile?.name}</b>.
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-400/90">
                  Escolha uma modelo no menu para mandar os frames para a galeria dela. Baixar funciona sem escolher.
                </p>
              )}
              <button
                onClick={sendAllToGallery}
                disabled={savingAll || !saveProfileId || stats.prontos === 0}
                className="btn-primary mt-2 w-full"
              >
                {savingAll
                  ? "Enviando..."
                  : `Enviar frames para a galeria${stats.prontos ? ` (${stats.prontos})` : ""}`}
              </button>
              <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <IconLock size={12} /> Metadados removidos ao salvar
              </p>
            </div>
          )}
        </div>

        {/* Coluna das prévias */}
        <div className="space-y-5">
          {jobs.length === 0 && (
            <div className="card grid place-items-center px-6 py-16 text-center">
              <IconFilm size={30} />
              <p className="mt-3 font-display text-lg text-zinc-300">Nenhum vídeo carregado</p>
              <p className="mt-1 max-w-sm text-sm text-zinc-500">
                Carregue os vídeos ao lado. Cada um abre no primeiro frame — arraste a linha do
                tempo para outro.
              </p>
            </div>
          )}

          {jobs.map((job) => (
            <div key={job.id} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                  {job.file.name}
                </span>
                {job.status === "pronto" && job.duration > 0 && (
                  <span className="chip shrink-0">{formatTimecode(job.duration)}</span>
                )}
              </div>

              {job.status === "erro" ? (
                <p className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
                  {job.error || "Falha ao carregar o vídeo."}
                </p>
              ) : (
                <>
                  <FramePicker
                    ref={(h) => {
                      pickerRefs.current[job.id] = h;
                    }}
                    url={job.url}
                    fps={fps}
                    onStatus={(patch) => patchJob(job.id, patch)}
                  />

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => downloadOne(job)}
                      disabled={job.status !== "pronto"}
                      className="btn-ghost px-3 py-2 text-sm"
                    >
                      <IconDownload size={15} /> Baixar frame
                    </button>
                    {saveProfileId && (
                      <button
                        onClick={() => saveJobToGallery(job)}
                        disabled={job.status !== "pronto" || job.save === "salvando"}
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
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
