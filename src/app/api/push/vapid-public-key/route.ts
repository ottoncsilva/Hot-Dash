import { NextResponse } from "next/server";
import { getVapidPublicKey, initWebPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    initWebPush();
    return NextResponse.json({ publicKey: getVapidPublicKey() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
