"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import PageHeader from "@/components/PageHeader";
import { DEFAULT_PERIOD } from "@/lib/periods";
import { useProfile } from "@/context/ProfileContext";

/**
 * FUNIL DE LTV — conversa → PIX gerado → pago.
 *
 * Tela irmã do Funil de Vendas, e de propósito com uma base diferente: lá o
 * topo é o /start no bot, aqui é a CONVERSA. Um lead de LTV nunca dá /start,
 * então contar os dois juntos afundava as taxas dos dois lados. O Dashboard
 * segue somando tudo — a separação é só de leitura, ninguém deixa de faturar.
 */

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(r: number | null) {
  return r === null ? "—" : `${(r * 100).toFixed(1)}%`;
}

/**
 * Taxa de passagem. Acima de 100% não é conversão — é venda de lead que chegou
 * ANTES da janela. Nesse caso some com o número em vez de mostrar "180%", que
 * só faria duvidar do painel inteiro; o detalhe embaixo já conta o que houve.
 */
function pctFunil(r: number | null) {
  return r === null || r > 1 ? "—" : `${(r * 100).toFixed(1)}%`;
}

type Metricas = {
  leads: number;
  leadsComPix: number;
  pixGerados: number;
  pixPagos: number;
  pagosCents: number;
  pendentesCents: number;
  ticketMedioCents: number;
  leadParaPix: number | null;
  pixParaPago: number | null;
  leadParaPago: number | null;
  descontoMedioPct: number | null;
};

type Linha = Metricas & {
  accountId: string;
  label: string;
  channel: "whatsapp" | "telegram";
  profileId: string;
  profileName: string;
};

type Produto = { productId: string; name: string; count: number; cents: number };

type Resposta = {
  metricas: Metricas;
  contas: Linha[];
  produtos: Produto[];
};

type Canal = "todos" | "whatsapp" | "telegram";

