"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiUpload } from "@/lib/api";
import { showToast } from "@/lib/toast";
import CensorCanvas, { type CensorCanvasHandle } from "@/components/censura/CensorCanvas";
import { CENSOR_EMOJIS } from "@/lib/censorEmojis";
import { BODY_PARTS, BODY_PART_LABELS, DEFAULT_PART_EMOJI, type BodyPart } from "@/lib/bodyParts";
import { type EditorObject, type EmojiObject } from "@/lib/editorObjects";
import { type Profile } from "@/lib/types";
import {
  IconUpload,
  IconClose,
  IconSparkle,
  IconDownload,
  IconBlur,
  IconLock,
  IconCheck,
} from "@/components/icons";

const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "200");
const MAX_DIM = 2000;
const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];

type Status = "pendente" | "processando" | "pronto" | "erro";

type SaveState = "idle" | "salvando" | "salvo" | "erro";

type Job = {
  id: string;
  file: File;
  url: string;
  img: HTMLImageElement | null;
  status: Status;
  error?: string;
  detected: boolean;
  regionsCount: number;
  objects: EditorObject[];
  save: SaveState;
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
  const [minScore, setMinScore] = useState(0.3);
  const [padding, setPadding] = useState(0.12);
  const [emojiScale, setEmojiScale] = useState(0.9);

  // Perfis (para salvar na galeria — opcional)
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saveProfileId, setSaveProfileId] = useState<string>("");

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => setProfiles(d.profiles || []))
      .catch(() => setProfiles([]));
  }, []);

  // Libera os object URLs ao desmontar.
  useEffect(() => {
    return () => {
      jobs.forEach((j) => URL.revokeObjectURL(j.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const maxBytes = MAX_MB * 1024 * 1024;
    const next: Job[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!IMG_EXTS.includes(ext) || file.size > maxBytes) continue;
      const url = URL.createObjectURL(file);
      const job: Job = {
        id: crypto.randomUUID(),
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
      if (j) URL.revokeObjectURL(j.url);
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
    const targets = jobs.filter((j) => j.img);
    if (targets.length === 0) return;
    setBusy(true);
    for (const job of targets) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "processando", error: undefined } : j)));
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
  async function saveJobToGallery(job: Job): Promise<boolean> {
    const handle = canvasRefs.current[job.id];
    if (!handle || !saveProfileId) return false;
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "salvando" } : j)));
    try {
      const blob = await handle.export();
      const baseName = job.file.name.replace(/\.[^./\\]+$/, "");
      const form = new FormData();
      form.append("file", new File([blob], `${baseName}-censurada.png`, { type: "image/png" }));
      form.append("tags", "Censurada");
      await apiUpload(`/api/profiles/${saveProfileId}/media`, form);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "salvo" } : j)));
      return true;
    } catch (e) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, save: "erro" } : j)));
      return false;
    }
  }

  const [savingAll, setSavingAll] = useState(false);

  /** Envia TODAS as fotos prontas para a galeria da modelo selecionada. */
  async function sendAllToGallery() {
    if (!saveProfileId) {
      showToast("Escolha a modelo antes de enviar para a galeria.", "warning");
      return;
    }
    const targets = jobs.filter((j) => j.img && j.status === "pronto" && j.save !== "salvo");
    if (targets.length === 0) {
      showToast("Nenhuma foto pronta para enviar. Clique em 'Detectar e editar' primeiro.", "warning");
      return;
    }
    setSavingAll(true);
    let ok = 0;
    for (const job of targets) {
      if (await saveJobToGallery(job)) ok++;
    }
    setSavingAll(false);
    const modelo = profiles.find((p) => p.id === saveProfileId)?.name || "a galeria";
    if (ok === targets.length) {
      showToast(`${ok} foto(s) censurada(s) enviada(s) para ${modelo}.`, "success");
    } else {
      showToast(`Enviadas ${ok}/${targets.length}. Algumas falharam — tente de novo.`, "error");
    }
  }

  const stats = {
    carregadas: jobs.length,
    detectadas: jobs.filter((j) => j.detected && j.regionsCount > 0).length,
    regioes: jobs.reduce((s, j) => s + j.regionsCount, 0),
    prontas: jobs.filter((j) => j.status === "pronto").length,
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5">
        <p className="eyebrow">ferramentas · IA</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
          <IconBlur size={22} /> Censura de imagem com IA
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Detecta partes explícitas e cobre com emoji automaticamente. Ajuste à mão e baixe.
        </p>
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
            <span className="text-sm font-medium text-zinc-200">Clique ou arraste as fotos</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              JPG · PNG · WEBP
            </span>
            <input
              ref={inputRef}
              type="file"
              accept={IMG_EXTS.join(",")}
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </label>

          {jobs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="eyebrow">{jobs.length} mídia(s)</p>
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5">
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
              <label key={part} className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5">
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

          {/* Sliders */}
          <div className="mt-4 space-y-3">
            <Slider label="Sensibilidade" value={minScore} min={0.1} max={0.9} step={0.05} onChange={setMinScore} />
            <Slider label="Folga ao redor" value={padding} min={0} max={0.5} step={0.02} onChange={setPadding} />
            <Slider label="Tamanho emoji" value={emojiScale} min={0.4} max={1.8} step={0.05} onChange={setEmojiScale} />
          </div>

          <button
            onClick={detectAll}
            disabled={busy || jobs.every((j) => !j.img)}
            className="btn-primary mt-4 w-full"
          >
            <IconSparkle size={16} /> {busy ? "Analisando..." : "Detectar e editar"}
          </button>
          <button onClick={clearAll} disabled={jobs.length === 0} className="btn-ghost mt-2 w-full">
            Limpar tudo
          </button>

          {profiles.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="eyebrow">Galeria da modelo</p>
              <p className="mt-1 text-xs text-zinc-500">
                Ao concluir, envie as fotos censuradas direto para a galeria da modelo.
              </p>
              <select
                value={saveProfileId}
                onChange={(e) => setSaveProfileId(e.target.value)}
                className="input mt-2"
              >
                <option value="">— escolher modelo —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={sendAllToGallery}
                disabled={savingAll || !saveProfileId || stats.prontas === 0}
                className="btn-primary mt-2 w-full"
              >
                {savingAll
                  ? "Enviando..."
                  : `Enviar censuradas para a galeria${stats.prontas ? ` (${stats.prontas})` : ""}`}
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
                Carregue as fotos e clique em <b>Detectar e editar</b>. Todas aparecem aqui, uma
                embaixo da outra, prontas para ajustar.
              </p>
            </div>
          )}

          {jobs.map((job) => (
            <div key={job.id} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                  {job.file.name}
                </span>
                {job.status === "pronto" && (
                  <span className="chip">{job.regionsCount} regiã(o/es)</span>
                )}
              </div>

              {job.error && (
                <p className="mb-2 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
                  {job.error}
                </p>
              )}

              {job.img ? (
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
