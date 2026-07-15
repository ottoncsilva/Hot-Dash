import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { processWhatsappAgent } from "@/lib/whatsappAgent";

export const runtime = "nodejs";

function extractMessageContent(msgData: any): string | null {
  if (!msgData || !msgData.message) return null;
  const m = msgData.message;
  // Evolution envia texto puro em "conversation" ou "extendedTextMessage.text"
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text;
  
  // Ignora audios, imagens e figurinhas por enquanto
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Filtramos apenas mensagens novas (upsert)
    if (body.event !== "messages.upsert") {
      return NextResponse.json({ ok: true });
    }

    const instanceName = body.instance;
    const msgData = body.data?.message;

    if (!instanceName || !msgData) {
      return NextResponse.json({ ok: true });
    }

    const remoteJid = msgData.key?.remoteJid;
    const fromMe = msgData.key?.fromMe;
    
    // Ignorar status do whatsapp e grupos (apenas DM)
    if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.includes("@g.us")) {
      return NextResponse.json({ ok: true });
    }

    const content = extractMessageContent(msgData);

    // Se for mensagem vazia ou midia que nao tratamos, ignora por enquanto
    if (!content && !fromMe) {
      return NextResponse.json({ ok: true });
    }

    const db = getDb();
    const now = Date.now();

    // Identificar a qual modelo pertence essa instancia
    const instanceRow = db.prepare(`SELECT profile_id FROM whatsapp_instances WHERE instance_name = ?`).get(instanceName) as any;
    if (!instanceRow) return NextResponse.json({ ok: true });

    const profileId = instanceRow.profile_id;

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
      db.prepare(`
        INSERT INTO whatsapp_messages (id, chat_id, role, content, type, created_at)
        VALUES (?, ?, ?, ?, 'text', ?)
      `).run(uuidv4(), chatId, fromMe ? "assistant" : "user", content, now);
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
