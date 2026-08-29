"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { showToast } from "@/lib/toast";
import type { SltNetwork } from "@/lib/sltNetworks";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import { DEFAULT_PERIOD, type PeriodKey } from "@/lib/periods";

type LinkRow = { id: string; label: string; url: string; platform: string; clicks: number };
type PageRow = {
  pageId: string;
  slug: string;
  displayName: string;
  label: string;
  published: boolean;
  activeDomain: string;
  links: LinkRow[];
  views: number;
  clicks: number;
  profileId: string | null;
  trafficSource: string | null;
};
type Group = { profileId: string; profileName: string; pages: PageRow[] };
type Data = {
  connected: boolean;
  period?: PeriodKey;
  profiles?: { id: string; name: string }[];
  networks?: SltNetwork[];
  groups?: Group[];
  unassigned?: PageRow[];
};

/**
 * TODAS as páginas do SLT (link na bio), agrupadas por MODELO do Hot-Dash.
 *
 * A API do SLT não sabe o que é uma "modelo" — cada página é atribuída AQUI
 * (uma vez só, dura até trocar), o que puxa cliques/visualizações e catálogo
 * é sempre da mesma conta (ver Configurações → Links da Bio).
 *
 * O período usa o MESMO seletor do Dashboard/Funil de Vendas — "últimos 7
 * dias" aqui é a MESMA janela de lá, e a mesma que compara direto com o
 * painel da própria SLT (que usa esses recortes também).
 */
export default function LinksPage() {
  const [data, setData] = useState<Data | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodState>({ period: DEFAULT_PERIOD, from: "", to: "" });
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  function load() {
    setErro(null);
    apiGet<Data>(`/api/links?${periodQuery(period)}`)
      .then(setData)
      .catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  async function atribuir(pageId: string, patch: { profileId?: string; trafficSource?: string }) {
    setSalvandoId(pageId);
    try {
      await apiSend("/api/links", "POST", { pageId, ...patch });
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao atribuir.", "error");
    } finally {
      setSalvandoId(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Links"
        description="Páginas e links do SLT (link na bio), agrupados por modelo e por rede — visualização e clique do período."
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {erro && (
        <div className="mt-4 card border-red-500/30 bg-red-500/[0.07] p-4 text-sm text-red-300">{erro}</div>
      )}

      {!data && !erro && (
        <div className="mt-4 space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
        </div>
      )}

      {data && !data.connected && (
        <div className="mt-4 card p-6 text-center text-sm text-zinc-400">
          SLT ainda não conectado. Configure a chave em{" "}
          <Link href="/dashboard/settings/slt" className="underline">
            Configurações → Links da Bio
          </Link>
          .
        </div>
      )}

      {data?.connected && (
        <div className="mt-5 space-y-6">
          {data.unassigned && data.unassigned.length > 0 && (
            <div>
              <p className="eyebrow text-amber-400">sem modelo atribuída</p>
              <div className="mt-2 space-y-2">
                {data.unassigned.map((p) => (
                  <PaginaCard
                    key={p.pageId}
                    pagina={p}
                    profiles={data.profiles || []}
                    networks={data.networks || []}
                    salvando={salvandoId === p.pageId}
                    onAtribuir={(patch) => atribuir(p.pageId, patch)}
                  />
                ))}
              </div>
            </div>
          )}

          {(data.groups || []).length === 0 && (!data.unassigned || data.unassigned.length === 0) && (
            <p className="card p-6 text-center text-sm text-zinc-500">
              Nenhuma página encontrada nessa conta do SLT.
            </p>
          )}

          {(data.groups || []).map((g) => (
            <div key={g.profileId}>
              <p className="eyebrow">{g.profileName}</p>
              <div className="mt-2 space-y-2">
                {g.pages.map((p) => (
                  <PaginaCard
                    key={p.pageId}
                    pagina={p}
                    profiles={data.profiles || []}
                    networks={data.networks || []}
                    salvando={salvandoId === p.pageId}
                    onAtribuir={(patch) => atribuir(p.pageId, patch)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PaginaCard({
  pagina,
  profiles,
  networks,
  salvando,
  onAtribuir,
}: {
  pagina: PageRow;
  profiles: { id: string; name: string }[];
  networks: SltNetwork[];
  salvando: boolean;
  onAtribuir: (patch: { profileId?: string; trafficSource?: string }) => void;
}) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{pagina.displayName}</p>
            {!pagina.published && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                despublicada
              </span>
            )}
            {!pagina.trafficSource && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                sem rede
              </span>
            )}
          </div>
          {pagina.label && <p className="mt-0.5 truncate text-xs text-zinc-500">{pagina.label}</p>}
          <p className="mt-0.5 font-mono text-[11px] text-zinc-600">
            {pagina.activeDomain || "slt.bio"}/{pagina.slug}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <select
            className="input h-8 w-auto py-0 text-xs"
            value={pagina.profileId || ""}
            disabled={salvando}
            onChange={(e) => onAtribuir({ profileId: e.target.value })}
            aria-label="Modelo"
          >
            <option value="">Sem modelo</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="input h-8 w-auto py-0 text-xs"
            value={pagina.trafficSource || ""}
            disabled={salvando}
            onChange={(e) => onAtribuir({ trafficSource: e.target.value })}
            aria-label="Rede de tráfego"
          >
            <option value="">Sem rede</option>
            {networks.map((n) => (
              <option key={n.key} value={n.key}>
                {n.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex gap-4 text-xs">
        <span className="text-zinc-400">
          Views: <b className="text-zinc-200">{pagina.views}</b>
        </span>
        <span className="text-zinc-400">
          Cliques: <b className="text-zinc-200">{pagina.clicks}</b>
        </span>
        {pagina.views > 0 && (
          <span className="text-zinc-400">
            Conversão: <b className="text-zinc-200">{((pagina.clicks / pagina.views) * 100).toFixed(1)}%</b>
          </span>
        )}
      </div>

      {pagina.links.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5">
          {pagina.links.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-xs">
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                {l.platform}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-300">{l.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                {l.clicks} {l.clicks === 1 ? "clique" : "cliques"}
              </span>
              <span className="min-w-0 max-w-[40%] truncate font-mono text-[11px] text-zinc-600">
                {l.url}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
