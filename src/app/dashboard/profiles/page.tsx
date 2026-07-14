"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import Modal from "@/components/Modal";
import NetworkIcon from "@/components/NetworkIcon";
import { IconPlus, IconProfiles, IconChevronRight } from "@/components/icons";
import {
  NETWORK_LABELS,
  PROFILE_STATUS_LABELS,
  type Profile,
  type ProfileStatus,
  type SocialNetwork,
} from "@/lib/types";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_ORDER: ProfileStatus[] = ["online", "configuring", "paused"];

const STATUS_STYLES: Record<ProfileStatus, string> = {
  online: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  configuring: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  paused: "border-white/15 bg-white/5 text-zinc-400",
};

type StatusFilter = "all" | ProfileStatus;
type NetworkFilter = "all" | SocialNetwork;

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("all");

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

  async function changeStatus(profile: Profile, status: ProfileStatus) {
    const prevStatus = profile.status;
    setProfiles((prev) => prev?.map((p) => (p.id === profile.id ? { ...p, status } : p)) ?? prev);
    try {
      await apiSend(`/api/profiles/${profile.id}`, "PATCH", { status });
    } catch (err) {
      setProfiles(
        (prev) => prev?.map((p) => (p.id === profile.id ? { ...p, status: prevStatus } : p)) ?? prev,
      );
      setError(err instanceof Error ? err.message : "Falha ao atualizar status.");
    }
  }

  const networksInUse = useMemo(() => {
    const set = new Set<SocialNetwork>();
    (profiles || []).forEach((p) => p.accounts.forEach((a) => set.add(a.network)));
    return Array.from(set);
  }, [profiles]);

  const counts = useMemo(() => {
    const list = profiles || [];
    return {
      total: list.length,
      online: list.filter((p) => p.status === "online").length,
      configuring: list.filter((p) => p.status === "configuring").length,
      paused: list.filter((p) => p.status === "paused").length,
    };
  }, [profiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (profiles || []).filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (networkFilter !== "all" && !p.accounts.some((a) => a.network === networkFilter))
        return false;
      return true;
    });
  }, [profiles, search, statusFilter, networkFilter]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">gestão</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Modelos
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Suas personagens de IA e as contas de cada uma.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">
          <IconPlus size={16} />
          <span className="hidden sm:inline">Novo modelo</span>
        </button>
      </div>

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {profiles === null ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card h-[76px] animate-pulse" />
            ))}
          </div>
          <div className="mt-3 card h-64 animate-pulse" />
        </>
      ) : profiles.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/10 p-12 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 text-zinc-400">
            <IconProfiles size={22} />
          </div>
          <div>
            <p className="text-zinc-200">Nenhum modelo ainda</p>
            <p className="mt-1 text-sm text-zinc-500">
              Crie sua primeira personagem para começar.
            </p>
          </div>
          <button onClick={() => setCreating(true)} className="btn-primary">
            <IconPlus size={16} />
            Criar modelo
          </button>
        </div>
      ) : (
        <>
          {/* Tiles de resumo */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Total" value={counts.total} />
            <StatTile label="Online" value={counts.online} />
            <StatTile label="Configurando" value={counts.configuring} />
            <StatTile label="Pausadas" value={counts.paused} />
          </div>

          {/* Busca e filtros */}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <input
              className="input"
              placeholder="Buscar modelo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">Todas</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {PROFILE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value as NetworkFilter)}
            >
              <option value="all">Todos</option>
              {networksInUse.map((n) => (
                <option key={n} value={n}>
                  {NETWORK_LABELS[n]}
                </option>
              ))}
            </select>
          </div>

          {/* Tabela */}
          <div className="mt-3 card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left">
                    <th className="px-4 py-3 eyebrow font-normal">Modelo</th>
                    <th className="px-4 py-3 eyebrow font-normal">Plataformas</th>
                    <th className="px-4 py-3 eyebrow font-normal">Faturamento</th>
                    <th className="px-4 py-3 eyebrow font-normal">Contas</th>
                    <th className="px-4 py-3 eyebrow font-normal">Posts</th>
                    <th className="px-4 py-3 eyebrow font-normal">Status</th>
                    <th className="px-4 py-3 text-right eyebrow font-normal">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {filtered.map((p) => {
                    const networks = Array.from(new Set(p.accounts.map((a) => a.network)));
                    return (
                      <tr key={p.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/dashboard/profiles/${p.id}`}
                            className="flex items-center gap-3"
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-ink-800">
                              <AuthImage
                                src={p.avatarPath ? `/api/profiles/${p.id}/avatar` : null}
                                alt={p.name}
                                className="h-9 w-9 object-cover"
                                fallback={
                                  <div className="grid h-9 w-9 place-items-center font-display text-sm font-semibold text-zinc-500">
                                    {p.name.charAt(0).toUpperCase()}
                                  </div>
                                }
                              />
                            </div>
                            <span className="truncate font-medium text-white">{p.name}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          {networks.length === 0 ? (
                            <span className="text-zinc-700">—</span>
                          ) : (
                            <div className="flex items-center gap-1.5 text-zinc-400">
                              {networks.map((n) => (
                                <span key={n} title={NETWORK_LABELS[n]}>
                                  <NetworkIcon network={n} size={14} />
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">
                          {brl(p.revenuePaidCents || 0)}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400">{p.accounts.length}</td>
                        <td className="px-4 py-2.5 text-zinc-400">{p.postCount ?? 0}</td>
                        <td className="px-4 py-2.5">
                          <select
                            value={p.status}
                            onChange={(e) => changeStatus(p, e.target.value as ProfileStatus)}
                            className={`rounded-md border px-2 py-1 text-xs font-medium ${STATUS_STYLES[p.status]}`}
                          >
                            {STATUS_ORDER.map((s) => (
                              <option key={s} value={s} className="bg-ink-850 text-zinc-100">
                                {PROFILE_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={`/dashboard/profiles/${p.id}`}
                            className="inline-grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"
                            aria-label={`Abrir ${p.name}`}
                          >
                            <IconChevronRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="p-8 text-center text-sm text-zinc-500">
                  Nenhum modelo encontrado com esses filtros.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      <Modal open={creating} onClose={() => !saving && setCreating(false)}>
        <form onSubmit={create}>
          <p className="eyebrow">novo</p>
          <h2 className="mt-1.5 font-display text-lg font-semibold">
            Novo modelo
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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold text-white">{value}</p>
    </div>
  );
}
