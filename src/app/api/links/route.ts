import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser, ApiError } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import { listProfiles } from "@/lib/profiles";
import { getSltCatalogue } from "@/lib/sltSync";
import { sltPageStats, sltLinkClicks, sltPoplinkClicks } from "@/lib/salesFunnel";
import { isValidSltNetworkKey, listSltNetworks } from "@/lib/sltNetworksStore";
import { codigosDeRastreio } from "@/lib/rastreio";
import { getAppTimeZone } from "@/lib/settings";
import { resolvePeriod } from "@/lib/periodRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O código de rastreio que ESTE link carrega — `t.me/<bot>?start=CODIGO`.
 *
 * É a única ligação confiável entre um link do SLT e o dinheiro que ele
 * trouxe. A tentação era casar pelo slug da página ("adriana2"), mas o slug
 * é o endereço da página e o código é escolhido à parte ("insta2"): os dois
 * quase nunca são a mesma palavra, e o cruzamento por slug erra calado.
 *
 * Link sem `?start=` (convite de grupo `t.me/+ABC`, site, qualquer outra
 * coisa) devolve null e a tela mostra "sem código" — é honesto: aquele
 * clique existe, mas não há como segui-lo até a venda.
 */
function codigoDoLink(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)t\.me$/i.test(u.hostname) && !/(^|\.)telegram\.me$/i.test(u.hostname)) return null;
    const bruto = (u.searchParams.get("start") || u.searchParams.get("startgroup") || "").trim();
    const limpo = bruto.replace(/[^\w-]/g, "").slice(0, 40);
    return limpo || null;
  } catch {
    return null;
  }
}

