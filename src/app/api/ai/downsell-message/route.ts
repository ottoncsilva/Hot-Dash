import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { gerarMensagemDownsell, type TipoFunilDownsell } from "@/lib/telegramDownsellAi";
import type { FunnelStep } from "@/lib/telegramCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Só os campos que o prompt de fato usa (tempo/desconto) precisam ser
 * números confiáveis — o resto passa direto, já que a IA nunca escreve
 * neles, só lê os números pra calibrar a escalada. */
function parsePasso(v: unknown): FunnelStep | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    ...(o as unknown as FunnelStep),
    delayMinutes: Number(o.delayMinutes) || 0,
    text: typeof o.text === "string" ? o.text : "",
    discountPercent: Number(o.discountPercent) || 0,
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const profileId = String(body.profileId || "").trim();
    if (!profileId) throw new ApiError(400, "Selecione a modelo.");

    const tipo: TipoFunilDownsell = body.funnelType === "pix" ? "pix" : "geral";
    const indice = Number(body.stepIndex);
    const passosBrutos: unknown[] = Array.isArray(body.steps) ? body.steps : [];
    const passos = passosBrutos.map(parsePasso).filter((p): p is FunnelStep => p !== null);

    if (!Number.isInteger(indice) || indice < 0 || indice >= passos.length) {
      throw new ApiError(400, "Passo inválido.");
    }

    const bot = getBotConfigByProfile(profileId);
    if (!bot) throw new ApiError(400, "Nenhum bot de vendas configurado para esta modelo ainda.");

    let text: string;
    try {
      text = await gerarMensagemDownsell({ bot, profileId, tipo, passos, indice });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao gerar a mensagem.");
    }

    return NextResponse.json({ text });
  } catch (err) {
    return errorResponse(err);
  }
}
