import { NextResponse } from "next/server";
import { runTelegramMailings } from "@/lib/telegramCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gatilho HTTP (manual/externo) dos disparos de mailing. A lógica vive em
 * `@/lib/telegramCron` e também roda sozinha pelo agendador em segundo plano
 * (`src/instrumentation.ts`).
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sent, failed } = await runTelegramMailings();
  return NextResponse.json({ ok: true, sent, failed });
}
