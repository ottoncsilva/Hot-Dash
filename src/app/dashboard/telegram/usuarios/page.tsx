"use client";

import { useCallback, useEffect, useState } from "react";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useConfirm } from "@/hooks/useConfirm";
import Modal from "@/components/Modal";
import type { Profile } from "@/lib/types";
import { IconProfiles, IconSend, IconClose, IconSearch } from "@/components/icons";
import PageHeader from "@/components/PageHeader";

/** Quem gerou PIX e não pagou é LEAD — a distinção vive no detalhe da linha. */
type UserStatus = "bloqueado" | "vip" | "expirado" | "lead";

/**
 * UMA lista só. Assinante não é uma lista à parte: é o mesmo usuário com a
 * coluna de status em "VIP" — antes eram duas listas na mesma tela e a mesma
 * pessoa aparecia nas duas, sem nada dizendo que era a mesma pessoa.
 */
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
  /** Quando existe, a linha ganha as ações de assinatura. */
  subscriptionId?: string;
  /** 0 = vitalício. Ausente = nunca assinou. */
  expiresAt?: number;
  planName?: string;
  /** Gerou PIX e não pagou. É lead, mas vale aparecer no detalhe. */
  pixPendente?: boolean;
  /** Venceu e o bot ainda não conseguiu tirar do VIP (ele segue tentando). */
  removalPending?: boolean;
};

type Stats = { total: number; vips: number; expirados: number; leads: number; bloqueados: number };
/** Como vai o rodízio que pergunta ao Telegram quem está no canal VIP. Só vem
 *  preenchido em bot que o Hot-Dash NÃO opera. */
type VipSync = { checkedAt: number | null; conferidos: number; pendentes: number };
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
  lead: "Lead",
  bloqueado: "Bloqueado",
};

const STATUS_CLASS: Record<UserStatus, string> = {
  vip: "border-emerald-500/30 text-emerald-400",
  expirado: "border-amber-500/30 text-amber-400",
  lead: "border-sky-500/30 text-sky-400",
  bloqueado: "border-red-500/30 text-red-400",
};

const PAGE_SIZE = 50;

