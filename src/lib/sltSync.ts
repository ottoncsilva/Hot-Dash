import "server-only";
import { getDb } from "./db";
import {
  getSltApiKey,
  setSltSyncState,
  getSltSyncState,
  getSltCatalogueStored,
  setSltCatalogueStored,
  getSltCotaStored,
  setSltCotaStored,
} from "./settings";

/**
 * Integração com a API do SLT (slt.bio, link na bio) — somente leitura, uma
 * conta cobre todas as modelos (ver `settings.ts`).
 *
 * Duas formas de uso:
 *   • `syncSltEvents` — roda no tick de fundo (ver `instrumentation.ts`),
 *     puxa só o que é NOVO (cursor `since`/`next_since`, devolvido pela
 *     própria API) e grava em `slt_events`. É o que alimenta os números de
 *     visualização/clique no Funil de Vendas e na tela de Links.
 *   • `syncSltCatalogue` — também no tick de fundo, em intervalo próprio
 *     (15 min): guarda páginas e links no banco. A tela de Links lê de lá
 *     (`getSltCatalogue`) sem tocar na rede, então o custo em cota é fixo e
 *     não depende de quantas telas forem abertas nem de quantas vezes o
 *     operador trocar o período.
 */

const SLT_API_BASE = "https://api.slt.bio";

/**
 * CADÊNCIA E COTA. A documentação da SLT diz 60 requisições/hora por chave,
 * numa janela FIXA que zera no topo de cada hora (UTC), e recomenda 15
 * minutos para quem faz polling. Uma medição antiga do
 * `X-RateLimit-Limit` tinha indicado 300/h e o intervalo daqui foi
 * calibrado por ela — com 60/h aquela conta não fecha: 20 ciclos/hora × 2
 * requisições por ciclo (ver o laço em `syncSltEvents`: quando há evento
 * novo, a segunda chamada é o que descobre que acabou) davam 40/h só de
 * fundo, sobrando 20 para a tela de Links, que gasta 2 por carregamento.
 *
 * Em vez de confiar em qualquer um dos dois números, agora o módulo LÊ a
 * cota de toda resposta (`registrarCota`) e se regula sozinho. O intervalo
 * de 5 minutos é o piso: 12 ciclos/hora, no máximo 24 requisições, o que
 * deixa a maior parte da cota livre para o uso interativo, seja ela 60 ou
 * 300.
 */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Nunca deixa um sync sem fim: cada página é uma requisição a mais gasta da
 *  cota da hora, e um cursor que nunca avança (bug do lado de lá, ou um
 *  volume de eventos maior que o esperado) não pode consumir a cota
 *  inteira de uma vez. */
const MAX_PAGES_PER_SYNC = 5;

/** Quanto da cota o sync de FUNDO deixa intocado para o operador. Sem esta
 *  reserva, o laço de fundo podia zerar a hora sozinho e a tela de Links
 *  abria quebrada — o pior jeito de gastar a última requisição. */
const RESERVA_PARA_A_TELA = 12;

/** O catálogo recua ANTES do sync de eventos, e de propósito: perder uma
 *  volta dele não custa nada (ele se refaz na volta seguinte, e a tela
 *  continua lendo do banco enquanto isso), enquanto evento não puxado a
 *  tempo some de vez — a API só guarda os últimos 7 dias. Quando a cota
 *  aperta, quem cede é o catálogo. */
const RESERVA_CATALOGO = 24;

/** De quanto em quanto tempo o job de fundo refaz o catálogo. Intervalo bem
 *  mais longo que o dos eventos de propósito: páginas e links só mudam
 *  quando o operador edita no painel da SLT, enquanto evento é fluxo
 *  contínuo. São 8 req/hora fixas (2 por sincronização), independente de
 *  quantas telas forem abertas — somadas ao sync de eventos (12 a 24/hora),
 *  dão 20 a 32 das 60 documentadas, com folga confortável. */
const CATALOGO_INTERVALO_MS = 15 * 60 * 1000;

/** Lê `X-RateLimit-*` de qualquer resposta (inclusive a de erro, que é
 *  justamente quando o número importa) e GRAVA no banco — nada em memória,
 *  para o estado sobreviver a um deploy. */
function registrarCota(res: Response): void {
  const atual = getSltCotaStored();
  const restante = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const novo = {
    restante: Number.isFinite(restante) ? restante : atual.restante,
    // O cabeçalho vem em segundos unix; guardamos em ms para comparar com
    // Date.now() sem conversão espalhada pelo arquivo.
    resetaEm: Number.isFinite(reset) && reset > 0 ? reset * 1000 : atual.resetaEm,
  };
  if (novo.restante !== atual.restante || novo.resetaEm !== atual.resetaEm) setSltCotaStored(novo);
}

