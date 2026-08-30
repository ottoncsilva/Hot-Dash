"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ToggleChip from "@/components/ToggleChip";
import { IconEdit, IconEye, IconLink } from "@/components/icons";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
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

/** Quantos links a visão "Por link" mostra antes de resumir o resto numa linha. */
const POR_LINK_TETO = 40;

/**
 * "custom" é o que a SLT chama um link que não é rede social nenhuma — ou
 * seja, a maioria deles. Escrever isso em cada linha não informava nada e só
 * poluía a lista, então a etiqueta de plataforma só aparece quando ela DIZ
 * alguma coisa (instagram, telegram, whatsapp…).
 */
const PLATAFORMA_MUDA = new Set(["", "custom", "link", "outro", "other"]);

function mostrarPlataforma(p: string): boolean {
  return !PLATAFORMA_MUDA.has((p || "").trim().toLowerCase());
}

function pct(parte: number, total: number): string {
  if (total <= 0) return "0%";
  const v = (parte / total) * 100;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

/**
 * TODAS as páginas do SLT (link na bio), agrupadas por MODELO do Hot-Dash.
 *
 * A API do SLT não sabe o que é uma "modelo" — cada página é atribuída AQUI
 * (uma vez só, dura até trocar), e o que puxa cliques/visualizações e catálogo
 * é sempre da mesma conta (ver Configurações → Links da Bio).
 *
 * A LEITURA vem antes da configuração. Atribuir modelo e rede é coisa que se
 * faz uma vez por página e não se toca mais; olhar quanto cada link rendeu é
 * o que se faz todo dia. Por isso os dois seletores saíram da linha de frente
 * do card e foram para um diálogo atrás do lápis — o que sobra na tela é o
 * desempenho: visualização, clique, participação de cada link.
 *
 * O período usa o MESMO seletor do Dashboard/Funil de Vendas — "últimos 7
 * dias" aqui é a MESMA janela de lá, e a mesma que compara direto com o
 * painel da própria SLT (que usa esses recortes também).
 */
export default function LinksPage() {
  const [data, setData] = useState<Data | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodState>({ period: DEFAULT_PERIOD, from: "", to: "" });
  const [vista, setVista] = useState<"pagina" | "link">("pagina");
  const [editando, setEditando] = useState<PageRow | null>(null);
  const [salvando, setSalvando] = useState(false);
  // A modelo escolhida é a MESMA do menu, que vale para o painel inteiro (ver
  // ProfileContext) — os chips abaixo são um atalho para ela, não um segundo
  // filtro que poderia divergir do resto das telas.
  const { profileId, setProfileId } = useProfile();

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

  async function salvar(pageId: string, patch: { profileId: string; trafficSource: string }) {
    setSalvando(true);
    try {
      await apiSend("/api/links", "POST", { pageId, ...patch });
      setEditando(null);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    } finally {
      setSalvando(false);
    }
  }

  const grupos = useMemo(
    () => (data?.groups || []).filter((g) => !profileId || g.profileId === profileId),
    [data, profileId],
  );
  // Página sem modelo não pertence a modelo NENHUMA — então some assim que o
  // filtro escolhe uma. Aparecer ali seria dizer que é dela.
  const semModelo = useMemo(() => (profileId ? [] : data?.unassigned || []), [data, profileId]);
  const paginas = useMemo(
    () => [...grupos.flatMap((g) => g.pages), ...semModelo],
    [grupos, semModelo],
  );

  const total = useMemo(() => {
    const views = paginas.reduce((s, p) => s + p.views, 0);
    const clicks = paginas.reduce((s, p) => s + p.clicks, 0);
    const links = paginas.reduce((s, p) => s + p.links.length, 0);
    return { views, clicks, links, paginas: paginas.length };
  }, [paginas]);

  const nomeDaPagina = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data?.groups || []) for (const p of g.pages) m.set(p.pageId, g.profileName);
    return m;
  }, [data]);

  const redeLabel = useMemo(
    () => new Map((data?.networks || []).map((n) => [n.key, n.label])),
    [data],
  );

  return (
    <div className="page">
      <PageHeader
        title="Links"
        description="Páginas e links do SLT (link na bio) — visualização, clique e a participação de cada link no período."
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {erro && (
        <div className="mt-4 card border-red-500/30 bg-red-500/[0.07] p-4 text-sm text-red-300">{erro}</div>
      )}

      {!data && !erro && (
        <div className="mt-4 space-y-3">
          <div className="h-20 animate-pulse rounded-xl bg-white/[0.03]" />
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
        <>
          {(data.groups || []).length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <ToggleChip active={!profileId} onClick={() => setProfileId("")}>
                Todas
              </ToggleChip>
              {(data.groups || []).map((g) => (
                <ToggleChip
                  key={g.profileId}
                  active={profileId === g.profileId}
                  onClick={() => setProfileId(profileId === g.profileId ? "" : g.profileId)}
                >
                  {g.profileName}
                </ToggleChip>
              ))}
            </div>
          )}

          <Resumo total={total} />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <ToggleChip active={vista === "pagina"} onClick={() => setVista("pagina")}>
                Por página
              </ToggleChip>
              <ToggleChip active={vista === "link"} onClick={() => setVista("link")}>
                Por link
              </ToggleChip>
            </div>
            {semModelo.length > 0 && (
              <p className="text-[11px] text-amber-400">
                {semModelo.length} {semModelo.length === 1 ? "página" : "páginas"} sem modelo atribuída
              </p>
            )}
          </div>

          {paginas.length === 0 ? (
            <p className="mt-4 card p-6 text-center text-sm text-zinc-500">
              {profileId
                ? "Nenhuma página do SLT atribuída a esta modelo."
                : "Nenhuma página encontrada nessa conta do SLT."}
            </p>
          ) : vista === "link" ? (
            <PorLink paginas={paginas} nomeDaPagina={nomeDaPagina} totalCliques={total.clicks} />
          ) : (
            <div className="mt-4 space-y-6">
              {semModelo.length > 0 && (
                <Secao titulo="Sem modelo atribuída" alerta>
                  {semModelo.map((p) => (
                    <PaginaCard
                      key={p.pageId}
                      pagina={p}
                      redeLabel={redeLabel}
                      onEditar={() => setEditando(p)}
                    />
                  ))}
                </Secao>
              )}
              {grupos.map((g) => (
                <Secao key={g.profileId} titulo={g.profileName}>
                  {[...g.pages]
                    .sort((a, b) => b.clicks - a.clicks || b.views - a.views)
                    .map((p) => (
                      <PaginaCard
                        key={p.pageId}
                        pagina={p}
                        redeLabel={redeLabel}
                        onEditar={() => setEditando(p)}
                      />
                    ))}
                </Secao>
              ))}
            </div>
          )}
        </>
      )}

      <DialogoEditar
        pagina={editando}
        profiles={data?.profiles || []}
        networks={data?.networks || []}
        salvando={salvando}
        onFechar={() => setEditando(null)}
        onSalvar={salvar}
      />
    </div>
  );
}

