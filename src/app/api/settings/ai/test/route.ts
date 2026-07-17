import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getAiKeyForTest, getNudenetConfig } from "@/lib/settings";
import { testAiProviderKey } from "@/lib/ai";
import { pingNudenet } from "@/lib/nudenet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const provider = body.provider;
    if (!["openai", "gemini", "grok", "sightengine", "magnific", "kling", "nudenet"].includes(provider)) throw new ApiError(400, "Provedor inválido.");

    // NudeNet é um serviço próprio (URL + token opcional), não uma chave de API.
    if (provider === "nudenet") {
      const saved = getNudenetConfig();
      const url = typeof body.baseUrl === "string" && body.baseUrl ? body.baseUrl : saved?.url || "";
      const token = typeof body.apiKey === "string" && body.apiKey ? body.apiKey : saved?.token;
      const result = await pingNudenet(url, token);
      return NextResponse.json({ connected: result.ok, message: result.message });
    }

    const testProvider = (provider === "kling") ? "magnific" : provider;
    const apiKey = typeof body.apiKey === "string" && body.apiKey ? body.apiKey : getAiKeyForTest(testProvider);
    if (!apiKey) {
      return NextResponse.json({ connected: false, message: "Cole a chave de API." });
    }
    
    let apiUser = body.apiUser;
    if (provider === "sightengine" && !apiUser) {
      // @ts-ignore
      apiUser = require("@/lib/settings").getSettings().sightengine.apiUser;
    }

    const result = await testAiProviderKey(testProvider, apiKey, { baseUrl: body.baseUrl, apiUser });
    return NextResponse.json({ connected: result.ok, message: result.message });
  } catch (err) {
    return errorResponse(err);
  }
}
