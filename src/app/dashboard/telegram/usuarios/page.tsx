"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useConfirm } from "@/hooks/useConfirm";
import Modal from "@/components/Modal";
import type { Profile } from "@/lib/types";
import { IconProfiles, IconSend, IconClose, IconSearch } from "@/components/icons";

type UserStatus = "bloqueado" | "vip" | "expirado" | "pendente" | "lead";

type TelegramUser = {
  id: string;
  telegramUserId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatId?: string;
  canDm: boolean;
  blocked: boolean;
  inVip: boolean;
  inPrevias: boolean;
  sourceCode?: string;
  createdAt: number;
  status: UserStatus;
};

type Stats = { total: number; vips: number; expirados: number; leads: number; bloqueados: number };
type Filter = "todos" | "vips" | "expirados" | "leads" | "bloqueados";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "vips", label: "VIPs" },
  { value: "expirados", label: "Expirados" },
  { value: "leads", label: "Leads" },
  { value: "bloqueados", label: "Bloqueados" },
];

const STATUS_LABEL: Record<UserStatus, string> = {
  vip: "VIP",
  expirado: "Expirado",
  pendente: "Pendente",
  lead: "Lead",
  bloqueado: "Bloqueado",
};

const STATUS_CLASS: Record<UserStatus, string> = {
  vip: "border-emerald-500/30 text-emerald-400",
  expirado: "border-amber-500/30 text-amber-400",
  pendente: "border-sky-500/30 text-sky-400",
  lead: "border-white/10 text-zinc-400",
  bloqueado: "border-red-500/30 text-red-400",
};

const PAGE_SIZE = 50;

