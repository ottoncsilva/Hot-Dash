import "server-only";
import { getUazapiAdminToken, getUazapiBaseUrl } from "./settings";

/**
 * Cliente da uazapi — o WhatsApp da modelo.
 *
 * Diferença que muda tudo em relação à Evolution: lá havia UMA chave global e
 * as instâncias eram só nomes; aqui cada instância tem o TOKEN dela, e é esse
 * token que autentica quase tudo. O admintoken só cria e apaga instância.
 * Por isso quase toda função aqui recebe o token da conta, não um nome.
 *
 * Documentação: https://docs.uazapi.com
 */

export class UazapiNaoConfigurada extends Error {
  constructor() {
    super(
      "A uazapi não está configurada. Informe a URL do servidor e o admintoken em Configurações → Conexões do LTV.",
    );
  }
}

function base(): string {
  const url = getUazapiBaseUrl();
  if (!url) throw new UazapiNaoConfigurada();
  return url;
}

export function isUazapiConfigurada(): boolean {
  return Boolean(getUazapiBaseUrl());
}

async function chamar<T>(
  caminho: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
    token?: string;
    admin?: boolean;
    body?: unknown;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.admin) {
    const admin = getUazapiAdminToken();
    if (!admin) {
      throw new Error(
        "Admintoken da uazapi ausente. Sem ele o painel não cria nem apaga instância.",
      );
    }
    headers.admintoken = admin;
  }
  if (opts.token) headers.token = opts.token;

  const res = await fetch(`${base()}${caminho}`, {
    method: opts.method || "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const texto = await res.text();
  let dados: any = {};
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    dados = { error: texto };
  }
  if (!res.ok) {
    const erro = new Error(dados.error || dados.message || `uazapi devolveu ${res.status}`);
    (erro as any).status = res.status;
    throw erro;
  }
  return dados as T;
}

/* ------------------------------------------------------------- instância */

export type UazapiStatus = "disconnected" | "connecting" | "connected" | "hibernated";

export type UazapiInstance = {
  id: string;
  token: string;
  status: UazapiStatus;
  name?: string;
  profileName?: string;
  /** Número conectado, quando já há sessão. */
  owner?: string;
  qrcode?: string;
  paircode?: string;
  lastDisconnect?: string;
  lastDisconnectReason?: string;
};

function normalizarInstancia(d: any): UazapiInstance {
  // A uazapi às vezes devolve a instância na raiz, às vezes dentro de
  // `instance` ou `response` — normalizar aqui evita espalhar `?.` pelo app.
  const i = d?.instance || d?.response || d || {};
  return {
    id: i.id,
    token: i.token,
    status: i.status || "disconnected",
    name: i.name,
    profileName: i.profileName,
    owner: i.owner,
    qrcode: d?.qrcode || i.qrcode,
    paircode: d?.paircode || i.paircode,
    lastDisconnect: i.lastDisconnect,
    lastDisconnectReason: i.lastDisconnectReason,
  };
}

/** Cria a instância (exige admintoken). O token devolvido é a credencial dela. */
export async function criarInstancia(name: string): Promise<UazapiInstance> {
  const d = await chamar<any>("/instance/create", { admin: true, body: { name } });
  const inst = normalizarInstancia(d);
  if (!inst.token) throw new Error("A uazapi criou a instância mas não devolveu o token.");
  return inst;
}

/**
 * Começa a conexão. Sem `phone` devolve QR code; com `phone`, devolve código
 * de pareamento — que é o caminho melhor para quem só tem o celular na mão.
 */
export async function conectarInstancia(
  token: string,
  phone?: string,
): Promise<UazapiInstance> {
  const d = await chamar<any>("/instance/connect", {
    token,
    body: phone ? { phone } : {},
  });
  return normalizarInstancia(d);
}

export async function statusInstancia(token: string): Promise<UazapiInstance> {
  const d = await chamar<any>("/instance/status", { method: "GET", token });
  return normalizarInstancia(d);
}

export async function desconectarInstancia(token: string): Promise<void> {
  await chamar("/instance/disconnect", { token, body: {} });
}

export async function apagarInstancia(token: string): Promise<void> {
  await chamar("/instance", { method: "DELETE", token, admin: true });
}

