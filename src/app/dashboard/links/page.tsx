"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ToggleChip from "@/components/ToggleChip";
import { IconEdit, IconList } from "@/components/icons";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import type { SltNetwork } from "@/lib/sltNetworks";
import PeriodPicker, { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import PainelCodigos from "@/components/rastreio/PainelCodigos";
import Resumo, { type NumeroDoResumo } from "@/components/rastreio/Resumo";
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
/**
 * Um POPLINK: o link curto da SLT (igpopl.ink/apelido) que manda direto para
 * o destino, sem página nem botões no meio.
 *
 * Por isso ele traz UM número só, o clique — não existe visualização de
 * página nem revelação de botão para contar. A venda chega do mesmo jeito
 * que nos outros links: pelo `?start=` que o destino carrega.
 */
type PoplinkRow = {
  id: string;
  slug: string;
  /** O endereço que se divulga (igpopl.ink/apelido). */
  shortUrl: string;
  /** Para onde o clique vai parar. */
  url: string;
  clicks: number;
  code: string | null;
  sales: number;
  revenueCents: number;
  profileId: string | null;
  trafficSource: string | null;
  shieldEnabled: boolean;
  blockedCountries: string[];
};
type Data = {
  connected: boolean;
  period?: PeriodKey;
  profiles?: { id: string; name: string }[];
  networks?: SltNetwork[];
  groups?: Group[];
  unassigned?: PageRow[];
  poplinks?: PoplinkRow[];
};

/**
 * O que entra numa seção de modelo: uma página do SLT ou um PopLink.
 *
 * Os dois no mesmo grupo, ordenados por clique, porque para quem lê é a mesma
 * pergunta — o que esta modelo divulgou e o que rendeu. Separá-los em duas
 * listas obrigava a comparar dois blocos para saber quem ganhou de quem.
 */
type Item = { tipo: "page"; p: PageRow } | { tipo: "poplink"; pl: PoplinkRow };

function cliquesDoItem(i: Item): number {
  return i.tipo === "page" ? i.p.clicks : i.pl.clicks;
}

/** Uma linha da quebra por país. */
type PaisRow = { country: string; views: number; clicks: number };

/** O alvo do "Detalhes" — a mesma pergunta ("de onde vieram os cliques?")
 *  para uma página ou para um PopLink. */
type AlvoDoDetalhe = {
  tipo: "page" | "poplink";
  id: string;
  slug: string;
  titulo: string;
  subtitulo: string;
};

/** O que o diálogo de configuração precisa saber, seja de uma página ou de um
 *  PopLink: a chave que o servidor grava e o que escrever no cabeçalho. */
type AlvoDaConfig = {
  chave: string;
  titulo: string;
  subtitulo: string;
  rotulo: string;
  profileId: string | null;
  trafficSource: string | null;
};

/** As duas metades do Rastreio: a página do SLT (view → clique) e o código do
 *  deep-link (start → cobrança → venda). Eram dois itens de menu; viraram uma
 *  escolha dentro da tela, porque são o mesmo caminho em dois pedaços e ficar
 *  trocando de página para segui-lo era o que atrapalhava. */
type Aba = "links" | "codigos";

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

/** Número com separador de milhar, do jeito que o painel escreve em todo lugar. */
function nBR(v: number): string {
  return v.toLocaleString("pt-BR");
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
function somarVendas(
  links: { code: string | null; sales: number; revenueCents: number }[],
): { sales: number; cents: number } {
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
export default function RastreioPage() {
  const [period, setPeriod] = useState<PeriodState>({ period: DEFAULT_PERIOD, from: "", to: "" });
  const [aba, setAba] = useState<Aba>("links");
  const { profiles, profileId, setProfileId } = useProfile();

  // A aba vem da URL na primeira pintura para `/dashboard/links?aba=codigos`
  // continuar valendo — é para onde o endereço antigo de Códigos redireciona,
  // e é o que um link salvo nos favoritos precisa reabrir.
  //
  // Lido de `window`, e não de `useSearchParams`: o hook obriga a página a
  // virar dinâmica (ou a nascer dentro de um Suspense) só para ler um
  // parâmetro que muda uma vez na vida.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("aba");
    if (q === "codigos" || q === "links") setAba(q);
  }, []);

  function trocarAba(nova: Aba) {
    setAba(nova);
    // O endereço acompanha para o F5 e o "copiar link" caírem na mesma aba.
    // `replaceState` em vez de `push`: alternar aba não é navegação, e encher
    // o histórico faz o "voltar" do celular percorrer as abas em vez de sair
    // da tela.
    const url = new URL(window.location.href);
    url.searchParams.set("aba", nova);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="page">
      <PageHeader title="Rastreio" />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* A modelo escolhida é a MESMA do menu, que vale para o painel inteiro
          (ver ProfileContext) — estes chips são um atalho para ela, não um
          segundo filtro que poderia divergir do resto das telas. Antes Links
          tinha chips e Códigos tinha um <select> com a lista própria: mesma
          escolha, dois controles diferentes, e trocar de aba perdia a modelo. */}
      {profiles.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ToggleChip active={!profileId} onClick={() => setProfileId("")}>
            Todas
          </ToggleChip>
          {profiles.map((p) => (
            <ToggleChip
              key={p.id}
              active={profileId === p.id}
              onClick={() => setProfileId(profileId === p.id ? "" : p.id)}
            >
              {p.name}
            </ToggleChip>
          ))}
        </div>
      )}

      {/* As duas antigas entradas do menu, agora uma escolha dentro da tela.
          Mesmo componente de chip do resto do painel — o alternador não é um
          controle novo, é o que já existia em "Por página / Por link". */}
      <div className="mt-3 flex items-center gap-1.5 border-t border-white/[0.06] pt-3">
        <ToggleChip active={aba === "links"} onClick={() => trocarAba("links")}>
          Links
        </ToggleChip>
        <ToggleChip active={aba === "codigos"} onClick={() => trocarAba("codigos")}>
          Códigos
        </ToggleChip>
      </div>

      {aba === "codigos" ? <PainelCodigos period={period} /> : <PainelLinks period={period} />}
    </div>
  );
}

