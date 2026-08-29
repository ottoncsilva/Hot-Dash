"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import { MoneyInput } from "@/components/MoneyInput";
import { IconPlus, IconSettings, IconPayments, IconCopy, IconTrash, IconEdit, IconTelegram, IconReport } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { Transaction, PeriodStats } from "@/lib/transactions";
import type { Profile } from "@/lib/types";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import PageHeader from "@/components/PageHeader";
import { DEFAULT_PERIOD, PERIOD_OPTIONS } from "@/lib/periods";
import { showToast } from "@/lib/toast";

/**
 * Link para abrir a conversa com o lead que fez a compra. O contato vem do
 * webhook, amarrado à inscrição do Telegram.
 *
 * Com @usuário o link é o normal do Telegram e abre a conversa direto. Sem
 * ele, só resta o id numérico (`tg://user?id=`), que os apps só conseguem
 * abrir quando já conhecem a pessoa — quem nunca falou com você pelo seu
 * usuário pessoal pode não abrir. Por isso o botão avisa no title.
 */
function telegramChatLink(contato: { userId: number; username?: string }): {
  href: string;
  certo: boolean;
} {
  const user = (contato.username || "").replace(/^@/, "").trim();
  if (user) return { href: `https://t.me/${user}`, certo: true };
  return { href: `tg://user?id=${contato.userId}`, certo: false };
}

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const STATUS_LABEL: Record<string, string> = {
  paid: "pago",
  pending: "gerado",
  failed: "falhou",
  refunded: "estornado",
  chargeback: "chargeback",
};

const METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  card: "Cartão",
};

type PaidFilter = "all" | "paid" | "unpaid";
type SortKey = "created_desc" | "created_asc" | "paid_desc" | "paid_asc" | "amount_desc" | "amount_asc";

const SORT_LABEL: Record<SortKey, string> = {
  created_desc: "Geração (mais novo)",
  created_asc: "Geração (mais antigo)",
  paid_desc: "Pagamento (mais novo)",
  paid_asc: "Pagamento (mais antigo)",
  amount_desc: "Valor (maior)",
  amount_asc: "Valor (menor)",
};

type Data = {
  providers: PaymentSettingsPublic;
  /** Totais do PERÍODO selecionado (os cards do topo). */
  periodStats: PeriodStats;
  transactions: Transaction[];
  balanceCents: number | null;
};

