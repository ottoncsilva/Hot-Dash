"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import Modal from "@/components/Modal";
import { IconPlus, IconProfiles, IconChevronRight } from "@/components/icons";
import type { Profile } from "@/lib/types";

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const data = await apiGet<{ profiles: Profile[] }>("/api/profiles");
      setProfiles(data.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar.");
      setProfiles([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const { profile } = await apiSend<{ profile: Profile }>(
        "/api/profiles",
        "POST",
        { name: newName.trim() },
      );
      setProfiles((prev) =>
        [...(prev || []), profile].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewName("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">gestão</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Perfis
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Suas personagens de IA e as contas de cada uma.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">
          <IconPlus size={16} />
          <span className="hidden sm:inline">Novo perfil</span>
        </button>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {profiles === null ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-[92px] animate-pulse" />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 p-12 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 text-zinc-400">
            <IconProfiles size={22} />
          </div>
          <div>
            <p className="text-zinc-200">Nenhum perfil ainda</p>
            <p className="mt-1 text-sm text-zinc-500">
              Crie sua primeira personagem para começar.
            </p>
          </div>
          <button onClick={() => setCreating(true)} className="btn-primary">
            <IconPlus size={16} />
            Criar perfil
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <Link key={p.id} href={`/dashboard/profiles/${p.id}`}>
              <div className="card group flex items-center gap-4 p-4 transition-all hover:border-white/20 hover:bg-white/[0.04]">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-ink-800">
                  <AuthImage
                    src={p.avatarPath ? `/api/profiles/${p.id}/avatar` : null}
                    alt={p.name}
                    className="h-14 w-14 object-cover"
                    fallback={
                      <div className="grid h-14 w-14 place-items-center font-display text-xl font-semibold text-zinc-500">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                    }
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{p.name}</p>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-600">
                    {p.accounts.length}{" "}
                    {p.accounts.length === 1 ? "conta" : "contas"}
                  </p>
                </div>
                <span className="text-zinc-700 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-400">
                  <IconChevronRight size={18} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => !saving && setCreating(false)}>
        <form onSubmit={create}>
          <p className="eyebrow">novo</p>
          <h2 className="mt-1.5 font-display text-lg font-semibold">
            Novo perfil
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Nome da personagem (ex.: Adriana Queiroz).
          </p>
          <input
            autoFocus
            className="input mt-4"
            placeholder="Nome da personagem"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="btn-ghost flex-1"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={saving || !newName.trim()}
            >
              {saving ? "Criando..." : "Criar"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
