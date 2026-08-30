import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getInstagramAppSecret, getInstagramAppSettings } from "../settings";

/**
 * Conversa com a Graph API do Instagram — o caminho do LOGIN DIRETO PELO
 * INSTAGRAM (`graph.instagram.com`), não o antigo via Página do Facebook.
 *
 * A escolha não é estilo: o caminho antigo exige a conta amarrada a uma Página,
 * a Página amarrada a um perfil, e permissões `pages_*` — três coisas que a
 * operação não tem e que não existem para ganhar nada aqui. Com o Business
 * Login a conta profissional autoriza sozinha, e é só isso que a modelo faz.
 *
 * MODELO SELF-SERVE: o app atende contas que a própria operação gerencia, o
 * que na documentação da Meta dispensa App Review e verificação de negócio
 * (Standard Access). No dia em que o painel atender contas de terceiros isso
 * vira Tech Provider e passa a exigir os dois — nada aqui muda, só o pedido
 * de acesso.
 */

const OAUTH_AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const OAUTH_TOKEN = "https://api.instagram.com/oauth/access_token";
const GRAPH = "https://graph.instagram.com";
/** Fixa de propósito: a Meta muda comportamento entre versões, e um "sempre a
 *  mais nova" faz o painel quebrar num dia em que ninguém mexeu em nada. */
const GRAPH_VERSION = "v25.0";

/** O mínimo para ler e responder DM. Nada além disso é pedido: cada permissão
 *  a mais é uma tela de consentimento mais assustadora e um motivo a mais de
 *  recusa no dia em que houver App Review. */
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];

export class InstagramApiError extends Error {
  readonly status: number;
  constructor(status: number, description: string) {
    super(`Instagram API: ${description}`);
    this.name = "InstagramApiError";
    this.status = status;
  }
}

/** A URL pública do painel, que precisa bater EXATAMENTE com a cadastrada no
 *  app da Meta — o OAuth compara string com string e recusa por uma barra. */
export function redirectUri(): string {
  const base = getInstagramAppSettings().publicBaseUrl;
  return base ? `${base}/api/instagram/callback` : "";
}

/**
 * O `state` do OAuth: diz de qual modelo é a conta que está sendo conectada.
 *
 * Vai ASSINADO porque ele volta do Instagram pelo NAVEGADOR — ou seja, passa
 * por um lugar onde qualquer um pode reescrevê-lo. Sem assinatura, bastaria
 * trocar o id no meio do caminho para pendurar a conta de alguém no perfil
 * errado. A chave é o App Secret, que já é o segredo desta integração — sem
 * mais um para guardar.
 *
 * As duas metades (assinar e conferir) moram juntas de propósito: separadas em
 * arquivos diferentes, uma muda e a outra fica para trás.
 */
export function assinarState(profileId: string): string {
  const secret = getInstagramAppSecret() || "";
  const corpo = `${profileId}.${Date.now()}`;
  const mac = createHmac("sha256", secret).update(corpo).digest("hex").slice(0, 32);
  return `${corpo}.${mac}`;
}

/** Devolve o profileId quando o `state` foi mesmo emitido por nós, há menos de
 *  uma hora. Validade curta: o link de conexão é para usar na hora, e um que
 *  vale para sempre vira convite reutilizável se vazar do histórico. */
export function conferirState(state: string): string | null {
  const partes = state.split(".");
  if (partes.length !== 3) return null;
  const [profileId, emitidoEm, mac] = partes;
  const secret = getInstagramAppSecret() || "";
  const esperado = createHmac("sha256", secret)
    .update(`${profileId}.${emitidoEm}`)
    .digest("hex")
    .slice(0, 32);
  const a = Buffer.from(esperado);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(emitidoEm) > 60 * 60 * 1000) return null;
  return profileId;
}

/**
 * O link que a modelo abre. `state` volta intacto no callback — é por ele que
 * se sabe de qual modelo é a conta que está sendo conectada, e é o que impede
 * um terceiro de disparar o callback com um código dele (CSRF).
 */
export function authorizeUrl(state: string): string {
  const { appId } = getInstagramAppSettings();
  const qs = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: IG_SCOPES.join(","),
    state,
  });
  return `${OAUTH_AUTHORIZE}?${qs.toString()}`;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as { message?: string } | undefined;
    throw new InstagramApiError(
      res.status,
      err?.message || (data.error_message as string) || `Erro HTTP ${res.status}`,
    );
  }
  return data;
}

/**
 * Troca o `code` do callback por um token curto. O código vale 1 hora e só
 * pode ser usado UMA vez — um refresh da página do callback já o queima, e é
 * por isso que o callback grava o resultado antes de qualquer outra coisa.
 */
