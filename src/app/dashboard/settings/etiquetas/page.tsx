"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconTag, IconTrash, IconPlus, IconEdit, IconClose } from "@/components/icons";
import { TAG_COLORS, type Tag } from "@/lib/types";
import { useConfirm } from "@/hooks/useConfirm";
import { BackToSettings } from "../_shared";

function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="grid h-7 w-7 place-items-center rounded-full border-2 transition-all"
          style={{
            backgroundColor: c,
            borderColor: value === c ? "#fff" : "transparent",
          }}
          aria-label={c}
        />
      ))}
    </div>
  );
}

export default function TagSettingsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(TAG_COLORS[0]);
  const [editSaving, setEditSaving] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  function load() {
    apiGet<{ tags: Tag[] }>("/api/tags")
      .then((d) => setTags(d.tags))
      .catch(() => {});
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { tag } = await apiSend<{ tag: Tag }>("/api/tags", "POST", {
        name: name.trim(),
        color,
      });
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm("Excluir esta etiqueta? Ela será removida de todas as mídias."))) return;
    await apiSend(`/api/tags/${id}`, "DELETE");
    setTags((prev) => prev.filter((t) => t.id !== id));
  }

  function startEdit(t: Tag) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditColor(t.color);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    setEditSaving(true);
    setError(null);
    try {
      const { tag } = await apiSend<{ tag: Tag }>(`/api/tags/${id}`, "PATCH", {
        name: editName.trim(),
        color: editColor,
      });
      setTags((prev) =>
        prev.map((t) => (t.id === id ? tag : t)).sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackToSettings />
      <p className="eyebrow mt-4">organização</p>
      <h1 className="mt-1.5 flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
        <IconTag size={20} /> Etiquetas
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Crie etiquetas para categorizar fotos e vídeos na Biblioteca de Mídia
        — depois é só aplicar em cada item e filtrar/agrupar por elas.
      </p>

      {tags.length > 0 && (
        <div className="mt-4 card divide-y divide-white/[0.06]">
          {tags.map((t) =>
            editingId === t.id ? (
              <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <input
                  className="input flex-1"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                />
                <ColorSwatches value={editColor} onChange={setEditColor} />
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => saveEdit(t.id)}
                    disabled={editSaving || !editName.trim()}
                    className="btn-primary px-3 py-1.5 text-xs"
                  >
                    {editSaving ? "Salvando..." : "Salvar"}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
                    aria-label="Cancelar"
                  >
                    <IconClose size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                <span className="flex-1 text-sm text-zinc-200">{t.name}</span>
                <button
                  onClick={() => startEdit(t)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
                  aria-label="Editar"
                >
                  <IconEdit size={16} />
                </button>
                <button
                  onClick={() => remove(t.id)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-red-400"
                  aria-label="Excluir"
                >
                  <IconTrash size={16} />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={create} className="mt-4 card p-4">
        <label className="eyebrow mb-1.5 block">Nova etiqueta</label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input flex-1"
            placeholder="Ex.: Instagram, Aprovada, Rascunho..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <ColorSwatches value={color} onChange={setColor} />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="btn-primary"
          >
            <IconPlus size={16} /> Criar
          </button>
        </div>
      </form>

      {ConfirmDialog}
    </div>
  );
}
