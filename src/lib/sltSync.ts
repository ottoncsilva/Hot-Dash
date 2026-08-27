import "server-only";
import { getDb } from "./db";
import { getSltApiKey, setSltSyncState, getSltSyncState } from "./settings";

/**
 * Integração com a API do SLT (slt.bio, link na bio) — somente leitura, uma
 * conta cobre todas as modelos (ver `settings.ts`).
 *
 * Duas formas de uso:
 *   • `syncSltEvents` — roda no tick de fundo (ver `instrumentation.ts`),
 *     puxa só o que é NOVO (cursor `since`/`next_since`, devolvido pela
 *     própria API) e grava em `slt_events`. É o que alimenta os números de
 *     visualização/clique no Funil de Vendas e na tela de Links.
 *   • `fetchSltCatalogue` — chamada AO VIVO quando o operador abre a tela de
 *     Links: páginas e links mudam pouco (o operador edita no próprio SLT),
 *     então não vale a pena guardar cópia local só pra ela poder ficar
 *     desatualizada. Duas chamadas por visita não chegam perto do limite de
 *     60/hora.
 */

const SLT_API_BASE = "https://api.slt.bio";

/** "Toda hora reseta a janela (UTC)" — a própria SLT recomenda 15 minutos
 *  pra quem faz polling (Zapier/Sheets); aqui vale o mesmo, com uma folga de
 *  1 minuto porque o tick de fundo roda a cada 60s e não bate exato na
 *  marca. */
const POLL_INTERVAL_MS = 14 * 60 * 1000;

/** Nunca deixa um sync sem fim: cada página é uma requisição a mais gasta da
 *  cota de 60/hora, e um cursor que nunca avança (bug do lado de lá, ou um
 *  volume de eventos maior que o esperado) não pode consumir a hora
 *  inteira de uma vez. */
const MAX_PAGES_PER_SYNC = 5;

export type SltEvent = {
  created_at: string;
  event_type: "page_viewed" | "link_revealed" | "link_clicked" | "poplink_click" | string;
  link_id?: string | null;
  page_id?: string | null;
  country?: string | null;
  referer?: string | null;
  domain?: string | null;
  source?: string | null;
  page_slug?: string | null;
  page_display_name?: string | null;
  link_url?: string | null;
  link_label?: string | null;
  link_platform?: string | null;
  poplink_id?: string | null;
  poplink_slug?: string | null;
};

type SltLink = {
  type: "link" | "poplink";
  id: string;
  page_id: string | null;
  url: string;
  label: string;
  platform: string;
  created_at: string;
  poplink_url?: string;
};

type SltPage = {
  id: string;
  slug: string;
  display_name: string;
  label?: string;
  active_domain?: string;
  published?: boolean;
};

class SltApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function sltFetch<T>(apiKey: string, path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, SLT_API_BASE);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    // A API é externa e a rota que chama isto (Next.js) não pode cachear uma
    // resposta que muda a cada poll.
    cache: "no-store",
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new SltApiError(`SLT ${path} → HTTP ${res.status}: ${texto.slice(0, 200)}`, res.status);
  }
  return res.json() as Promise<T>;
}

/** Monta o `id` local — a SLT não manda um id próprio de evento. Os campos
 *  que juntos identificam UM evento (instante + tipo + o link/poplink
 *  envolvido) bastam: um replay do mesmo `since` (a borda pode repetir,
 *  documentado pela própria SLT) gera o MESMO id, e `INSERT OR IGNORE`
 *  descarta em vez de duplicar. */
function idDoEvento(e: SltEvent): string {
  return [e.created_at, e.event_type, e.link_id || "", e.poplink_id || "", e.page_id || ""].join("|");
}

