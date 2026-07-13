import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getAiSettingsPublic, updateAiSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ settings: getAiSettingsPublic() });
  } catch (err) {
    return errorResponse(err);
  }
}

function parseProviderPatch(raw: unknown): { enabled?: boolean; apiKey?: string; model?: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : undefined,
    apiKey: typeof r.apiKey === "string" ? r.apiKey : undefined,
    model: typeof r.model === "string" ? r.model : undefined,
  };
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const settings = updateAiSettings({
      openai: parseProviderPatch(body.openai),
      gemini: parseProviderPatch(body.gemini),
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
