"use client";

import { useCallback, useRef, useState } from "react";
import {
  IconUpload,
  IconDownload,
  IconClose,
  IconSparkle,
} from "@/components/icons";

type Status = "pendente" | "processando" | "pronto" | "erro";

type Item = {
  id: string;
  file: File;
  status: Status;
  error?: string;
  resultUrl?: string;
  resultName?: string;
};

const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "200");

export default function MetadataPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const maxBytes = MAX_MB * 1024 * 1024;
    const next: Item[] = [];

    for (const file of Array.from(files)) {
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const isImg = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tiff", ".tif", ".gif"].includes(ext);
      const isVid = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg"].includes(ext);

      if (file.size > maxBytes) {
        next.push({
          id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
          file,
          status: "erro",
          error: `Excede o limite de ${MAX_MB} MB.`,
        });
      } else if (!isImg && !isVid) {
        next.push({
          id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
          file,
          status: "erro",
          error: "Formato não suportado.",
        });
      } else {
        next.push({
          id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
          file,
          status: "pendente",
        });
      }
    }
    setItems((prev) => [...prev, ...next]);
  }, []);

  async function processItem(item: Item) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, status: "processando", error: undefined } : i,
      ),
    );
    try {
      const body = new FormData();
      body.append("file", item.file);
      const res = await fetch("/api/metadata/clean", { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const baseName = item.file.name.replace(/\.[^./\\]+$/, "");
      const ext = item.file.name.slice(item.file.name.lastIndexOf("."));
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: "pronto",
                resultUrl: url,
                resultName: `${baseName}-limpo${ext}`,
              }
            : i,
        ),
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: "erro",
                error: err instanceof Error ? err.message : "Falha",
              }
            : i,
        ),
      );
    }
  }

  async function processAll() {
    setBusy(true);
    for (const item of items) {
      if (item.status === "pendente" || item.status === "erro") {
        await processItem(item);
      }
    }
    setBusy(false);
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const found = prev.find((i) => i.id === id);
      if (found?.resultUrl) URL.revokeObjectURL(found.resultUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  function clearAll() {
    items.forEach((i) => i.resultUrl && URL.revokeObjectURL(i.resultUrl));
    setItems([]);
  }

  const pending = items.filter(
    (i) => i.status === "pendente" || i.status === "erro",
  ).length;

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">ferramenta</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
        Limpar Metadados
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Remove EXIF, GPS, data, câmera e rastros de software (IA) de fotos e
        vídeos. Processado na hora —{" "}
        <span className="text-zinc-300">nada é armazenado</span>.
      </p>

      {/* Zona de upload */}
      <div
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
        onClick={() => inputRef.current?.click()}
        className={`mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center transition-all ${
          dragging
            ? "border-white/40 bg-white/[0.04]"
            : "border-white/20 hover:border-white/25 hover:bg-white/[0.02]"
        }`}
      >
        <div className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300">
          <IconUpload size={22} />
        </div>
        <div>
          <p className="font-medium text-white">
            Arraste arquivos ou clique para escolher
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Fotos (JPG, PNG, WEBP, HEIC…) e vídeos (MP4, MOV, MKV…) · até{" "}
            {MAX_MB} MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={processAll}
            disabled={busy || pending === 0}
            className="btn-primary"
          >
            <IconSparkle size={16} />
            {busy ? "Processando..." : `Limpar ${pending > 0 ? `(${pending})` : ""}`}
          </button>
          <button onClick={clearAll} disabled={busy} className="btn-ghost">
            Limpar lista
          </button>
        </div>
      )}

      <div className="mt-6 space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="card flex items-center gap-4 p-3.5">
            <StatusDot status={item.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">
                {item.file.name}
              </p>
              <p className="font-mono text-[11px] text-zinc-600">
                {(item.file.size / 1024 / 1024).toFixed(1)} MB
                {item.status === "erro" && item.error && (
                  <span className="text-red-400"> · {item.error}</span>
                )}
              </p>
            </div>
            {item.status === "pronto" && item.resultUrl && (
              <a
                href={item.resultUrl}
                download={item.resultName}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                <IconDownload size={14} />
                Baixar
              </a>
            )}
            {(item.status === "pendente" || item.status === "erro") && (
              <button
                onClick={() => processItem(item)}
                disabled={busy}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                {item.status === "erro" ? "Tentar de novo" : "Limpar"}
              </button>
            )}
            <button
              onClick={() => removeItem(item.id)}
              className="text-zinc-600 transition-colors hover:text-zinc-300"
              aria-label="Remover"
            >
              <IconClose size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    pendente: "bg-zinc-600",
    processando: "bg-white animate-pulse",
    pronto: "bg-white",
    erro: "bg-red-500",
  };
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.02]">
      <span className={`h-2 w-2 rounded-full ${map[status]}`} />
    </span>
  );
}
