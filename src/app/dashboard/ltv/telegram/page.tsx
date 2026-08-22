"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Switch from "@/components/Switch";
import LtvBlock from "@/components/ltv/LtvBlock";
import OpcaoCartao from "@/components/ltv/OpcaoCartao";
import ChipTelegramBlock from "@/components/ltv/ChipTelegramBlock";
import PersonaBlock from "@/components/ltv/PersonaBlock";
import ProdutosBlock, { type ProdutoEditavel } from "@/components/ltv/ProdutosBlock";
import SegurancaBlock from "@/components/ltv/SegurancaBlock";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import { useProfile } from "@/context/ProfileContext";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import {
  IconBot,
  IconFire,
  IconCheck,
  IconPayments,
  IconProfiles,
  IconSend,
  IconSettings,
} from "@/components/icons";
import type {
  LtvAccount,
  LtvAgentSettings,
  LtvAudio,
  LtvProduct,
  LtvResumo,
} from "@/lib/ltvDb";

/**
 * LTV no Telegram — a IA falando pela conta REAL da modelo (o chip dela).
 *
 * É UM chip por modelo, então esta tela não tem seletor de conta: o multi-
 * número existe só no WhatsApp. Tudo o mais é igual à tela do WhatsApp de
 * propósito — mesma persona, mesmos produtos, mesmas travas —, porque é o
 * mesmo motor por trás.
 */
