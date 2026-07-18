import { NextResponse } from "next/server";
import { processReminders } from "@/lib/cronTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sent = await processReminders();
    return NextResponse.json({ success: true, sent });
  } catch (err: any) {
    console.error("Erro na cron de reminders:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