/**
 * A visão de LINKS: as páginas do SLT e o que cada link delas rendeu.
 *
 * Continua dona da própria busca e do próprio diálogo de edição — o que subiu
 * para o Rastreio foi só o que as duas abas dividem (período, modelo, e a
 * escolha da aba). Assim trocar de aba não perde o período nem a modelo.
 */
function PainelLinks({ period }: { period: PeriodState }) {
  const [data, setData] = useState<Data | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vista, setVista] = useState<"pagina" | "link">("pagina");
  const [editando, setEditando] = useState<AlvoDaConfig | null>(null);
  const [detalhando, setDetalhando] = useState<AlvoDoDetalhe | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Só LÊ a modelo: quem a escolhe é o Rastreio, acima, com os chips que as
  // duas abas dividem.
  const { profileId } = useProfile();

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

  async function salvar(chave: string, patch: { profileId: string; trafficSource: string }) {
    setSalvando(true);
    try {
      // O servidor guarda os dois na mesma tabela; a chave do PopLink vem
      // prefixada (`poplink:<id>`) para não se confundir com id de página.
      await apiSend("/api/links", "POST", { pageId: chave, ...patch });
      setEditando(null);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    } finally {
      setSalvando(false);
    }
  }

  const nomeDoPerfil = useMemo(
    () => new Map((data?.profiles || []).map((p) => [p.id, p.name])),
    [data],
  );

  /**
   * As seções por modelo, com página e PopLink na MESMA lista, do mais
   * clicado ao menos.
   *
   * A mescla é aqui e não no servidor porque `groups` só traz modelo que tem
   * PÁGINA — uma que só divulgue por PopLink não apareceria. Montando do lado
   * de cá, o modelo entra pelo que tiver: página, PopLink ou os dois.
   */
  const grupos = useMemo(() => {
    const porModelo = new Map<string, { profileId: string; profileName: string; itens: Item[] }>();
    for (const g of data?.groups || []) {
      porModelo.set(g.profileId, {
        profileId: g.profileId,
        profileName: g.profileName,
        itens: g.pages.map((p) => ({ tipo: "page", p }) as Item),
      });
    }
    for (const pl of data?.poplinks || []) {
      if (!pl.profileId) continue;
      const grupo = porModelo.get(pl.profileId) || {
        profileId: pl.profileId,
        profileName: nomeDoPerfil.get(pl.profileId) || "Modelo",
        itens: [] as Item[],
      };
      grupo.itens.push({ tipo: "poplink", pl });
      porModelo.set(pl.profileId, grupo);
    }
    return [...porModelo.values()]
      .filter((g) => !profileId || g.profileId === profileId)
      .map((g) => ({ ...g, itens: [...g.itens].sort((a, b) => cliquesDoItem(b) - cliquesDoItem(a)) }))
      .sort((a, b) => a.profileName.localeCompare(b.profileName, "pt-BR"));
  }, [data, profileId, nomeDoPerfil]);

  // Página e PopLink sem modelo não pertencem a modelo NENHUMA — então somem
  // assim que o filtro escolhe uma. Aparecer ali seria dizer que são dela.
  const semModelo = useMemo<Item[]>(() => {
    if (profileId) return [];
    const itens: Item[] = [
      ...(data?.unassigned || []).map((p) => ({ tipo: "page", p }) as Item),
      ...(data?.poplinks || []).filter((pl) => !pl.profileId).map((pl) => ({ tipo: "poplink", pl }) as Item),
    ];
    return itens.sort((a, b) => cliquesDoItem(b) - cliquesDoItem(a));
  }, [data, profileId]);

  const todosOsItens = useMemo(
    () => [...grupos.flatMap((g) => g.itens), ...semModelo],
    [grupos, semModelo],
  );
  const paginas = useMemo(
    () => todosOsItens.flatMap((i) => (i.tipo === "page" ? [i.p] : [])),
    [todosOsItens],
  );
  const poplinks = useMemo(
    () => todosOsItens.flatMap((i) => (i.tipo === "poplink" ? [i.pl] : [])),
    [todosOsItens],
  );

  const total = useMemo(() => {
    const todosLinks = paginas.flatMap((p) => p.links);
    // O dinheiro dos PopLinks entra na MESMA soma: ela anda por código
    // distinto, então um código que está numa página e num PopLink conta uma
    // vez só — que é a venda que de fato aconteceu.
    const { sales, cents } = somarVendas([...todosLinks, ...poplinks]);
    const cliquesPoplink = poplinks.reduce((s, pl) => s + pl.clicks, 0);
    return {
      views: paginas.reduce((s, p) => s + p.views, 0),
      // CLIQUES DE PÁGINA e cliques de PopLink ficam separados de propósito:
      // o primeiro tem visualização por trás (dá para dividir um pelo outro),
      // o segundo não passa por página nenhuma. Somados, "cliques por visita"
      // viraria uma conta sem sentido.
      clicks: paginas.reduce((s, p) => s + p.clicks, 0),
      poplinkClicks: cliquesPoplink,
      // Clique que dá pra seguir: o que caiu num link com `?start=`.
      rastreaveis:
        todosLinks.reduce((s, l) => s + (l.code ? l.clicks : 0), 0) +
        poplinks.reduce((s, pl) => s + (pl.code ? pl.clicks : 0), 0),
      sales,
      cents,
    };
  }, [paginas, poplinks]);

  /** Os mesmos cinco números de sempre, agora no formato que a faixa
   *  compartilhada com a aba de Códigos entende. */
  const numeros: NumeroDoResumo[] = useMemo(() => {
    const cliquesTotais = total.clicks + total.poplinkClicks;
    return [
      { rotulo: "Visualizações", valor: nBR(total.views), nota: "nas páginas" },
      { rotulo: "Cliques", valor: nBR(total.clicks), nota: "em algum link" },
      // Só aparece quando existe PopLink no recorte: uma coluna zerada numa
      // conta que não usa a função é espaço gasto para não dizer nada.
      ...(total.poplinkClicks > 0 || poplinks.length > 0
        ? [
            {
              rotulo: "PopLinks",
              valor: nBR(total.poplinkClicks),
              nota: "cliques diretos ao destino",
              cor: "text-orange-300",
            },
          ]
        : []),
      {
        rotulo: "Rastreáveis",
        valor: nBR(total.rastreaveis),
        nota: `${pct(total.rastreaveis, cliquesTotais)} dos cliques têm código`,
        cor: "text-sky-300",
      },
      { rotulo: "Vendas", valor: nBR(total.sales), nota: "vindas destes códigos" },
      {
        rotulo: "Receita",
        valor: brl(total.cents),
        nota: "o que estes links trouxeram",
        cor: "text-emerald-400",
      },
    ];
  }, [total, poplinks]);

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
    <>
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
          <Resumo numeros={numeros} />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
                {semModelo.length} sem modelo atribuída
              </p>
            )}
          </div>

          {todosOsItens.length === 0 ? (
            <p className="mt-4 card p-6 text-center text-sm text-zinc-500">
              {profileId
                ? "Nada do SLT atribuído a esta modelo."
                : "Nenhuma página encontrada nessa conta do SLT."}
            </p>
          ) : vista === "link" ? (
            <PorLink
              paginas={paginas}
              poplinks={poplinks}
              modeloDaPagina={modeloDaPagina}
              nomeDoPerfil={nomeDoPerfil}
            />
          ) : (
            <div className="mt-4 space-y-6">
              {semModelo.length > 0 && (
                <Secao titulo="Sem modelo atribuída" alerta>
                  {semModelo.map((item) => (
                    <CardDoItem
                      key={item.tipo === "page" ? item.p.pageId : item.pl.id}
                      item={item}
                      redeLabel={redeLabel}
                      onEditar={setEditando}
                      onDetalhes={setDetalhando}
                    />
                  ))}
                </Secao>
              )}
              {grupos.map((g) => (
                <Secao key={g.profileId} titulo={g.profileName}>
                  {g.itens.map((item) => (
                    <CardDoItem
                      key={item.tipo === "page" ? item.p.pageId : item.pl.id}
                      item={item}
                      redeLabel={redeLabel}
                      onEditar={setEditando}
                      onDetalhes={setDetalhando}
                    />
                  ))}
                </Secao>
              ))}
            </div>
          )}
        </>
      )}

      <DialogoEditar
        alvo={editando}
        profiles={data?.profiles || []}
        networks={data?.networks || []}
        salvando={salvando}
        onFechar={() => setEditando(null)}
        onSalvar={salvar}
      />

      <DialogoPaises alvo={detalhando} period={period} onFechar={() => setDetalhando(null)} />
    </>
  );
}

