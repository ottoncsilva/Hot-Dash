import { NextResponse } from "next/server";
import { runTelegramFunnels } from "@/lib/telegramCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gatilho HTTP (manual/externo) dos funis de downsell/upsell. A lógica vive em
 * `@/lib/telegramCron` e também roda sozinha pelo agendador em segundo plano
 * (`src/instrumentation.ts`).
 */
export async function GET(req: Request) {
  // Autenticação básica via Cron Secret
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { downsellCount, upsellCount } = await runTelegramFunnels();
  return NextResponse.json({ ok: true, downsellCount, upsellCount });
}