export async function trocarCodePorToken(code: string): Promise<{
  accessToken: string;
  userId: string;
}> {
  const secret = getInstagramAppSecret();
  const { appId } = getInstagramAppSettings();
  if (!appId || !secret) throw new Error("Cadastre o App ID e o App Secret da Meta antes de conectar.");

  const body = new URLSearchParams({
    client_id: appId,
    client_secret: secret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code,
  });
  const data = await json(
    await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
  return { accessToken: String(data.access_token), userId: String(data.user_id) };
}

/** Token curto → token de 60 dias. É o único que vale guardar. */
export async function tokenLongo(curto: string): Promise<{ accessToken: string; expiresIn: number }> {
  const secret = getInstagramAppSecret();
  if (!secret) throw new Error("App Secret da Meta não cadastrado.");
  const qs = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: secret,
    access_token: curto,
  });
  const data = await json(await fetch(`${GRAPH}/access_token?${qs.toString()}`));
  return { accessToken: String(data.access_token), expiresIn: Number(data.expires_in) || 0 };
}

/**
 * Renova por mais 60 dias.
 *
 * A armadilha: um token que passa 60 dias sem renovar MORRE e não pode mais
 * ser renovado — a modelo teria que refazer o login. E a Meta recusa renovar
 * um token com menos de 24 horas de vida, então isto nunca roda logo depois
 * de conectar.
 */
export async function renovarToken(atual: string): Promise<{ accessToken: string; expiresIn: number }> {
  const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: atual });
  const data = await json(await fetch(`${GRAPH}/refresh_access_token?${qs.toString()}`));
  return { accessToken: String(data.access_token), expiresIn: Number(data.expires_in) || 0 };
}

/** @usuário e nome da conta conectada — é o que a tela mostra para o operador
 *  conferir que conectou a conta certa. */
export async function dadosDaConta(
  token: string,
): Promise<{ id: string; username?: string; name?: string }> {
  const qs = new URLSearchParams({ fields: "id,username,name", access_token: token });
  const data = await json(await fetch(`${GRAPH}/me?${qs.toString()}`));
  return {
    id: String(data.id),
    username: data.username ? String(data.username) : undefined,
    name: data.name ? String(data.name) : undefined,
  };
}

/**
 * Assina os webhooks DESTA conta. Sem isto o app está configurado, a conta
 * está conectada e nenhuma DM chega — é o passo silencioso que faz tudo
 * parecer quebrado sem dar erro em lugar nenhum.
 */
export async function assinarWebhooks(igUserId: string, token: string): Promise<void> {
  const qs = new URLSearchParams({
    subscribed_fields: "messages",
    access_token: token,
  });
  await json(
    await fetch(`${GRAPH}/${GRAPH_VERSION}/${igUserId}/subscribed_apps?${qs.toString()}`, {
      method: "POST",
    }),
  );
}

/**
 * Manda uma mensagem de texto.
 *
 * `igUserId` é a CONTA DA MODELO; `peerRef` é o id do lead com escopo nessa
 * conta (o mesmo lead tem outro id em outra conta, então esse número não vale
 * fora daqui).
 *
 * Quem chama precisa ter conferido a janela de 24 horas antes — a Meta recusa
 * fora dela, e queimar a chamada para descobrir isso conta como erro na conta.
 */
