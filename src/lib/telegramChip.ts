import "server-only";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import bigInt from "big-integer";
import { decryptSecret, encryptSecret } from "./crypto";
import { getTelegramAppCredentials } from "./settings";
import { ensureChat, getAccountSession, insertMessage, updateAccount } from "./ltvDb";
import { getDb } from "./db";

/**
 * O chip do Telegram — a modelo falando pela CONTA REAL dela.
 *
 * Isto roda DENTRO do processo do painel, e não num container à parte como
 * antes. MTProto precisa de conexão aberta o tempo todo, e o Next em produção
 * é justamente um processo Node de vida longa (o mesmo que já hospeda o
 * agendador em `instrumentation.ts`). O serviço separado só acrescentava um
 * container para subir, um endereço para configurar e um segredo para manter
 * igual dos dois lados — três coisas para dar errado sem nada em troca.
 *
 * As conexões vivem neste Map enquanto o processo viver; a sessão fica cifrada
 * no banco, e `religarChips()` reconecta tudo no boot.
 */

const clientes = new Map<string, TelegramClient>();

/** Login pela metade: entre mandar o telefone e receber o código. */
type Pendente = {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  expiraEm: NodeJS.Timeout;
};
const pendentes = new Map<string, Pendente>();

export class TelegramAppNaoConfigurado extends Error {
  constructor() {
    super(
      "Informe o api_id e o api_hash do Telegram em Configurações → Conexões do LTV. Eles são gratuitos e saem em my.telegram.org.",
    );
  }
}

function credenciais() {
  const c = getTelegramAppCredentials();
  if (!c) throw new TelegramAppNaoConfigurado();
  return c;
}

export function isChipConfigurado(): boolean {
  return Boolean(getTelegramAppCredentials());
}

function novoCliente(session: string): TelegramClient {
  const { apiId, apiHash } = credenciais();
  return new TelegramClient(new StringSession(session || ""), apiId, apiHash, {
    connectionRetries: 5,
    // A conta real é um celular; anunciar-se como tal reduz a chance de o
    // Telegram tratar a sessão como automação.
    deviceModel: "iPhone",
    systemVersion: "iOS 17.5",
    appVersion: "10.9",
  });
}

function sessaoDe(accountId: string): string | null {
  const enc = getAccountSession(accountId);
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    // Chave-mestra trocada: a sessão virou lixo e o chip precisa reconectar.
    return null;
  }
}

/**
 * Só conversa privada de gente interessa. Grupo, canal e o que a própria
 * modelo mandou do celular dela entrariam no histórico como se fossem do lead,
 * e a IA acabaria respondendo a si mesma.
 */
function escutar(accountId: string, client: TelegramClient) {
  client.addEventHandler(async (event: any) => {
    try {
      const msg = event.message;
      if (!msg || msg.out) return;
      if (msg.peerId?.className !== "PeerUser") return;
      const sender: any = await msg.getSender().catch(() => null);
      if (!sender || sender.bot) return;

      const nome = [sender.firstName, sender.lastName].filter(Boolean).join(" ").trim();
      const chat = ensureChat(
        accountId,
        String(sender.id),
        nome || sender.username || undefined,
        // O access_hash é guardado a cada mensagem: é o que permite responder
        // depois de um restart, quando o cache de entidades já se foi.
        sender.accessHash ? String(sender.accessHash) : undefined,
      );

      // Foto ou áudio sem legenda ainda é o lead falando.
      const conteudo = String(msg.message || "").trim() || (msg.media ? "[mandou um arquivo]" : "");
      if (!conteudo) return;

      insertMessage({ chatId: chat.id, role: "user", content: conteudo });

      // `agendarResposta` junta rajada de mensagens numa resposta só — ver
      // o comentário dela em ltvAgent.ts.
      const { agendarResposta } = await import("./ltvAgent");
      agendarResposta(chat.id);
    } catch (e) {
      console.error(`[chip ${accountId}] erro tratando mensagem:`, e);
    }
  }, new NewMessage({ incoming: true }));
}

async function conectar(accountId: string, session: string): Promise<TelegramClient> {
  const client = novoCliente(session);
  await client.connect();
  if (!(await client.checkAuthorization())) {
    await client.disconnect().catch(() => {});
    throw new Error("Sessão inválida ou expirada — reconecte o chip.");
  }
  escutar(accountId, client);
  clientes.set(accountId, client);
  return client;
}

async function clienteDe(accountId: string): Promise<TelegramClient> {
  const vivo = clientes.get(accountId);
  if (vivo?.connected) return vivo;
  const session = sessaoDe(accountId);
  if (!session) throw new Error("Este chip não está conectado.");
  return conectar(accountId, session);
}

/* ----------------------------------------------------------------- login */

