"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Switch from "@/components/Switch";
import { MoneyInput } from "@/components/MoneyInput";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { useProfile } from "@/context/ProfileContext";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { IconPlus, IconSend, IconWhatsapp } from "@/components/icons";
import type { LtvAccount, LtvChannel, LtvLead, LtvMessage, LtvResumo } from "@/lib/ltvDb";

/**
 * Painel LTV — todos os leads que a modelo atendeu, quanto cada um já gastou e
 * a conversa completa, na mesma tela.
 *
 * Os leads são SEMPRE de uma conta só. No WhatsApp a modelo tem vários
 * números, e cada um tem a conversa dele: misturar faria responder um lead
 * achando que é de outro chip. No Telegram é um chip só, então não há chips de
 * conta para escolher.
 */
const LIMITE_MENSAGEM = 900;

// useSearchParams exige limite de Suspense no App Router.
export default function PainelLtvPage() {
  return (
    <Suspense fallback={<div className="page text-sm text-zinc-600">Carregando…</div>}>
      <PainelLtv />
    </Suspense>
  );
}

function PainelLtv() {
  const { profileId, profile } = useProfile();
  const params = useSearchParams();
  const [canal, setCanal] = useState<LtvChannel>(
    params.get("channel") === "telegram" ? "telegram" : "whatsapp",
  );
  const [contas, setContas] = useState<LtvAccount[]>([]);
  const [contaId, setContaId] = useState<string | null>(null);
  const [resumo, setResumo] = useState<LtvResumo | null>(null);
  const [leads, setLeads] = useState<LtvLead[]>([]);
  const [busca, setBusca] = useState("");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<LtvMessage[]>([]);
  const [iaAtiva, setIaAtiva] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [vendaAberta, setVendaAberta] = useState(false);
  const fimDaConversa = useRef<HTMLDivElement>(null);

  const contasDoCanal = contas.filter((c) => c.channel === canal);
  const lead = leads.find((l) => l.id === leadId) || null;

  /* Contas da modelo — recarrega ao trocar de modelo ou de canal. */
  useEffect(() => {
    if (!profileId) return;
    apiGet<{ accounts: LtvAccount[] }>(`/api/ltv/accounts?profileId=${profileId}`)
      .then((d) => setContas(d.accounts))
      .catch((e) => showToast(e.message, "error"));
  }, [profileId]);

  useEffect(() => {
    const doCanal = contas.filter((c) => c.channel === canal);
    setContaId((atual) => (doCanal.some((c) => c.id === atual) ? atual : doCanal[0]?.id ?? null));
  }, [contas, canal]);

  const carregarLeads = useCallback(async () => {
    if (!contaId) {
      setLeads([]);
      setResumo(null);
      return;
    }
    try {
      const d = await apiGet<{ summary: LtvResumo; leads: LtvLead[] }>(
        `/api/ltv/chats?accountId=${contaId}&q=${encodeURIComponent(busca)}`,
      );
      setResumo(d.summary);
      setLeads(d.leads);
    } catch {
      /* uma falha de rede não pode limpar a lista que já está na tela */
    }
  }, [contaId, busca]);

  useEffect(() => {
    carregarLeads();
    const t = setInterval(carregarLeads, 8000);
    return () => clearInterval(t);
  }, [carregarLeads]);

  // Trocar de conta ou de canal fecha a conversa aberta: ela é de outra conta.
  useEffect(() => {
    setLeadId(null);
    setMensagens([]);
  }, [contaId]);

  const carregarConversa = useCallback(async () => {
    if (!leadId) return;
    try {
      const d = await apiGet<{ chat: { state: string }; messages: LtvMessage[] }>(
        `/api/ltv/chats/${leadId}`,
      );
      setMensagens(d.messages);
      setIaAtiva(d.chat.state === "active");
    } catch {
      /* idem */
    }
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;
    carregarConversa();
    const t = setInterval(carregarConversa, 4000);
    return () => clearInterval(t);
  }, [leadId, carregarConversa]);

  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens.length]);

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || !leadId) return;
    setEnviando(true);
    try {
      await apiSend(`/api/ltv/chats/${leadId}`, "POST", { action: "send", content: conteudo });
      setTexto("");
      // Responder pelo painel assume a conversa: o servidor pausa a IA, e a
      // tela precisa mostrar isso sem esperar o próximo ciclo.
      setIaAtiva(false);
      await carregarConversa();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setEnviando(false);
    }
  }

  async function alternarIa(v: boolean) {
    if (!leadId) return;
    setIaAtiva(v);
    try {
      await apiSend(`/api/ltv/chats/${leadId}`, "POST", { action: "toggle_ai" });
    } catch (e: any) {
      setIaAtiva(!v);
      showToast(e.message, "error");
    }
  }

  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Painel LTV" />
        <PrecisaDeModelo oQue="ver os leads e as conversas" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={profile?.name}
        title="Painel LTV"
      />

      <div className="mt-4 flex gap-2">
        {(["whatsapp", "telegram"] as LtvChannel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCanal(c)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
              canal === c
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                : "border-white/10 text-zinc-400 hover:bg-white/5"
            }`}
          >
            {c === "whatsapp" ? <IconWhatsapp size={16} /> : <IconSend size={16} />}
            {c === "whatsapp" ? "WhatsApp" : "Telegram"}
          </button>
        ))}
      </div>

      {/* Chips de número só no WhatsApp: no Telegram é um chip por modelo. */}
      {canal === "whatsapp" && contasDoCanal.length > 1 && (
        <div className="mt-4">
          <p className="eyebrow">Escolha o número · cada um tem os leads só dele</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {contasDoCanal.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setContaId(c.id)}
                className={`rounded-lg border px-4 py-2 text-left text-sm transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
                  contaId === c.id
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-white/10 hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2 font-semibold text-white">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      c.status === "connected" ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                  />
                  {c.label}
                </span>
                <span className="block font-mono text-xs text-zinc-500">
                  {c.externalRef || "sem número"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!contaId ? (
        <p className="mt-8 text-sm text-zinc-500">
          Esta modelo ainda não tem uma conta de {canal === "whatsapp" ? "WhatsApp" : "Telegram"}{" "}
          no LTV.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            <Cartao rotulo="Leads" valor={String(resumo?.leads ?? 0)} />
            <Cartao rotulo="Compradores" valor={String(resumo?.compradores ?? 0)} destaque />
            <Cartao
              rotulo="Receita"
              destaque
              valor={((resumo?.receitaCents ?? 0) / 100).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            />
          </div>

          <input
            className="input mt-3"
            placeholder="Buscar lead..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          <div className="mt-3 flex flex-col gap-2">
            {leads.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLeadId(l.id === leadId ? null : l.id)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  leadId === l.id
                    ? "border-emerald-500/50 bg-emerald-500/[0.07]"
                    : "border-white/[0.06] bg-white/[0.02] hover:bg-white/5"
                }`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 font-semibold uppercase text-zinc-300">
                  {(l.peerName || l.peerRef).slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-sky-400">
                      {l.peerName || l.peerRef}
                    </span>
                    {l.spentCents > 0 && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                        {(l.spentCents / 100).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-zinc-500">
                    {l.lastMessage || "sem mensagens"}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                  {tempoRelativo(l.lastInteractionAt)}
                </span>
              </button>
            ))}
            {!leads.length && (
              <p className="py-6 text-center text-sm text-zinc-600">
                {busca ? "Nenhum lead com esse nome." : "Nenhum lead ainda."}
              </p>
            )}
          </div>

          {/* A conversa fica EMBAIXO da lista, na mesma tela: escolher o lead e
              ler o que ele disse é o mesmo movimento. */}
          {lead && (
            <section className="panel mt-4 overflow-hidden rounded-xl">
              <header className="flex items-center gap-3 border-b border-white/[0.06] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 font-semibold uppercase text-zinc-300">
                  {(lead.peerName || lead.peerRef).slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">
                    {lead.peerName || lead.peerRef}
                  </p>
                  <p className="font-mono text-xs text-zinc-500">
                    {lead.spentCents > 0
                      ? `já gastou ${(lead.spentCents / 100).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}`
                      : "—"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setVendaAberta((v) => !v)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10 [@media(pointer:coarse)]:min-h-[44px]"
                >
                  <IconPlus size={14} /> Venda
                </button>
              </header>

              {vendaAberta && (
                <FormularioVenda
                  chatId={lead.id}
                  onPronto={() => {
                    setVendaAberta(false);
                    carregarLeads();
                  }}
                />
              )}

              <div className="max-h-[60vh] overflow-y-auto p-4">
                {mensagens.map((m, i) => {
                  const anterior = mensagens[i - 1];
                  const novoDia =
                    !anterior ||
                    new Date(anterior.createdAt).toDateString() !==
                      new Date(m.createdAt).toDateString();
                  return (
                    <div key={m.id}>
                      {novoDia && (
                        <p className="my-3 text-center">
                          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-zinc-400">
                            {new Date(m.createdAt).toLocaleDateString("pt-BR")}
                          </span>
                        </p>
                      )}
                      <div
                        className={`mb-2 flex ${
                          m.role === "assistant" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                            m.role === "assistant"
                              ? "bg-emerald-700/60 text-white"
                              : "bg-white/[0.07] text-zinc-100"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
                          <p className="mt-0.5 text-right font-mono text-[10px] text-white/50">
                            {new Date(m.createdAt).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={fimDaConversa} />
              </div>

              <footer className="border-t border-white/[0.06] p-4">
                <div className="flex items-center gap-3">
                  <Switch checked={iaAtiva} onChange={alternarIa} ariaLabel="Atendente respondendo" />
                  <p className="text-sm">
                    <span className={iaAtiva ? "font-semibold text-emerald-400" : "text-zinc-500"}>
                      Atendente respondendo
                    </span>
                    <span className="text-zinc-500">
                      {" "}
                      — desliga sozinho quando você responder por aqui
                    </span>
                  </p>
                </div>

                <div className="mt-3 flex gap-2">
                  <textarea
                    className="input min-h-[64px] flex-1 resize-y"
                    placeholder="Escreva sua resposta..."
                    maxLength={LIMITE_MENSAGEM}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        enviar();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={enviar}
                    disabled={enviando || !texto.trim()}
                    className="flex shrink-0 items-center gap-2 self-end rounded-lg bg-emerald-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
                  >
                    <IconSend size={16} /> {enviando ? "..." : "Enviar"}
                  </button>
                </div>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Enter envia · Shift+Enter quebra linha · {LIMITE_MENSAGEM - texto.length}{" "}
                  caracteres restantes
                </p>
              </footer>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Cartao({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="panel rounded-xl p-3 sm:p-4">
      <p className="eyebrow truncate">{rotulo}</p>
      <p
        className={`mt-1 font-display text-lg font-semibold sm:text-2xl ${
          destaque ? "text-emerald-400" : "text-white"
        }`}
      >
        {valor}
      </p>
    </div>
  );
}

/**
 * Lançamento de uma venda que não entrou sozinha. Toda cobrança da IA passa
 * pela SyncPay e se registra pelo webhook; isto é o conserto para o que ficou
 * de fora — sem ele o total gasto do lead fica menor do que é, e é justamente
 * esse número que decide quanto vale insistir com ele.
 */
function FormularioVenda({ chatId, onPronto }: { chatId: string; onPronto: () => void }) {
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const numero = Number(valor.replace(",", "."));
    if (!Number.isFinite(numero) || numero <= 0) {
      showToast("Informe um valor válido.", "error");
      return;
    }
    setSalvando(true);
    try {
      await apiSend("/api/ltv/orders", "POST", { chatId, amount: numero, description: descricao });
      showToast("Venda registrada.", "success");
      onPronto();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-white/[0.06] bg-white/[0.02] p-4">
      <label className="block">
        <span className="eyebrow mb-1 block">Valor</span>
        <MoneyInput className="w-28" placeholder="49,90" value={valor} onChange={setValor} />
      </label>
      <label className="block flex-1">
        <span className="eyebrow mb-1 block">Descrição</span>
        <input
          className="input"
          placeholder="O que ele comprou"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={salvar}
        disabled={salvando}
        className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {salvando ? "Salvando..." : "Registrar"}
      </button>
    </div>
  );
}

function tempoRelativo(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
