import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { gerarMensagemAvulsa, type CampoMensagemAvulsa } from "@/lib/telegramDownsellAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAMPOS: CampoMensagemAvulsa[] = [
  "welcome",
  "success",
  "pixGenerating",
  "pixCaption",
  "pixSocialProof",
  "pixNotPaid",
];

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const profileId = String(body.profileId || "").trim();
    if (!profileId) throw new ApiError(400, "Selecione a modelo.");

    const campo = body.campo as CampoMensagemAvulsa;
    if (!CAMPOS.includes(campo)) throw new ApiError(400, "Campo inválido.");

    const bot = getBotConfigByProfile(profileId);
    if (!bot) throw new ApiError(400, "Nenhum bot de vendas configurado para esta modelo ainda.");

    const rascunho = typeof body.rascunho === "string" ? body.rascunho : undefined;

    let text: string;
    try {
      text = await gerarMensagemAvulsa({ bot, profileId, campo, rascunho });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao gerar a mensagem.");
    }

    return NextResponse.json({ text });
  } catch (err) {
    return errorResponse(err);
  }
}
