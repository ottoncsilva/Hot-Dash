"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import Modal from "@/components/Modal";
import {
  IconUpload,
  IconDownload,
  IconTrash,
  IconPlay,
  IconMedia,
  IconClose,
} from "@/components/icons";
import type { MediaItem, Profile } from "@/lib/types";

export default function MediaPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<{ name: string; status: string }[]>([]);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Carrega perfis e pré-seleciona pelo ?profile= da URL.
  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => {
        setProfiles(d.profiles);
        const param = new URLSearchParams(window.location.search).get("profile");
        const initial =
          param && d.profiles.some((p) => p.id === param)
            ? param
            : d.profiles[0]?.id || "";
        setProfileId(initial);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Falha."));
  }, []);

  useEffect(() => {
    if (!profileId) {
      setMedia([]);
      return;
    }
    setMedia(null);
    apiGet<{ media: MediaItem[] }>(`/api/profiles/${profileId}/media`)
      .then((d) => setMedia(d.media))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Falha.");
        setMedia([]);
      });
  }, [profileId]);

  async function handleFiles(files: FileList | null) {
    if (!files || !profileId) return;
    for (const file of Array.from(files)) {
      setUploads((u) => [...u, { name: file.name, status: "enviando" }]);
      try {
        const form = new FormData();
        form.append("file", file);
        const { media: item } = await apiUpload<{ media: MediaItem }>(
          `/api/profiles/${profileId}/media`,
          form,
        );
        setMedia((m) => [item, ...(m || [])]);
        setUploads((u) => u.filter((x) => x.name !== file.name));
      } catch (err) {
        setUploads((u) =>
          u.map((x) =>
            x.name === file.name
              ? { ...x, status: err instanceof Error ? err.message : "erro" }
              : x,
          ),
        );
      }
    }
  }

  async function remove(item: MediaItem) {
    if (!confirm("Excluir esta mídia?")) return;
    await apiSend(`/api/media/${item.id}`, "DELETE");
    setMedia((m) => (m || []).filter((x) => x.id !== item.id));
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">biblioteca</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Mídia
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Fotos e vídeos com metadados já removidos, prontos para baixar.
          </p>
        </div>
        {profiles.length > 0 && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!profileId}
            className="btn-primary"
          >
            <IconUpload size={16} /> Enviar mídia
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Seletor de perfil */}
      {profiles.length > 0 && (
        <div className="mt-5 flex items-center gap-2">
          <label className="eyebrow">perfil</label>
          <select
            className="input max-w-xs"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Uploads em andamento */}
      {uploads.length > 0 && (
        <div className="mt-4 space-y-2">
          {uploads.map((u, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              <span className="flex-1 truncate text-zinc-300">{u.name}</span>
              <span className="font-mono uppercase tracking-wider text-zinc-500">
                {u.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Grade */}
      {profiles.length === 0 ? (
        <EmptyState text="Crie um perfil antes de enviar mídias." />
      ) : media === null ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <EmptyState text="Nenhuma mídia neste perfil ainda." />
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((item) => (
            <div
              key={item.id}
              className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-ink-850"
            >
              <button
                onClick={() => setPreview(item)}
                className="absolute inset-0 h-full w-full"
              >
                {item.kind === "image" ? (
                  <AuthImage
                    src={`/api/media/${item.id}/file`}
                    alt={item.filename}
                    className="h-full w-full object-cover"
                    fallback={<div className="h-full w-full bg-ink-800" />}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-zinc-600">
                    <IconPlay size={30} />
                  </div>
                )}
              </button>
              <span className="pointer-events-none absolute left-2 top-2">
                <span className="chip bg-black/50">
                  {item.kind === "video" ? "vídeo" : "foto"}
                </span>
              </span>
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                <a
                  href={`/api/media/${item.id}/file?download=1`}
                  download={item.filename}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20"
                  aria-label="Baixar"
                >
                  <IconDownload size={16} />
                </a>
                <button
                  onClick={() => remove(item)}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-red-500/40"
                  aria-label="Excluir"
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview */}
      <Modal open={preview !== null} onClose={() => setPreview(null)} maxWidth="max-w-2xl">
        {preview && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="truncate font-mono text-xs text-zinc-400">
                {preview.filename}
              </p>
              <button
                onClick={() => setPreview(null)}
                className="text-zinc-500 hover:text-white"
              >
                <IconClose size={18} />
              </button>
            </div>
            <div className="overflow-hidden rounded-lg bg-black">
              {preview.kind === "image" ? (
                <AuthImage
                  src={`/api/media/${preview.id}/file`}
                  alt={preview.filename}
                  className="mx-auto max-h-[70vh] w-auto object-contain"
                />
              ) : (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={`/api/media/${preview.id}/file`}
                  controls
                  playsInline
                  className="mx-auto max-h-[70vh] w-full"
                />
              )}
            </div>
            <a
              href={`/api/media/${preview.id}/file?download=1`}
              download={preview.filename}
              className="btn-primary mt-4 w-full"
            >
              <IconDownload size={16} /> Baixar para o dispositivo
            </a>
            <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              no iphone: toque em baixar → compartilhar → salvar
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/12 p-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 text-zinc-400">
        <IconMedia size={22} />
      </div>
      <p className="text-sm text-zinc-500">{text}</p>
    </div>
  );
}
