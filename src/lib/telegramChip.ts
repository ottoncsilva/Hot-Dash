import "server-only";
import { getTelegramChipCredentials } from "./settings";
import { decryptSecret, encryptSecret } from "./crypto";
import { getAccountSession, updateAccount } from "./ltvDb";

/**
 * Cliente do microserviço MTProto (ver telegram-mtproto-service/) — o chip da
 * modelo no Telegram. Espelha a forma de `evolution.ts`: o painel nunca fala
 * MTProto, só HTTP com o serviço.
 *
 * A sessão é a credencial que evita pedir código de novo, e pedir código
 * demais derruba o chip. Ela é guardada em DOIS lugares: em disco no serviço
 * (para religar no boot) e cifrada aqui no banco (para sobreviver à perda do
 * volume). Este módulo manda a cópia do banco junto em toda chamada, então o
 * serviço se recupera sozinho de um container recriado do zero.
 */

export class ChipNaoConfigurado extends Error {
  constructor() {
    super(
      "O serviço do chip do Telegram não está configurado. Informe a URL e o token em Configurações → Conexão com IA.",
    );
  }
}

function creds() {
  const c = getTelegramChipCredentials();
  if (!c) throw new ChipNaoConfigurado();
  return c;
}

export function isChipConfigurado(): boolean {
  return Boolean(getTelegramChipCredentials());
}

async function chamar<T>(
  caminho: string,
  init: { method: "POST" | "DELETE"; body?: unknown },
): Promise<T> {
  const { url, token } = creds();
  const res = await fetch(`${url}${caminho}`, {
    method: init.method,
    headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const texto = await res.text();
  let dados: any = {};
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    dados = { error: texto };
  }
  if (!res.ok) {
    const erro = new Error(dados.error || `serviço do chip devolveu ${res.status}`);
    (erro as any).status = res.status;
    (erro as any).payload = dados;
    throw erro;
  }
  return dados as T;
}

/** Sessão cifrada da conta, pronta para ir junto na chamada. */
function sessaoDe(accountId: string): string | undefined {
  const enc = getAccountSession(accountId);
  if (!enc) return undefined;
  try {
    return decryptSecret(enc);
  } catch {
    // Chave-mestra trocada: a sessão virou lixo. Melhor pedir o código de novo
    // do que mandar uma credencial ilegível e receber um erro obscuro.
    return undefined;
  }
}

/** Etapa 1 do login: manda o código para o telefone da modelo. */
export async function pedirCodigo(accountId: string, phone: string): Promise<void> {
  await chamar("/sessions/start", { method: "POST", body: { accountId, phone } });
}

export type ChipConectado = {
  phone: string;
  name: string;
  username: string | null;
};

/**
 * Etapa 2: o código (e a senha da verificação em duas etapas, quando existe).
 * Guarda a sessão cifrada e marca a conta como conectada.
 *
 * Quando a conta tem verificação em duas etapas e a senha não veio, o serviço
 * responde 409 `password_needed` — a tela usa isso para pedir a senha em vez
 * de acusar código errado.
 */
export async function confirmarCodigo(
  accountId: string,
  code: string,
  password?: string,
): Promise<ChipConectado> {
  const r = await chamar<{ session: string } & ChipConectado>("/sessions/confirm", {
    method: "POST",
    body: { accountId, code, password },
  });
  updateAccount(accountId, {
    sessionEnc: encryptSecret(r.session),
    externalRef: r.phone,
    status: "connected",
  });
  return { phone: r.phone, name: r.name, username: r.username };
}

export type ChipStatus = { status: "connected" | "disconnected"; phone?: string; name?: string };

export async function statusChip(accountId: string): Promise<ChipStatus> {
  try {
    const r = await chamar<ChipStatus>(`/sessions/${accountId}/status`, {
      method: "POST",
      body: { session: sessaoDe(accountId) },
    });
    updateAccount(accountId, { status: r.status === "connected" ? "connected" : "disconnected" });
    return r;
  } catch (e) {
    if (e instanceof ChipNaoConfigurado) throw e;
    return { status: "disconnected" };
  }
}

export async function enviarTexto(
  accountId: string,
  peerRef: string,
  text: string,
): Promise<void> {
  await chamar(`/sessions/${accountId}/send`, {
    method: "POST",
    body: { session: sessaoDe(accountId), peerRef, text },
  });
}

export async function enviarMidia(
  accountId: string,
  peerRef: string,
  opts: { mediaUrl: string; mediaName?: string; caption?: string; voice?: boolean },
): Promise<void> {
  await chamar(`/sessions/${accountId}/send`, {
    method: "POST",
    body: {
      session: sessaoDe(accountId),
      peerRef,
      text: opts.caption,
      mediaUrl: opts.mediaUrl,
      mediaName: opts.mediaName,
      voice: opts.voice,
    },
  });
}

/** "Digitando…" é enfeite: nunca pode derrubar o envio que vem depois. */
export async function mostrarDigitando(accountId: string, peerRef: string): Promise<void> {
  try {
    await chamar(`/sessions/${accountId}/typing`, {
      method: "POST",
      body: { session: sessaoDe(accountId), peerRef },
    });
  } catch {
    /* sem problema */
  }
}

export async function desconectarChip(accountId: string): Promise<void> {
  try {
    await chamar(`/sessions/${accountId}`, { method: "DELETE" });
  } catch (e) {
    // O serviço pode estar fora do ar. Ainda assim a conta precisa sair do
    // "conectado" no painel, senão a tela mente para quem está olhando.
    if (e instanceof ChipNaoConfigurado) throw e;
  }
  updateAccount(accountId, { sessionEnc: null, status: "disconnected" });
}