function Secao({
  titulo,
  alerta,
  children,
}: {
  titulo: string;
  alerta?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={`eyebrow ${alerta ? "text-amber-400" : ""}`}>{titulo}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

/** A faixa de números do período, já respeitando o filtro de modelo. */
function Resumo({ total }: { total: { views: number; clicks: number; links: number; paginas: number } }) {
  return (
    <div className="mt-4 card grid grid-cols-2 divide-x divide-y divide-white/[0.06] sm:grid-cols-4 sm:divide-y-0">
      <Numero rotulo="Visualizações" valor={total.views.toLocaleString("pt-BR")} />
      <Numero rotulo="Cliques" valor={total.clicks.toLocaleString("pt-BR")} />
      <Numero
        rotulo="Cliques por visita"
        valor={total.views > 0 ? (total.clicks / total.views).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}
      />
      <Numero rotulo="Páginas / links" valor={`${total.paginas} / ${total.links}`} />
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="p-4">
      <p className="eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-2xl text-white">{valor}</p>
    </div>
  );
}

function PaginaCard({
  pagina,
  redeLabel,
  onEditar,
}: {
  pagina: PageRow;
  redeLabel: Map<string, string>;
  onEditar: () => void;
}) {
  // O denominador do % é a soma dos cliques DOS LINKS, não o clique da página:
  // as duas contagens vêm de consultas diferentes (página por slug, link por
  // URL) e podem não bater. Somar os próprios links é o que garante que as
  // participações fechem em 100% e ninguém precise conferir na mão.
  const totalLinks = pagina.links.reduce((s, l) => s + l.clicks, 0);
  const links = [...pagina.links].sort((a, b) => b.clicks - a.clicks);
  const maior = links[0]?.clicks || 0;
  const url = `${pagina.activeDomain || "slt.bio"}/${pagina.slug}`;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{pagina.displayName}</p>
            {pagina.trafficSource ? (
              <span className="chip">{redeLabel.get(pagina.trafficSource) || pagina.trafficSource}</span>
            ) : (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                sem rede
              </span>
            )}
            {!pagina.published && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                despublicada
              </span>
            )}
          </div>
          {pagina.label && <p className="mt-0.5 truncate text-xs text-zinc-500">{pagina.label}</p>}
          <a
            href={`https://${url}`}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-block font-mono text-[11px] text-zinc-600 hover:text-zinc-300"
          >
            {url}
          </a>
        </div>
        <button
          type="button"
          onClick={onEditar}
          className="btn-ghost h-8 shrink-0 px-3 text-xs"
          aria-label={`Editar ${pagina.displayName}`}
        >
          <IconEdit size={14} />
          Editar
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 text-zinc-400">
          <IconEye size={13} />
          <b className="text-zinc-200">{pagina.views.toLocaleString("pt-BR")}</b> visualizações
        </span>
        <span className="inline-flex items-center gap-1.5 text-zinc-400">
          <IconLink size={13} />
          <b className="text-zinc-200">{pagina.clicks.toLocaleString("pt-BR")}</b> cliques
        </span>
        {pagina.views > 0 && (
          <span className="text-zinc-400">
            <b className="text-zinc-200">
              {(pagina.clicks / pagina.views).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
            </b>{" "}
            cliques por visita
          </span>
        )}
      </div>

      {links.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-2.5">
          <div className="space-y-1.5">
            {links.map((l) => (
              <LinhaDoLink key={l.id} link={l} total={totalLinks} maior={maior} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Uma linha da lista de links de uma página: rótulo, destino, clique, o QUANTO
 * daquele clique é dele (%) e a barra que deixa a comparação imediata — a
 * barra é proporcional ao MAIOR link da página, não ao total, porque o que se
 * quer ver de relance é quem ganha de quem.
 */
function LinhaDoLink({ link, total, maior }: { link: LinkRow; total: number; maior: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {mostrarPlataforma(link.platform) && (
        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] lowercase text-zinc-500">
          {link.platform}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-zinc-300" title={link.url}>
        {link.label || link.url}
      </span>
      <span className="hidden min-w-0 max-w-[28%] shrink truncate font-mono text-[11px] text-zinc-600 sm:block">
        {link.url}
      </span>
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-white/40"
          style={{ width: `${maior > 0 ? Math.round((link.clicks / maior) * 100) : 0}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-300">{link.clicks}</span>
      <span className="w-11 shrink-0 text-right font-mono text-[11px] text-zinc-500">
        {pct(link.clicks, total)}
      </span>
    </div>
  );
}

/**
 * Todos os links do recorte numa lista só, do que mais rendeu ao que menos
 * rendeu. É a resposta para "qual link está puxando o clique?", que a visão
 * por página não dá quando a modelo tem cinco páginas.
 */
function PorLink({
  paginas,
  nomeDaPagina,
  totalCliques,
}: {
  paginas: PageRow[];
  nomeDaPagina: Map<string, string>;
  totalCliques: number;
}) {
  const linhas = paginas
    .flatMap((p) =>
      p.links.map((l) => ({
        ...l,
        pagina: p.displayName,
        modelo: nomeDaPagina.get(p.pageId) || "",
      })),
    )
    .sort((a, b) => b.clicks - a.clicks);
  const total = linhas.reduce((s, l) => s + l.clicks, 0) || totalCliques;
  const maior = linhas[0]?.clicks || 0;
  const mostradas = linhas.slice(0, POR_LINK_TETO);
  const resto = linhas.slice(POR_LINK_TETO);
  const cliquesDoResto = resto.reduce((s, l) => s + l.clicks, 0);

  if (linhas.length === 0) {
    return (
      <p className="mt-4 card p-6 text-center text-sm text-zinc-500">
        Nenhum link cadastrado nas páginas deste recorte.
      </p>
    );
  }

  return (
    <div className="mt-4 card divide-y divide-white/[0.06]">
      {mostradas.map((l) => (
        <div key={`${l.id}-${l.pagina}`} className="flex items-center gap-3 px-4 py-2.5 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {mostrarPlataforma(l.platform) && (
                <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] lowercase text-zinc-500">
                  {l.platform}
                </span>
              )}
              <span className="truncate text-zinc-200" title={l.url}>
                {l.label || l.url}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-600">
              {l.modelo ? `${l.modelo} · ` : ""}
              {l.pagina}
            </p>
          </div>
          <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-white/[0.06] sm:w-28">
            <div
              className="h-full rounded-full bg-white/40"
              style={{ width: `${maior > 0 ? Math.round((l.clicks / maior) * 100) : 0}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-[11px] text-zinc-200">{l.clicks}</span>
          <span className="w-11 shrink-0 text-right font-mono text-[11px] text-zinc-500">
            {pct(l.clicks, total)}
          </span>
        </div>
      ))}
      {resto.length > 0 && (
        <p className="px-4 py-2.5 text-[11px] text-zinc-500">
          + outros {resto.length} links, {cliquesDoResto.toLocaleString("pt-BR")} cliques (
          {pct(cliquesDoResto, total)})
        </p>
      )}
    </div>
  );
}

/**
 * Onde a página é CONFIGURADA: modelo e rede de tráfego, os dois de escolher
 * numa lista (nada de digitar), e só gravados no "Salvar" — antes eram dois
 * seletores soltos no card que salvavam a cada troca, o que fazia um clique
 * errado virar atribuição errada sem aviso.
 */
function DialogoEditar({
  pagina,
  profiles,
  networks,
  salvando,
  onFechar,
  onSalvar,
}: {
  pagina: PageRow | null;
  profiles: { id: string; name: string }[];
  networks: SltNetwork[];
  salvando: boolean;
  onFechar: () => void;
  onSalvar: (pageId: string, patch: { profileId: string; trafficSource: string }) => void;
}) {
  const [profileId, setProfileId] = useState("");
  const [rede, setRede] = useState("");

  useEffect(() => {
    setProfileId(pagina?.profileId || "");
    setRede(pagina?.trafficSource || "");
  }, [pagina]);

  if (!pagina) return null;

  return (
    <Modal open onClose={onFechar}>
      <p className="eyebrow">Configurar página</p>
      <h2 className="mt-1 font-display text-lg text-white">{pagina.displayName}</h2>
      <p className="mt-0.5 font-mono text-[11px] text-zinc-600">
        {pagina.activeDomain || "slt.bio"}/{pagina.slug}
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="link-modelo">
            Modelo
          </label>
          <select
            id="link-modelo"
            className="input"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            <option value="">Sem modelo</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="link-rede">
            Rede de tráfego
          </label>
          <select id="link-rede" className="input" value={rede} onChange={(e) => setRede(e.target.value)}>
            <option value="">Sem rede</option>
            {networks.map((n) => (
              <option key={n.key} value={n.key}>
                {n.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            É a rede que traz o lead para esta página — usada para separar o tráfego no Funil de Vendas.
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={salvando}
          onClick={() => onSalvar(pagina.pageId, { profileId, trafficSource: rede })}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