/** Já sabemos que não há cota agora? Vale tanto para a espera pós-429 quanto
 *  para a reserva do sync de fundo. */
function semCota(reserva: number): boolean {
  const { restante, resetaEm } = getSltCotaStored();
  if (restante === null) return false; // ainda não medimos: deixa passar
  if (resetaEm !== null && Date.now() >= resetaEm) return false; // já virou a janela
  return restante <= reserva;
}

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
  /** Uma sessão pode mandar VÁRIOS "page_viewed" pro mesmo carregamento de
   *  página (reload do navegador embutido de Instagram/TikTok, troca de
   *  aba) — é o que `sltPageStats`/`sltViewsClicks` usam pra contar
   *  visualização por sessão única, não por ping. */
  session_id?: string | null;
};

export type SltLink = {
  type: "link" | "poplink";
  id: string;
  page_id: string | null;
  url: string;
  label: string;
  platform: string;
  created_at: string;
  poplink_url?: string;
};

export type SltPage = {
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
  registrarCota(res);
  if (!res.ok) {
    // 429 sem cabeçalho de reset: assume que a janela vira no topo da hora
    // seguinte, que é como a SLT documenta (janela fixa, não deslizante).
    if (res.status === 429) {
      const atual = getSltCotaStored();
      let resetaEm = atual.resetaEm;
      if (resetaEm === null || resetaEm <= Date.now()) {
        const proximaHora = new Date();
        proximaHora.setUTCMinutes(0, 0, 0);
        resetaEm = proximaHora.getTime() + 60 * 60 * 1000;
      }
      setSltCotaStored({ restante: 0, resetaEm });
    }
    const texto = await res.text().catch(() => "");
    throw new SltApiError(`SLT ${path} → HTTP ${res.status}: ${texto.slice(0, 200)}`, res.status);
  }
  return res.json() as Promise<T>;
}

/** Monta o `id` local — a SLT não manda um id próprio de evento. Os campos
 *  que juntos identificam UM evento (instante + tipo + o link/poplink
 *  envolvido) bastam: um replay do mesmo `since` (a borda pode repetir,
 *  documentado pela própria SLT) gera o MESMO id, e `INSERT OR IGNORE`
 *  descarta em vez de duplicar.
 *
 *  A sessão entra na chave quando existe. Sem ela, dois VISITANTES DIFERENTES
 *  abrindo a mesma página no mesmo segundo geram a mesma chave e o segundo é
 *  descartado como se fosse replay — visualização a menos, silenciosamente.
 *  Só entra SE existe, de propósito: evento sem sessão mantém exatamente a
 *  chave que já tem hoje, então nada do que já está gravado pode duplicar. */
function idDoEvento(e: SltEvent): string {
  const base = [e.created_at, e.event_type, e.link_id || "", e.poplink_id || "", e.page_id || ""].join("|");
  return e.session_id ? `${base}|${e.session_id}` : base;
}

