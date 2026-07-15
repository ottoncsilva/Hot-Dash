import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { processWhatsappAgent } from "@/lib/whatsappAgent";

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const instanceName = body.instance;
    if (!instanceName) return NextResponse.json({ ok: true });

    const db = getDb();
    const now = Date.now();

    const instanceRow = db.prepare(`SELECT profile_id FROM whatsapp_instances WHERE instance_name = ?`).get(instanceName) as any;
    if (!instanceRow) return NextResponse.json({ ok: true });
    const profileId = instanceRow.profile_id;

    // Processamento de Histórico (messages.set)
    if (body.event === "messages.set" || body.event === "messaging-history.set") {
      const messagesArray = body.data?.messages || [];
      if (!Array.isArray(messagesArray)) return NextResponse.json({ ok: true });

      const insertChat = db.prepare(`INSERT OR IGNORE INTO whatsapp_chats (id, profile_id, remote_jid, state, last_interaction_at, created_at) VALUES (?, ?, ?, 'active', ?, ?)`);
      const updateChat = db.prepare(`UPDATE whatsapp_chats SET last_interaction_at = MAX(last_interaction_at, ?) WHERE profile_id = ? AND remote_jid = ?`);
      const insertMsg = db.prepare(`INSERT OR IGNORE INTO whatsapp_messages (id, chat_id, role, content, type, created_at) VALUES (?, ?, ?, ?, 'text', ?)`);
      
      db.transaction(() => {
        for (const msgData of messagesArray) {
          const remoteJid = msgData.key?.remoteJid;
          const fromMe = msgData.key?.fromMe;
          if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.includes("@g.us")) continue;
          
          const content = extractMessageContent(msgData);
          if (!content) continue;

          const msgTime = (msgData.messageTimestamp || Math.floor(now / 1000)) * 1000;
          
          let chatRow = db.prepare(`SELECT id FROM whatsapp_chats WHERE profile_id = ? AND remote_jid = ?`).get(profileId, remoteJid) as any;
          let chatId = chatRow?.id;
          
          if (!chatId) {
            chatId = uuidv4();
            insertChat.run(chatId, profileId, remoteJid, msgTime, msgTime);
          } else {
            updateChat.run(msgTime, profileId, remoteJid);
          }

          const msgId = msgData.key?.id || uuidv4();
          insertMsg.run(msgId, chatId, fromMe ? "assistant" : "user", content, msgTime);
        }
      })();
      
      return NextResponse.json({ ok: true });
    }

    // Filtramos apenas mensagens novas (upsert)
    if (body.event !== "messages.upsert") {
      return NextResponse.json({ ok: true });
    }

    const msgData = body.data;
    if (!msgData) return NextResponse.json({ ok: true });

    const remoteJid = msgData.key?.remoteJid || msgData.remoteJid;
    const fromMe = msgData.key?.fromMe !== undefined ? msgData.key.fromMe : msgData.fromMe;
    
    // Ignorar status do whatsapp e grupos (apenas DM)
    if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.includes("@g.us")) {
      return NextResponse.json({ ok: true });
    }

    const content = extractMessageContent(msgData);

    // Se for mensagem vazia ou midia que nao tratamos, ignora por enquanto
    if (!content && !fromMe) {
      return NextResponse.json({ ok: true });
    }

    // Verificar e Criar o Chat (Sessão do Lead)
    let chatRow = db.prepare(`SELECT id, state FROM whatsapp_chats WHERE profile_id = ? AND remote_jid = ?`).get(profileId, remoteJid) as any;
    
    let chatId = chatRow?.id;
    let chatState = chatRow?.state || "active";

    if (!chatRow) {
      chatId = uuidv4();
      db.prepare(`
        INSERT INTO whatsapp_chats (id, profile_id, remote_jid, state, last_interaction_at, created_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(chatId, profileId, remoteJid, now, now);
    } else {
      db.prepare(`UPDATE whatsapp_chats SET last_interaction_at = ? WHERE id = ?`).run(now, chatId);
    }

    // Salvar a mensagem no histórico (seja da vendedora ou do cliente)
    if (content) {
      const msgId = msgData.key?.id || uuidv4();
      db.prepare(`
        INSERT OR IGNORE INTO whatsapp_messages (id, chat_id, role, content, type, created_at)
        VALUES (?, ?, ?, ?, 'text', ?)
      `).run(msgId, chatId, fromMe ? "assistant" : "user", content, now);
    }

    // Fase 3: Se a mensagem foi do Lead (fromMe = false) E o chat está "active" (IA ligada), processa IA
    if (!fromMe && chatState === "active" && content) {
      processWhatsappAgent(chatId, profileId, remoteJid, instanceName);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Evolution Webhook Error:", err);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
