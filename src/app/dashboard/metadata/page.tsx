"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
    const next: Item[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      status: "pendente",
    }));
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
      const res = await fetch("/api/metadata/clean", {
        method: "POST",
        body,
      });
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
    // Processa em sequência para não sobrecarregar a VPS.
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
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Limpar Metadados
        </h1>
        <p className="mt-1.5 text-slate-400">
          Remove EXIF, GPS, data, modelo de câmera e rastros de software (IA) de
          fotos e vídeos. Os arquivos são processados na hora e{" "}
          <strong className="text-slate-200">nada é armazenado</strong>.
        </p>
      </header>

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
        className={`card flex cursor-pointer flex-col items-center justify-center gap-3 border-dashed p-10 text-center transition-all ${
          dragging
            ? "border-brand-500/60 bg-brand-500/5"
            : "hover:border-white/20"
        }`}
      >
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/80 to-accent-500/80 text-2xl text-white">
          ⤒
        </div>
        <div>
          <p className="font-medium text-white">
            Arraste arquivos aqui ou clique para escolher
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Fotos (JPG, PNG, WEBP, HEIC…) e vídeos (MP4, MOV, MKV…) · até{" "}
            {MAX_MB} MB cada
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

      {/* Ações */}
      {items.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={processAll}
            disabled={busy || pending === 0}
            className="btn-primary"
          >
            {busy
              ? "Processando..."
              : `Limpar ${pending > 0 ? `(${pending})` : "tudo"}`}
          </button>
          <button
            onClick={clearAll}
            disabled={busy}
            className="btn-ghost"
          >
            Limpar lista
          </button>
        </div>
      )}

      {/* Lista de arquivos */}
      <div className="mt-6 space-y-3">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="card flex items-center gap-4 p-4"
            >
              <StatusBadge status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-100">
                  {item.file.name}
                </p>
                <p className="text-xs text-slate-500">
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
                  className="btn-primary px-4 py-2 text-sm"
                >
                  Baixar
                </a>
              )}
              {(item.status === "pendente" || item.status === "erro") && (
                <button
                  onClick={() => processItem(item)}
                  disabled={busy}
                  className="btn-ghost px-4 py-2 text-sm"
                >
                  {item.status === "erro" ? "Tentar de novo" : "Limpar"}
                </button>
              )}
              <button
                onClick={() => removeItem(item.id)}
                disabled={busy && item.status === "processando"}
                className="text-slate-500 transition-colors hover:text-slate-300"
                aria-label="Remover"
              >
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; className: string }> = {
    pendente: { label: "●", className: "text-slate-500" },
    processando: { label: "◐", className: "animate-spin text-brand-400" },
    pronto: { label: "✓", className: "text-emerald-400" },
    erro: { label: "!", className: "text-red-400" },
  };
  const { label, className } = map[status];
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-lg ${className}`}
    >
      {label}
    </span>
  );
}
