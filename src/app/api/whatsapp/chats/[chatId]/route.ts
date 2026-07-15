import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import { sendEvolutionText, sendEvolutionMedia } from "@/lib/evolution";
import { readFileSync } from "fs";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { chatId: string } }) {
  try {
    await requireUser(req);
    const db = getDb();
    const chatId = params.chatId;

    const chat = db.prepare(`
      SELECT c.*, p.name as profile_name 
      FROM whatsapp_chats c 
      JOIN profiles p ON p.id = c.profile_id 
      WHERE c.id = ?
    `).get(chatId) as any;

    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    const messages = db.prepare(`
      SELECT * FROM whatsapp_messages 
      WHERE chat_id = ? 
      ORDER BY created_at ASC
    `).all(chatId);

    return NextResponse.json({ chat, messages });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { chatId: string } }) {
  try {
    await requireUser(req);
    const db = getDb();
    const chatId = params.chatId;
    const body = await req.json();
    const action = body.action;

    const chat = db.prepare(`SELECT * FROM whatsapp_chats WHERE id = ?`).get(chatId) as any;
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    if (action === "toggle_ai") {
      const newState = chat.state === "active" ? "paused" : "active";
      db.prepare(`UPDATE whatsapp_chats SET state = ? WHERE id = ?`).run(newState, chatId);
      return NextResponse.json({ state: newState });
    }

    if (action === "send_message") {
      const content = body.content;
      if (!content) return NextResponse.json({ error: "Message content required" }, { status: 400 });

      // Pegar o nome da instancia
      const instanceRow = db.prepare(`SELECT instance_name FROM whatsapp_instances WHERE profile_id = ?`).get(chat.profile_id) as any;
      if (!instanceRow) return NextResponse.json({ error: "Instance not found" }, { status: 404 });

      // Envia via Evolution API
      await sendEvolutionText(instanceRow.instance_name, chat.remote_jid, content);

      // Salva no DB
      const now = Date.now();
      db.prepare(`
        INSERT INTO whatsapp_messages (id, chat_id, role, content, type, created_at)
        VALUES (?, ?, ?, ?, 'text', ?)
      `).run(uuidv4(), chatId, "assistant", content, now);
      
      db.prepare(`UPDATE whatsapp_chats SET last_interaction_at = ? WHERE id = ?`).run(now, chatId);

      return NextResponse.json({ ok: true });
    }

    if (action === "send_media") {
      const mediaId = body.mediaId;
      if (!mediaId) return NextResponse.json({ error: "Media ID required" }, { status: 400 });

      const instanceRow = db.prepare(`SELECT instance_name FROM whatsapp_instances WHERE profile_id = ?`).get(chat.profile_id) as any;
      if (!instanceRow) return NextResponse.json({ error: "Instance not found" }, { status: 404 });

      const mediaRow = db.prepare(`SELECT * FROM media WHERE id = ?`).get(mediaId) as any;
      if (!mediaRow) return NextResponse.json({ error: "Media not found" }, { status: 404 });

      const baseDir = resolve(process.env.MEDIA_STORAGE_DIR || "/app/data");
      const fullPath = resolve(baseDir, mediaRow.path);
      const fileBuffer = readFileSync(fullPath);
      const base64 = fileBuffer.toString("base64");

      await sendEvolutionMedia(
        instanceRow.instance_name,
        chat.remote_jid,
        base64,
        mediaRow.mime || "image/jpeg",
        ""
      );

      const now = Date.now();
      db.prepare(`
        INSERT INTO whatsapp_messages (id, chat_id, role, content, type, created_at)
        VALUES (?, ?, ?, ?, 'imagem', ?)
      `).run(uuidv4(), chatId, "assistant", "📸 Mídia enviada manualmente", now);
      
      db.prepare(`UPDATE whatsapp_chats SET last_interaction_at = ? WHERE id = ?`).run(now, chatId);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
