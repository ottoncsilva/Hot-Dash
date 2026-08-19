import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  getAiSettingsPublic,
  updateAiSettings,
  setChaveMidiaGoogle,
  temChaveMidiaGoogle,
  type AiActivityModels,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({ settings: getAiSettingsPublic(), temChaveMidiaGoogle: temChaveMidiaGoogle() });
  } catch (err) {
    return errorResponse(err);
  }
}

function parseProviderPatch(raw: unknown): { enabled?: boolean; apiKey?: string; model?: string; baseUrl?: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : undefined,
    apiKey: typeof r.apiKey === "string" ? r.apiKey : undefined,
    model: typeof r.model === "string" ? r.model : undefined,
    baseUrl: typeof r.baseUrl === "string" ? r.baseUrl : undefined,
  };
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const settings = updateAiSettings({
      openai: parseProviderPatch(body.openai),
      gemini: parseProviderPatch(body.gemini),
      grok: parseProviderPatch(body.grok),
      openrouter: parseProviderPatch(body.openrouter),
      magnific: parseProviderPatch(body.magnific),
      kling: parseProviderPatch(body.kling),
      nudenet: parseProviderPatch(body.nudenet),
      // A validação das chaves (atividade e provedor conhecidos) fica em
      // updateAiSettings, que é por onde qualquer chamador passa.
      activityModels:
        body.activityModels && typeof body.activityModels === "object"
          ? (body.activityModels as AiActivityModels)
          : undefined,
    });
    // A chave só de mídia (Nano Banana e Veo) não é um "provedor": não tem
    // modelo por atividade nem teste de conexão, então anda por fora do
    // updateAiSettings. String vazia apaga.
    if (typeof body.googleMediaKey === "string") {
      setChaveMidiaGoogle(body.googleMediaKey);
    }

    return NextResponse.json({ settings, temChaveMidiaGoogle: temChaveMidiaGoogle() });
  } catch (err) {
    return errorResponse(err);
  }
}
