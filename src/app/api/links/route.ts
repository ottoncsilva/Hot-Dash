import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser, ApiError } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import { listProfiles } from "@/lib/profiles";
import { fetchSltCatalogue } from "@/lib/sltSync";
import { sltPageStats } from "@/lib/salesFunnel";
import { SLT_NETWORKS } from "@/lib/sltNetworks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JANELA_PADRAO_DIAS = 30;

/**
 * Tela de Links: o catálogo de páginas/links do SLT (ao vivo — muda pouco,
 * não vale a pena manter cópia local), com clique/visualização dos últimos
 * dias (local, já sincronizado — ver `lib/sltSync.ts`) e agrupado por
 * MODELO do Hot-Dash via `slt_page_profiles` (ver POST abaixo).
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const dias = Number(req.nextUrl.searchParams.get("days")) || JANELA_PADRAO_DIAS;
    const sinceMs = Date.now() - dias * 24 * 60 * 60 * 1000;

    const catalogo = await fetchSltCatalogue().catch((e) => {
      throw new ApiError(502, e instanceof Error ? e.message : "Falha ao consultar o SLT.");
    });
    if (!catalogo) {
      return NextResponse.json({ connected: false, groups: [] });
    }

    const profiles = await listProfiles();
    const stats = new Map(sltPageStats(sinceMs, null).map((s) => [s.pageSlug, s]));
    const mapa = getDb()
      .prepare("SELECT page_id, profile_id, traffic_source FROM slt_page_profiles")
      .all() as { page_id: string; profile_id: string | null; traffic_source: string | null }[];
    const profileDoPage = new Map(mapa.map((m) => [m.page_id, m.profile_id]));
    const redeDoPage = new Map(mapa.map((m) => [m.page_id, m.traffic_source]));

    const linksPorPagina = new Map<string, typeof catalogo.links>();
    for (const l of catalogo.links) {
      if (!l.page_id) continue; // PopLink solto, sem página — não entra no agrupamento por página
      const lista = linksPorPagina.get(l.page_id) || [];
      lista.push(l);
      linksPorPagina.set(l.page_id, lista);
    }

    const paginas = catalogo.pages.map((p) => {
      const s = stats.get(p.slug);
      return {
        pageId: p.id,
        slug: p.slug,
        displayName: p.display_name,
        label: p.label || "",
        published: p.published !== false,
        activeDomain: p.active_domain || "",
        links: (linksPorPagina.get(p.id) || []).map((l) => ({
          id: l.id,
          label: l.label,
          url: l.url,
          platform: l.platform,
        })),
        views: s?.views || 0,
        clicks: s?.clicks || 0,
        profileId: profileDoPage.get(p.id) || null,
        trafficSource: redeDoPage.get(p.id) || null,
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
      windowDays: dias,
      profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
      groups,
      unassigned: semModelo,
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
    if (trafficSource && !SLT_NETWORKS.some((n) => n.key === trafficSource)) {
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