/** A página, no formato que o "Detalhes" entende. Os DOIS identificadores
 *  porque o evento pode ter sido gravado só com o apelido (a coluna do id de
 *  página nasceu depois). */
function detalheDaPagina(p: PageRow): AlvoDoDetalhe {
  return {
    tipo: "page",
    id: p.pageId,
    slug: p.slug,
    titulo: nomeDaPagina(p),
    subtitulo: enderecoDaPagina(p),
  };
}

function detalheDoPoplink(pl: PoplinkRow): AlvoDoDetalhe {
  return {
    tipo: "poplink",
    id: pl.id,
    slug: pl.slug,
    titulo: pl.slug,
    subtitulo: pl.shortUrl.replace(/^https?:\/\//, ""),
  };
}

/** A página, no formato que o diálogo de configuração entende. */
function alvoDaPagina(p: PageRow): AlvoDaConfig {
  return {
    chave: p.pageId,
    titulo: nomeDaPagina(p),
    subtitulo: enderecoDaPagina(p),
    rotulo: "Configurar página",
    profileId: p.profileId,
    trafficSource: p.trafficSource,
  };
}

/** O PopLink, no mesmo formato. A chave vai prefixada — ver o POST de
 *  `/api/links`. */
function alvoDoPoplink(pl: PoplinkRow): AlvoDaConfig {
  return {
    chave: `poplink:${pl.id}`,
    titulo: pl.slug,
    subtitulo: pl.shortUrl.replace(/^https?:\/\//, ""),
    rotulo: "Configurar PopLink",
    profileId: pl.profileId,
    trafficSource: pl.trafficSource,
  };
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
      {/* A BARRA some no celular, o número e o % ficam. Ela existe para ranquear
          de relance uma linha contra as outras; em 390px, espremida a 12px, não
          ranqueia nada e ainda empurrava a linha para fora do card — era o que
          fazia a etiqueta da plataforma escrever por cima da pílula do código e
          o "não rastreável" sair cortado na borda. O % faz o mesmo trabalho em
          um quarto do espaço. */}
      <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.06] sm:block sm:w-28">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-300 group-hover/barra:bg-sky-400"
          style={{ width: `${largura}%` }}
        />
      </div>
      <span className="text-right font-mono text-[11px] text-zinc-200 sm:w-11">
        {clicks.toLocaleString("pt-BR")}
      </span>
      <span className="text-right font-mono text-[11px] text-sky-400 sm:w-10">{pct(clicks, total)}</span>
    </div>
  );
}

