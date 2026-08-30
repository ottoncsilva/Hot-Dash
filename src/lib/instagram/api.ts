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
