import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { traduzirTexto } from "@/lib/telegramDownsellAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Traduz um texto já escrito (ex.: a mensagem de pagamento aprovado) pro
 * inglês ou espanhol — botão "Traduzir" (D.4 do fluxo internacional).
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const profileId = String(body.profileId || "").trim();
    if (!profileId) throw new ApiError(400, "Selecione a modelo.");

    const idioma = body.idioma === "en" || body.idioma === "es" ? body.idioma : null;
    if (!idioma) throw new ApiError(400, "Idioma inválido.");

    const texto = typeof body.texto === "string" ? body.texto.trim() : "";
    if (!texto) throw new ApiError(400, "Escreva a mensagem em português antes de traduzir.");

    let text: string;
    try {
      text = await traduzirTexto(texto, idioma, profileId);
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao traduzir a mensagem.");
    }

    return NextResponse.json({ text });
  } catch (err) {
    return errorResponse(err);
  }
}