export default function PaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [sort, setSort] = useState<SortKey>("created_desc");
  // Busca em texto livre — sobre o que JÁ carregou (o período é filtrado no
  // servidor, sem teto: ver /api/payments/overview). Cobre nome, produto,
  // bot e método, porque "pesquisar" pra quem usa a tela é achar uma venda
  // por qualquer um desses, não só o cliente.
  const [busca, setBusca] = useState("");
  // Mesmo seletor do Dashboard, com o mesmo padrão (hoje). O recorte é feito no
  // servidor — ver /api/payments/overview.
  const [period, setPeriod] = useState<PeriodState>({ period: DEFAULT_PERIOD, from: "", to: "" });
  // O filtro por data é sobre o dia no FUSO DA OPERAÇÃO, não no do navegador.
  const [tz, setTz] = useState(DEFAULT_TIME_ZONE);
  useEffect(() => {
    apiGet<{ timeZone: string }>("/api/settings/general")
      .then((d) => d.timeZone && setTz(d.timeZone))
      .catch(() => {});
  }, []);

  async function load() {
    try {
      setData(await apiGet<Data>(`/api/payments/overview?${periodQuery(period)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha.");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);
  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((r) => setProfiles(r.profiles))
      .catch(() => {});
  }, []);

  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [editando, setEditando] = useState<Transaction | null>(null);

  async function excluir(t: Transaction) {
    const nome = t.customer || t.description || "esta cobrança";
    if (!confirm(`Remover ${nome} de ${brl(t.amountCents)} do histórico? Isso não cancela nada na SyncPay.`)) return;
    setExcluindo(t.id);
    try {
      await apiSend(`/api/payments/transactions/${t.id}`, "DELETE");
      await load();
      showToast("Lançamento excluído.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao remover.");
    } finally {
      setExcluindo(null);
    }
  }

  const anyProvider = data?.providers.syncpay.enabled;
  const periodLabel =
    period.period === "custom"
      ? "Período"
      : PERIOD_OPTIONS.find((p) => p.key === period.period)?.label || "Período";

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    let list = data.transactions;

    if (paidFilter === "paid") list = list.filter((t) => t.status === "paid");
    else if (paidFilter === "unpaid") list = list.filter((t) => t.status !== "paid");

    const termo = busca.trim().toLowerCase();
    if (termo) {
      list = list.filter((t) =>
        [t.customer, t.description, t.botUsername, t.method, t.provider]
          .filter(Boolean)
          .some((campo) => campo!.toLowerCase().includes(termo)),
      );
    }

    const val = (t: Transaction) => t.netAmountCents ?? t.amountCents;
    // Sem pagamento ainda: joga pro fim na ordem decrescente e pro fim na
    // crescente também, para os pendentes não bagunçarem a leitura.
    const paidTs = (t: Transaction) => t.paidAt ?? null;

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "created_asc": return a.createdAt - b.createdAt;
        case "amount_desc": return val(b) - val(a);
        case "amount_asc": return val(a) - val(b);
        case "paid_desc":
        case "paid_asc": {
          const pa = paidTs(a), pb = paidTs(b);
          if (pa === null && pb === null) return b.createdAt - a.createdAt;
          if (pa === null) return 1;
          if (pb === null) return -1;
          return sort === "paid_desc" ? pb - pa : pa - pb;
        }
        default: return b.createdAt - a.createdAt;
      }
    });
    return sorted;
  }, [data, paidFilter, sort, busca]);

  return (
    <div className="page">
      <PageHeader
        title="Financeiro"
        actions={
          <>
            {/* O relatório abre já no período selecionado aqui — sem obrigar a
                escolher de novo do outro lado. */}
            <Link href={`/dashboard/payments/relatorio?${periodQuery(period)}`} className="btn-ghost">
              <IconReport size={16} /> Relatório
            </Link>
            <button
              onClick={() => setCharging(true)}
              disabled={!anyProvider}
              className="btn-primary"
              title={anyProvider ? "" : "Configure um provedor primeiro"}
            >
              <IconPlus size={16} /> Nova cobrança
            </button>
          </>
        }
      />

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!anyProvider && data && (
        <div className="mt-5 flex items-center justify-between card p-4">
          <p className="text-sm text-zinc-400">Nenhum provedor conectado ainda.</p>
          <Link href="/dashboard/settings/pagamentos" className="btn-ghost text-xs">
            <IconSettings size={14} /> Configurar
          </Link>
        </div>
      )}

      {/* Período — o mesmo seletor do Dashboard, valendo para os totais e para
          a lista abaixo. */}
      <div className="mt-5">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* Totais do período + saldo no gateway (consultado na SyncPay a cada
          carregamento desta tela). */}
      <div className="mt-4 flex flex-wrap gap-3">
        <SummaryChip label={periodLabel} value={data ? brl(data.periodStats.paidCents) : null} />
        <SummaryChip
          label="Líquido"
          value={data ? brl(data.periodStats.paidNetCents) : null}
          accent
        />
        <SummaryChip label="Vendas" value={data ? String(data.periodStats.paidCount) : null} />
        <SummaryChip
          label="Saldo na SyncPay"
          value={data ? (data.balanceCents === null ? "indisponível" : brl(data.balanceCents)) : null}
          accent={Boolean(data && data.balanceCents !== null)}
        />
      </div>

      {/* Lista de PIX gerados */}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <p className="eyebrow">
          pix gerados
          {data && (
            <span className="ml-2 normal-case text-zinc-600">
              ({filteredTransactions.length}
              {filteredTransactions.length !== data.transactions.length ? ` de ${data.transactions.length}` : ""})
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <input
            className="input w-48 py-1.5 text-xs"
            placeholder="Buscar cliente, produto, bot..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <select
            className="input w-auto py-1.5 text-xs"
            value={paidFilter}
            onChange={(e) => setPaidFilter(e.target.value as PaidFilter)}
          >
            <option value="all">Pagos: todos</option>
            <option value="paid">Pagos: sim</option>
            <option value="unpaid">Pagos: não</option>
          </select>
          <select
            className="input w-auto py-1.5 text-xs"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABEL[k]}</option>
            ))}
          </select>
          {(paidFilter !== "all" || sort !== "created_desc" || busca) && (
            <button
              type="button"
              onClick={() => { setPaidFilter("all"); setSort("created_desc"); setBusca(""); }}
              className="btn-ghost py-1.5 text-xs"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Tabela. "Pago" e "gerado" dividem uma coluna só (pago em cima), o que
          devolveu uma coluna inteira de largura — daí o min-w cair de 900 para
          780px e a tabela rolar menos no celular. O desconto continua separado
          em Taxa e Split, como no painel da SyncPay. */}
      <div className="mt-3 card overflow-x-auto">
        {!data ? (
          <div className="h-32 animate-pulse" />
        ) : filteredTransactions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 text-zinc-500">
              <IconPayments size={20} />
            </div>
            <p className="text-sm text-zinc-500">Nenhum PIX encontrado.</p>
          </div>
        ) : (
          <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="p-3">Nome</th>
                <th className="p-3 w-32">Bot</th>
                <th className="p-3 w-40">Produto</th>
                <th className="p-3 w-24">Método</th>
                {/* Pago e gerado dividem uma coluna só: são a mesma informação
                    (quando), e separadas gastavam largura numa tabela que já
                    rola na horizontal. Pago em cima, gerado embaixo. */}
                <th className="w-36 whitespace-nowrap p-3">Pago / gerado</th>
                <th className="p-3 w-24 text-center">Status</th>
                <th className="p-3 w-28 text-right">Venda</th>
                <th className="p-3 w-24 text-right">Taxa</th>
                <th className="p-3 w-24 text-right">Split</th>
                <th className="p-3 w-28 text-right">Líquido</th>
                <th className="p-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredTransactions.map((t) => {
                const pago = t.status === "paid";
                // Taxa = venda − líquido. É o desconto real do gateway; a coluna
                // "Sync Amount" do export fica fixa em 0,80 e não bate.
                const liquido = t.netAmountCents;
                // Taxa e split vêm separados (é assim que a SyncPay mostra:
                // entrada − taxas − split = você recebe).
                const taxa = t.feeCents;
                const split = t.splitCents;
                return (
                  <tr key={t.id} className="hover:bg-white/[0.04]">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <PaidCheck paid={pago} />
                        <div className="min-w-0">
                          <p className="truncate text-zinc-200">
                            {t.customer || t.description || "Venda SyncPay"}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                              {t.provider}
                            </span>
                            {/* Falar com o lead. Fica AQUI, na primeira coluna,
                                porque a tabela é larga e rola na horizontal: na
                                coluna de ações o atalho nasceria fora da tela no
                                celular. Só aparece quando o webhook amarrou esta
                                venda a um contato do Telegram. */}
                            {t.telegram && (() => {
                              const { href, certo } = telegramChatLink(t.telegram);
                              return (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={
                                    certo
                                      ? `Conversar com @${t.telegram.username} no Telegram`
                                      : "Este lead não tem @usuário público — o Telegram pode não conseguir abrir a conversa"
                                  }
                                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                                    certo
                                      ? "border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                                      : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/10"
                                  }`}
                                >
                                  <IconTelegram size={11} />
                                  Conversar
                                </a>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 font-mono text-[11px] text-zinc-400">
                      {t.botUsername ? `@${t.botUsername}` : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="max-w-[160px] truncate p-3 text-xs text-zinc-400">
                      {t.description || <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="p-3 text-xs text-zinc-400">
                      {t.method ? METHOD_LABEL[t.method] || t.method : <span className="text-zinc-700">—</span>}
                    </td>
                    {/* Pago em cima, gerado embaixo. Uma linha cada (em vez do
                        par data/hora empilhado de antes), senão a célula viraria
                        quatro linhas de altura. */}
                    <td className="p-3">
                      {/* nowrap: sem isso a data e a hora quebram em duas
                          linhas cada e a célula vira quatro linhas de altura —
                          justo o que a fusão das colunas veio evitar. */}
                      {t.paidAt ? (
                        <p className="whitespace-nowrap font-mono text-[11px] text-emerald-400">
                          {dataHoraCurta(t.paidAt, tz)}
                        </p>
                      ) : (
                        <p className="font-mono text-[11px] text-zinc-700">—</p>
                      )}
                      <p className="whitespace-nowrap font-mono text-[10px] text-zinc-600">
                        {dataHoraCurta(t.createdAt, tz)}
                      </p>
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          pago
                            ? "bg-emerald-500/10 text-emerald-400"
                            : t.status === "pending"
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-zinc-500/10 text-zinc-400"
                        }`}
                      >
                        {STATUS_LABEL[t.status] || t.status}
                      </span>
                    </td>
                    <td className={`p-3 text-right font-display font-semibold ${pago ? "text-white" : "text-zinc-500"}`}>
                      {brl(t.amountCents)}
                    </td>
                    <td className="p-3 text-right font-mono text-xs text-zinc-500">
                      {taxa === undefined ? "—" : `-${brl(taxa)}`}
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {split === undefined ? (
                        <span className="text-zinc-700">—</span>
                      ) : split > 0 ? (
                        <span className="text-amber-400/80">-{brl(split)}</span>
                      ) : (
                        <span className="text-zinc-700">-{brl(0)}</span>
                      )}
                    </td>
                    <td className={`p-3 text-right font-display font-semibold ${pago ? "text-emerald-400" : "text-zinc-600"}`}>
                      {liquido === undefined ? "—" : brl(liquido)}
                    </td>
                    {/* Remover: o webhook da SyncPay é por conta e traz
                        movimento que não é venda (saque, por exemplo). */}
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          title="Corrigir valores"
                          onClick={() => setEditando(t)}
                          className="text-zinc-700 transition-colors hover:text-white"
                        >
                          <IconEdit size={14} />
                        </button>
                        <button
                          type="button"
                          title="Remover do histórico"
                          onClick={() => excluir(t)}
                          disabled={excluindo === t.id}
                          className="text-zinc-700 transition-colors hover:text-red-400 disabled:opacity-40"
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={Boolean(editando)} onClose={() => setEditando(null)}>
        {editando && (
          <EditarCobranca
            tx={editando}
            profiles={profiles}
            onClose={() => setEditando(null)}
            onDone={() => {
              setEditando(null);
              load();
            }}
          />
        )}
      </Modal>

      <Modal open={charging} onClose={() => setCharging(false)}>
        <ChargeForm
          profiles={profiles}
          onClose={() => setCharging(false)}
          onDone={() => {
            setCharging(false);
            load();
          }}
        />
      </Modal>
    </div>
  );
}

/**
 * Correção manual de uma cobrança. O líquido não é campo: ele é sempre
 * venda − taxa − split, e aparece calculado para conferência antes de salvar.
 */
function EditarCobranca({
  tx,
  profiles,
  onClose,
  onDone,
}: {
  tx: Transaction;
  profiles: Profile[];
  onClose: () => void;
  onDone: () => void;
}) {
  const emReais = (c: number | undefined) => ((c ?? 0) / 100).toFixed(2);
  const [venda, setVenda] = useState(emReais(tx.amountCents));
  const [taxa, setTaxa] = useState(emReais(tx.feeCents));
  const [split, setSplit] = useState(emReais(tx.splitCents));
  const [nome, setNome] = useState(tx.customer || "");
  const [perfil, setPerfil] = useState(tx.profileId || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const paraCentavos = (v: string) => Math.round((Number(v) || 0) * 100);
  const cVenda = paraCentavos(venda);
  const cTaxa = paraCentavos(taxa);
  const cSplit = paraCentavos(split);
  const valido = [cVenda, cTaxa, cSplit].every((n) => Number.isFinite(n) && n >= 0);
  const liquido = valido ? Math.max(0, cVenda - cTaxa - cSplit) : 0;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await apiSend(`/api/payments/transactions/${tx.id}`, "PATCH", {
        amountCents: cVenda,
        feeCents: cTaxa,
        splitCents: cSplit,
        customer: nome,
        profileId: perfil,
      });
      showToast("Salvo!");
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <div>
      <p className="eyebrow">corrigir</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">Valores da cobrança</h2>
      <p className="mt-2 text-xs text-zinc-500">
        Use os números do painel da SyncPay. Isso altera só o histórico aqui — não mexe em nada
        no gateway.
      </p>
      {erro && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {erro}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        <div>
          <label className="eyebrow mb-1.5 block">Nome</label>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Cliente" />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Modelo</label>
          <select className="input" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
            <option value="">Sem modelo</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-zinc-600">
            Venda que chega só pelo webhook nasce sem modelo. Atribuir aqui a coloca no Funil de Vendas certo.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="eyebrow mb-1.5 block">Venda</label>
            <MoneyInput value={venda} onChange={setVenda} />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Taxa</label>
            <MoneyInput value={taxa} onChange={setTaxa} />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Split</label>
            <MoneyInput value={split} onChange={setSplit} />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">líquido</span>
          <span className="font-display text-sm font-semibold text-emerald-400">
            {valido ? brl(liquido) : "—"}
          </span>
        </div>
      </div>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={salvando}>
          Cancelar
        </button>
        <button type="button" onClick={salvar} className="btn-primary flex-1" disabled={salvando || !valido}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

/** "04/08/26 19:18" no fuso da operação — data e hora na MESMA linha, para as
 *  duas datas caberem empilhadas numa célula só. */
function dataHoraCurta(ms: number, tz: string): string {
  const d = new Date(ms);
  const data = d.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", timeZone: tz,
  });
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: tz,
  });
  return `${data} ${hora}`;
}


function SummaryChip({ label, value, accent }: { label: string; value: string | null; accent?: boolean }) {
  return (
    <div className="card flex items-center gap-2 rounded-full px-4 py-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`font-display text-sm font-semibold ${accent ? "text-emerald-400" : "text-white"}`}>
        {value ?? <span className="inline-block h-4 w-14 animate-pulse rounded bg-white/5" />}
      </span>
    </div>
  );
}

/** Check verde quando pago; ícone neutro de "gerado/aguardando" caso contrário. */
function PaidCheck({ paid }: { paid: boolean }) {
  if (paid) {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4 10-10"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/15 text-zinc-500">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} />
        <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </span>
  );
}

function ChargeForm({
  profiles,
  onClose,
  onDone,
}: {
  profiles: Profile[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pix, setPix] = useState<{ code?: string; qr?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await apiSend<{ pixCode?: string; qrCodeBase64?: string }>(
        "/api/payments/charge",
        "POST",
        {
          amount: Number(amount.replace(",", ".")),
          description,
          profileId: profileId || undefined,
          customer: {
            name: name || undefined,
            document: cpf || undefined,
            email: email || undefined,
            phone: phone || undefined,
          },
        },
      );
      if (res.pixCode || res.qrCodeBase64) {
        setPix({ code: res.pixCode, qr: res.qrCodeBase64 });
      } else {
        onDone();
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Falha.");
    } finally {
      setSaving(false);
    }
  }

  if (pix) {
    const qrSrc = pix.qr
      ? pix.qr.startsWith("data:")
        ? pix.qr
        : `data:image/png;base64,${pix.qr}`
      : null;
    return (
      <div>
        <p className="eyebrow">pix gerado</p>
        <h2 className="mt-1.5 font-display text-lg font-semibold">Cobrança PIX</h2>
        {qrSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrSrc}
            alt="QR Code PIX"
            className="mx-auto mt-4 h-44 w-44 rounded-lg bg-white p-2"
          />
        )}
        {pix.code && (
          <>
            <label className="eyebrow mb-1.5 mt-4 block">Copia e cola</label>
            <textarea
              readOnly
              className="input min-h-[90px] font-mono text-xs"
              value={pix.code}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(pix.code!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="btn-ghost mt-2 w-full"
            >
              <IconCopy size={15} /> {copied ? "Copiado!" : "Copiar código"}
            </button>
          </>
        )}
        <button onClick={onDone} className="btn-primary mt-4 w-full">
          Concluir
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <p className="eyebrow">nova</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">Nova cobrança PIX</h2>
      {err && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="eyebrow mb-1.5 block">Valor</label>
            <MoneyInput value={amount} onChange={setAmount} />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">CPF do cliente</label>
            <input
              className="input"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Descrição</label>
          <input
            className="input"
            placeholder="Ex.: Pacote de mídia"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Modelo</label>
          <select
            className="input"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            <option value="">Nenhum</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Cliente (nome)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="eyebrow mb-1.5 block">E-mail</label>
            <input
              className="input"
              type="email"
              placeholder="cliente@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Telefone</label>
            <input
              className="input"
              inputMode="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={saving || !amount}>
          {saving ? "Gerando..." : "Gerar PIX"}
        </button>
      </div>
    </form>
  );
}
