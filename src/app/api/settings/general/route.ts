import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getAppTimeZone, setAppTimeZone } from "@/lib/settings";
import { DEFAULT_TIME_ZONE, isValidTimeZone, partsInTimeZone } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Devolve o fuso da operação + a hora atual nele (para conferência na tela). */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const timeZone = getAppTimeZone();
    const p = partsInTimeZone(Date.now(), timeZone);
    return NextResponse.json({
      timeZone,
      now: `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
      serverUtc: new Date().toISOString(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const tz = typeof body.timeZone === "string" ? body.timeZone : DEFAULT_TIME_ZONE;
    if (!isValidTimeZone(tz)) {
      return NextResponse.json({ error: "Fuso horário inválido." }, { status: 400 });
    }
    const timeZone = setAppTimeZone(tz);
    const p = partsInTimeZone(Date.now(), timeZone);
    return NextResponse.json({
      timeZone,
      now: `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
