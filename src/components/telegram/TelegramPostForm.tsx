import React, { useState, useEffect, useMemo } from "react";
import Modal from "@/components/Modal";
import AuthImage from "@/components/AuthImage";
import { apiGet, apiSend } from "@/lib/api";
import { IconCheck, IconPlay, IconSparkle } from "@/components/icons";
import type { ScheduledPost, PostNetwork } from "@/lib/postTypes";
import type { Profile, MediaItem, Tag } from "@/lib/types";
import type { AiProvider } from "@/lib/settings";

function mediaFileUrl(m: { id: string; updatedAt?: number }): string {
  return `/api/media/${m.id}/file?v=${m.updatedAt || 0}`;
}
function mediaThumbUrl(m: { id: string; updatedAt?: number }): string {
  return `/api/media/${m.id}/thumbnail?v=${m.updatedAt || 0}`;
}
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function TelegramPostForm({
  profiles,
  initial,
  defaultProfileId,
  onClose,
  onSaved,
}: {
  profiles: Profile[];
  initial: ScheduledPost | null;
  defaultProfileId: string;
  onClose: () => void;
  onSaved: (post: ScheduledPost, isNew: boolean) => void;
}) {
  const base = initial ? new Date(initial.scheduledAt) : new Date();
  const [profileId, setProfileId] = useState(
    initial?.profileId || defaultProfileId || profiles[0]?.id || "",
  );
  const [date, setDate] = useState(() => {
    const d = base;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [time, setTime] = useState(() =>
    initial ? fmtTime(initial.scheduledAt) : "12:00",
  );
  
  // Para telegram, teremos uma única network na lista
  const [postType, setPostType] = useState(
    initial?.networks.find(n => n.network === "telegram")?.postType || "VIP"
  );

  const [caption, setCaption] = useState(initial?.caption || "");
  const [mediaIds, setMediaIds] = useState<string[]>(initial?.media.map((m) => m.id) || []);
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  
  const [aiTheme, setAiTheme] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider | "">("");
  const [aiOptions, setAiOptions] = useState<AiProvider[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [mediaTagFilter, setMediaTagFilter] = useState<string>("");
  const [mediaSortOrder, setMediaSortOrder] = useState<"desc" | "asc">("desc");
  const [usedMedia, setUsedMedia] = useState<Set<string>>(new Set());
  const [reusableBlocks, setReusableBlocks] = useState<{ id: string; name: string; content: string }[]>([]);

  useEffect(() => {
    if (!profileId) return;
    setLibrary(null);
    setUsedMedia(new Set());
    apiGet<{ media: MediaItem[]; usedMediaIds?: string[] }>(`/api/profiles/${profileId}/media`)
      .then((d) => {
        setLibrary(d.media);
        if (d.usedMediaIds) setUsedMedia(new Set(d.usedMediaIds));
      })
      .catch(() => setLibrary([]));
  }, [profileId]);

  useEffect(() => {
    apiGet<{ blocks: { id: string; name: string; content: string }[] }>("/api/settings/reusable-blocks")
      .then((d) => setReusableBlocks(d.blocks))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiGet<{ settings: { openai: { enabled: boolean; hasKey: boolean }; gemini: { enabled: boolean; hasKey: boolean } } }>(
      "/api/settings/ai",
    )
      .then((d) => {
        const opts: AiProvider[] = [];
        if (d.settings.openai.enabled && d.settings.openai.hasKey) opts.push("openai");
        if (d.settings.gemini.enabled && d.settings.gemini.hasKey) opts.push("gemini");
        setAiOptions(opts);
        setAiProvider(opts[0] || "");
      })
      .catch(() => setAiOptions([]));
  }, []);

  useEffect(() => {
    apiGet<{ tags: Tag[] }>("/api/tags")
      .then((d) => setTags(d.tags))
      .catch(() => {});
  }, []);

  const filteredLibrary = useMemo(() => {
    if (!library) return null;
    let list = library;
    if (mediaTagFilter) {
      list = list.filter((m) => m.tags?.some((t) => t.id === mediaTagFilter));
    }
    list = [...list].sort((a, b) => {
      if (mediaSortOrder === "asc") return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [library, mediaTagFilter, mediaSortOrder]);

  function toggleMedia(id: string) {
    setMediaIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }

  async function generate() {
    if (mediaIds.length === 0) {
      setErr("Selecione ao menos uma mídia para gerar a legenda.");
      return;
    }
    if (!aiProvider) {
      setErr("Nenhum provedor de IA conectado. Configure em Configurações → Conexão com IA.");
      return;
    }
    setAiBusy(true);
    setErr(null);
    try {
      const { caption: generated } = await apiSend<{ caption: string }>(
        "/api/ai/caption",
        "POST",
        { provider: aiProvider, profileId, networks: [{network: "telegram", postType}], theme: aiTheme, mediaIds },
      );
      setCaption(generated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao gerar legenda.");
    } finally {
      setAiBusy(false);
    }
  }

  async function save() {
    setErr(null);
    if (!profileId) return setErr("Selecione o perfil.");
    const [h, m] = time.split(":").map(Number);
    const [yy, mm, dd] = date.split("-").map(Number);
    const scheduledAt = new Date(yy, mm - 1, dd, h || 0, m || 0).getTime();
    setSaving(true);
    
    // Para telegram, construimos a network dinamicamente
    const networks: PostNetwork[] = [{
      network: "telegram",
      postType: postType,
    }];

    try {
      if (initial && initial.id) {
        const { post } = await apiSend<{ post: ScheduledPost }>(
          `/api/posts/${initial.id}`,
          "PATCH",
          { profileId, networks, scheduledAt, caption, mediaIds },
        );
        onSaved(post, false);
      } else {
        const { post } = await apiSend<{ post: ScheduledPost }>("/api/posts", "POST", {
          profileId,
          networks,
          scheduledAt,
          caption,
          mediaIds,
        });
        onSaved(post, true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl">
      <div className="max-h-[80vh] overflow-y-auto pr-1">
        <p className="eyebrow">{initial?.id ? "editar" : "novo"}</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold text-[#3390ec]">
          {initial?.id ? "Editar post no Telegram" : "Postar no Telegram"}
        </h2>

        {err && (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        )}

        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="eyebrow mb-1.5 block">Modelo</label>
              <select
                className="input"
                value={profileId}
                onChange={(e) => {
                  setProfileId(e.target.value);
                  setMediaIds([]);
                }}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Tipo</label>
              <select
                className="input"
                value={postType}
                onChange={(e) => setPostType(e.target.value)}
              >
                <option value="VIP">VIP</option>
                <option value="Aquecimento">Aquecimento / Prévias</option>
              </select>
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Data</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">Hora</label>
              <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          {/* Mídias da biblioteca */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="eyebrow block">
                Mídias da biblioteca{" "}
                <span className="normal-case text-zinc-600">
                  (clique para selecionar)
                </span>
              </label>
              <div className="flex gap-2">
                <select
                  className="input py-1 text-xs"
                  value={mediaTagFilter}
                  onChange={(e) => setMediaTagFilter(e.target.value)}
                >
                  <option value="">Todas as etiquetas</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input py-1 text-xs"
                  value={mediaSortOrder}
                  onChange={(e) => setMediaSortOrder(e.target.value as "desc" | "asc")}
                >
                  <option value="desc">Mais recentes</option>
                  <option value="asc">Mais antigas</option>
                </select>
              </div>
            </div>
            {filteredLibrary === null ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/5" />
                ))}
              </div>
            ) : filteredLibrary.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-zinc-600">
                Nenhuma mídia encontrada com os filtros atuais.
              </p>
            ) : (
              <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                {filteredLibrary.map((m) => {
                  const idx = mediaIds.indexOf(m.id);
                  const selected = idx !== -1;
                  const used = usedMedia.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMedia(m.id)}
                      className={`relative aspect-square overflow-hidden rounded-lg border bg-ink-850 transition-all ${
                        selected ? "border-[#3390ec] ring-2 ring-[#3390ec]/60" : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      {m.kind === "image" ? (
                        <AuthImage
                          src={mediaFileUrl(m)}
                          alt={m.filename}
                          className={`h-full w-full object-cover ${selected ? "opacity-80" : ""}`}
                          fallback={<div className="h-full w-full bg-ink-800" />}
                        />
                      ) : (
                        <>
                          <AuthImage
                            src={mediaThumbUrl(m)}
                            alt={m.filename}
                            className={`h-full w-full object-cover ${selected ? "opacity-80" : ""}`}
                            fallback={<div className="h-full w-full bg-ink-800" />}
                          />
                          <div className="pointer-events-none absolute inset-0 grid place-items-center">
                            <span className="grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white">
                              <IconPlay size={14} />
                            </span>
                          </div>
                        </>
                      )}
                      {selected && (
                        <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[#3390ec] font-mono text-[10px] font-bold text-white">
                          {idx + 1}
                        </span>
                      )}
                      {used && !selected && (
                        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-white" title="Mídia já utilizada por este perfil">
                          <IconCheck size={10} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Legenda */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="eyebrow block">Legenda</label>
              {reusableBlocks.length > 0 && (
                <select
                  className="input py-1 text-xs w-48"
                  value=""
                  onChange={(e) => {
                    const block = reusableBlocks.find(b => b.id === e.target.value);
                    if (block) setCaption(prev => prev ? prev + "\n" + block.content : block.content);
                  }}
                >
                  <option value="" disabled>Inserir Bloco...</option>
                  {reusableBlocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            <textarea
              className="input min-h-[110px]"
              placeholder="Escreva a legenda..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="input min-w-[180px] flex-1 py-2 text-sm"
                placeholder="Contexto extra p/ IA (opcional — tom, ocasião...)"
                value={aiTheme}
                onChange={(e) => setAiTheme(e.target.value)}
              />
              {aiOptions && aiOptions.length > 0 && (
                <select
                  className="input w-auto py-2 text-sm"
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value as AiProvider)}
                >
                  {aiOptions.map((p) => (
                    <option key={p} value={p}>
                      {p === "openai" ? "OpenAI" : "Gemini"}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={generate}
                disabled={aiBusy}
                className="btn-ghost shrink-0 px-3 text-sm"
                title="Gera a legenda analisando a(s) mídia(s) selecionada(s)"
              >
                <IconSparkle size={15} /> {aiBusy ? "Gerando…" : "Gerar com IA"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={saving}>
            Cancelar
          </button>
          <button type="button" onClick={save} className="rounded-md bg-[#3390ec] text-white flex-1 font-semibold hover:bg-[#2f84d9] transition-colors" disabled={saving}>
            {saving ? "Salvando..." : (initial?.id ? "Salvar Alterações" : "Agendar Post")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
