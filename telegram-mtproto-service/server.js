"use strict";

/**
 * Hot Dash · chip do Telegram (MTProto)
 * ============================================================================
 * A modelo falando com o lead pela CONTA REAL dela — não por bot. A Bot API
 * não serve: um bot não tem histórico, não aparece como pessoa e o lead vê que
 * é bot. Conta real exige MTProto, que precisa de conexão aberta o tempo todo
 * — por isso um container próprio, e não uma rota do Next.
 *
 * O painel fala com este serviço por HTTP; as mensagens que chegam voltam para
 * ele por webhook. A sessão (a credencial que evita pedir código de novo) fica
 * em disco aqui E cifrada no banco do painel: aqui para reconectar sozinho no
 * boot, lá para sobreviver à perda do volume.
 */

const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");

const PORT = Number(process.env.PORT || 8100);
const TOKEN = process.env.CHIP_API_TOKEN || "";
const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const WEBHOOK_URL = (process.env.WEBHOOK_URL || "").replace(/\/+$/, "");
const SESSIONS_DIR = process.env.SESSIONS_DIR || "/data";

if (!API_ID || !API_HASH) {
  console.error(
    "TELEGRAM_API_ID e TELEGRAM_API_HASH são obrigatórios. Pegue os seus em https://my.telegram.org → API development tools.",
  );
  process.exit(1);
}
if (!TOKEN) {
  console.error("CHIP_API_TOKEN é obrigatório: sem ele qualquer um manda mensagem pelo chip.");
  process.exit(1);
}

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

/**
 * Conexões vivas, por conta. `pending` guarda o login pela metade (entre
 * mandar o telefone e receber o código) — inclusive o cliente, que precisa ser
 * o MESMO nas duas etapas: o phone_code_hash só vale na conexão que o pediu.
 */
const clients = new Map();
const pending = new Map();

const sessionFile = (accountId) => path.join(SESSIONS_DIR, `${accountId}.session`);

function readSession(accountId) {
  try {
    return fs.readFileSync(sessionFile(accountId), "utf8").trim();
  } catch {
    return "";
  }
}

function writeSession(accountId, session) {
  try {
    fs.writeFileSync(sessionFile(accountId), session, { mode: 0o600 });
  } catch (e) {
    console.error(`[${accountId}] não consegui gravar a sessão:`, e.message);
  }
}

function dropSession(accountId) {
  try {
    fs.unlinkSync(sessionFile(accountId));
  } catch {
    /* já não existia */
  }
}

function novoCliente(session) {
  return new TelegramClient(new StringSession(session || ""), API_ID, API_HASH, {
    connectionRetries: 5,
    // A conta real é um celular; anunciar-se como tal reduz a chance de o
    // Telegram tratar a sessão como automação.
    deviceModel: "iPhone",
    systemVersion: "iOS 17.5",
    appVersion: "10.9",
  });
}

/** Repassa a mensagem recebida para o painel. */
async function avisarPainel(accountId, evento) {
  if (!WEBHOOK_URL) return;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ accountId, ...evento }),
    });
    if (!res.ok) console.error(`[${accountId}] painel recusou o webhook: ${res.status}`);
  } catch (e) {
    console.error(`[${accountId}] não alcancei o painel:`, e.message);
  }
}

/**
 * Só conversa privada de gente interessa. Grupo, canal e as mensagens que a
 * própria modelo mandou do celular dela entrariam no histórico como se fossem
 * do lead, e a IA responderia a si mesma.
 */
function escutar(accountId, client) {
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg || msg.out) return;
      const peer = msg.peerId;
      if (!peer || peer.className !== "PeerUser") return;
      const sender = await msg.getSender().catch(() => null);
      if (!sender || sender.bot) return;
      const nome = [sender.firstName, sender.lastName].filter(Boolean).join(" ").trim();
      await avisarPainel(accountId, {
        peerRef: String(sender.id),
        peerName: nome || sender.username || undefined,
        text: msg.message || "",
        hasMedia: Boolean(msg.media),
        messageId: msg.id,
      });
    } catch (e) {
      console.error(`[${accountId}] erro tratando mensagem:`, e.message);
    }
  }, new NewMessage({ incoming: true }));
}