export default function TelegramUsuariosPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  // Modelo escolhida no menu — vale para o painel inteiro.
  const { profileId } = useProfile();
  // Trocar de modelo volta para a primeira página — antes isto morava no
  // onChange do select, que agora vive no menu.
  useEffect(() => {
    setPage(0);
  }, [profileId]);
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
  /** Só existe em bot operado por fora: lá o VIP não vem de assinatura, vem de
   *  perguntar ao Telegram quem está no canal. `null` = bot do Hot-Dash. */
  const [vipSync, setVipSync] = useState<VipSync | null>(null);
  const [conferindo, setConferindo] = useState(false);

  useEffect(() => {
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
        vipSync: VipSync | null;
      }>(`/api/telegram/users?${qs.toString()}`);
      setBot(d.bot);
      setUsers(d.users || []);
      setTotal(d.total || 0);
      setStats(d.stats);
      setVipSync(d.vipSync ?? null);
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
      message: `Remover ${displayName(u)} da lista? Isso não expulsa de nenhum canal — se a pessoa voltar a interagir com o bot, ela reaparece.`,
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

  /** Confere agora, sem esperar o rodízio de fundo. */
  async function conferirVip() {
    if (!profileId) return;
    setConferindo(true);
    try {
      const r = await apiSend<{ conferidos: number; dentro: number; falhas: number }>(
        "/api/telegram/users",
        "POST",
        { action: "sync-vip", profileId },
      );
      showToast(
        r.conferidos === 0
          ? "Todo mundo já foi conferido há pouco."
          : `${r.conferidos} conferido(s) · ${r.dentro} no canal${r.falhas ? ` · ${r.falhas} sem resposta` : ""}`,
        r.falhas && !r.dentro ? "error" : "success",
      );
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao conferir.", "error");
    } finally {
      setConferindo(false);
    }
  }

  const pages = Math.ceil(total / PAGE_SIZE);

  // Sem modelo escolhida no menu ("Todas"), esta tela não tem o que
  // mostrar: bot, mailing e usuários são sempre de UMA modelo. Antes a tela
  // escolhia a primeira sozinha; com o seletor no menu isso viraria mentira.
  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Usuários" />
        <PrecisaDeModelo oQue="ver os usuários do bot" />
      </div>
    );
  }

  return (
    <div className="page px-1 py-2">
      {ConfirmDialog}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconProfiles size={22} /> Usuários
          </span>
        }
      />
      <div className="mb-5" />

      {!bot && !loading && (
        <div className="card p-6 text-center text-sm text-zinc-400">
          Este modelo ainda não tem o bot configurado. Vá em <b>Modelos → editar a modelo → Bot do
          Telegram</b> e informe o token e os IDs dos canais.
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

          {/* BOT OPERADO POR FORA: aqui o VIP não vem de assinatura (não existe
              nenhuma — a venda não passou pelo nosso checkout) e sim de
              perguntar ao Telegram quem está no canal, em rodízio. Dizer isso
              na tela é o que separa "ninguém é VIP" de "ainda não conferi
              ninguém" — que sem a data seriam a mesma tela vazia. */}
          {vipSync && <FaixaVipExterno sync={vipSync} onConferir={conferirVip} ocupado={conferindo} />}

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
              Ninguém na lista ainda. Ela é montada pelos eventos do bot.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-white/[0.06]">
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  onDm={() => setDmTarget(u)}
                  onRemove={() => removeUser(u)}
                  onAction={load}
                  confirm={confirm}
                />
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
            A lista cresce com o uso do bot. Para capturar entradas e saídas o webhook precisa estar atualizado
            — se este bot já rodava antes, use
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
        Enviada agora, no privado. Aceita as tags do Telegram.
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
// ---------------------------------------------------------------------------
/**
 * A linha da lista. Uma pessoa = uma linha, seja ela lead, VIP ou expirada.
 *
 * O que muda conforme o status é o que a linha MOSTRA (vencimento e plano só
 * existem para quem assinou) e o que ela OFERECE: as ações de assinatura
 * (reenviar link, estender, expulsar) aparecem só quando há assinatura — antes
 * moravam numa segunda lista, o que obrigava a procurar a mesma pessoa duas
 * vezes na mesma tela.
 */
function UserRow({
  u,
  onDm,
  onRemove,
  onAction,
  confirm,
}: {
  u: TelegramUser;
  onDm: () => void;
  onRemove: () => void;
  onAction: () => void;
  confirm: (opts: { title: string; message: string }) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [aberto, setAberto] = useState(false);
  const temAssinatura = Boolean(u.subscriptionId);

  async function act(
    action: "sub-resend-link" | "sub-extend" | "sub-kick",
    extra?: Record<string, unknown>,
  ) {
    if (!u.subscriptionId) return;
    setBusy(true);
    try {
      await apiSend("/api/telegram", "POST", { action, subscriptionId: u.subscriptionId, ...extra });
      showToast("Feito.", "success");
      onAction();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setBusy(false);
    }
  }

  // A segunda linha conta a história do acesso: quem paga vê quando vence e o
  // que comprou; quem nunca comprou vê desde quando está na lista.
  const detalhe: string[] = [];
  if (u.status === "vip" || u.status === "expirado") {
    detalhe.push(
      u.expiresAt === 0
        ? "Vitalício"
        : u.expiresAt
          ? `${u.status === "vip" ? "Expira" : "Expirou"} ${new Date(u.expiresAt).toLocaleDateString("pt-BR")}`
          : `Entrou ${new Date(u.createdAt).toLocaleDateString("pt-BR")}`,
    );
    if (u.planName) detalhe.push(`⭐ ${u.planName}`);
  } else {
    detalhe.push(`Entrou ${new Date(u.createdAt).toLocaleDateString("pt-BR")}`);
  }
  if (u.pixPendente) detalhe.push("PIX gerado");
  if (u.username) detalhe.push(`@${u.username}`);
  if (u.inPrevias) detalhe.push("prévias");
  if (!u.canDm) detalhe.push("sem conversa no privado");

  return (
    <div className="py-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-sm text-zinc-400">
          {(displayName(u)[0] || "?").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{displayName(u)}</p>
          <p className="truncate font-mono text-[11px] text-zinc-500">{detalhe.join(" · ")}</p>
        </div>
        {/* A COLUNA DE STATUS. Estava escondida no celular (`sm:inline`), que é
            justamente onde o painel é usado — e sem ela a lista não respondia
            à única pergunta que importa: essa pessoa paga ou não? */}
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] ${
            u.removalPending ? "border-red-500/40 bg-red-500/10 text-red-300" : STATUS_CLASS[u.status]
          }`}
          title={
            u.removalPending
              ? "O prazo venceu e o bot ainda não conseguiu tirar do canal VIP. Ele continua tentando — confira se ele é admin com permissão de banir."
              : undefined
          }
        >
          {u.removalPending ? "ainda no VIP" : STATUS_LABEL[u.status]}
        </span>
        <button
          onClick={onDm}
          disabled={!u.canDm || u.blocked}
          title={u.canDm ? "Enviar mensagem" : "Esta pessoa nunca falou com o bot no privado"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-30"
          aria-label="Enviar mensagem"
        >
          <IconSend size={15} />
        </button>
        {temAssinatura ? (
          <button
            onClick={() => setAberto((v) => !v)}
            title="Ações da assinatura"
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-[15px] transition-colors ${
              aberto
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-white/10 text-zinc-300 hover:bg-white/5"
            }`}
            aria-label="Ações da assinatura"
          >
            ⋯
          </button>
        ) : (
          <button
            onClick={onRemove}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-red-500/30 text-red-400 transition-colors hover:bg-red-500/10"
            aria-label="Remover da lista"
          >
            <IconClose size={15} />
          </button>
        )}
      </div>

      {temAssinatura && aberto && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-[50px]">
          <button
            onClick={() => act("sub-resend-link")}
            disabled={busy}
            className="btn-ghost px-2.5 py-1.5 text-xs"
          >
            Reenviar link
          </button>
          <button
            onClick={() => act("sub-extend", { days: 30 })}
            disabled={busy}
            className="btn-ghost px-2.5 py-1.5 text-xs"
          >
            +30 dias
          </button>
          <button
            onClick={async () => {
              const ok = await confirm({
                title: "Expulsar do VIP",
                message: `Remover ${displayName(u)} do canal VIP agora?`,
              });
              if (ok) act("sub-kick");
            }}
            disabled={busy}
            className="rounded-lg px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
          >
            Expulsar
          </button>
          <button
            onClick={onRemove}
            disabled={busy}
            className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-white/5"
          >
            Remover da lista
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A explicação de onde vem o "VIP" quando o bot é operado por fora.
 *
 * Nesse bot não existe assinatura nenhuma (a venda não passou pelo checkout do
 * Hot-Dash) e nenhum update chega pelo webhook — antes disto, todo mundo
 * aparecia como lead para sempre, inclusive quem estava dentro do canal. Agora
 * o painel PERGUNTA ao Telegram, pessoa por pessoa, em rodízio de fundo.
 *
 * A faixa existe porque isso muda o que a tela significa: o VIP aqui é um
 * retrato de minutos atrás, não um estado ao vivo, e "0 VIPs" pode ser
 * simplesmente "ainda não conferi ninguém". Sem a data e o quanto falta, as
 * duas situações são a mesma tela vazia.
 */
function FaixaVipExterno({
  sync,
  onConferir,
  ocupado,
}: {
  sync: VipSync;
  onConferir: () => void;
  ocupado: boolean;
}) {
  const quando = sync.checkedAt
    ? new Date(sync.checkedAt).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : null;
  return (
    <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/[0.05] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-zinc-300">
            Este bot é <b>operado por fora</b>: quem está no VIP é conferido perguntando ao
            Telegram, pessoa por pessoa.
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {quando
              ? `Última conferência ${quando}.`
              : "Nenhuma conferência ainda — a primeira rodada começa em até 1 minuto."}
            {sync.pendentes > 0 && ` Faltam ${sync.pendentes} de ${sync.conferidos + sync.pendentes}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onConferir}
          disabled={ocupado}
          className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] font-bold text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-40"
        >
          {ocupado ? "Conferindo..." : "Conferir agora"}
        </button>
      </div>
      {/* O limite honesto: a API de bot não lista membros de canal, só responde
          sobre um id que já se tem. Quem nunca apareceu num relatório de venda
          é invisível aqui, e não há como mudar isso pelo lado do bot. */}
      <p className="mt-1.5 border-t border-white/[0.06] pt-1.5 text-[11px] text-zinc-600">
        Só é possível conferir quem o painel já conhece (veio de um relatório do Canal de Vendas).
        O Telegram não deixa um bot listar os membros de um canal.
      </p>
    </div>
  );
}