export default function TelegramUsuariosPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [loading, setLoading] = useState(false);

  const [bot, setBot] = useState<{ id: string; botUsername?: string; operationActive: boolean } | null>(null);
  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({ total: 0, vips: 0, expirados: 0, leads: 0, bloqueados: 0 });

  const [filter, setFilter] = useState<Filter>("todos");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [dmTarget, setDmTarget] = useState<TelegramUser | null>(null);

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => {
        setProfiles(d.profiles || []);
        if (d.profiles?.[0]) setProfileId(d.profiles[0].id);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        profileId,
        filter,
        search,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      const d = await apiGet<{
        bot: { id: string; botUsername?: string; operationActive: boolean } | null;
        users: TelegramUser[];
        total: number;
        stats: Stats;
      }>(`/api/telegram/users?${qs.toString()}`);
      setBot(d.bot);
      setUsers(d.users || []);
      setTotal(d.total || 0);
      setStats(d.stats);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao carregar.", "error");
    } finally {
      setLoading(false);
    }
  }, [profileId, filter, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function removeUser(u: TelegramUser) {
    const ok = await confirm({
      title: "Remover da lista",
      message: `Remover ${displayName(u)} da lista? Isso não expulsa de nenhum grupo — se a pessoa voltar a interagir com o bot, ela reaparece.`,
    });
    if (!ok) return;
    try {
      await apiSend("/api/telegram/users", "POST", { action: "delete-user", userId: u.id });
      showToast("Removido da lista.", "success");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    }
  }

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="page px-1 py-2">
      {ConfirmDialog}
      <div className="mb-5">
        <p className="eyebrow">telegram · usuários</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
          <IconProfiles size={22} /> Usuários
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Todo mundo que o bot conhece: quem deu /start e quem entrou nos grupos VIP e de prévias.
        </p>
      </div>

      <div className="card mb-5 p-4">
        <p className="eyebrow">Modelo</p>
        <select
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value);
            setPage(0);
          }}
          className="input mt-2"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {!bot && !loading && (
        <div className="card p-6 text-center text-sm text-zinc-400">
          Este modelo ainda não tem o bot configurado. Vá em <b>Modelos → editar a modelo → Bot do
          Telegram</b> e informe o token e os IDs dos grupos.
        </div>
      )}

      {bot && (
        <div className="card p-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <IconProfiles size={18} />
            </span>
            <h2 className="font-display text-lg font-semibold">
              Usuários do bot
              {bot.botUsername && <span className="text-zinc-500"> — @{bot.botUsername}</span>}
            </h2>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <StatCard label="Total" value={stats.total} className="text-white" />
            <StatCard label="VIPs" value={stats.vips} className="text-emerald-400" />
            <StatCard label="Expirados" value={stats.expirados} className="text-amber-400" />
            <StatCard label="Leads" value={stats.leads} className="text-sky-400" />
            <StatCard label="Bloqueados" value={stats.bloqueados} className="text-red-400" />
          </div>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(0);
              setSearch(searchInput.trim());
            }}
          >
            <input
              className="input"
              placeholder="Nome, @username ou ID..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn-ghost shrink-0">
              <IconSearch size={15} /> Buscar
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => {
                  setFilter(f.value);
                  setPage(0);
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  filter === f.value
                    ? "border-emerald-500/60 bg-emerald-500/[0.08] text-emerald-400"
                    : "border-white/10 text-zinc-400 hover:bg-white/5"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid place-items-center py-10">
              <div className="h-7 w-7 animate-spin rounded-full border border-white/15 border-t-white" />
            </div>
          ) : users.length === 0 ? (
            <p className="mt-5 text-sm text-zinc-500">
              Nenhum usuário nesta lista ainda. A lista é montada pelos eventos do bot — o Telegram
              não permite consultar os membros de um grupo de uma vez.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-white/[0.06]">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-sm text-zinc-400">
                    {(displayName(u)[0] || "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">{displayName(u)}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-500">
                      Entrou {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                      {u.username && ` · @${u.username}`}
                      {u.inVip && " · no VIP"}
                      {u.inPrevias && " · nas prévias"}
                      {!u.canDm && " · sem conversa no privado"}
                    </p>
                  </div>
                  <span
                    className={`hidden shrink-0 rounded-md border px-2 py-0.5 text-[11px] sm:inline ${STATUS_CLASS[u.status]}`}
                  >
                    {STATUS_LABEL[u.status]}
                  </span>
                  <button
                    onClick={() => setDmTarget(u)}
                    disabled={!u.canDm || u.blocked}
                    title={u.canDm ? "Enviar mensagem" : "Esta pessoa nunca falou com o bot no privado"}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-30"
                    aria-label="Enviar mensagem"
                  >
                    <IconSend size={15} />
                  </button>
                  <button
                    onClick={() => removeUser(u)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-red-500/30 text-red-400 transition-colors hover:bg-red-500/10"
                    aria-label="Remover da lista"
                  >
                    <IconClose size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn-ghost px-2.5 py-1.5 text-xs"
              >
                Anterior
              </button>
              <span className="font-mono text-[11px] text-zinc-500">
                página {page + 1} de {pages} · {total} usuário(s)
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="btn-ghost px-2.5 py-1.5 text-xs"
              >
                Próxima
              </button>
            </div>
          )}

          <p className="mt-3 text-[11px] text-zinc-600">
            A lista cresce sozinha com o uso do bot. Para capturar entradas e saídas dos grupos, o
            webhook precisa estar registrado na versão atual — se este bot já rodava antes, use
            <b> Bot de vendas → Reenviar webhook</b> uma vez.
          </p>
        </div>
      )}

      <SendMessageModal user={dmTarget} onClose={() => setDmTarget(null)} />
    </div>
  );
}

function StatCard({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="panel rounded-xl p-3">
      <p className={`font-display text-xl font-semibold ${className}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">{label}</p>
    </div>
  );
}

function displayName(u: TelegramUser): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (u.username) return `@${u.username}`;
  return `ID ${u.telegramUserId}`;
}

function SendMessageModal({ user, onClose }: { user: TelegramUser | null; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setText("");
  }, [user]);

  async function send() {
    if (!user) return;
    setBusy(true);
    try {
      await apiSend("/api/telegram/users", "POST", {
        action: "send-message",
        userId: user.id,
        text,
      });
      showToast("Mensagem enviada.", "success");
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(user)} onClose={onClose}>
      <h2 className="font-display text-lg font-semibold">
        Mensagem para {user ? displayName(user) : ""}
      </h2>
      <p className="mt-1 text-xs text-zinc-500">
        Enviada agora, no privado do bot. Aceita as tags de formatação do Telegram.
      </p>
      <textarea
        className="input mt-3 min-h-[120px]"
        placeholder="Digite a mensagem..."
        maxLength={4096}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">
          Cancelar
        </button>
        <button onClick={send} disabled={busy || !text.trim()} className="btn-primary">
          <IconSend size={15} /> {busy ? "Enviando..." : "Enviar"}
        </button>
      </div>
    </Modal>
  );
}