function gravarEventos(eventos: SltEvent[]): number {
  if (eventos.length === 0) return 0;
  const db = getDb();
  const agora = Date.now();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO slt_events
       (id, created_at, event_type, page_id, page_slug, page_display_name, link_label, link_url, link_platform, poplink_slug, referer, country, domain, synced_at, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        e.session_id || null,
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
  skipped?: "no_api_key" | "throttled" | "sem_cota";
  error?: string;
}> {
  const apiKey = getSltApiKey();
  if (!apiKey) return { ok: true, synced: 0, skipped: "no_api_key" };

  const estado = getSltSyncState();
  if (!opts?.force && estado.lastPolledAt && Date.now() - estado.lastPolledAt < POLL_INTERVAL_MS) {
    return { ok: true, synced: 0, skipped: "throttled" };
  }
  // Cota no fim (ou 429 ainda valendo): nem tenta. Insistir a cada ciclo
  // não adianta — a janela da SLT é fixa e só vira no topo da hora — e a
  // reserva garante que a tela de Links ainda abre. Não marca
  // `lastPolledAt`: assim que a cota voltar, o próximo tick já sincroniza.
  // "Sincronizar agora" é o operador pedindo: pode usar a reserva, que
  // existe justamente para ele. Só a cota REALMENTE zerada o segura.
  if (semCota(opts?.force ? 0 : RESERVA_PARA_A_TELA)) {
    return { ok: true, synced: 0, skipped: "sem_cota" };
  }

  let cursor = estado.sinceCursor;
  let totalGravados = 0;
  let ultimoCreatedAt: number | undefined;

  try {
    for (let pagina = 0; pagina < MAX_PAGES_PER_SYNC; pagina++) {
      // A cota pode acabar no meio da paginação: para aqui e guarda o cursor
      // já avançado, para o próximo ciclo continuar de onde parou.
      if (pagina > 0 && semCota(RESERVA_PARA_A_TELA)) break;
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

export type Catalogo = { pages: SltPage[]; links: SltLink[] };

/**
 * Sincroniza o catálogo (páginas + links) e GRAVA no banco — roda no tick de
 * fundo, junto do sync de eventos.
 *
 * Antes a tela de Links chamava a API a cada carregamento, e o catálogo nem
 * depende do período escolhido: passar pelos 8 botões do seletor gastava 16
 * requisições em segundos. Um cache em memória resolveria pela metade — ele
 * morre a cada deploy e o custo continuaria dependendo do uso. Sincronizando
 * de fundo, o gasto vira fixo (8 req/hora) e a tela nunca espera rede nem
 * quebra por falta de cota.
 *
 * Nunca lança: é uma tarefa do agendador como as outras.
 */
export async function syncSltCatalogue(opts?: { force?: boolean }): Promise<Catalogo | null> {
  const apiKey = getSltApiKey();
  if (!apiKey) return null;

  const guardado = getSltCatalogueStored();
  if (!opts?.force && guardado && Date.now() - guardado.syncedAt < CATALOGO_INTERVALO_MS) {
    return { pages: guardado.pages as SltPage[], links: guardado.links as SltLink[] };
  }
  // Reserva MAIOR que a do sync de eventos: com a cota apertando, o catálogo
  // é o primeiro a ceder (ver `RESERVA_CATALOGO`). Com algo guardado,
  // devolve o que tem.
  if (semCota(opts?.force ? 0 : RESERVA_CATALOGO)) {
    return guardado ? { pages: guardado.pages as SltPage[], links: guardado.links as SltLink[] } : null;
  }

  try {
    const [pagesResp, linksResp] = await Promise.all([
      sltFetch<{ pages: SltPage[] }>(apiKey, "/v1/pages"),
      sltFetch<{ links: SltLink[] }>(apiKey, "/v1/links"),
    ]);
    const dados = { pages: pagesResp.pages || [], links: linksResp.links || [] };
    setSltCatalogueStored({ ...dados, syncedAt: Date.now() });
    return dados;
  } catch (e) {
    console.error("[hotdash] Erro sincronizando o catálogo do SLT:", e instanceof Error ? e.message : e);
    // Falhou agora não pode apagar o que já estava certo.
    return guardado ? { pages: guardado.pages as SltPage[], links: guardado.links as SltLink[] } : null;
  }
}

/**
 * O catálogo para a TELA — lê do banco, sem tocar na rede. Só vai à API no
 * caso de nunca ter sincronizado (chave recém-configurada, banco novo), para
 * a tela não nascer vazia esperando o primeiro tick.
 */
export async function getSltCatalogue(): Promise<Catalogo | null> {
  if (!getSltApiKey()) return null;
  const guardado = getSltCatalogueStored();
  if (guardado) return { pages: guardado.pages as SltPage[], links: guardado.links as SltLink[] };
  return syncSltCatalogue({ force: true });
}

/**
 * A SLT está mandando `session_id` nos eventos?
 *
 * A pergunta importa porque `sltViewsClicks`/`sltPageStats` contam
 * visualização como `COUNT(DISTINCT COALESCE(session_id, id))`. Com sessão,
 * isso é VISITANTE ÚNICO: a mesma pessoa recarregando a página (o navegador
 * embutido do Instagram/TikTok faz isso sozinho) conta uma vez. Sem sessão,
 * cai no id do evento e passa a contar CADA CARREGAMENTO — o número fica
 * mais alto que o de gente de verdade, e a taxa de conversão do funil, mais
 * baixa. O campo não está na documentação pública da SLT, então a única
 * forma de saber é olhar o que chegou. Daí este diagnóstico na tela.
 */
export function sltDiagnosticoSessao(): {
  views: number;
  viewsComSessao: number;
  sessoesDistintas: number;
} {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS views,
              COUNT(session_id) AS com_sessao,
              COUNT(DISTINCT session_id) AS sessoes
         FROM slt_events WHERE event_type = 'page_viewed'`,
    )
    .get() as { views: number; com_sessao: number; sessoes: number };
  return {
    views: row?.views || 0,
    viewsComSessao: row?.com_sessao || 0,
    sessoesDistintas: row?.sessoes || 0,
  };
}

/** Estado da cota, para diagnóstico na tela de Configurações. */
export function sltCotaAtual(): { restante: number | null; resetaEm: number | null } {
  return getSltCotaStored();
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
