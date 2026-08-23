"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Switch from "@/components/Switch";
import LtvBlock from "@/components/ltv/LtvBlock";
import OpcaoCartao from "@/components/ltv/OpcaoCartao";
import ContaWhatsappBlock from "@/components/ltv/ContaWhatsappBlock";
import PersonaBlock from "@/components/ltv/PersonaBlock";
import ProdutosBlock, { type ProdutoEditavel } from "@/components/ltv/ProdutosBlock";
import SegurancaBlock from "@/components/ltv/SegurancaBlock";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { useProfile } from "@/context/ProfileContext";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import {
  IconBot,
  IconCheck,
  IconFire,
  IconPayments,
  IconPlus,
  IconProfiles,
  IconSettings,
  IconWhatsapp,
} from "@/components/icons";
import type {
  LtvAccount,
  LtvAgentSettings,
  LtvAudio,
  LtvProduct,
  LtvResumo,
} from "@/lib/ltvDb";

/**
 * LTV no WhatsApp. Mesmos blocos da tela do Telegram de propósito: é o mesmo
 * motor por trás, e duas telas diferentes para a mesma configuração fariam a
 * pessoa reaprender tudo ao trocar de canal.
 *
 * A diferença é o MULTI-NÚMERO: aqui a modelo tem vários WhatsApps, cada um
 * com a persona, os produtos e os leads dele. Trocar de número troca tudo o
 * que está abaixo dos chips.
 */