function gravarEventos(eventos: SltEvent[]): number {
  if (eventos.length === 0) return 0;
  const db = getDb();
  const agora = Date.now();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO slt_events
       (id, created_at, event_type, page_id, page_slug, page_display_name, link_label, link_url, link_platform, poplink_slug, referer, country, domain, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const inserir = db.transaction((linhas: SltEvent[]) => {
    let gravados = 0;
    for (const e of linhas) {
      const ts = Date.parse(e.created_at);
      if (!Number.isFinite(ts)) continue; // linha malformada — pula, não derruba o lote
      const info = stmt.run(
        idDoEvento(e),
        ts,
        e.event_type,
        e.page_id || null,
        e.page_slug || null,
        e.page_display_name || null,
        e.link_label || null,
        e.link_url || null,
        e.link_platform || null,
        e.poplink_slug || null,
        e.referer || null,
        e.country || null,
        e.domain || null,
        agora,
      );
      if (info.changes > 0) gravados++;
    }
    return gravados;
  });
  return inserir(eventos);
}

/**
 * Puxa os eventos NOVOS desde a última sincronização e grava.
 *
 * Sem chave configurada, é um no-op silencioso — a integração é opcional, e
 * o tick de fundo chama isto sempre, ligada ou não. `force` pula a
 * trava dos 15 minutos (usado pelo botão "Sincronizar agora" da tela de
 * Configurações).
 */
export async function syncSltEvents(opts?: { force?: boolean }): Promise<{
  ok: boolean;
  synced: number;
  skipped?: "no_api_key" | "throttled";
  error?: string;
}> {
  const apiKey = getSltApiKey();
  if (!apiKey) return { ok: true, synced: 0, skipped: "no_api_key" };

  const estado = getSltSyncState();
  if (!opts?.force && estado.lastPolledAt && Date.now() - estado.lastPolledAt < POLL_INTERVAL_MS) {
    return { ok: true, synced: 0, skipped: "throttled" };
  }

  let cursor = estado.sinceCursor;
  let totalGravados = 0;
  let ultimoCreatedAt: number | undefined;

  try {
    for (let pagina = 0; pagina < MAX_PAGES_PER_SYNC; pagina++) {
      const resp = await sltFetch<{ events: SltEvent[]; next_since?: string }>(
        apiKey,
        "/v1/events",
        cursor ? { since: cursor } : undefined,
      );
      totalGravados += gravarEventos(resp.events);
      for (const e of resp.events) {
        const ts = Date.parse(e.created_at);
        if (Number.isFinite(ts)) ultimoCreatedAt = Math.max(ultimoCreatedAt ?? 0, ts);
      }

      const proximo = resp.next_since;
      // Sem `next_since`, sem progresso (mesmo cursor de volta), ou lote
      // vazio: acabou o que tinha pra pegar agora. Continuar bateria na
      // mesma página pra sempre.
      if (!proximo || proximo === cursor || resp.events.length === 0) {
        cursor = proximo || cursor;
        break;
      }
      cursor = proximo;
    }

    setSltSyncState({
      sinceCursor: cursor,
      lastSyncedAt: ultimoCreatedAt,
      lastPolledAt: Date.now(),
      lastSyncError: null,
    });
    return { ok: true, synced: totalGravados };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha desconhecida.";
    setSltSyncState({ lastPolledAt: Date.now(), lastSyncError: msg });
    return { ok: false, synced: totalGravados, error: msg };
  }
}

/** Catálogo AO VIVO — páginas + links, pra tela de Links. */
export async function fetchSltCatalogue(): Promise<{ pages: SltPage[]; links: SltLink[] } | null> {
  const apiKey = getSltApiKey();
  if (!apiKey) return null;
  const [pagesResp, linksResp] = await Promise.all([
    sltFetch<{ pages: SltPage[] }>(apiKey, "/v1/pages"),
    sltFetch<{ links: SltLink[] }>(apiKey, "/v1/links"),
  ]);
  return { pages: pagesResp.pages, links: linksResp.links };
}

/** Confere a chave batendo em `/v1/me` — usado ao salvar, pra não deixar
 *  uma chave inválida/revogada parecer salva com sucesso. */
export async function testSltApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await sltFetch(apiKey, "/v1/me");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha desconhecida." };
  }
}