/** Etapa 1: manda o código para o telefone da modelo. */
export async function pedirCodigo(accountId: string, phone: string): Promise<void> {
  const { apiId, apiHash } = credenciais();
  const anterior = pendentes.get(accountId);
  if (anterior) {
    clearTimeout(anterior.expiraEm);
    await anterior.client.disconnect().catch(() => {});
  }
  const client = novoCliente("");
  await client.connect();
  const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);
  // O código do Telegram vale poucos minutos; a conexão pendurada some junto.
  const expiraEm = setTimeout(() => {
    const p = pendentes.get(accountId);
    if (p) {
      p.client.disconnect().catch(() => {});
      pendentes.delete(accountId);
    }
  }, 10 * 60 * 1000);
  pendentes.set(accountId, { client, phone, phoneCodeHash, expiraEm });
}

export type ChipConectado = { phone: string; name: string; username: string | null };

/** Sinaliza que a conta tem verificação em duas etapas e a senha é necessária. */
export class SenhaNecessaria extends Error {
  constructor() {
    super("password_needed");
  }
}

/** Etapa 2: o código e, quando a conta tem, a senha de duas etapas. */
export async function confirmarCodigo(
  accountId: string,
  code: string,
  password?: string,
): Promise<ChipConectado> {
  const p = pendentes.get(accountId);
  if (!p) throw new Error("Nenhum código pendente. Peça o código de novo.");
  const { apiId, apiHash } = credenciais();

  try {
    await p.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: p.phone,
        phoneCodeHash: p.phoneCodeHash,
        phoneCode: String(code),
      }),
    );
  } catch (e: any) {
    const msg = String(e?.errorMessage || e?.message || "");
    if (!msg.includes("SESSION_PASSWORD_NEEDED")) throw e;
    if (!password) throw new SenhaNecessaria();
    await p.client.signInWithPassword(
      { apiId, apiHash },
      {
        password: async () => password,
        onError: (err) => {
          throw err;
        },
      },
    );
  }

  const me: any = await p.client.getMe();
  const session = String(p.client.session.save());
  clearTimeout(p.expiraEm);
  pendentes.delete(accountId);

  escutar(accountId, p.client);
  clientes.set(accountId, p.client);

  const phone = me.phone ? `+${me.phone}` : p.phone;
  updateAccount(accountId, {
    sessionEnc: encryptSecret(session),
    externalRef: phone,
    status: "connected",
  });
  return {
    phone,
    name: [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.username || "",
    username: me.username || null,
  };
}

export type ChipStatus = { status: "connected" | "disconnected"; phone?: string; name?: string };

