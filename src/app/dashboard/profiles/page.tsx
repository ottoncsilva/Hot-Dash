"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import Modal from "@/components/Modal";
import NetworkIcon from "@/components/NetworkIcon";
import { IconPlus, IconProfiles, IconChevronRight } from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import BuscaRecolhivel from "@/components/BuscaRecolhivel";
import { showToast } from "@/lib/toast";
import {
  NETWORK_LABELS,
  type Profile,
  type ProfileStatusDef,
  type SocialNetwork,
} from "@/lib/types";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Acrescenta transparência (alfa) a uma cor hex `#rrggbb`, ex.: `hexAlpha("#10b981", "1a")`. */
function hexAlpha(hex: string, alpha: string) {
  return `${hex}${alpha}`;
}

type StatusFilter = "all" | string;

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [statuses, setStatuses] = useState<ProfileStatusDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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
    apiGet<{ statuses: ProfileStatusDef[] }>("/api/profile-statuses")
      .then((d) => setStatuses(d.statuses))
      .catch(() => {});
    // Abre o modal de criação quando vindo da paleta de comandos (?new=1).
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") {
      setCreating(true);
    }
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
      showToast(`Modelo "${profile.name}" criado.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Falha ao criar.", "error");
      setError(err instanceof Error ? err.message : "Falha ao criar.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(profile: Profile, status: string) {
    const prevStatus = profile.status;
    setProfiles((prev) => prev?.map((p) => (p.id === profile.id ? { ...p, status } : p)) ?? prev);
    try {
      await apiSend(`/api/profiles/${profile.id}`, "PATCH", { status });
    } catch (err) {
      setProfiles(
        (prev) => prev?.map((p) => (p.id === profile.id ? { ...p, status: prevStatus } : p)) ?? prev,
      );
      showToast(err instanceof Error ? err.message : "Falha ao atualizar status.", "error");
    }
  }

  const statusCounts = useMemo(() => {
    const list = profiles || [];
    const byId = new Map<string, number>();
    for (const p of list) byId.set(p.status, (byId.get(p.status) || 0) + 1);
    return byId;
  }, [profiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (profiles || []).filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      return true;
    });
  }, [profiles, search, statusFilter]);

  return (
    <div className="page">
      <PageHeader
        title="Modelos"
        actions={
          <button onClick={() => setCreating(true)} className="btn-primary">
            <IconPlus size={16} />
            <span className="hidden sm:inline">Novo modelo</span>
          </button>
        }
      />

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {profiles === null ? (
        <>
          {/* Esqueleto na mesma forma dos tiles reais, senão a tela dá um salto
              de altura quando os dados chegam. */}
          <div className="mt-6 grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="card h-[52px] animate-pulse" />
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
          {/* Tiles de resumo. Com "Total" + os status são 6 quadros: 3 colunas
              no celular (2 linhas) e todos numa linha só a partir do desktop.
              Antes eram 2 colunas no celular, o que dava 3 linhas altas e
              empurrava a lista de modelos para fora da primeira tela. */}
          <div className="mt-6 grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-3">
            <StatTile label="Total" value={profiles.length} />
            {statuses.map((s) => (
              <StatTile key={s.id} label={s.name} value={statusCounts.get(s.id) || 0} />
            ))}
          </div>

          {/* Busca e status na MESMA linha, inclusive no celular. Eram três
              filtros empilhados, três linhas antes da primeira modelo — e a
              busca some da tela junto com quem se está procurando. A busca leva
              o espaço que sobra; o status ocupa só o que precisa.

              O filtro por REDE saiu: filtrar modelo por ter Instagram ou
              Telegram não é pergunta que alguém faz (todas têm), e ele custava
              uma linha inteira. Os ícones de rede continuam no cartão de cada
              uma. */}
          <div className="mt-6 flex items-center gap-2">
            <BuscaRecolhivel
              valor={search}
              onChange={setSearch}
              placeholder="Buscar modelo…"
              classeCampo="min-w-0 flex-1"
            />
            <select
              className="input w-auto shrink-0"
              aria-label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* CARTÕES ATÉ `lg`, TABELA DAQUI PARA CIMA.
              A tabela mede 850px. Rolava — isso estava certo —, mas rolava
              tanto em 390px quanto num iPad em retrato, onde a coluna "Ações"
              caía 47px além da borda. Pior: faturamento, contas e posts, que
              são o motivo de abrir a lista, ficavam fora da primeira leitura.
              O cartão põe nome, faturamento e status na frente e deixa o resto
              para dentro da modelo. */}
          <ul className="mt-3 space-y-2 lg:hidden">
            {filtered.map((p) => {
              const networks = Array.from(new Set(p.accounts.map((a) => a.network)));
              return (
                <li key={p.id} className="card p-3.5">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/dashboard/profiles/${p.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-ink-800">
                        <AuthImage
                          src={p.avatarPath ? `/api/profiles/${p.id}/avatar` : null}
                          alt={p.name}
                          className="h-11 w-11 object-cover"
                          fallback={
                            <div className="grid h-11 w-11 place-items-center font-display text-base font-semibold text-zinc-500">
                              {p.name.charAt(0).toUpperCase()}
                            </div>
                          }
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{p.name}</p>
                        <p className="mt-0.5 font-mono text-sm text-emerald-400">
                          {brl(p.revenuePaidCents || 0)}
                        </p>
                      </div>
                    </Link>
                    <Link
                      href={`/dashboard/profiles/${p.id}`}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"
                      aria-label={`Abrir ${p.name}`}
                    >
                      <IconChevronRight size={18} />
                    </Link>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {(() => {
                      const current = statuses.find((s) => s.id === p.status);
                      const color = current?.color || "#71717a";
                      return (
                        <select
                          value={p.status}
                          onChange={(e) => changeStatus(p, e.target.value)}
                          aria-label={`Status de ${p.name}`}
                          className="rounded-md border px-2 py-1 text-xs font-medium"
                          style={{
                            borderColor: hexAlpha(color, "4d"),
                            backgroundColor: hexAlpha(color, "1a"),
                            color,
                          }}
                        >
                          {statuses.map((st) => (
                            <option key={st.id} value={st.id} className="bg-ink-850 text-zinc-100">
                              {st.name}
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                    <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      {p.accounts.length} conta(s) · {p.postCount ?? 0} post(s)
                    </p>
                    {networks.length > 0 && (
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        {networks.map((n) => (
                          <span key={n} title={NETWORK_LABELS[n]}>
                            <NetworkIcon network={n} size={14} />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="card p-8 text-center text-sm text-zinc-500">
                Nenhum modelo encontrado com esses filtros.
              </li>
            )}
          </ul>

          {/* Tabela */}
          <div className="mt-3 hidden card overflow-hidden lg:block">
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
                      <tr key={p.id} className="hover:bg-white/[0.04]">
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
                          {(() => {
                            const current = statuses.find((s) => s.id === p.status);
                            const color = current?.color || "#71717a";
                            return (
                              <select
                                value={p.status}
                                onChange={(e) => changeStatus(p, e.target.value)}
                                className="rounded-md border px-2 py-1 text-xs font-medium"
                                style={{
                                  borderColor: hexAlpha(color, "4d"),
                                  backgroundColor: hexAlpha(color, "1a"),
                                  color,
                                }}
                              >
                                {statuses.map((s) => (
                                  <option key={s.id} value={s.id} className="bg-ink-850 text-zinc-100">
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            );
                          })()}
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

/** Quadro de contagem. Compacto de propósito: são seis deles em cima da tela e
 *  o que interessa é o número — o rótulo pode ser miúdo. `truncate` porque os
 *  status são cadastrados pelo usuário e um nome longo ("LTV terceiros") não
 *  pode quebrar o quadro em três linhas. */
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-3 py-2.5">
      <p className="eyebrow truncate text-[10px]" title={label}>
        {label}
      </p>
      <p className="mt-1 font-display text-lg font-semibold leading-none text-white">{value}</p>
    </div>
  );
}
