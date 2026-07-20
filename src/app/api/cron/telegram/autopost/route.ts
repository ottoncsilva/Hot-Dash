import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/apiAuth";
import { runTelegramAutopost } from "@/lib/telegramCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gatilho HTTP (manual/externo) do autopost. A lógica de verdade vive em
 * `@/lib/telegramCron` e também é executada automaticamente pelo agendador em
 * segundo plano (`src/instrumentation.ts`) — esta rota existe para depuração
 * e para permitir um cron externo, se desejado.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");

    let isAuthorized = false;
    if (token && token === process.env.SESSION_SECRET) {
      isAuthorized = true;
    } else {
      try {
        await requireUser(req);
        isAuthorized = true;
      } catch {
        isAuthorized = false;
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const posted = await runTelegramAutopost();
    return NextResponse.json({ ok: true, posted });
  } catch (err) {
    console.error("Cron Autopost Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