export default function LtvTelegramPage() {
  const { profileId, profile } = useProfile();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [chipConfigurado, setChipConfigurado] = useState(false);
  const [conta, setConta] = useState<LtvAccount | null>(null);
  const [agente, setAgente] = useState<LtvAgentSettings | null>(null);
  const [produtos, setProdutos] = useState<ProdutoEditavel[]>([]);
  const [audios, setAudios] = useState<LtvAudio[]>([]);
  const [resumo, setResumo] = useState<LtvResumo | null>(null);

  const carregar = useCallback(async (pid: string) => {
    setCarregando(true);
    try {
      const d = await apiGet<{ accounts: LtvAccount[]; chipConfigurado: boolean }>(
        `/api/ltv/accounts?profileId=${pid}&channel=telegram`,
      );
      setChipConfigurado(d.chipConfigurado);
      const c = d.accounts[0] || null;
      setConta(c);
      if (!c) {
        setAgente(null);
        setProdutos([]);
        setAudios([]);
        setResumo(null);
        return;
      }
      const [a, p, au, ch] = await Promise.all([
        apiGet<{ agent: LtvAgentSettings }>(`/api/ltv/agent?accountId=${c.id}`),
        apiGet<{ products: LtvProduct[] }>(`/api/ltv/products?accountId=${c.id}`),
        apiGet<{ audios: LtvAudio[] }>(`/api/ltv/audios?accountId=${c.id}`),
        apiGet<{ summary: LtvResumo }>(`/api/ltv/chats?accountId=${c.id}`),
      ]);
      setAgente(a.agent);
      setProdutos(p.products.map((x) => ({ ...x })));
      setAudios(au.audios);
      setResumo(ch.summary);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (profileId) carregar(profileId);
  }, [profileId, carregar]);

  function mudarAgente(patch: Partial<LtvAgentSettings>) {
    setAgente((a) => (a ? { ...a, ...patch } : a));
  }

  /**
   * Um "Salvar" só para a tela inteira. Salvar bloco a bloco parece mais
   * seguro e é o contrário: a pessoa mexe na persona, mexe no produto, sai da
   * tela e descobre depois que metade não foi.
   */
  async function salvar() {
    if (!conta || !agente) return;
    setSalvando(true);
    try {
      await apiSend("/api/ltv/agent", "PATCH", { ...agente, accountId: conta.id });
      const d = await apiSend<{ products: LtvProduct[] }>("/api/ltv/products", "PUT", {
        accountId: conta.id,
        // Produto sem nome é linha que a pessoa abriu e não preencheu.
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
        <PageHeader title="LTV no Telegram" />
        <PrecisaDeModelo oQue="conectar o chip do Telegram e configurar a IA" />
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
            <IconSend size={22} /> LTV no Telegram
          </span>
        }
        description="A IA fala pela conta real da modelo (chip dedicado) e faz LTV automaticamente."
      />

      {carregando ? (
        <div className="mt-8 flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {agente && (
            <div className="panel flex items-start gap-3 rounded-xl p-4">
              <Switch
                checked={agente.enabled}
                onChange={(v) => mudarAgente({ enabled: v })}
                ariaLabel="I.A ativa no Telegram"
              />
              <div>
                <p className="font-semibold text-white">I.A ativa no Telegram</p>
                <p className="text-xs text-zinc-500">
                  Respondendo os leads automaticamente pela conta da modelo.
                </p>
              </div>
            </div>
          )}

          <LtvBlock
            icon={<IconSend size={20} />}
            title="Chip do Telegram da modelo"
            summary={conta?.externalRef || "Nenhum chip conectado"}
            defaultOpen={!conta || conta.status !== "connected"}
            badge={
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  conta?.status === "connected"
                    ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                    : "border-white/10 bg-white/5 text-zinc-400"
                }`}
              >
                {conta?.status === "connected" ? "Conectado" : "Desconectado"}
              </span>
            }
          >
            <ChipTelegramBlock
              profileId={profileId}
              conta={conta}
              chipConfigurado={chipConfigurado}
              onConta={(c) => {
                setConta(c);
                if (c) carregar(profileId);
              }}
            />
          </LtvBlock>

          {/* O resto da configuração só existe depois que há um chip: sem conta
              não há onde guardar persona nem produto. */}
          {conta && agente && (
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
                    Lead que já é assinante VIP. Conversa mais longa, sobe o tesão aos poucos e
                    só fala preço quando ele pede. (padrão)
                  </OpcaoCartao>
                  <OpcaoCartao
                    active={agente.approach === "direto"}
                    onClick={() => mudarAgente({ approach: "direto" })}
                    title="Direto · tráfego pago"
                  >
                    Lead FRIO de anúncio que caiu direto no Telegram. Roteiro rápido: gancho +
                    nome → amostra → menu de packs → PIX. Fecha em minutos.
                  </OpcaoCartao>
                </div>
              </LtvBlock>

              <LtvBlock
                icon={<IconBot size={20} />}
                title="Persona da modelo"
                summary={[agente.personaName, tomResumo].filter(Boolean).join(" · ") || "Não configurada"}
              >
                <PersonaBlock agente={agente} onChange={mudarAgente} />
              </LtvBlock>

              <LtvBlock
                icon={<IconPayments size={20} />}
                title="Recebimento e produtos (LTV)"
                summary={`${produtos.length} produto(s) · PIX pela SyncPay`}
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
                  podeCopiarDoWhatsapp
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
                    Todos os leads que a modelo atendeu no Telegram, quanto cada um já gastou e a
                    conversa completa.
                  </p>
                  <Link
                    href="/dashboard/ltv/chat?channel=telegram"
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/5"
                  >
                    Abrir o Chat ao vivo
                  </Link>
                </div>
              </LtvBlock>

              <LtvBlock
                icon={<IconSettings size={20} />}
                title="Inteligência e segurança"
                summary={`${agente.rhythm === "humano" ? "Ritmo humano" : "Rápido fixo"} · limite de ${agente.dailyLimit}/dia`}
              >
                <SegurancaBlock agente={agente} onChange={mudarAgente} />
              </LtvBlock>

              {/* Fixo no rodapé: a tela é longa, e um botão lá embaixo faz a
                  pessoa mexer na persona e sair sem salvar. */}
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
        </div>
      )}
    </div>
  );
}
