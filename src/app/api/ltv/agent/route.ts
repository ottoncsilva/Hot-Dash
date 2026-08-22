import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getAccount, getAgent, saveAgent, type LtvAgentSettings } from "@/lib/ltvDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const accountId = new URL(req.url).searchParams.get("accountId") || "";
    if (!getAccount(accountId)) throw new ApiError(404, "Conta não encontrada.");
    return NextResponse.json({ agent: getAgent(accountId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const accountId = String(body.accountId || "");
    if (!getAccount(accountId)) throw new ApiError(404, "Conta não encontrada.");

    // Só os campos conhecidos entram: o corpo vem da tela, e um campo extra
    // não pode virar coluna nova nem sobrescrever o accountId.
    const patch: Partial<LtvAgentSettings> = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.approach === "aquecer" || body.approach === "direto") patch.approach = body.approach;
    if (typeof body.personaName === "string") patch.personaName = body.personaName;
    if (Array.isArray(body.toneTags)) {
      patch.toneTags = body.toneTags.filter((t: unknown) => typeof t === "string");
    }
    if (typeof body.personality === "string") patch.personality = body.personality;
    if (typeof body.mechanism === "string") patch.mechanism = body.mechanism;
    if (typeof body.limits === "string") patch.limits = body.limits;
    if (body.rhythm === "humano" || body.rhythm === "fixo") patch.rhythm = body.rhythm;
    if (Number.isFinite(body.delayMinS)) patch.delayMinS = Number(body.delayMinS);
    if (Number.isFinite(body.delayMaxS)) patch.delayMaxS = Number(body.delayMaxS);
    if (Number.isFinite(body.dailyLimit)) patch.dailyLimit = Number(body.dailyLimit);
    if (typeof body.onlyReplyFirst === "boolean") patch.onlyReplyFirst = body.onlyReplyFirst;

    return NextResponse.json({ agent: saveAgent(accountId, patch) });
  } catch (err) {
    return errorResponse(err);
  }
}
