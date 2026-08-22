import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { responderLead } from "@/lib/ltvAgent";
import {
  ensureChat,
  findAccountByRef,
  insertMessage,
  setChatState,
  type LtvAccount,
} from "@/lib/ltvDb";

export const runtime = "nodejs";

function extractMessageContent(msgData: any): string | null {
  if (!msgData) return null;
  const m = msgData.message || msgData;
  if (!m) return null;
  // Evolution envia texto puro em "conversation" ou "extendedTextMessage.text"
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text;
  if (m.imageMessage && m.imageMessage.caption) return m.imageMessage.caption;
  if (m.videoMessage && m.videoMessage.caption) return m.videoMessage.caption;

  return null;
}

/** Status do WhatsApp e grupo não são lead: só conversa privada interessa. */
function ehConversaDeLead(remoteJid: string | undefined): remoteJid is string {
  return Boolean(remoteJid && remoteJid !== "status@broadcast" && !remoteJid.includes("@g.us"));
}

/**
 * Grava uma mensagem já existente do histórico. Diferente da mensagem nova,
 * aqui o id vem da Evolution — é o que impede a mesma mensagem de entrar duas
 * vezes quando a instância reenvia o histórico.
 */
function gravarHistorico(conta: LtvAccount, mensagens: any[], agora: number) {
  const db = getDb();
  db.transaction(() => {
    for (const msgData of mensagens) {
      const remoteJid = msgData.key?.remoteJid;
      if (!ehConversaDeLead(remoteJid)) continue;
      const content = extractMessageContent(msgData);
      if (!content) continue;

      const quando = (msgData.messageTimestamp || Math.floor(agora / 1000)) * 1000;
      const chat = ensureChat(conta.id, remoteJid);
      const msgId = msgData.key?.id;
      db.prepare(
        `INSERT OR IGNORE INTO ltv_messages (id, chat_id, role, content, type, created_at)
         VALUES (?, ?, ?, ?, 'text', ?)`,
      ).run(
        msgId || `${chat.id}:${quando}`,
        chat.id,
        msgData.key?.fromMe ? "assistant" : "user",
        content,
        quando,
      );
      db.prepare(
        `UPDATE ltv_chats SET last_interaction_at = MAX(last_interaction_at, ?) WHERE id = ?`,
      ).run(quando, chat.id);
    }
  })();
}

/**
 * Esta mensagem "minha" é o eco de algo que o painel acabou de enviar?
 * A janela é curta de propósito: a IA acabou de mandar, então o eco chega em
 * segundos. Uma janela larga engoliria uma resposta humana de verdade que por
 * acaso repetisse o texto.
 */
function ehEcoDoQueMandamos(chatId: string, content: string, agora: number): boolean {
  const janela = agora - 2 * 60 * 1000;
  const igual = getDb()
    .prepare(
      `SELECT 1 FROM ltv_messages
        WHERE chat_id = ? AND role = 'assistant' AND content = ? AND created_at >= ?
        LIMIT 1`,
    )
    .get(chatId, content, janela);
  return Boolean(igual);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const instanceName = body.instance;
    if (!instanceName) return NextResponse.json({ ok: true });

    // A instância aponta para UMA conta de LTV. Com o multi-número, é ela que
    // diz de qual "Número" da modelo esta mensagem é — não dá mais para
    // resolver só pela modelo.
    const conta = findAccountByRef("whatsapp", instanceName);
    if (!conta) return NextResponse.json({ ok: true });

    const now = Date.now();

    if (
      body.event === "messages.set" ||
      body.event === "messaging-history.set" ||
      body.event === "CHATS_SET" ||
      body.event === "MESSAGING_HISTORY_SET"
    ) {
      const mensagens = body.data?.messages || [];
      if (Array.isArray(mensagens)) gravarHistorico(conta, mensagens, now);
      return NextResponse.json({ ok: true });
    }

    if (body.event !== "messages.upsert" && body.event !== "MESSAGES_UPSERT") {
      return NextResponse.json({ ok: true });
    }

    const msgData = body.data;
    if (!msgData) return NextResponse.json({ ok: true });

    const remoteJid = msgData.key?.remoteJid || msgData.remoteJid;
    const fromMe = msgData.key?.fromMe !== undefined ? msgData.key.fromMe : msgData.fromMe;
    if (!ehConversaDeLead(remoteJid)) return NextResponse.json({ ok: true });

    const content = extractMessageContent(msgData);
    if (!content) return NextResponse.json({ ok: true });

    const chat = ensureChat(conta.id, remoteJid, msgData.pushName || undefined);

    // Precisa ser decidido ANTES de gravar: gravada primeiro, a mensagem
    // casaria consigo mesma e toda resposta humana pareceria eco.
    const eco = fromMe && ehEcoDoQueMandamos(chat.id, content, now);

    // O id da Evolution é a trava contra a mensagem duplicada: o provedor
    // reentrega o evento quando não recebe 200 a tempo.
    const msgId = msgData.key?.id;
    if (msgId) {
      const jaTem = getDb()
        .prepare(`SELECT 1 FROM ltv_messages WHERE id = ?`)
        .get(msgId);
      if (jaTem) return NextResponse.json({ ok: true });
      getDb()
        .prepare(
          `INSERT INTO ltv_messages (id, chat_id, role, content, type, created_at)
           VALUES (?, ?, ?, ?, 'text', ?)`,
        )
        .run(msgId, chat.id, fromMe ? "assistant" : "user", content, now);
      getDb().prepare(`UPDATE ltv_chats SET last_interaction_at = ? WHERE id = ?`).run(now, chat.id);
    } else {
      insertMessage({
        chatId: chat.id,
        role: fromMe ? "assistant" : "user",
        content,
      });
    }

    // A modelo respondeu do celular DELA: assume a conversa e cala a IA, igual
    // a responder pelo Chat ao vivo. Duas vozes no mesmo chat é o pior
    // resultado possível.
    //
    // O truque é separar isso do ECO: o que a própria IA mandou volta pela
    // Evolution também marcado como fromMe, e pausar nisso desligaria a IA já
    // na primeira resposta dela. Se o texto bate com algo que acabamos de
    // gravar como nosso, é eco; se não bate, foi gente digitando.
    if (fromMe) {
      if (!eco) setChatState(chat.id, "paused");
      return NextResponse.json({ ok: true });
    }

    void responderLead(chat.id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Evolution Webhook Error:", err);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
