"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ToggleChip from "@/components/ToggleChip";
import { IconEdit } from "@/components/icons";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import type { SltNetwork } from "@/lib/sltNetworks";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import { DEFAULT_PERIOD, type PeriodKey } from "@/lib/periods";

type LinkRow = {
  id: string;
  label: string;
  url: string;
  platform: string;
  clicks: number;
  /** O `?start=CODIGO` que o link carrega. null = clique que não dá para seguir até a venda. */
  code: string | null;
  sales: number;
  revenueCents: number;
};
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
 * seja, quase todos. Escrever isso em cada linha não informava nada e só
 * poluía a lista, então a etiqueta de plataforma só aparece quando ela DIZ
 * alguma coisa (instagram, telegram, whatsapp…).
 */
const PLATAFORMA_MUDA = new Set(["", "custom", "link", "outro", "other"]);

function mostrarPlataforma(p: string): boolean {
  return !PLATAFORMA_MUDA.has((p || "").trim().toLowerCase());
}

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(parte: number, total: number): string {
  if (total <= 0) return "0%";
  const v = (parte / total) * 100;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

/**
 * O nome que DISTINGUE uma página das outras da mesma modelo.
 *
 * A SLT devolve `display_name` (o título grande da página) e `label` (a nota
 * do operador). Nesta conta o `display_name` é sempre o nome da modelo — as
 * cinco páginas da Adriana se chamam todas "Adriana Queiroz" — e quem separa
 * uma da outra é o `label` ("Adriana Queiroz Insta 2"). Por isso o label vem
 * primeiro: sem ele a lista vira cinco linhas com o mesmo nome.
 */
function nomeDaPagina(p: { label: string; displayName: string; slug: string }): string {
  return p.label.trim() || p.displayName.trim() || p.slug;
}

function enderecoDaPagina(p: { activeDomain: string; slug: string }): string {
  return `${p.activeDomain || "slt.bio"}/${p.slug}`;
}

/**
 * Soma venda e receita SEM contar o mesmo código duas vezes.
 *
 * O mesmo `?start=insta1` pode estar em dois links (a página de teste e a de
 * produção, o botão e o hiperlink). O clique de cada um é dele; a VENDA é do
 * código, e é a mesma venda. Somar link a link inflaria a receita — então o
 * total anda por código distinto.
 */
function somarVendas(links: LinkRow[]): { sales: number; cents: number } {
  const vistos = new Set<string>();
  let sales = 0;
  let cents = 0;
  for (const l of links) {
    if (!l.code) continue;
    const c = l.code.toLowerCase();
    if (vistos.has(c)) continue;
    vistos.add(c);
    sales += l.sales;
    cents += l.revenueCents;
  }
  return { sales, cents };
}

/**
 * TODAS as páginas do SLT (link na bio), agrupadas por MODELO do Hot-Dash.
 *
 * A LEITURA vem antes da configuração. Atribuir modelo e rede é coisa que se
 * faz uma vez por página e não se toca mais; olhar quanto cada link rendeu é
 * o que se faz todo dia. Por isso os dois seletores ficam atrás do lápis e o
 * que ocupa a tela é o desempenho — clique, participação e o dinheiro que o
 * link trouxe.
 *
 * O DINHEIRO chega aqui pelo `?start=CODIGO` do próprio link, não pelo slug
 * da página: o slug é o endereço ("adriana2") e o código é escolhido à parte
 * ("insta2"), então casar pelo slug erraria calado. Link sem código aparece
 * como "sem código" e sem receita — o clique existe, mas não há como segui-lo.
 *
 * O período usa o MESMO seletor do Dashboard/Funil de Vendas — "últimos 7
 * dias" aqui é a MESMA janela de lá.
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
    const todosLinks = paginas.flatMap((p) => p.links);
    const { sales, cents } = somarVendas(todosLinks);
    return {
      views: paginas.reduce((s, p) => s + p.views, 0),
      clicks: paginas.reduce((s, p) => s + p.clicks, 0),
      // Clique que dá pra seguir: o que caiu num link com `?start=`.
      rastreaveis: todosLinks.reduce((s, l) => s + (l.code ? l.clicks : 0), 0),
      sales,
      cents,
    };
  }, [paginas]);

  const modeloDaPagina = useMemo(() => {
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
        description="Páginas e links do SLT (link na bio) — clique, participação e o que cada código de deep-link trouxe em venda."
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
            <PorLink paginas={paginas} modeloDaPagina={modeloDaPagina} />
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

/** A faixa de números do recorte: do clique até o dinheiro, na mesma linha. */
function Resumo({
  total,
}: {
  total: { views: number; clicks: number; rastreaveis: number; sales: number; cents: number };
}) {
  const n = (v: number) => v.toLocaleString("pt-BR");
  return (
    <div className="mt-4 card grid grid-cols-2 divide-x divide-y divide-white/[0.06] sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
      <Numero rotulo="Visualizações" valor={n(total.views)} nota="nas páginas" />
      <Numero rotulo="Cliques" valor={n(total.clicks)} nota="em algum link" />
      <Numero
        rotulo="Rastreáveis"
        valor={n(total.rastreaveis)}
        nota={`${pct(total.rastreaveis, total.clicks)} dos cliques têm código`}
        cor="text-sky-300"
      />
      <Numero rotulo="Vendas" valor={n(total.sales)} nota="vindas destes códigos" />
      <Numero
        rotulo="Receita"
        valor={brl(total.cents)}
        nota="o que estes links trouxeram"
        cor="text-emerald-400"
      />
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  cor = "text-white",
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  cor?: string;
}) {
  return (
    <div className="p-4">
      <p className="eyebrow">{rotulo}</p>
      <p className={`mt-1 font-display text-2xl ${cor}`}>{valor}</p>
      {nota && <p className="mt-0.5 text-[11px] text-zinc-600">{nota}</p>}
    </div>
  );
}

/**
 * A pílula do código. ROXA quando o link carrega um `?start=` — é a marca
 * visual de "este clique dá para seguir até a venda". Cinza e apagada quando
 * não carrega: não é erro, é um link que simplesmente não é rastreável.
 */
function PilulaCodigo({ code }: { code: string | null }) {
  if (!code) {
    return (
      <span className="shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
        sem código
      </span>
    );
  }
  return (
    <span
      className="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-300"
      title={`Deep-link: t.me/<bot>?start=${code}`}
    >
      ?start={code}
    </span>
  );
}

/**
 * Barra + clique + participação, em azul. A barra é proporcional ao MAIOR
 * link do grupo, não ao total: o que se quer de relance é quem ganha de quem,
 * e contra o total tudo vira um tracinho.
 */
function BarraDeCliques({
  clicks,
  total,
  maior,
  dica,
}: {
  clicks: number;
  total: number;
  maior: number;
  dica: string;
}) {
  const largura = maior > 0 ? Math.max(2, Math.round((clicks / maior) * 100)) : 0;
  return (
    <div className="group/barra flex shrink-0 items-center gap-2" title={dica}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.06] sm:w-28">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-300 group-hover/barra:bg-sky-400"
          style={{ width: `${largura}%` }}
        />
      </div>
      <span className="w-11 text-right font-mono text-[11px] text-zinc-200">
        {clicks.toLocaleString("pt-BR")}
      </span>
      <span className="w-10 text-right font-mono text-[11px] text-sky-400">{pct(clicks, total)}</span>
    </div>
  );
}