/**
 * Registra o webhook da instância.
 *
 * `excludeMessages: ["wasSentByApi"]` é o que impede o laço infinito: sem
 * ele, toda mensagem que a IA manda volta como evento e ela responde a si
 * mesma. De quebra resolve o problema do eco — qualquer `fromMe` que chegar
 * daqui em diante é a modelo digitando no celular dela.
 */
export async function registrarWebhook(token: string, url: string): Promise<void> {
  await chamar("/webhook", {
    token,
    body: {
      enabled: true,
      url,
      events: ["messages", "connection", "call"],
      excludeMessages: ["wasSentByApi", "isGroupYes"],
    },
  });
}

/* ------------------------------------------------------------- mensagens */

/**
 * Campos que todo envio aceita. `delay` é o pulo do gato: durante ele o
 * WhatsApp mostra "Digitando..." (ou "Gravando áudio..." no áudio), então a
 * presença sai de graça, sem uma chamada separada que poderia vazar se o
 * envio falhasse no meio.
 *
 * `readmessages` e `readchat` marcam a conversa como lida junto do envio —
 * conta que responde sem nunca marcar como lida é padrão de robô.
 */
type CamposComuns = {
  delay?: number;
  readchat?: boolean;
  readmessages?: boolean;
};

const LIDO: CamposComuns = { readchat: true, readmessages: true };

export async function enviarTexto(
  token: string,
  number: string,
  text: string,
  opts: CamposComuns = {},
): Promise<void> {
  await chamar("/send/text", {
    token,
    body: { number, text, linkPreview: false, ...LIDO, ...opts },
  });
}

export type TipoMidia =
  | "image"
  | "video"
  | "videoplay"
  | "document"
  | "audio"
  | "myaudio"
  | "ptt"
  | "ptv"
  | "sticker";

export async function enviarMidia(
  token: string,
  number: string,
  midia: { type: TipoMidia; file: string; text?: string; docName?: string },
  opts: CamposComuns = {},
): Promise<void> {
  await chamar("/send/media", {
    token,
    body: { number, ...midia, ...LIDO, ...opts },
  });
}

/**
 * Botão nativo que COPIA um código ao ser tocado.
 *
 * É assim que o PIX vai, e não pelo `/send/pix-button`: aquele recebe uma
 * CHAVE pix, então o dinheiro cairia fora da SyncPay — sem conciliação, sem
 * webhook de confirmação e sem entrega automática do conteúdo. Aqui o que o
 * lead copia é o copia-e-cola que a SyncPay gerou, e a venda continua se
 * fechando sozinha.
 *
 * Só um botão de cópia por mensagem, sem misturar com botões de resposta: a
 * própria documentação avisa que a mistura quebra a exibição no WhatsApp Web.
 */
export async function enviarBotaoCopiar(
  token: string,
  number: string,
  conteudo: { text: string; rotulo: string; codigo: string; footerText?: string },
  opts: CamposComuns = {},
): Promise<void> {
  await chamar("/send/menu", {
    token,
    body: {
      number,
      type: "button",
      text: conteudo.text,
      choices: [`${conteudo.rotulo}|copy:${conteudo.codigo}`],
      footerText: conteudo.footerText,
      ...LIDO,
      ...opts,
    },
  });
}

/** Marca mensagens como lidas na hora que chegam, antes mesmo de responder. */
export async function marcarComoLida(token: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await chamar("/message/markread", { token, body: { id: ids } });
}

/** Recusa a chamada. O corpo vazio recusa a que estiver tocando. */
export async function rejeitarChamada(
  token: string,
  chamada: { number?: string; id?: string } = {},
): Promise<void> {
  await chamar("/call/reject", { token, body: chamada });
}

/* -------------------------------------------------------------- etiquetas */

export type UazapiLabel = { id?: string; labelid?: string; name: string; color?: number };

export async function listarEtiquetas(token: string): Promise<UazapiLabel[]> {
  const d = await chamar<any>("/labels", { method: "GET", token });
  const lista = Array.isArray(d) ? d : d?.labels || d?.response || [];
  return Array.isArray(lista) ? lista : [];
}

/** `labelid: "new"` cria; a uazapi escolhe o próximo id livre. */
export async function criarEtiqueta(
  token: string,
  name: string,
  color = 3,
): Promise<void> {
  await chamar("/label/edit", { token, body: { labelid: "new", name, color } });
}

export async function marcarChatComEtiqueta(
  token: string,
  number: string,
  labelid: string,
): Promise<void> {
  await chamar("/chat/labels", { token, body: { number, add_labelid: labelid } });
}
