import { NextRequest, NextResponse } from "next/server";
import { runTelegramEviction } from "@/lib/telegramCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gatilho HTTP (manual/externo) da expiração de assinaturas VIP. A lógica vive
 * em `@/lib/telegramCron` e também roda sozinha pelo agendador em segundo plano
 * (`src/instrumentation.ts`).
 */
export async function GET(req: NextRequest) {
  try {
    // Rota protegida por token do cron (SESSION_SECRET)
    const token = req.nextUrl.searchParams.get("token");
    if (!token || token !== process.env.SESSION_SECRET) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const evicted = await runTelegramEviction();
    return NextResponse.json({ ok: true, evicted });
  } catch (err) {
    console.error("Cron Eviction Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
