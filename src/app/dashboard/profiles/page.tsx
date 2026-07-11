"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { apiGet, apiSend } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import type { Profile } from "@/lib/types";

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ profiles: Profile[] }>("/api/profiles");
      setProfiles(data.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
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
        [...prev, profile].sort((a, b) => a.name.localeCompare(b.name)),
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
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Perfis
          </h1>
          <p className="mt-1 text-slate-400">
            Suas personagens de IA e as contas de cada uma.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">
          + Novo perfil
        </button>
      </header>

      {error && (
        <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-40 animate-pulse" />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center">
          <p className="text-slate-300">Nenhum perfil ainda.</p>
          <p className="mt-1 text-sm text-slate-500">
            Crie sua primeira personagem para começar.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="btn-primary mt-5"
          >
            + Criar perfil
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <Link key={p.id} href={`/dashboard/profiles/${p.id}`}>
              <div className="card group flex h-full items-center gap-4 p-5 transition-all hover:border-brand-500/40 hover:bg-white/[0.06]">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/5">
                  <AuthImage
                    src={p.avatarPath ? `/api/profiles/${p.id}/avatar` : null}
                    alt={p.name}
                    className="h-16 w-16 object-cover"
                    fallback={
                      <div className="grid h-16 w-16 place-items-center bg-gradient-to-br from-brand-500/60 to-accent-500/60 text-2xl font-semibold text-white">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                    }
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-medium text-white">
                    {p.name}
                  </p>
                  <p className="text-sm text-slate-400">
                    {p.accounts.length}{" "}
                    {p.accounts.length === 1 ? "conta" : "contas"}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Modal de criação */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => !saving && setCreating(false)}
          >
            <motion.form
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={create}
              className="card w-full max-w-sm p-6"
            >
              <h2 className="text-lg font-semibold text-white">Novo perfil</h2>
              <p className="mt-1 text-sm text-slate-400">
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
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