/** Receita e vendas do código, ou o traço de "não dá para saber". */
function ValorDoLink({ link }: { link: LinkRow }) {
  if (!link.code) {
    return (
      <div className="w-24 shrink-0 text-right">
        <p className="font-mono text-[11px] text-zinc-700">—</p>
        <p className="text-[10px] text-zinc-700">não rastreável</p>
      </div>
    );
  }
  return (
    <div className="w-24 shrink-0 text-right">
      <p className={`font-mono text-[11px] ${link.revenueCents > 0 ? "text-emerald-400" : "text-zinc-600"}`}>
        {brl(link.revenueCents)}
      </p>
      <p className="text-[10px] text-zinc-600">
        {link.sales} {link.sales === 1 ? "venda" : "vendas"}
      </p>
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
  // URL) e podem não bater. Somar os próprios links garante que as
  // participações fechem em 100% e ninguém precise conferir na mão.
  const totalLinks = pagina.links.reduce((s, l) => s + l.clicks, 0);
  const links = [...pagina.links].sort((a, b) => b.clicks - a.clicks);
  const maior = links[0]?.clicks || 0;
  const { sales, cents } = somarVendas(pagina.links);
  const endereco = enderecoDaPagina(pagina);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{nomeDaPagina(pagina)}</p>
          <a
            href={`https://${endereco}`}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-block font-mono text-[11px] text-zinc-600 hover:text-zinc-300"
          >
            {endereco}
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
        </div>
        <button
          type="button"
          onClick={onEditar}
          className="btn-ghost h-8 shrink-0 px-3 text-xs"
          aria-label={`Editar ${nomeDaPagina(pagina)}`}
        >
          <IconEdit size={14} />
          Editar
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
        <span>
          Views <b className="text-zinc-200">{pagina.views.toLocaleString("pt-BR")}</b>
        </span>
        <span>
          Cliques <b className="text-zinc-200">{pagina.clicks.toLocaleString("pt-BR")}</b>
        </span>
        {pagina.views > 0 && (
          <span>
            Cliques por visita{" "}
            <b className="text-zinc-200">
              {(pagina.clicks / pagina.views).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
            </b>
          </span>
        )}
        <span>
          Receita <b className={cents > 0 ? "text-emerald-400" : "text-zinc-200"}>{brl(cents)}</b>
        </span>
        <span>
          Vendas <b className="text-zinc-200">{sales}</b>
        </span>
      </div>

      {links.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5">
          {links.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-lg px-1 py-1 text-xs hover:bg-white/[0.03]">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {mostrarPlataforma(l.platform) && (
                  <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] lowercase text-zinc-500">
                    {l.platform}
                  </span>
                )}
                <span className="truncate text-zinc-200" title={l.url}>
                  {l.label || l.url}
                </span>
              </div>
              <PilulaCodigo code={l.code} />
              <BarraDeCliques
                clicks={l.clicks}
                total={totalLinks}
                maior={maior}
                dica={`${l.clicks} de ${totalLinks} cliques desta página · ${l.url}`}
              />
              <ValorDoLink link={l} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Todos os links do recorte numa lista só, do que mais rendeu ao que menos.
 *
 * Cada linha tem que se explicar sozinha, porque aqui não existe o card da
 * página em volta: o rótulo do link ("Telegram VIP"), o código que ele
 * carrega, DE QUE PÁGINA ele veio (pelo nome que a distingue e pelo endereço)
 * e de que modelo. Sem isso a lista vira seis linhas iguais chamadas
 * "Prévias" — que foi exatamente o que não podia acontecer.
 */
function PorLink({
  paginas,
  modeloDaPagina,
}: {
  paginas: PageRow[];
  modeloDaPagina: Map<string, string>;
}) {
  const linhas = paginas
    .flatMap((p) =>
      p.links.map((l) => ({
        ...l,
        chave: `${p.pageId}|${l.id}`,
        pagina: nomeDaPagina(p),
        endereco: enderecoDaPagina(p),
        modelo: modeloDaPagina.get(p.pageId) || "Sem modelo",
      })),
    )
    .sort((a, b) => b.clicks - a.clicks);
  const total = linhas.reduce((s, l) => s + l.clicks, 0);
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
        <div key={l.chave} className="flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-white/[0.02]">
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
              <PilulaCodigo code={l.code} />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">
              {l.modelo} · {l.pagina}{" "}
              <span className="font-mono text-zinc-600">{l.endereco}</span>
            </p>
          </div>
          <BarraDeCliques
            clicks={l.clicks}
            total={total}
            maior={maior}
            dica={`${l.clicks} de ${total} cliques do recorte · ${l.url}`}
          />
          <ValorDoLink link={l} />
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
      <h2 className="mt-1 font-display text-lg text-white">{nomeDaPagina(pagina)}</h2>
      <p className="mt-0.5 font-mono text-[11px] text-zinc-600">{enderecoDaPagina(pagina)}</p>

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
