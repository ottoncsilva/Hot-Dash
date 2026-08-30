"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import Modal from "@/components/Modal";
import { MoneyInput } from "@/components/MoneyInput";
import { IconPlus, IconSettings, IconPayments, IconCopy, IconTrash, IconEdit, IconTelegram, IconReport } from "@/components/icons";
import type { PaymentSettingsPublic } from "@/lib/settings";
import type { Transaction, PeriodStats } from "@/lib/transactions";
import type { RelatorioDaTransacao } from "@/lib/externalSaleReport";
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

/** Um bot na lista da edição — vem com a modelo dona junto, porque é ela que
 *  a escolha do bot atribui. */
type BotOpcao = { id: string; botUsername?: string; profileId: string; profileName: string };

/** "@lana_bot · Lana". O @ vem primeiro porque é o que identifica o bot; a
 *  modelo aparece do lado para o operador conferir que é a dona certa. */
function rotuloDoBot(b: BotOpcao): string {
  return `${b.botUsername ? "@" + b.botUsername : "bot sem @"} · ${b.profileName}`;
}

type PaidFilter = "all" | "paid" | "unpaid";
/** "todos" = sem filtro; o resto casa com `origemDaVenda`. */
type OriginFilter = "all" | "bot" | "ltv" | "painel";

const ORIGIN_LABEL: Record<Exclude<OriginFilter, "all">, string> = {
  bot: "Funil (bot)",
  ltv: "LTV",
  painel: "Lançada à mão",
};

/**
 * De qual parte do painel a venda veio.
 *
 * A coluna `origin` só existe a partir de certo ponto, então cobrança antiga
 * vem NULL. Nesses casos o BOT decide: toda venda com bot amarrado passou por
 * um bot de vendas — é isso que `origin = 'bot'` significa. O que sobra
 * (NULL e sem bot) fica `undefined` de propósito, e não "painel": chutar
 * "lançada à mão" numa venda de origem desconhecida seria inventar um dado
 * que ninguém conferiu. Essas linhas só aparecem em "Origem: todas".
 */
