import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getMenu, setMenu } from "@/lib/settings";
import type { MenuEntry } from "@/lib/navItems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ menu: getMenu() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const menu = Array.isArray(body.menu) ? (body.menu as MenuEntry[]) : [];
    return NextResponse.json({ menu: setMenu(menu) });
  } catch (err) {
    return errorResponse(err);
  }
}