export async function statusChip(accountId: string): Promise<ChipStatus> {
  try {
    const client = await clienteDe(accountId);
    const me: any = await client.getMe();
    updateAccount(accountId, { status: "connected" });
    return {
      status: "connected",
      phone: me.phone ? `+${me.phone}` : undefined,
      name: [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.username || "",
    };
  } catch {
    updateAccount(accountId, { status: "disconnected" });
    return { status: "disconnected" };
  }
}

export async function desconectarChip(accountId: string): Promise<void> {
  const client = clientes.get(accountId);
  if (client) {
    // logOut invalida a sessão no servidor do Telegram; só desconectar
    // deixaria o aparelho na lista de sessões ativas da conta.
    await client.invoke(new Api.auth.LogOut()).catch(() => {});
    await client.disconnect().catch(() => {});
    clientes.delete(accountId);
  }
  const p = pendentes.get(accountId);
  if (p) {
    clearTimeout(p.expiraEm);
    await p.client.disconnect().catch(() => {});
    pendentes.delete(accountId);
  }
  updateAccount(accountId, { sessionEnc: null, status: "disconnected" });
}

/* ----------------------------------------------------------------- envio */

/**
 * Para quem mandar. O caminho normal é o access_hash guardado quando o lead
 * falou: o cache de entidades do GramJS vive na memória e some no restart.
 */
async function destino(client: TelegramClient, peerRef: string, accessHash?: string) {
  if (accessHash && /^-?\d+$/.test(peerRef)) {
    return new Api.InputPeerUser({
      userId: bigInt(peerRef),
      accessHash: bigInt(accessHash),
    });
  }
  return client.getInputEntity(/^-?\d+$/.test(peerRef) ? bigInt(peerRef) : peerRef);
}

/**
 * `comoCodigo` manda em monoespaçado — no Telegram, tocar num trecho de código
 * copia e mostra "Copiado". É o mais perto de um botão que uma CONTA REAL
 * alcança: teclado inline é recurso de bot.
 */
export async function enviarTexto(
  accountId: string,
  peerRef: string,
  text: string,
  accessHash?: string,
  opts?: { comoCodigo?: boolean },
): Promise<void> {
  const client = await clienteDe(accountId);
  const alvo = await destino(client, peerRef, accessHash);
  await client.sendMessage(alvo, {
    message: text,
    // A entidade vai explícita, e não por parseMode: o código do PIX tem
    // caracteres que o HTML e o Markdown comem, e código mutilado é recusado.
    formattingEntities: opts?.comoCodigo
      ? [new Api.MessageEntityCode({ offset: 0, length: text.length })]
      : undefined,
  });
}

/**
 * O código PIX em destaque — o mais perto de um "botão verde" que uma CONTA
 * REAL alcança no Telegram (teclado inline é recurso de bot, e a cor exata do
 * destaque não dá pra escolher: cada cliente pinta a citação com a cor de
 * acento dele, não um valor fixo que a gente manda).
 *
 * Duas entidades no MESMO trecho: a citação desenha um contêiner com barra e
 * fundo diferentes do resto da conversa, e o monoespaçado por cima é o que
 * copia sozinho com um toque. O aviso vem ANTES, fora do contêiner, pra ficar
 * claro o que fazer antes do lead nem olhar pro código.
 */
export async function enviarCodigoPix(
  accountId: string,
  peerRef: string,
  codigo: string,
  accessHash?: string,
): Promise<void> {
  const client = await clienteDe(accountId);
  const alvo = await destino(client, peerRef, accessHash);
  const aviso = "👉 é só tocar no código abaixo que ele copia sozinho";
  const texto = `${aviso}\n\n${codigo}`;
  const offset = aviso.length + 2; // pula o aviso + "\n\n"
  await client.sendMessage(alvo, {
    message: texto,
    formattingEntities: [
      new Api.MessageEntityBlockquote({ offset, length: codigo.length, collapsed: false }),
      new Api.MessageEntityCode({ offset, length: codigo.length }),
    ],
  });
}

/**
 * Manda o arquivo lendo direto do disco. Rodando dentro do painel, o arquivo
 * está do lado — buscar por HTTP seria o processo pedindo a si mesmo, e ainda
 * obrigava a abrir uma rota autenticada só para isso.
 */
export async function enviarMidia(
  accountId: string,
  peerRef: string,
  opts: {
    /** Caminho relativo dentro do armazenamento (media.path / ltv_audios.path). */
    filePath: string;
    mediaName?: string;
    caption?: string;
    voice?: boolean;
    accessHash?: string;
  },
): Promise<void> {
  const client = await clienteDe(accountId);
  const alvo = await destino(client, peerRef, opts.accessHash);
  const { readBuffer } = await import("./storage");
  const buf = await readBuffer(opts.filePath);
  const { CustomFile } = await import("telegram/client/uploads");
  const file = new CustomFile(opts.mediaName || "arquivo", buf.length, "", buf);
  await client.sendFile(alvo, {
    file,
    caption: opts.caption || undefined,
    voiceNote: Boolean(opts.voice),
  });
}

/** O Telegram esquece o "digitando…" sozinho se ninguém renovar — por isso o
 *  loop reenvia o aviso nesse intervalo, sempre ANTES do indicador sumir. */
const RENOVAR_DIGITANDO_MS = 4500;

/**
 * "Digitando…" é enfeite: nunca pode derrubar o envio que vem depois.
 *
 * Sem `ms`, dispara UM aviso só (o Telegram mostra por ~5-6s sozinho e some —
 * suficiente pra um "vi sua mensagem" antes de uma espera longa e silenciosa,
 * ver `esperaMs` no motor do LTV). Com `ms`, RENOVA o aviso a cada poucos
 * segundos até completar a duração pedida — é o que faz o indicador durar o
 * tempo de verdade que uma mensagem daquele tamanho levaria pra ser digitada,
 * em vez de sumir no meio e deixar a mensagem "aparecer do nada".
 */
export async function mostrarDigitando(
  accountId: string,
  peerRef: string,
  accessHash?: string,
  ms?: number,
): Promise<void> {
  try {
    const client = await clienteDe(accountId);
    const alvo = await destino(client, peerRef, accessHash);
    const acao = new Api.messages.SetTyping({ peer: alvo, action: new Api.SendMessageTypingAction() });
    if (!ms || ms <= RENOVAR_DIGITANDO_MS) {
      await client.invoke(acao);
      return;
    }
    let restante = ms;
    while (restante > 0) {
      await client.invoke(acao);
      const passo = Math.min(RENOVAR_DIGITANDO_MS, restante);
      await new Promise((r) => setTimeout(r, passo));
      restante -= passo;
    }
  } catch {
    /* sem problema */
  }
}

/* ------------------------------------------------------------------ boot */

/**
 * Religa no boot os chips que já estavam conectados. Sem isto, todo deploy
 * deixaria os leads falando sozinhos até alguém abrir a tela.
 */
export async function religarChips(): Promise<void> {
  if (!isChipConfigurado()) return;
  const linhas = getDb()
    .prepare(`SELECT id FROM ltv_accounts WHERE channel = 'telegram' AND session_enc IS NOT NULL`)
    .all() as { id: string }[];
  for (const { id } of linhas) {
    const session = sessaoDe(id);
    if (!session) continue;
    try {
      await conectar(id, session);
      console.log(`[hotdash] chip do Telegram religado (${id}).`);
    } catch (e) {
      console.error(`[hotdash] chip ${id} não religou:`, e);
      updateAccount(id, { status: "disconnected" });
    }
  }
}