/**
 * Tela de Links: o catálogo de páginas/links do SLT (lido do banco, gravado
 * pelo job de fundo — ver `syncSltCatalogue`), com clique/visualização do período
 * escolhido (local, já sincronizado — ver `lib/sltSync.ts`) e agrupado por
 * MODELO do Hot-Dash via `slt_page_profiles` (ver POST abaixo).
 *
 * O período usa o MESMO seletor do Dashboard/Financeiro/Funil de Vendas
 * (`resolvePeriod`) — comparar "últimos 7 dias" aqui com o painel da própria
 * SLT só faz sentido se as duas contarem os mesmos 7 dias.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const tz = getAppTimeZone();
    const { period, range } = resolvePeriod(
      req.nextUrl.searchParams.get("period"),
      req.nextUrl.searchParams.get("from"),
      req.nextUrl.searchParams.get("to"),
      tz,
    );

    const catalogo = await getSltCatalogue().catch((e) => {
      throw new ApiError(502, e instanceof Error ? e.message : "Falha ao consultar o SLT.");
    });
    if (!catalogo) {
      return NextResponse.json({ connected: false, groups: [] });
    }

    const profiles = await listProfiles();
    const stats = new Map(sltPageStats(range.since, range.until).map((s) => [s.pageSlug, s]));
    // Cliques por LINK (não só por página) — chave página+URL, mesmo par
    // que casa com o catálogo abaixo.
    const cliquesPorLink = new Map(sltLinkClicks(range.since, range.until).map((s) => [`${s.pageId}|${s.linkUrl}`, s.clicks]));
    // Venda por CÓDIGO de rastreio, do mesmo período — é o que transforma
    // "esse link levou 187 cliques" em "esse link fez R$ 76". Vem pronto de
    // `codigosDeRastreio`, a mesma fonte da tela Códigos de rastreio, então
    // as duas telas nunca contam diferente.
    const rastreio = codigosDeRastreio(range.since, range.until);
    const vendaPorPerfilCodigo = new Map<string, { sales: number; cents: number }>();
    const vendaPorCodigo = new Map<string, { sales: number; cents: number }>();
    for (const r of rastreio) {
      if (!r.code) continue;
      const c = r.code.toLowerCase();
      const doPerfil = vendaPorPerfilCodigo.get(`${r.profileId || ""}|${c}`) || { sales: 0, cents: 0 };
      doPerfil.sales += r.pagos;
      doPerfil.cents += r.paidCents;
      vendaPorPerfilCodigo.set(`${r.profileId || ""}|${c}`, doPerfil);
      const total = vendaPorCodigo.get(c) || { sales: 0, cents: 0 };
      total.sales += r.pagos;
      total.cents += r.paidCents;
      vendaPorCodigo.set(c, total);
    }

    const mapa = getDb()
      .prepare("SELECT page_id, profile_id, traffic_source FROM slt_page_profiles")
      .all() as { page_id: string; profile_id: string | null; traffic_source: string | null }[];
    const profileDoPage = new Map(mapa.map((m) => [m.page_id, m.profile_id]));
    const redeDoPage = new Map(mapa.map((m) => [m.page_id, m.traffic_source]));

    const linksPorPagina = new Map<string, typeof catalogo.links>();
    const poplinks: typeof catalogo.links = [];
    for (const l of catalogo.links) {
      // PopLink não tem página: é o link curto (igpopl.ink) que manda direto
      // para o destino, sem botões no meio. Vai para a lista dele.
      if (l.type === "poplink" || !l.page_id) {
        poplinks.push(l);
        continue;
      }
      const lista = linksPorPagina.get(l.page_id) || [];
      lista.push(l);
      linksPorPagina.set(l.page_id, lista);
    }

    const paginas = catalogo.pages.map((p) => {
      const s = stats.get(p.slug);
      const perfilDaPagina = profileDoPage.get(p.id) || null;
      return {
        pageId: p.id,
        slug: p.slug,
        displayName: p.display_name,
        label: p.label || "",
        published: p.published !== false,
        activeDomain: p.active_domain || "",
        links: (linksPorPagina.get(p.id) || []).map((l) => {
          const code = codigoDoLink(l.url);
          // Página COM modelo só olha a venda daquela modelo: o mesmo código
          // ("previas", "insta1") é reusado por várias, e somar todas aqui
          // creditaria a uma o que outra vendeu. Sem modelo atribuída, aí sim
          // o total do código é a melhor resposta disponível.
          const venda = code
            ? perfilDaPagina
              ? vendaPorPerfilCodigo.get(`${perfilDaPagina}|${code.toLowerCase()}`)
              : vendaPorCodigo.get(code.toLowerCase())
            : undefined;
          return {
            id: l.id,
            label: l.label,
            url: l.url,
            platform: l.platform,
            clicks: cliquesPorLink.get(`${p.id}|${l.url}`) || 0,
            code,
            sales: venda?.sales || 0,
            revenueCents: venda?.cents || 0,
          };
        }),
        views: s?.views || 0,
        clicks: s?.clicks || 0,
        profileId: perfilDaPagina,
        trafficSource: redeDoPage.get(p.id) || null,
      };
    });

    /**
     * OS POPLINKS. Um por vez, sem página em volta.
     *
     * A única métrica que existe para eles é o CLIQUE — o PopLink não tem
     * página nem botões, então não há visualização nem revelação para contar
     * (ver `sltPoplinkClicks`). O que os coloca no mesmo pé dos outros links
     * é o `?start=` do destino: quando ele existe, o clique dá para seguir
     * até a venda exatamente como o de um link de página.
     *
     * A atribuição de modelo e rede reusa `slt_page_profiles` com a chave
     * `poplink:<id>`: é a mesma pergunta ("de quem é isto?") e o mesmo
     * diálogo na tela — o prefixo só impede que um id de PopLink se
     * confunda com um id de página.
     */
    const cliquesPorId = new Map<string, number>();
    const cliquesPorSlug = new Map<string, number>();
    for (const c of sltPoplinkClicks(range.since, range.until)) {
      if (c.poplinkId) cliquesPorId.set(c.poplinkId, (cliquesPorId.get(c.poplinkId) || 0) + c.clicks);
      // Evento gravado antes de a coluna do id existir: só o apelido
      // identifica. Some com o do id quando os dois apontam para o mesmo.
      else if (c.poplinkSlug)
        cliquesPorSlug.set(c.poplinkSlug, (cliquesPorSlug.get(c.poplinkSlug) || 0) + c.clicks);
    }
    const poplinksSaida = poplinks.map((l) => {
      const chave = `poplink:${l.id}`;
      const perfil = profileDoPage.get(chave) || null;
      const code = codigoDoLink(l.url);
      const venda = code
        ? perfil
          ? vendaPorPerfilCodigo.get(`${perfil}|${code.toLowerCase()}`)
          : vendaPorCodigo.get(code.toLowerCase())
        : undefined;
      return {
        id: l.id,
        slug: l.label,
        // O endereço que se divulga. A API manda pronto; se faltar, monta-se
        // do apelido, que é o que ele é.
        shortUrl: l.poplink_url || `https://igpopl.ink/${l.label}`,
        url: l.url,
        clicks: (cliquesPorId.get(l.id) || 0) + (cliquesPorSlug.get(l.label) || 0),
        code,
        sales: venda?.sales || 0,
        revenueCents: venda?.cents || 0,
        profileId: perfil,
        trafficSource: redeDoPage.get(chave) || null,
        shieldEnabled: l.shield_enabled === true,
        blockedCountries: l.blocked_countries || [],
      };
    });

    const porProfile = new Map(profiles.map((p) => [p.id, { profileId: p.id, profileName: p.name, pages: [] as typeof paginas }]));
    const semModelo: typeof paginas = [];
    for (const p of paginas) {
      const grupo = p.profileId ? porProfile.get(p.profileId) : undefined;
      if (grupo) grupo.pages.push(p);
      else semModelo.push(p);
    }

    const groups = [...porProfile.values()].filter((g) => g.pages.length > 0);
    groups.sort((a, b) => a.profileName.localeCompare(b.profileName, "pt-BR"));

    return NextResponse.json({
      connected: true,
      period,
      profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
      networks: listSltNetworks(),
      groups,
      unassigned: semModelo,
      poplinks: poplinksSaida,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Atribui (ou reatribui) uma página do SLT — modelo e/ou rede de tráfego,
 * cada campo INDEPENDENTE do outro (manda só o que mudou; o campo ausente
 * no corpo mantém o que já estava salvo — só uma string vazia LIMPA aquele
 * campo específico).
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
    if (!pageId) throw new ApiError(400, "Informe pageId.");

    const db = getDb();
    const atual = db
      .prepare("SELECT profile_id, traffic_source FROM slt_page_profiles WHERE page_id = ?")
      .get(pageId) as { profile_id: string | null; traffic_source: string | null } | undefined;

    const profileId =
      typeof body.profileId === "string" ? body.profileId.trim() || null : (atual?.profile_id ?? null);
    const trafficSource =
      typeof body.trafficSource === "string"
        ? body.trafficSource.trim() || null
        : (atual?.traffic_source ?? null);

    if (profileId) {
      const existe = db.prepare("SELECT id FROM profiles WHERE id = ?").get(profileId);
      if (!existe) throw new ApiError(404, "Modelo não encontrada.");
    }
    if (trafficSource && !isValidSltNetworkKey(trafficSource)) {
      throw new ApiError(400, "Rede desconhecida.");
    }

    if (!profileId && !trafficSource) {
      // Os dois campos vazios: não há mais nada pra guardar sobre esta página.
      db.prepare("DELETE FROM slt_page_profiles WHERE page_id = ?").run(pageId);
      return NextResponse.json({ ok: true });
    }

    db.prepare(
      `INSERT INTO slt_page_profiles (page_id, profile_id, traffic_source, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET
         profile_id = excluded.profile_id,
         traffic_source = excluded.traffic_source,
         updated_at = excluded.updated_at`,
    ).run(pageId, profileId, trafficSource, Date.now());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