/** Receita e vendas do código, ou o traço de "não dá para saber". */
/**
 * Receita e vendas do código, ou o traço de "não dá para saber".
 *
 * DUAS LINHAS no desktop, UMA no celular. É a mesma informação: lá em cima o
 * empilhamento alinha a coluna do dinheiro; aqui embaixo ele custava 13px por
 * link, e três links por card viravam 40px de card só para quebrar linha onde
 * cabia lado a lado.
 */
function ValorDoLink({
  link,
}: {
  /* Estrutural de propósito: serve tanto para o link de uma página quanto
     para um PopLink — os dois têm código, venda e receita, e é só disso que
     esta caixa precisa. */
  link: { code: string | null; sales: number; revenueCents: number };
}) {
  const caixa = "flex shrink-0 items-baseline justify-end gap-1.5 sm:block sm:w-24 sm:text-right";
  if (!link.code) {
    return (
      <div className={caixa}>
        <p className="font-mono text-[11px] text-zinc-700">—</p>
        <p className="text-[10px] text-zinc-700">não rastreável</p>
      </div>
    );
  }
  return (
    <div className={caixa}>
      <p className={`font-mono text-[11px] ${link.revenueCents > 0 ? "text-emerald-400" : "text-zinc-600"}`}>
        {brl(link.revenueCents)}
      </p>
      <p className="whitespace-nowrap text-[10px] text-zinc-600">
        {link.sales} {link.sales === 1 ? "venda" : "vendas"}
      </p>
    </div>
  );
}

