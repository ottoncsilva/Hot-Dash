import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const profileId = url.searchParams.get("profileId");

    if (!profileId) {
      return NextResponse.json({ error: "Missing profileId" }, { status: 400 });
    }

    const db = getDb();
    let row = db
      .prepare(`SELECT * FROM whatsapp_agent_settings WHERE profile_id = ?`)
      .get(profileId) as any;

    if (!row) {
      // Cria configurações iniciais caso não existam (default).
      const insert = db.prepare(
        `INSERT INTO whatsapp_agent_settings (profile_id, prompt, enable_media, enable_billing) VALUES (?, ?, 1, 1)`
      );
      insert.run(profileId);
      row = db
        .prepare(`SELECT * FROM whatsapp_agent_settings WHERE profile_id = ?`)
        .get(profileId);
    }

    return NextResponse.json({
      settings: {
        prompt: row.prompt || "",
        enable_media: Boolean(row.enable_media),
        enable_billing: Boolean(row.enable_billing),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { profileId, prompt, enable_media, enable_billing } = body;

    if (!profileId) {
      return NextResponse.json({ error: "Missing profileId" }, { status: 400 });
    }

    const db = getDb();
    
    // Assegura que o registro exista
    const row = db.prepare(`SELECT 1 FROM whatsapp_agent_settings WHERE profile_id = ?`).get(profileId);
    if (!row) {
      db.prepare(`INSERT INTO whatsapp_agent_settings (profile_id, prompt, enable_media, enable_billing) VALUES (?, ?, ?, ?)`).run(profileId, prompt, enable_media ? 1 : 0, enable_billing ? 1 : 0);
    } else {
      const update = db.prepare(
        `UPDATE whatsapp_agent_settings SET prompt = ?, enable_media = ?, enable_billing = ? WHERE profile_id = ?`
      );
      update.run(
        typeof prompt === "string" ? prompt : "",
        enable_media ? 1 : 0,
        enable_billing ? 1 : 0,
        profileId
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
