import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const db = getDb();
    
    // Lista os chats ordenados pelos mais recentes, trazendo a ultima mensagem de cada um
    const chats = db.prepare(`
      SELECT c.*, p.name as profile_name,
             (SELECT content FROM whatsapp_messages m WHERE m.chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM whatsapp_chats c
      JOIN profiles p ON p.id = c.profile_id
      ORDER BY c.last_interaction_at DESC
    `).all();

    return NextResponse.json({ chats });
  } catch (err) {
    return errorResponse(err);
  }
}