function PaginaCard({
  pagina,
  redeLabel,
  onEditar,
  onDetalhes,
}: {
  pagina: PageRow;
  redeLabel: Map<string, string>;
  onEditar: () => void;
  onDetalhes: () => void;
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
    <div className="card p-3">
      {/* CABEÇALHO NUMA LINHA SÓ.
          Eram três: nome, endereço e a fileira de etiquetas — 24px gastos para
          dizer "Instagram". A rede e o estado da página são qualificadores do
          nome, não conteúdo próprio, então vão para a direita, ao lado do
          Editar, onde já havia espaço vazio. O endereço encosta no nome porque
          é o mesmo assunto: qual página é esta. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-semibold text-white">{nomeDaPagina(pagina)}</p>
          <a
            href={`https://${endereco}`}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-[11px] text-zinc-600 hover:text-zinc-300"
          >
            {endereco}
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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
          {/* DETALHES: de onde vieram os cliques. Fica atrás de um botão e não
              no card porque é pergunta de vez em quando — o card responde
              "quanto", este responde "de onde". */}
          <button
            type="button"
            onClick={onDetalhes}
            className="btn-ghost h-8 shrink-0 px-3 text-xs"
            aria-label={`Detalhes de ${nomeDaPagina(pagina)}`}
          >
            <IconList size={14} />
            Detalhes
          </button>
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
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-400">
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
        <div className="mt-2 space-y-0.5 border-t border-white/10 pt-2">
          {links.map((l) => (
            // Duas linhas no celular, uma a partir de `sm`. Em 390px os quatro
            // blocos de largura fixa não cabiam lado a lado e passavam por
            // cima uns dos outros. `sm:contents` dissolve o agrupamento do
            // celular no desktop, então lá continua a mesma linha única de
            // sempre — sem duplicar marcação para as duas larguras.
            <div
              key={l.id}
              className="rounded-lg px-1 py-1 text-xs hover:bg-white/[0.03] sm:flex sm:items-center sm:gap-3 sm:py-0.5"
            >
              <div className="flex min-w-0 items-center gap-2 sm:flex-1">
                {mostrarPlataforma(l.platform) && (
                  <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] lowercase text-zinc-500">
                    {l.platform}
                  </span>
                )}
                <span className="truncate text-zinc-200" title={l.url}>
                  {l.label || l.url}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-end gap-3 sm:mt-0 sm:contents">
                <PilulaCodigo code={l.code} />
                <BarraDeCliques
                  clicks={l.clicks}
                  total={totalLinks}
                  maior={maior}
                  dica={`${l.clicks} de ${totalLinks} cliques desta página · ${l.url}`}
                />
                <ValorDoLink link={l} />
              </div>
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
  poplinks,
  modeloDaPagina,
  nomeDoPerfil,
}: {
  paginas: PageRow[];
  poplinks: PoplinkRow[];
  modeloDaPagina: Map<string, string>;
  nomeDoPerfil: Map<string, string>;
}) {
  // PopLink entra na MESMA lista, na mesma ordem de clique: aqui a pergunta é
  // "o que rendeu mais no recorte", e ele concorre com os outros links.
  const linhas = [
    ...paginas.flatMap((p) =>
      p.links.map((l) => ({
        chave: `${p.pageId}|${l.id}`,
        titulo: l.label || l.url,
        url: l.url,
        plataforma: l.platform,
        poplink: false,
        clicks: l.clicks,
        code: l.code,
        sales: l.sales,
        revenueCents: l.revenueCents,
        contexto: `${modeloDaPagina.get(p.pageId) || "Sem modelo"} · ${nomeDaPagina(p)}`,
        endereco: enderecoDaPagina(p),
      })),
    ),
    ...poplinks.map((pl) => ({
      chave: `poplink|${pl.id}`,
      titulo: pl.shortUrl.replace(/^https?:\/\//, ""),
      url: pl.url,
      plataforma: "",
      poplink: true,
      clicks: pl.clicks,
      code: pl.code,
      sales: pl.sales,
      revenueCents: pl.revenueCents,
      contexto: `${(pl.profileId && nomeDoPerfil.get(pl.profileId)) || "Sem modelo"} · PopLink`,
      // O PopLink não tem página: o endereço que o explica é o destino.
      endereco: pl.url,
    })),
  ].sort((a, b) => b.clicks - a.clicks);
  const total = linhas.reduce((s, l) => s + l.clicks, 0);
  const maior = linhas[0]?.clicks || 0;
  const mostradas = linhas.slice(0, POR_LINK_TETO);
  const resto = linhas.slice(POR_LINK_TETO);
  const cliquesDoResto = resto.reduce((s, l) => s + l.clicks, 0);

  if (linhas.length === 0) {
    return (
      <p className="mt-4 card p-6 text-center text-sm text-zinc-500">
        Nenhum link neste recorte.
      </p>
    );
  }

  return (
    <div className="mt-4 card divide-y divide-white/[0.06]">
      {mostradas.map((l) => (
        <div
          key={l.chave}
          className="px-3 py-2 text-xs hover:bg-white/[0.02] sm:flex sm:items-center sm:gap-3 sm:px-4 sm:py-2"
        >
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2">
              {l.poplink ? (
                <span className="shrink-0 rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-300">
                  poplink
                </span>
              ) : (
                mostrarPlataforma(l.plataforma) && (
                  <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] lowercase text-zinc-500">
                    {l.plataforma}
                  </span>
                )
              )}
              <span className="truncate text-zinc-200" title={l.url}>
                {l.titulo}
              </span>
              <PilulaCodigo code={l.code} />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">
              {l.contexto} <span className="font-mono text-zinc-600">{l.endereco}</span>
            </p>
          </div>
          <div className="mt-1 flex items-center justify-end gap-3 sm:mt-0 sm:contents">
            <BarraDeCliques
              clicks={l.clicks}
              total={total}
              maior={maior}
              dica={`${l.clicks} de ${total} cliques do recorte · ${l.url}`}
            />
            <ValorDoLink link={l} />
          </div>
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

/** Um item da seção do modelo — página ou PopLink, o mesmo lugar na lista. */
function CardDoItem({
  item,
  redeLabel,
  onEditar,
  onDetalhes,
}: {
  item: Item;
  redeLabel: Map<string, string>;
  onEditar: (alvo: AlvoDaConfig) => void;
  onDetalhes: (alvo: AlvoDoDetalhe) => void;
}) {
  if (item.tipo === "page") {
    return (
      <PaginaCard
        pagina={item.p}
        redeLabel={redeLabel}
        onEditar={() => onEditar(alvoDaPagina(item.p))}
        onDetalhes={() => onDetalhes(detalheDaPagina(item.p))}
      />
    );
  }
  return (
    <PoplinkCard
      poplink={item.pl}
      redeLabel={redeLabel}
      onEditar={() => onEditar(alvoDoPoplink(item.pl))}
      onDetalhes={() => onDetalhes(detalheDoPoplink(item.pl))}
    />
  );
}

/**
 * O card de um POPLINK — o link curto (igpopl.ink) que manda direto para o
 * destino, sem página e sem botões no meio.
 *
 * Fica na MESMA lista dos cards de página, ordenado por clique junto com
 * eles: para quem lê é a mesma pergunta, "o que esta modelo divulgou e o que
 * rendeu". A etiqueta laranja é o que diz qual é qual — e por que este card é
 * mais curto: sem página não há visualização nem "cliques por visita", e sem
 * botões não há lista de links dentro. O clique é a única métrica que existe.
 */
function PoplinkCard({
  poplink: pl,
  redeLabel,
  onEditar,
  onDetalhes,
}: {
  poplink: PoplinkRow;
  redeLabel: Map<string, string>;
  onEditar: () => void;
  onDetalhes: () => void;
}) {
  const endereco = pl.shortUrl.replace(/^https?:\/\//, "");
  return (
    <div className="card p-3">
      {/* Mesmo cabeçalho do card de página: identidade à esquerda,
          qualificadores e ações à direita. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-300">
            poplink
          </span>
          <a
            href={pl.shortUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm font-semibold text-white hover:text-orange-200"
          >
            {endereco}
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pl.trafficSource ? (
            <span className="chip">{redeLabel.get(pl.trafficSource) || pl.trafficSource}</span>
          ) : (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
              sem rede
            </span>
          )}
          {/* O escudo da SLT: com ele ligado, ela filtra varredura de bot e
              VPN antes de deixar o clique passar. Muda o que o número ao lado
              significa, então é informação, não enfeite. */}
          {pl.shieldEnabled && (
            <span
              className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500"
              title={
                pl.blockedCountries.length > 0
                  ? `Proteção ligada · países bloqueados: ${pl.blockedCountries.join(", ")}`
                  : "Proteção ligada — a SLT filtra varredura de bot antes de contar o clique"
              }
            >
              escudo
            </span>
          )}
          <button
            type="button"
            onClick={onDetalhes}
            className="btn-ghost h-8 shrink-0 px-3 text-xs"
            aria-label={`Detalhes de ${pl.slug}`}
          >
            <IconList size={14} />
            Detalhes
          </button>
          <button
            type="button"
            onClick={onEditar}
            className="btn-ghost h-8 shrink-0 px-3 text-xs"
            aria-label={`Editar ${pl.slug}`}
          >
            <IconEdit size={14} />
            Editar
          </button>
        </div>
      </div>

      <p className="mt-1 truncate font-mono text-[11px] text-zinc-600" title={pl.url}>
        → {pl.url}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-zinc-400">
        <span>
          Cliques <b className="text-zinc-200">{nBR(pl.clicks)}</b>
        </span>
        <span>
          Receita <b className={pl.revenueCents > 0 ? "text-emerald-400" : "text-zinc-200"}>{brl(pl.revenueCents)}</b>
        </span>
        <span>
          Vendas <b className="text-zinc-200">{pl.sales}</b>
        </span>
        <PilulaCodigo code={pl.code} />
      </div>
    </div>
  );
}

/** Bandeira a partir do ISO de duas letras: cada letra vira o "indicador
 *  regional" correspondente, e o par forma a bandeira. Código estranho
 *  (vazio, tamanho errado) devolve vazio em vez de um retângulo torto. */
function bandeira(iso: string): string {
  const c = iso.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((l) => 0x1f1e6 + l.charCodeAt(0) - 65));
}

/** "BR" → "Brasil". `Intl.DisplayNames` já sabe os nomes em português; código
 *  que ele não reconhece volta como veio, que ainda é melhor que nada. */
function nomeDoPais(iso: string): string {
  const c = iso.trim().toUpperCase();
  if (!c) return "Sem país";
  try {
    return new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(c) || c;
  } catch {
    return c;
  }
}

/**
 * DE ONDE vieram os cliques — de uma página ou de um PopLink.
 *
 * O país já vinha em todo evento da SLT e já estava gravado; só nunca tinha
 * sido lido. Não custa consulta à SLT: sai do histórico local, que o painel
 * guarda sem prazo (a janela de 7 dias é da API, não daqui).
 *
 * Fica atrás de um botão, e não no card, porque é pergunta de vez em quando:
 * o card responde "quanto", isto responde "de onde". Buscar só ao abrir
 * também é o que impede a carga da tela de crescer por país × página.
 */
function DialogoPaises({
  alvo,
  period,
  onFechar,
}: {
  alvo: AlvoDoDetalhe | null;
  period: PeriodState;
  onFechar: () => void;
}) {
  const [linhas, setLinhas] = useState<PaisRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!alvo) return;
    setLinhas(null);
    setErro(null);
    const q = new URLSearchParams({
      tipo: alvo.tipo,
      id: alvo.id,
      slug: alvo.slug,
    });
    apiGet<{ paises: PaisRow[] }>(`/api/links/detalhes?${q}&${periodQuery(period)}`)
      .then((d) => setLinhas(d.paises || []))
      .catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar."));
  }, [alvo, period]);

  if (!alvo) return null;

  const totalCliques = (linhas || []).reduce((s, l) => s + l.clicks, 0);
  const totalViews = (linhas || []).reduce((s, l) => s + l.views, 0);
  // PopLink não tem visualização — não passa por página nenhuma. A coluna só
  // aparece onde ela quer dizer alguma coisa.
  const temViews = alvo.tipo === "page";

  return (
    <Modal open onClose={onFechar}>
      <p className="eyebrow">de onde vieram</p>
      <h2 className="mt-1 font-display text-lg text-white">{alvo.titulo}</h2>
      <p className="mt-0.5 font-mono text-[11px] text-zinc-600">{alvo.subtitulo}</p>

      {erro && <p className="mt-4 text-sm text-red-300">{erro}</p>}

      {!linhas && !erro && (
        <div className="mt-4 space-y-2">
          <div className="h-6 animate-pulse rounded bg-white/[0.03]" />
          <div className="h-6 animate-pulse rounded bg-white/[0.03]" />
          <div className="h-6 animate-pulse rounded bg-white/[0.03]" />
        </div>
      )}

      {linhas && linhas.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">
          Nenhum clique ou visita neste período.
        </p>
      )}

      {linhas && linhas.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-zinc-600">
            <span className="flex-1">país</span>
            {temViews && <span className="w-12 text-right">views</span>}
            <span className="w-12 text-right">cliques</span>
            <span className="w-10 text-right">%</span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {linhas.map((l) => (
              <div
                key={l.country || "sem"}
                className="flex items-center gap-2 border-t border-white/[0.06] py-1.5 text-xs"
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span aria-hidden>{bandeira(l.country)}</span>
                  <span className="truncate text-zinc-200">{nomeDoPais(l.country)}</span>
                </span>
                {temViews && (
                  <span className="w-12 text-right font-mono text-zinc-400">{nBR(l.views)}</span>
                )}
                <span className="w-12 text-right font-mono text-zinc-200">{nBR(l.clicks)}</span>
                <span className="w-10 text-right font-mono text-sky-400">
                  {pct(l.clicks, totalCliques)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2 text-xs">
            <span className="flex-1 text-zinc-500">
              {linhas.length} {linhas.length === 1 ? "país" : "países"}
            </span>
            {temViews && (
              <span className="w-12 text-right font-mono text-zinc-400">{nBR(totalViews)}</span>
            )}
            <span className="w-12 text-right font-mono text-white">{nBR(totalCliques)}</span>
            <span className="w-10" />
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button type="button" className="btn-ghost" onClick={onFechar}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

/**
 * Modelo e rede de UM alvo — uma página do SLT ou um PopLink.
 *
 * O mesmo diálogo para os dois porque é a mesma pergunta ("de quem é isto, e
 * por qual rede chega?"), respondida na mesma tabela. Só o que se escreve no
 * cabeçalho e a chave gravada mudam — e os dois vêm prontos no `alvo`.
 */
function DialogoEditar({
  alvo,
  profiles,
  networks,
  salvando,
  onFechar,
  onSalvar,
}: {
  alvo: AlvoDaConfig | null;
  profiles: { id: string; name: string }[];
  networks: SltNetwork[];
  salvando: boolean;
  onFechar: () => void;
  onSalvar: (chave: string, patch: { profileId: string; trafficSource: string }) => void;
}) {
  const [profileId, setProfileId] = useState("");
  const [rede, setRede] = useState("");

  useEffect(() => {
    setProfileId(alvo?.profileId || "");
    setRede(alvo?.trafficSource || "");
  }, [alvo]);

  if (!alvo) return null;

  return (
    <Modal open onClose={onFechar}>
      <p className="eyebrow">{alvo.rotulo}</p>
      <h2 className="mt-1 font-display text-lg text-white">{alvo.titulo}</h2>
      <p className="mt-0.5 font-mono text-[11px] text-zinc-600">{alvo.subtitulo}</p>

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
            É a rede que traz o lead — usada para separar o tráfego no Funil de Vendas.
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
          onClick={() => onSalvar(alvo.chave, { profileId, trafficSource: rede })}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
