import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getAiKeyForTest } from "@/lib/settings";
import { testAiProviderKey } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const provider = body.provider;
    if (!["openai", "gemini", "grok", "sightengine"].includes(provider)) throw new ApiError(400, "Provedor inválido.");

    const apiKey = typeof body.apiKey === "string" && body.apiKey ? body.apiKey : getAiKeyForTest(provider);
    if (!apiKey) {
      return NextResponse.json({ connected: false, message: "Cole a chave de API." });
    }
    
    let apiUser = body.apiUser;
    if (provider === "sightengine" && !apiUser) {
      // @ts-ignore
      apiUser = require("@/lib/settings").getSettings().sightengine.apiUser;
    }

    const result = await testAiProviderKey(provider, apiKey, { baseUrl: body.baseUrl, apiUser });
    return NextResponse.json({ connected: result.ok, message: result.message });
  } catch (err) {
    return errorResponse(err);
  }
}