async function conectar(accountId, session) {
  const client = novoCliente(session);
  await client.connect();
  if (!(await client.checkAuthorization())) {
    await client.disconnect().catch(() => {});
    throw new Error("Sessão inválida ou expirada — reconecte o chip.");
  }
  escutar(accountId, client);
  clients.set(accountId, client);
  return client;
}

/** Devolve o cliente vivo; reconecta a partir da sessão em disco se preciso. */
async function clienteDe(accountId, sessionDoPainel) {
  const vivo = clients.get(accountId);
  if (vivo && vivo.connected) return vivo;
  const session = sessionDoPainel || readSession(accountId);
  if (!session) throw new Error("Este chip não está conectado.");
  return conectar(accountId, session);
}

const app = express();
app.use(express.json({ limit: "25mb" }));

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const header = req.get("authorization") || "";
  if (header !== `Bearer ${TOKEN}`) return res.status(401).json({ error: "não autorizado" });
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, contas: clients.size }));

/**
 * Etapa 1 do login: manda o código para o telefone. O cliente fica guardado em
 * `pending` porque a etapa 2 precisa dele — e some sozinho em 10 minutos, que
 * é mais ou menos a validade do código.
 */
app.post("/sessions/start", async (req, res) => {
  const { accountId, phone } = req.body || {};
  if (!accountId || !phone) return res.status(400).json({ error: "accountId e phone são obrigatórios" });
  try {
    const anterior = pending.get(accountId);
    if (anterior) {
      clearTimeout(anterior.timer);
      await anterior.client.disconnect().catch(() => {});
    }
    const client = novoCliente("");
    await client.connect();
    const { phoneCodeHash } = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
    const timer = setTimeout(() => {
      const p = pending.get(accountId);
      if (p) {
        p.client.disconnect().catch(() => {});
        pending.delete(accountId);
      }
    }, 10 * 60 * 1000);
    pending.set(accountId, { client, phone, phoneCodeHash, timer });
    res.json({ status: "code_sent" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Etapa 2: código (e a senha da verificação em duas etapas, quando a conta
 * tem). Devolve a sessão para o painel guardar cifrada.
 */
app.post("/sessions/confirm", async (req, res) => {
  const { accountId, code, password } = req.body || {};
  if (!accountId || !code) return res.status(400).json({ error: "accountId e code são obrigatórios" });
  const p = pending.get(accountId);
  if (!p) return res.status(400).json({ error: "Nenhum código pendente. Peça o código de novo." });
  try {
    try {
      await p.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: p.phone,
          phoneCodeHash: p.phoneCodeHash,
          phoneCode: String(code),
        }),
      );
    } catch (e) {
      // Conta com verificação em duas etapas: o código sozinho não basta.
      if (String(e.errorMessage || e.message).includes("SESSION_PASSWORD_NEEDED")) {
        if (!password) {
          return res.status(409).json({ error: "password_needed" });
        }
        await p.client.signInWithPassword(
          { apiId: API_ID, apiHash: API_HASH },
          { password: async () => password, onError: (err) => { throw err; } },
        );
      } else {
        throw e;
      }
    }

    const me = await p.client.getMe();
    const session = p.client.session.save();
    clearTimeout(p.timer);
    pending.delete(accountId);

    writeSession(accountId, session);
    escutar(accountId, p.client);
    clients.set(accountId, p.client);

    res.json({
      status: "connected",
      session,
      phone: me.phone ? `+${me.phone}` : p.phone,
      name: [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.username || "",
      username: me.username || null,
    });
  } catch (e) {
    res.status(400).json({ error: e.errorMessage || e.message });
  }
});

app.post("/sessions/:accountId/status", async (req, res) => {
  const { accountId } = req.params;
  const { session } = req.body || {};
  try {
    const client = await clienteDe(accountId, session);
    const me = await client.getMe();
    res.json({
      status: "connected",
      phone: me.phone ? `+${me.phone}` : null,
      name: [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.username || "",
    });
  } catch (e) {
    res.json({ status: "disconnected", error: e.message });
  }
});

/**
 * Envia pelo chip. `mediaUrl` chega como URL porque a mídia mora no painel;
 * baixar aqui evita mandar arquivo grande em base64 pela rede interna.
 */
app.post("/sessions/:accountId/send", async (req, res) => {
  const { accountId } = req.params;
  const { session, peerRef, text, mediaUrl, mediaName, voice } = req.body || {};
  if (!peerRef) return res.status(400).json({ error: "peerRef é obrigatório" });
  try {
    const client = await clienteDe(accountId, session);
    const destino = await client.getInputEntity(
      /^-?\d+$/.test(String(peerRef)) ? BigInt(peerRef) : String(peerRef),
    );

    if (mediaUrl) {
      const r = await fetch(mediaUrl);
      if (!r.ok) throw new Error(`não consegui baixar a mídia (${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      const file = new (require("telegram").CustomFile)(
        mediaName || "arquivo",
        buf.length,
        "",
        buf,
      );
      await client.sendFile(destino, {
        file,
        caption: text || undefined,
        voiceNote: Boolean(voice),
      });
    } else {
      if (!text) return res.status(400).json({ error: "mande text ou mediaUrl" });
      await client.sendMessage(destino, { message: text });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.errorMessage || e.message });
  }
});

/** Mostra "digitando…" enquanto a resposta é composta — é o que parece gente. */
app.post("/sessions/:accountId/typing", async (req, res) => {
  const { accountId } = req.params;
  const { session, peerRef } = req.body || {};
  try {
    const client = await clienteDe(accountId, session);
    const destino = await client.getInputEntity(
      /^-?\d+$/.test(String(peerRef)) ? BigInt(peerRef) : String(peerRef),
    );
    await client.invoke(
      new Api.messages.SetTyping({ peer: destino, action: new Api.SendMessageTypingAction() }),
    );
    res.json({ ok: true });
  } catch (e) {
    // "Digitando" é enfeite: falhar aqui não pode derrubar o envio.
    res.json({ ok: false, error: e.message });
  }
});

app.delete("/sessions/:accountId", async (req, res) => {
  const { accountId } = req.params;
  const client = clients.get(accountId);
  if (client) {
    // logOut invalida a sessão no servidor do Telegram; só desconectar
    // deixaria o aparelho na lista de sessões ativas da conta.
    await client.invoke(new Api.auth.LogOut()).catch(() => {});
    await client.disconnect().catch(() => {});
    clients.delete(accountId);
  }
  const p = pending.get(accountId);
  if (p) {
    clearTimeout(p.timer);
    await p.client.disconnect().catch(() => {});
    pending.delete(accountId);
  }
  dropSession(accountId);
  res.json({ ok: true });
});

/**
 * Religa no boot o que já estava conectado. Sem isso, todo deploy deixaria os
 * leads falando sozinhos até alguém abrir a tela.
 */
async function religarSessoes() {
  let arquivos = [];
  try {
    arquivos = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".session"));
  } catch {
    return;
  }
  for (const arquivo of arquivos) {
    const accountId = path.basename(arquivo, ".session");
    try {
      await conectar(accountId, readSession(accountId));
      console.log(`[${accountId}] chip religado`);
    } catch (e) {
      console.error(`[${accountId}] não religou: ${e.message}`);
    }
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`chip do Telegram ouvindo na porta ${PORT}`);
  religarSessoes();
});