export async function enviarMensagem(
  igUserId: string,
  token: string,
  peerRef: string,
  texto: string,
): Promise<void> {
  await json(
    await fetch(`${GRAPH}/${GRAPH_VERSION}/${igUserId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { id: peerRef }, message: { text: texto } }),
    }),
  );
}

/**
 * Confere a assinatura do webhook (`X-Hub-Signature-256`).
 *
 * Não é zelo: a URL do webhook é pública por definição, e sem isto qualquer um
 * que a descubra injeta conversa falsa no funil — e faz a IA responder para
 * quem ele quiser, pela conta da modelo. Comparação em tempo constante porque
 * comparar HMAC com `===` vaza o segredo byte a byte.
 */
export function assinaturaConfere(corpoCru: string, header: string | null): boolean {
  const secret = getInstagramAppSecret();
  if (!secret || !header) return false;
  const esperado = "sha256=" + createHmac("sha256", secret).update(corpoCru, "utf8").digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * ================================================================
 * O WEBHOOK, LIGADO SOZINHO
 * ================================================================
 *
 * Configurar o recebimento de mensagens era o passo mais fácil de errar do
 * cadastro inteiro — e o único que erra em SILÊNCIO: esquecer de assinar o
 * campo `messages` deixa tudo com cara de certo (a conta conecta, nenhum erro
 * aparece na tela da Meta) e simplesmente nada chega.
 *
 * A Graph API expõe isso em `/{app-id}/subscriptions`, e a autenticação é um
 * token de APP — `{app_id}|{app_secret}`, os dois valores que o operador já
 * colou no painel. Ou seja: dá para o painel se cadastrar sozinho, sem ninguém
 * navegar pelo console da Meta.
 *
 * Cadastrar dispara o aperto de mão na hora: a Meta chama o nosso endpoint com
 * o `hub.challenge`, e só aceita se a resposta bater. Isso é uma vantagem
 * escondida — o erro aparece AGORA, com mensagem, em vez de virar um "não
 * chega nada" descoberto dias depois.
 *
 * Aqui é `graph.facebook.com` e não `graph.instagram.com`: esta chamada é sobre
 * o APLICATIVO, não sobre a conta de uma modelo.
 */

const GRAPH_FB = "https://graph.facebook.com";
/** O objeto do webhook. É o mesmo nome que vem no `object` de cada evento. */
const WEBHOOK_OBJECT = "instagram";
/** Só mensagens. Cada campo a mais é tráfego que ninguém lê e uma superfície a
 *  mais para tratar no endpoint. */
const WEBHOOK_FIELDS = "messages";

/** Token de aplicativo: identifica o APP, não uma pessoa. Vale para as
 *  chamadas sobre o próprio app, como a assinatura do webhook. */
function appAccessToken(): string | null {
  const { appId } = getInstagramAppSettings();
  const secret = getInstagramAppSecret();
  return appId && secret ? `${appId}|${secret}` : null;
}

export type WebhookStatus = {
  /** O recebimento está ligado E apontando para este painel. */
  ativo: boolean;
  /** Para onde a Meta está mandando hoje. Diferente do nosso quer dizer que o
   *  app está cadastrado, mas entregando em outro lugar. */
  callbackUrl?: string;
  campos: string[];
  /** Preenchido quando não deu para conferir (rede, credencial errada). */
  erro?: string;
};

/** A URL que a Meta precisa chamar para entregar as mensagens. */
export function webhookUrl(): string {
  const base = getInstagramAppSettings().publicBaseUrl;
  return base ? `${base}/api/webhooks/instagram` : "";
}

/**
 * Como está o recebimento AGORA, perguntado à Meta — não o que achamos que
 * configuramos. É a diferença entre a tela dizer "ligado" e a tela dizer
 * "ligado porque acabei de conferir".
 */
export async function statusDoWebhook(): Promise<WebhookStatus> {
  const token = appAccessToken();
  const { appId } = getInstagramAppSettings();
  if (!token || !appId) return { ativo: false, campos: [], erro: "App ID ou chave secreta não cadastrados." };

  try {
    const data = await json(
      await fetch(
        `${GRAPH_FB}/${GRAPH_VERSION}/${appId}/subscriptions?${new URLSearchParams({ access_token: token })}`,
      ),
    );
    const lista = (data.data as { object?: string; callback_url?: string; active?: boolean; fields?: unknown[] }[]) || [];
    const nosso = lista.find((s) => s.object === WEBHOOK_OBJECT);
    if (!nosso) return { ativo: false, campos: [] };

    const campos = (nosso.fields || [])
      .map((f) => (typeof f === "string" ? f : (f as { name?: string }).name))
      .filter((n): n is string => Boolean(n));

    return {
      // "Ativo" exige as três coisas: existir, apontar para ESTE painel e
      // trazer o campo `messages`. Sem as três, alguma DM não chega — e dizer
      // "ligado" nesse estado seria pior que dizer nada.
      ativo:
        Boolean(nosso.active) &&
        nosso.callback_url === webhookUrl() &&
        campos.includes(WEBHOOK_FIELDS),
      callbackUrl: nosso.callback_url,
      campos,
    };
  } catch (e) {
    return { ativo: false, campos: [], erro: e instanceof Error ? e.message : "Falha ao consultar a Meta." };
  }
}

/**
 * Liga o recebimento de mensagens. Idempotente: chamar de novo com os mesmos
 * valores só reconfirma.
 *
 * A Meta faz o aperto de mão DENTRO desta chamada — ela bate no nosso endpoint
 * com o `hub.challenge` antes de responder. Então uma falha aqui já diz qual
 * é o problema (URL fora do ar, verify token diferente, http em vez de https)
 * em vez de deixar o operador adivinhando depois.
 */
export async function configurarWebhook(): Promise<{ ok: true } | { ok: false; erro: string }> {
  const token = appAccessToken();
  const { appId, verifyToken } = getInstagramAppSettings();
  const callback = webhookUrl();

  if (!token || !appId) return { ok: false, erro: "Cadastre o App ID e a chave secreta da Meta primeiro." };
  if (!callback) return { ok: false, erro: "Cadastre o endereço público do painel primeiro." };
  if (!verifyToken) return { ok: false, erro: "Sem a palavra de verificação do webhook." };
  if (!callback.startsWith("https://")) {
    // A Meta recusa http, e a mensagem dela não diz isso com todas as letras.
    return { ok: false, erro: "O endereço do painel precisa começar com https:// — a Meta recusa http." };
  }

  try {
    await json(
      await fetch(`${GRAPH_FB}/${GRAPH_VERSION}/${appId}/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          object: WEBHOOK_OBJECT,
          callback_url: callback,
          fields: WEBHOOK_FIELDS,
          verify_token: verifyToken,
          access_token: token,
        }),
      }),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "A Meta recusou a configuração." };
  }
}