export default function FunilLtvPage() {
  const { profileId } = useProfile();
  const [periodo, setPeriodo] = useState<PeriodState>({
    period: DEFAULT_PERIOD,
    from: "",
    to: "",
  });
  const [canal, setCanal] = useState<Canal>("todos");
  const [data, setData] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams(periodQuery(periodo));
      if (profileId) qs.set("profileId", profileId);
      if (canal !== "todos") qs.set("channel", canal);
      setData(await apiGet<Resposta>(`/api/ltv/funil?${qs.toString()}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar o funil.");
      setData(null);
    } finally {
      setCarregando(false);
    }
  }, [periodo, profileId, canal]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const m = data?.metricas ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="LTV"
        title="Funil de LTV"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PeriodPicker value={periodo} onChange={setPeriodo} />
        <div className="flex items-center gap-1.5">
          {(["todos", "whatsapp", "telegram"] as Canal[]).map((c) => (
            <button
              key={c}
              onClick={() => setCanal(c)}
              className={`chip ${canal === c ? "text-emerald-400" : "text-zinc-400"}`}
            >
              {c === "todos" ? "Todos os canais" : c === "whatsapp" ? "WhatsApp" : "Telegram"}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/5 p-3 text-sm text-rose-300">
          {erro}
        </p>
      )}

      {/* As três etapas, na ordem em que o lead passa por elas. */}
      <p className="eyebrow mt-6">a jornada</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Etapa
          rotulo="Leads"
          valor={m ? String(m.leads) : null}
          detalhe="conversas abertas no período"
          carregando={carregando}
        />
        <Etapa
          rotulo="PIX gerados"
          valor={m ? String(m.pixGerados) : null}
          detalhe={
            m ? `${pctFunil(m.leadParaPix)} dos leads receberam uma cobrança` : undefined
          }
          carregando={carregando}
        />
        <Etapa
          rotulo="PIX pagos"
          valor={m ? String(m.pixPagos) : null}
          detalhe={m ? `${pctFunil(m.pixParaPago)} dos PIX gerados` : undefined}
          accent
          carregando={carregando}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Receita paga" valor={m ? brl(m.pagosCents) : null} accent />
        <Card
          label="PIX pendente"
          valor={m ? brl(m.pendentesCents) : null}
          hint="cobrado e ainda não pago"
          muted
        />
        <Card label="Ticket médio" valor={m ? brl(m.ticketMedioCents) : null} />
        <Card
          label="Desconto médio"
          valor={m ? (m.descontoMedioPct === null ? "—" : `${m.descontoMedioPct.toFixed(1)}%`) : null}
          hint="quanto a IA cedeu sobre o preço de tabela"
        />
      </div>

      {/* Por conta: é aqui que se vê qual número (ou o chip) está vendendo. */}
      <p className="eyebrow mt-8">por conta</p>
      <div className="mt-3 card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="p-3">Conta</th>
              <th className="p-3">Modelo</th>
              <th className="p-3 text-right">Leads</th>
              <th className="p-3 text-right">PIX gerados</th>
              <th className="p-3 text-right">PIX pagos</th>
              <th className="p-3 text-right">Conversão</th>
              <th className="p-3 text-right">Receita</th>
            </tr>
          </thead>
          <tbody>
            {(data?.contas || []).map((l) => (
              <tr key={l.accountId} className="border-b border-white/[0.04] last:border-0">
                <td className="p-3">
                  <span className="text-zinc-200">{l.label}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {l.channel === "whatsapp" ? "WhatsApp" : "Telegram"}
                  </span>
                </td>
                <td className="p-3 text-zinc-400">{l.profileName}</td>
                <td className="p-3 text-right tabular-nums">{l.leads}</td>
                <td className="p-3 text-right tabular-nums">{l.pixGerados}</td>
                <td className="p-3 text-right tabular-nums text-emerald-400">{l.pixPagos}</td>
                <td className="p-3 text-right tabular-nums">{pctFunil(l.leadParaPago)}</td>
                <td className="p-3 text-right tabular-nums">{brl(l.pagosCents)}</td>
              </tr>
            ))}
            {!carregando && (data?.contas || []).length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-sm text-zinc-500">
                  Nenhuma conta de LTV ainda. Conecte um número em{" "}
                  <Link href="/dashboard/ltv/whatsapp" className="text-emerald-400 underline">
                    LTV WhatsApp
                  </Link>{" "}
                  ou o chip em{" "}
                  <Link href="/dashboard/ltv/telegram" className="text-emerald-400 underline">
                    LTV Telegram
                  </Link>
                  .
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* O que está vendendo. Só produto: venda lançada à mão não tem produto
          e por isso não aparece aqui — ela conta na receita, acima. */}
      <p className="eyebrow mt-8">produtos que mais venderam</p>
      <div className="mt-3 card p-0">
        {(data?.produtos || []).length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">
            {carregando ? "Carregando…" : "Nenhuma venda de produto no período."}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {(data?.produtos || []).map((p) => (
              <li key={p.productId} className="flex items-center justify-between gap-3 p-3">
                <span className="min-w-0 truncate text-zinc-200">{p.name}</span>
                <span className="shrink-0 text-xs text-zinc-500">{p.count}×</span>
                <span className="shrink-0 tabular-nums text-emerald-400">{brl(p.cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Etapa({
  rotulo,
  valor,
  detalhe,
  accent,
  carregando,
}: {
  rotulo: string;
  valor: string | null;
  detalhe?: string;
  accent?: boolean;
  carregando?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{rotulo}</p>
      <p
        className={`mt-1 text-3xl font-semibold tabular-nums ${
          accent ? "text-emerald-400" : "text-zinc-100"
        }`}
      >
        {valor ?? (carregando ? "…" : "—")}
      </p>
      {detalhe && <p className="mt-1 text-xs text-zinc-500">{detalhe}</p>}
    </div>
  );
}

function Card({
  label,
  valor,
  hint,
  accent,
  muted,
}: {
  label: string;
  valor: string | null;
  hint?: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          accent ? "text-emerald-400" : muted ? "text-amber-400" : "text-zinc-100"
        }`}
      >
        {valor ?? "…"}
      </p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
