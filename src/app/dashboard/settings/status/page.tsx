"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { IconDot, IconTrash, IconPlus, IconEdit, IconClose } from "@/components/icons";
import ColorSwatches from "@/components/ColorSwatches";
import { TAG_COLORS, type ProfileStatusDef } from "@/lib/types";
import { useConfirm } from "@/hooks/useConfirm";
import { BackToSettings } from "../_shared";

export default function ProfileStatusSettingsPage() {
  const [statuses, setStatuses] = useState<ProfileStatusDef[]>([]);
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
    apiGet<{ statuses: ProfileStatusDef[] }>("/api/profile-statuses")
      .then((d) => setStatuses(d.statuses))
      .catch(() => {});
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { status } = await apiSend<{ status: ProfileStatusDef }>(
        "/api/profile-statuses",
        "POST",
        { name: name.trim(), color },
      );
      setStatuses((prev) => [...prev, status]);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm("Excluir este status? Só é possível se nenhum modelo estiver usando ele."))) return;
    setError(null);
    try {
      await apiSend(`/api/profile-statuses/${id}`, "DELETE");
      setStatuses((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  function startEdit(s: ProfileStatusDef) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditColor(s.color);
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
      const { status } = await apiSend<{ status: ProfileStatusDef }>(
        `/api/profile-statuses/${id}`,
        "PATCH",
        { name: editName.trim(), color: editColor },
      );
      setStatuses((prev) => prev.map((s) => (s.id === id ? status : s)));
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
        <IconDot size={20} /> Status de modelos
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Crie, renomeie e mude a cor dos status usados na tela Modelos (ex.:
        Online, Configurando, Pausado) — depois é só escolher em cada modelo.
      </p>

      {statuses.length > 0 && (
        <div className="mt-4 card divide-y divide-white/[0.06]">
          {statuses.map((s) =>
            editingId === s.id ? (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <input
                  className="input flex-1"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                />
                <ColorSwatches value={editColor} onChange={setEditColor} />
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => saveEdit(s.id)}
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
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="flex-1 text-sm text-zinc-200">{s.name}</span>
                <button
                  onClick={() => startEdit(s)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
                  aria-label="Editar"
                >
                  <IconEdit size={16} />
                </button>
                <button
                  onClick={() => remove(s.id)}
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
        <label className="eyebrow mb-1.5 block">Novo status</label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input flex-1"
            placeholder="Ex.: Em teste, Arquivado..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <ColorSwatches value={color} onChange={setColor} />
          <button type="submit" disabled={saving || !name.trim()} className="btn-primary">
            <IconPlus size={16} /> Criar
          </button>
        </div>
      </form>

      {ConfirmDialog}
    </div>
  );
}