export default function LtvWhatsappPage() {
  const { profileId, profile } = useProfile();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [contas, setContas] = useState<LtvAccount[]>([]);
  const [contaId, setContaId] = useState<string | null>(null);
  const [agente, setAgente] = useState<LtvAgentSettings | null>(null);
  const [produtos, setProdutos] = useState<ProdutoEditavel[]>([]);
  const [audios, setAudios] = useState<LtvAudio[]>([]);
  const [resumo, setResumo] = useState<LtvResumo | null>(null);

  const conta = contas.find((c) => c.id === contaId) || null;

  const carregarContas = useCallback(async (pid: string) => {
    const d = await apiGet<{ accounts: LtvAccount[] }>(
      `/api/ltv/accounts?profileId=${pid}&channel=whatsapp`,
    );
    setContas(d.accounts);
    setContaId((atual) => (d.accounts.some((c) => c.id === atual) ? atual : d.accounts[0]?.id ?? null));
    return d.accounts;
  }, []);

  useEffect(() => {
    if (!profileId) return;
    setCarregando(true);
    carregarContas(profileId)
      .catch((e) => showToast(e.message, "error"))
      .finally(() => setCarregando(false));
  }, [profileId, carregarContas]);

  /* A configuração é por CONTA: trocar de número recarrega tudo. */
  useEffect(() => {
    if (!contaId) {
      setAgente(null);
      setProdutos([]);
      setAudios([]);
      setResumo(null);
      return;
    }
    Promise.all([
      apiGet<{ agent: LtvAgentSettings }>(`/api/ltv/agent?accountId=${contaId}`),
      apiGet<{ products: LtvProduct[] }>(`/api/ltv/products?accountId=${contaId}`),
      apiGet<{ audios: LtvAudio[] }>(`/api/ltv/audios?accountId=${contaId}`),
      apiGet<{ summary: LtvResumo }>(`/api/ltv/chats?accountId=${contaId}`),
    ])
      .then(([a, p, au, ch]) => {
        setAgente(a.agent);
        setProdutos(p.products.map((x) => ({ ...x })));
        setAudios(au.audios);
        setResumo(ch.summary);
      })
      .catch((e) => showToast(e.message, "error"));
  }, [contaId]);

  function mudarAgente(patch: Partial<LtvAgentSettings>) {
    setAgente((a) => (a ? { ...a, ...patch } : a));
  }

  async function adicionarNumero() {
    if (!profileId) return;
    try {
      const d = await apiSend<{ account: LtvAccount }>("/api/ltv/accounts", "POST", {
        profileId,
        channel: "whatsapp",
      });
      await carregarContas(profileId);
      setContaId(d.account.id);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  }

  async function salvar() {
    if (!conta || !agente) return;
    setSalvando(true);
    try {
      await apiSend("/api/ltv/agent", "PATCH", { ...agente, accountId: conta.id });
      const d = await apiSend<{ products: LtvProduct[] }>("/api/ltv/products", "PUT", {
        accountId: conta.id,
        products: produtos.filter((p) => p.name.trim()),
      });
      setProdutos(d.products.map((p) => ({ ...p })));
      showToast("Atendente salvo!", "success");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setSalvando(false);
    }
  }

  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="LTV no WhatsApp" />
        <PrecisaDeModelo oQue="conectar o WhatsApp e configurar a IA" />
      </div>
    );
  }

  const tomResumo = agente?.toneTags.join(" + ");

  return (
    <div className="page pb-28">
      <PageHeader
        eyebrow={profile?.name}
        title={
          <span className="flex items-center gap-2">
            <IconWhatsapp size={22} /> LTV no WhatsApp
          </span>
        }
        description="Sua modelo conversa com os leads no WhatsApp e faz LTV automaticamente."
      />

      {carregando ? (
        <div className="mt-8 flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {/* Cada número é uma operação separada: persona, produtos e leads
              próprios. Os chips deixam isso explícito antes de qualquer campo. */}
          <div className="flex flex-wrap gap-2">
            {contas.map((c) => (
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
            <button
              type="button"
              onClick={adicionarNumero}
              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-white/20 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/5 [@media(pointer:coarse)]:min-h-[44px]"
            >
              <IconPlus size={16} /> Adicionar outro WhatsApp
            </button>
          </div>

          {!conta ? (
            <p className="mt-4 text-sm text-zinc-500">
              Esta modelo ainda não tem um WhatsApp no LTV. Adicione o primeiro número acima.
            </p>
          ) : (
            <>
              {agente && (
                <div className="panel flex items-start gap-3 rounded-xl p-4">
                  <Switch
                    checked={agente.enabled}
                    onChange={(v) => mudarAgente({ enabled: v })}
                    ariaLabel="Atendente ativo"
                  />
                  <div>
                    <p className="font-semibold text-white">Atendente ativo</p>
                    <p className="text-xs text-zinc-500">
                      Respondendo os leads automaticamente no WhatsApp.
                    </p>
                  </div>
                </div>
              )}

              <LtvBlock
                icon={<IconWhatsapp size={20} />}
                title="WhatsApp da modelo"
                summary={conta.externalRef || "Nenhum número conectado"}
                defaultOpen={conta.status !== "connected"}
                badge={
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      conta.status === "connected"
                        ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                        : "border-white/10 bg-white/5 text-zinc-400"
                    }`}
                  >
                    {conta.status === "connected" ? "Conectado" : "Off"}
                  </span>
                }
              >
                <ContaWhatsappBlock
                  conta={conta}
                  onConta={(c) => setContas((cs) => cs.map((x) => (x.id === c.id ? c : x)))}
                  onRemovida={() => {
                    setContaId(null);
                    carregarContas(profileId);
                  }}
                />
              </LtvBlock>

              {agente && (
                <>
                  <LtvBlock
                    icon={<IconFire size={20} />}
                    title="Abordagem do lead"
                    summary={
                      agente.approach === "aquecer"
                        ? "Aquecer — conversa longa (assinante)"
                        : "Direto — tráfego pago, fecha em minutos"
                    }
                  >
                    <p className="mb-3 text-sm text-zinc-500">
                      Como a modelo aborda quem chega — escolha conforme a{" "}
                      <strong className="text-zinc-300">origem</strong> do lead.
                    </p>
                    <div className="flex flex-col gap-3">
                      <OpcaoCartao
                        active={agente.approach === "aquecer"}
                        onClick={() => mudarAgente({ approach: "aquecer" })}
                        title="Aquecer"
                      >
                        Lead que já é assinante VIP. Conversa mais longa, sobe o tesão aos poucos
                        e só fala preço quando ele pede. (padrão)
                      </OpcaoCartao>
                      <OpcaoCartao
                        active={agente.approach === "direto"}
                        onClick={() => mudarAgente({ approach: "direto" })}
                        title="Direto · tráfego pago"
                      >
                        Lead FRIO de anúncio. Roteiro rápido: gancho + nome → amostra → menu de
                        packs → PIX. Fecha em minutos.
                      </OpcaoCartao>
                    </div>
                  </LtvBlock>

                  <LtvBlock
                    icon={<IconBot size={20} />}
                    title="Persona da modelo"
                    summary={
                      [agente.personaName, tomResumo].filter(Boolean).join(" · ") ||
                      "Não configurada"
                    }
                  >
                    <PersonaBlock agente={agente} onChange={mudarAgente} />
                  </LtvBlock>

                  <LtvBlock
                    icon={<IconPayments size={20} />}
                    title="Recebimento e produtos (LTV)"
                    summary={`${produtos.length} produto(s) · PIX pela SyncPay · ${
                      agente.maxDiscountPct > 0
                        ? `desconto até ${agente.maxDiscountPct}%`
                        : "sem desconto"
                    }`}
                  >
                    <ProdutosBlock
                      accountId={conta.id}
                      profileId={profileId}
                      produtos={produtos}
                      onProdutos={setProdutos}
                      audios={audios}
                      onAudios={setAudios}
                      maxDiscountPct={agente.maxDiscountPct}
                      onMaxDiscountPct={(v) => mudarAgente({ maxDiscountPct: v })}
                    />
                  </LtvBlock>

                  <LtvBlock
                    icon={<IconProfiles size={20} />}
                    title="Leads e conversas"
                    summary={
                      resumo
                        ? `${resumo.leads} lead(s) · ${resumo.compradores} comprador(es) · ${(
                            resumo.receitaCents / 100
                          ).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
                        : "Sem leads ainda"
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-zinc-400">
                        Todos os leads deste número, quanto cada um já gastou e a conversa
                        completa.
                      </p>
                      <Link
                        href="/dashboard/ltv/chat?channel=whatsapp"
                        className="rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/5"
                      >
                        Abrir o Chat ao vivo
                      </Link>
                    </div>
                  </LtvBlock>

                  <LtvBlock
                    icon={<IconSettings size={20} />}
                    title="Inteligência e segurança"
                    summary={`${
                      agente.rhythm === "humano" ? "Ritmo humano" : "Rápido fixo"
                    } · limite de ${agente.dailyLimit}/dia`}
                  >
                    <SegurancaBlock agente={agente} onChange={mudarAgente} />
                  </LtvBlock>

                  <div className="sticky bottom-4 z-10 mt-2">
                    <button
                      type="button"
                      onClick={salvar}
                      disabled={salvando}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3.5 text-base font-bold text-white shadow-lg transition-colors hover:bg-emerald-400 disabled:opacity-50"
                    >
                      <IconCheck size={18} /> {salvando ? "Salvando..." : "Salvar atendente"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
