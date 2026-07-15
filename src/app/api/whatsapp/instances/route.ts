import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import { createEvolutionInstance, connectEvolutionInstance, getStateEvolutionInstance, logoutEvolutionInstance, setEvolutionWebhook } from "@/lib/evolution";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const profileId = url.searchParams.get("profileId");

    if (!profileId) return NextResponse.json({ error: "Missing profileId" }, { status: 400 });

    const db = getDb();
    let row = db.prepare(`SELECT * FROM whatsapp_instances WHERE profile_id = ?`).get(profileId) as any;

    if (!row) {
      return NextResponse.json({ status: "disconnected", instance: null });
    }

    // Se existe no BD, checamos o status na API da evolution
    const state = await getStateEvolutionInstance(row.instance_name);
    
    if (state && state.instance) {
      const stateName = state.instance.state; // ex: "open", "connecting", "close"
      if (stateName === "open") {
        if (row.status !== "connected") {
          db.prepare(`UPDATE whatsapp_instances SET status = 'connected', updated_at = ? WHERE id = ?`).run(Date.now(), row.id);
        }
        return NextResponse.json({ status: "connected", instance: row.instance_name });
      }
    }

    return NextResponse.json({ status: "disconnected", instance: row.instance_name });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json();
    const { action, profileId } = body;
    if (!profileId) return NextResponse.json({ error: "Missing profileId" }, { status: 400 });

    const db = getDb();
    const now = Date.now();
    let row = db.prepare(`SELECT * FROM whatsapp_instances WHERE profile_id = ?`).get(profileId) as any;

    if (action === "connect") {
      let instanceName = row?.instance_name;
      let qrcodeData = null;

      if (!row) {
        // Obtain profile name to generate slug
        const profileRow = db.prepare(`SELECT name FROM profiles WHERE id = ?`).get(profileId) as any;
        const profileName = profileRow?.name || "model";
        const slug = profileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^\-+|\-+$/g, "");
        instanceName = `hotdash_${slug}`;
        const res = await createEvolutionInstance(instanceName);
        qrcodeData = res?.qrcode?.base64 || res?.base64; // depende da versão da evolution api

        // Configura o webhook automaticamente usando a origem da requisição
        const origin = new URL(req.url).origin;
        const webhookUrl = `${origin}/api/webhooks/evolution`;
        await setEvolutionWebhook(instanceName, webhookUrl);

        db.prepare(
          `INSERT INTO whatsapp_instances (id, profile_id, instance_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(uuidv4(), profileId, instanceName, "connecting", now, now);

      } else {
        // Ja existe, tenta conectar
        const res = await connectEvolutionInstance(instanceName);
        qrcodeData = res?.qrcode?.base64 || res?.base64 || res?.qrcode;
        
        db.prepare(`UPDATE whatsapp_instances SET status = 'connecting', updated_at = ? WHERE id = ?`).run(now, row.id);
      }

      return NextResponse.json({ status: "connecting", qrcode: qrcodeData });
    }

    if (action === "disconnect") {
      if (row) {
        try { await logoutEvolutionInstance(row.instance_name); } catch (e) { /* ignore se nao existir na evolution */ }
        db.prepare(`DELETE FROM whatsapp_instances WHERE id = ?`).run(row.id);
      }
      return NextResponse.json({ status: "disconnected" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