function origemDaVenda(t: Transaction): Exclude<OriginFilter, "all"> | undefined {
  if (t.origin) return t.origin;
  return t.botId ? "bot" : undefined;
}
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
  // Filtros de recorte da lista. Vazio = sem filtro; as opções de bot e de
  // método são montadas a partir do que EXISTE no período carregado, para o
  // seletor nunca oferecer uma escolha que não devolve nada.
  const [botFilter, setBotFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
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

  /** Bots que aparecem no período — chave é o id, rótulo é o @usuário. O
   *  "sem bot" só entra na lista quando existe alguma venda assim. */
  const botOptions = useMemo(() => {
    if (!data) return [];
    const mapa = new Map<string, string>();
    let temSemBot = false;
    for (const t of data.transactions) {
      if (t.botId) mapa.set(t.botId, t.botUsername ? `@${t.botUsername}` : "bot sem @");
      else temSemBot = true;
    }
    const lista = [...mapa].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
    return temSemBot ? [...lista, ["none", "Sem bot"] as [string, string]] : lista;
  }, [data]);

  const methodOptions = useMemo(() => {
    if (!data) return [];
    const vistos = new Set<string>();
    let temSemMetodo = false;
    for (const t of data.transactions) {
      if (t.method) vistos.add(t.method);
      else temSemMetodo = true;
    }
    const lista = [...vistos].sort().map((m) => [m, METHOD_LABEL[m] || m] as [string, string]);
    return temSemMetodo ? [...lista, ["none", "Sem método"] as [string, string]] : lista;
  }, [data]);

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    let list = data.transactions;

    if (paidFilter === "paid") list = list.filter((t) => t.status === "paid");
    else if (paidFilter === "unpaid") list = list.filter((t) => t.status !== "paid");

    if (botFilter !== "all") {
      list = list.filter((t) => (botFilter === "none" ? !t.botId : t.botId === botFilter));
    }
    if (methodFilter !== "all") {
      list = list.filter((t) => (methodFilter === "none" ? !t.method : t.method === methodFilter));
    }
    if (originFilter !== "all") list = list.filter((t) => origemDaVenda(t) === originFilter);

    const termo = busca.trim().toLowerCase();
    if (termo) {
      list = list.filter((t) =>
        [t.customer, t.description, t.botUsername, t.method, t.provider, t.sourceCode]
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
  }, [data, paidFilter, sort, busca, botFilter, methodFilter, originFilter]);

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
          {/* Bot e método só aparecem quando há mais de uma opção no período:
              um seletor com uma escolha só não filtra nada e só ocupa espaço. */}
          {botOptions.length > 1 && (
            <select
              className="input w-auto py-1.5 text-xs"
              value={botFilter}
              onChange={(e) => setBotFilter(e.target.value)}
            >
              <option value="all">Bot: todos</option>
              {botOptions.map(([id, rotulo]) => (
                <option key={id} value={id}>{rotulo}</option>
              ))}
            </select>
          )}
          {methodOptions.length > 1 && (
            <select
              className="input w-auto py-1.5 text-xs"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
            >
              <option value="all">Método: todos</option>
              {methodOptions.map(([m, rotulo]) => (
                <option key={m} value={m}>{rotulo}</option>
              ))}
            </select>
          )}
          <select
            className="input w-auto py-1.5 text-xs"
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}
          >
            <option value="all">Origem: todas</option>
            {(Object.keys(ORIGIN_LABEL) as Exclude<OriginFilter, "all">[]).map((k) => (
              <option key={k} value={k}>{ORIGIN_LABEL[k]}</option>
            ))}
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
          {(paidFilter !== "all" ||
            sort !== "created_desc" ||
            busca ||
            botFilter !== "all" ||
            methodFilter !== "all" ||
            originFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setPaidFilter("all");
                setSort("created_desc");
                setBusca("");
                setBotFilter("all");
                setMethodFilter("all");
                setOriginFilter("all");
              }}
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
                            {/* Deep-link que trouxe o lead (`?start=CODIGO`).
                                É a origem de tráfego da venda — vem do
                                checkout do bot ou do relatório do Canal de
                                Vendas, e antes não aparecia em lugar nenhum
                                do Financeiro. */}
                            {t.sourceCode && (
                              <span
                                className="font-mono text-[10px] tracking-wider text-zinc-600"
                                title="Código de origem do lead (deep-link do /start)"
                              >
                                #{t.sourceCode}
                              </span>
                            )}
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
                    {/* Sem bot, a célula mostra de ONDE a venda veio em vez de
                        um travessão: é o que explica a ausência do bot (LTV e
                        lançamento à mão nunca passam por um) e o que dá sentido
                        ao filtro de Origem. Origem desconhecida (linha antiga,
                        sem bot) continua travessão — ver `origemDaVenda`. */}
                    <td className="p-3 font-mono text-[11px] text-zinc-400">
                      {t.botUsername ? (
                        `@${t.botUsername}`
                      ) : origemDaVenda(t) && origemDaVenda(t) !== "bot" ? (
                        <span className="text-zinc-500">{ORIGIN_LABEL[origemDaVenda(t)!]}</span>
                      ) : (
                        <span className="text-zinc-700">—</span>
                      )}
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

      {/* Mais largo que o padrão: o relatório do Canal de Vendas divide a
          tela com os campos, e em `max-w-md` cada linha dele quebrava em duas. */}
      <Modal open={Boolean(editando)} onClose={() => setEditando(null)} maxWidth="max-w-lg">
        {editando && (
          <EditarCobranca
            tx={editando}
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
/**
 * CORRIGIR UMA COBRANÇA à mão — com o relatório do Canal de Vendas ao lado.
 *
 * Antes daqui só dava para mexer em valor, nome e modelo. Mas o campo que mais
 * nasce vazio é justamente outro: numa venda de bot que o Hot-Dash NÃO opera,
 * o gateway só sabe quanto entrou — produto, método, código de origem e modelo
 * chegam em branco e a linha fica com travessão em metade das colunas, fora de
 * todos os filtros e do Funil.
 *
 * O RELATÓRIO É A FONTE. Esses dados existem: o sistema de origem os posta no
 * Canal de Vendas e o Hot-Dash já os guarda inteiros (17 campos), esperando o
 * cruzamento automático. Quando ele não acontece — relatório que nunca chegou,
 * "ID Bot" que não bate com token nenhum, campo que o gateway já tinha
 * preenchido com outra coisa —, o dado continua ali, invisível. Mostrá-lo aqui
 * é o que troca "corrigir no escuro" (ir procurar a mensagem no Telegram para
 * saber o que digitar) por conferir e aceitar.
 *
 * Cada campo do relatório vira um botão "usar", e o que ele diz e a linha não
 * tem é marcado. O que o relatório traz e a transação não guarda em coluna
 * nenhuma (categoria, duração, idioma, passo do funil, tempo até converter,
 * contato do lead) aparece como leitura — é contexto para decidir, não campo
 * para editar.
 */
function EditarCobranca({
  tx,
  onClose,
  onDone,
}: {
  tx: Transaction;
  onClose: () => void;
  onDone: () => void;
}) {
  const emReais = (c: number | undefined) => ((c ?? 0) / 100).toFixed(2);
  const [venda, setVenda] = useState(emReais(tx.amountCents));
  const [taxa, setTaxa] = useState(emReais(tx.feeCents));
  const [split, setSplit] = useState(emReais(tx.splitCents));
  const [nome, setNome] = useState(tx.customer || "");
  /**
   * UMA escolha para bot e modelo. O valor guarda os dois lados de propósito:
   * `bot:<id>` quando a venda veio de um bot (que já diz a modelo) e
   * `perfil:<id>` para a modelo que não tem bot cadastrado. Dois `select`
   * separados perguntariam duas vezes a mesma coisa e deixariam o operador
   * escolher um par que não existe.
   */
  const [vinculo, setVinculo] = useState(
    tx.botId ? `bot:${tx.botId}` : tx.profileId ? `perfil:${tx.profileId}` : "",
  );
  const [bots, setBots] = useState<BotOpcao[]>([]);
  const [perfisSemBot, setPerfisSemBot] = useState<{ id: string; name: string }[]>([]);
  const [produto, setProduto] = useState(tx.description || "");
  const [metodo, setMetodo] = useState(tx.method || "");
  const [codigo, setCodigo] = useState(tx.sourceCode || "");
  const [origem, setOrigem] = useState(tx.origin || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioDaTransacao | null>(null);
  const [verTexto, setVerTexto] = useState(false);

  // O relatório é buscado ao ABRIR, não junto da listagem: é uma consulta por
  // linha, e a tabela do Financeiro carrega centenas delas de uma vez.
  useEffect(() => {
    let vivo = true;
    apiGet<{
      relatorio: RelatorioDaTransacao | null;
      bots: BotOpcao[];
      perfisSemBot: { id: string; name: string }[];
    }>(`/api/payments/transactions/${tx.id}`)
      .then((r) => {
        if (!vivo) return;
        setRelatorio(r.relatorio);
        setBots(r.bots || []);
        setPerfisSemBot(r.perfisSemBot || []);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [tx.id]);

  const paraCentavos = (v: string) => Math.round((Number(v) || 0) * 100);
  const cVenda = paraCentavos(venda);
  const cTaxa = paraCentavos(taxa);
  const cSplit = paraCentavos(split);
  const valido = [cVenda, cTaxa, cSplit].every((n) => Number.isFinite(n) && n >= 0);
  const liquido = valido ? Math.max(0, cVenda - cTaxa - cSplit) : 0;

  /**
   * O que o relatório tem para cada campo EDITÁVEL, com o estado atual do
   * formulário ao lado. É desta lista que saem os botões "usar" e o
   * "preencher o que está vazio" — uma fonte só, para os dois não divergirem.
   *
   * A modelo do relatório só entra se ela ainda existir no painel: um id de
   * modelo apagada viraria uma opção que o `select` não tem.
   */
  const sugestoes = useMemo(() => {
    if (!relatorio) return [];
    // O relatório resolve o BOT pelo "ID Bot" da mensagem; a modelo é
    // consequência. A sugestão aponta o mesmo valor que o dropdown usa.
    const botDoRelatorio = relatorio.botId ? bots.find((b) => b.id === relatorio.botId) : undefined;
    const itens: {
      chave: string;
      label: string;
      valor: string;
      mostrar: string;
      atual: string;
      aplicar: () => void;
    }[] = [];
    const add = (
      chave: string,
      label: string,
      valor: string | undefined,
      atual: string,
      aplicar: () => void,
      mostrar?: string,
    ) => {
      if (!valor) return;
      itens.push({ chave, label, valor, mostrar: mostrar || valor, atual, aplicar });
    };
    add("produto", "Produto", relatorio.planName, produto, () => setProduto(relatorio.planName!));
    add("nome", "Nome", relatorio.customerName, nome, () => setNome(relatorio.customerName!));
    add(
      "bot",
      "Bot",
      botDoRelatorio ? `bot:${botDoRelatorio.id}` : undefined,
      vinculo,
      () => setVinculo(`bot:${botDoRelatorio!.id}`),
      botDoRelatorio ? rotuloDoBot(botDoRelatorio) : undefined,
    );
    add(
      "metodo",
      "Método",
      relatorio.method,
      metodo,
      () => setMetodo(relatorio.method!),
      METHOD_LABEL[relatorio.method || ""] || relatorio.method,
    );
    add("codigo", "Código de venda", relatorio.sourceCode, codigo, () =>
      setCodigo(relatorio.sourceCode!),
    );
    // O relatório não tem um campo "origem": ele É a prova de que a venda saiu
    // de um bot do Telegram. Só vale sugerir quando o bot foi reconhecido —
    // sem isso não se sabe se a venda entra no Funil de Vendas.
    add(
      "origem",
      "Origem",
      relatorio.botId ? "bot" : undefined,
      origem,
      () => setOrigem("bot"),
      "Bot de vendas",
    );
    return itens;
  }, [relatorio, bots, produto, nome, vinculo, metodo, codigo, origem]);

  /** Só o que o relatório sabe e a linha ainda não tem. É o que o botão de
   *  preencher em massa aplica — nunca por cima do que já está escrito. */
  const paraPreencher = sugestoes.filter((s) => !s.atual);

  /**
   * DIVERGÊNCIA DE VALOR. O relatório traz o valor que o bot de fora anunciou;
   * a linha traz o que o gateway liquidou. Quando os dois discordam é sinal de
   * leitura errada de um dos lados — e é o único caso em que corrigir o valor
   * à mão tem uma referência de verdade, em vez de ser chute.
   */
  const divergenciaValor =
    relatorio?.amountCents !== undefined && relatorio.amountCents !== tx.amountCents
      ? relatorio.amountCents
      : null;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await apiSend(`/api/payments/transactions/${tx.id}`, "PATCH", {
        amountCents: cVenda,
        feeCents: cTaxa,
        splitCents: cSplit,
        customer: nome,
        // Um lado só vai por vez: `bot:` carrega a modelo junto no servidor;
        // `perfil:` é a modelo sem bot. Vazio desvincula os dois.
        ...(vinculo.startsWith("bot:")
          ? { botId: vinculo.slice(4) }
          : vinculo.startsWith("perfil:")
            ? { profileId: vinculo.slice(7), botId: "" }
            : { botId: "", profileId: "" }),
        description: produto,
        method: metodo,
        sourceCode: codigo,
        origin: origem,
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
      <h2 className="mt-1.5 font-display text-lg font-semibold">Dados da cobrança</h2>
      <p className="mt-2 text-xs text-zinc-500">
        Isso altera só o histórico aqui — não mexe em nada no gateway. Status, data de pagamento e
        moeda não são editáveis: são a palavra do gateway sobre o dinheiro que entrou.
      </p>
      {erro && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {erro}
        </p>
      )}

      {relatorio && (
        <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/[0.05] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow text-sky-300/80">relatório do canal de vendas</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                O que o bot operado por fora anunciou nesta venda.
              </p>
            </div>
            {paraPreencher.length > 0 && (
              <button
                type="button"
                onClick={() => paraPreencher.forEach((s) => s.aplicar())}
                className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] font-bold text-sky-300 transition-colors hover:bg-sky-500/20"
              >
                Preencher {paraPreencher.length} campo{paraPreencher.length > 1 ? "s" : ""} vazio
                {paraPreencher.length > 1 ? "s" : ""}
              </button>
            )}
          </div>

          {sugestoes.length > 0 && (
            <div className="mt-2.5 grid gap-1">
              {sugestoes.map((s) => {
                const igual = s.atual === s.valor;
                return (
                  <div key={s.chave} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 text-[11px] text-zinc-500">{s.label}</span>
                    <span className={`min-w-0 flex-1 truncate ${igual ? "text-zinc-500" : "text-zinc-200"}`}>
                      {s.mostrar}
                    </span>
                    {igual ? (
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-600">
                        já está
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={s.aplicar}
                        className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-300 transition-colors hover:bg-white/10"
                      >
                        {s.atual ? "substituir" : "usar"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {divergenciaValor !== null && (
            <p className="mt-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-2.5 py-1.5 text-[11px] text-amber-300">
              O relatório diz {brl(divergenciaValor)} e a cobrança está em {brl(tx.amountCents)}.
              Confira no painel do gateway antes de mudar o valor.
            </p>
          )}

          {/* Contexto: o relatório traz mais do que a transação guarda. Fica
              como leitura porque não existe coluna para isso — mas é o que
              explica a venda (que plano, por qual passo do funil, em quanto
              tempo, para quem). */}
          <ContextoDoRelatorio r={relatorio} />

          {relatorio.rawText && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setVerTexto((v) => !v)}
                className="text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
              >
                {verTexto ? "esconder" : "ver"} a mensagem original
              </button>
              {verTexto && (
                <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-2 text-[10px] leading-relaxed text-zinc-400">
                  {relatorio.rawText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-3">
        <div>
          <label className="eyebrow mb-1.5 block">Produto</label>
          <input
            className="input"
            value={produto}
            onChange={(e) => setProduto(e.target.value)}
            placeholder="Nome do plano"
          />
          <p className="mt-1 text-[11px] text-zinc-600">
            É o que aparece na coluna Produto e no texto do alerta de venda. Venda de bot operado
            por fora chega sem ele — o gateway só sabe o valor.
          </p>
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Nome</label>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Cliente" />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Bot</label>
          <select className="input" value={vinculo} onChange={(e) => setVinculo(e.target.value)}>
            <option value="">Sem bot / sem modelo</option>
            {bots.map((b) => (
              <option key={b.id} value={`bot:${b.id}`}>{rotuloDoBot(b)}</option>
            ))}
            {/* Modelo sem bot cadastrado: venda de LTV ou lançada à mão nunca
                passou por um. Fica no fim, separada, para a escolha normal
                continuar sendo o bot. */}
            {perfisSemBot.map((p) => (
              <option key={p.id} value={`perfil:${p.id}`}>{p.name} · sem bot</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-zinc-600">
            Escolher o bot já atribui a modelo dona dele — é um bot por modelo. Venda que chega só
            pelo webhook nasce sem os dois; atribuir aqui a coloca no Funil de Vendas certo e a tira
            do filtro &quot;Sem bot&quot;.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="eyebrow mb-1.5 block">Método</label>
            <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              <option value="">Sem método</option>
              <option value="pix">Pix</option>
              <option value="card">Cartão</option>
            </select>
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Origem</label>
            <select className="input" value={origem} onChange={(e) => setOrigem(e.target.value)}>
              <option value="">Não informada</option>
              <option value="bot">Bot de vendas</option>
              <option value="ltv">LTV</option>
              <option value="painel">Lançada no painel</option>
            </select>
          </div>
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Código de venda</label>
          <input
            className="input"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Deep-link do /start"
          />
          <p className="mt-1 text-[11px] text-zinc-600">
            A origem de tráfego do lead. Sem ele a venda entra no Funil sem saber de onde veio.
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

/** "0d 0h 23m 53s" a partir dos segundos — como o próprio relatório escreve. */
function tempoCurto(segundos: number): string {
  const d = Math.floor(segundos / 86400);
  const h = Math.floor((segundos % 86400) / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(" ");
}

/**
 * O que o relatório traz e a transação NÃO guarda em coluna nenhuma. Só
 * leitura: não há onde salvar, mas é o que explica a venda para quem está
 * decidindo o que corrigir.
 */
function ContextoDoRelatorio({ r }: { r: RelatorioDaTransacao }) {
  const itens: [string, string][] = [];
  if (r.category) itens.push(["categoria", r.category]);
  if (r.durationLabel) itens.push(["duração", r.durationLabel]);
  if (r.language) itens.push(["idioma", r.language]);
  if (r.funnelStep) itens.push(["passo do funil", r.funnelStep]);
  if (r.conversionSeconds !== undefined) itens.push(["conversão em", tempoCurto(r.conversionSeconds)]);
  if (r.botUsername) itens.push(["bot", `@${r.botUsername}`]);
  if (r.telegramUsername) itens.push(["lead", `@${r.telegramUsername}`]);
  else if (r.telegramUserId) itens.push(["lead", String(r.telegramUserId)]);
  if (r.externalTxId) itens.push(["id na origem", r.externalTxId]);
  if (itens.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-2.5">
      {itens.map(([k, v]) => (
        <span
          key={k}
          className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-zinc-400"
        >
          <span className="text-zinc-600">{k}</span> {v}
        </span>
      ))}
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
