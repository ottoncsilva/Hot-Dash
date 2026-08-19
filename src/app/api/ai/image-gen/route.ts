import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getMediaRow, renderVisionImageBase64 } from "@/lib/media";
import {
  gerarImagemSeedream,
  ASPECT_RATIOS,
  MAX_REFERENCIAS,
  type AspectRatio,
  type ImageResolution,
} from "@/lib/imageGen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Geração de imagem em 2K pode levar dezenas de segundos — folga generosa
 *  para não cortar a chamada no meio de um pedido que estava indo bem. */
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const prompt = String(body.prompt || "").trim();
    if (!prompt) throw new ApiError(400, "Escreva o prompt da imagem.");

    const resolution: ImageResolution = body.resolution === "1K" ? "1K" : "2K";
    const aspectRatio: AspectRatio = ASPECT_RATIOS.includes(body.aspectRatio) ? body.aspectRatio : "auto";
    const seed =
      typeof body.seed === "number" && Number.isFinite(body.seed) ? body.seed : undefined;

    // A IMAGEM A COPIAR (se houver) já chega do cliente como data: URL, já
    // redimensionada lá — o cliente é quem tem a foto original na mão, e
    // mandá-la sem redimensionar só para o servidor encolher depois seria
    // gastar banda à toa.
    //
    // Ela vai SEMPRE POR ÚLTIMO na lista, depois das fotos da modelo. Essa é
    // a ordem que os prompts escritos à mão já usavam (primeiro QUEM é a
    // pessoa, depois a CENA a reproduzir), e é o que o prompt padrão e a
    // citação com @ pressupõem ao falar em "última imagem de referência".
    const copyImage = typeof body.copyImageBase64 === "string" ? body.copyImageBase64.trim() : "";
    if (copyImage && !copyImage.startsWith("data:image/")) {
      throw new ApiError(400, "Imagem a copiar inválida.");
    }

    const referenceMediaIds = Array.isArray(body.referenceMediaIds)
      ? body.referenceMediaIds.filter((x: unknown): x is string => typeof x === "string")
      : [];

    // Reserva a última vaga para a imagem a copiar, para o teto do modelo não
    // engolir justamente a cena que se quer reproduzir.
    const tetoGaleria = copyImage ? MAX_REFERENCIAS - 1 : MAX_REFERENCIAS;
    const referencias: string[] = [];
    for (const id of referenceMediaIds) {
      if (referencias.length >= tetoGaleria) break;
      const row = getMediaRow(id);
      if (!row) continue;
      // Mesma renderização usada para a IA "ver" fotos na legenda: até 1024px,
      // JPEG q82 — leve o bastante para embutir em base64 sem perder o que
      // importa (rosto, corpo, roupa).
      const b64 = await renderVisionImageBase64(row.path);
      if (b64) referencias.push(`data:image/jpeg;base64,${b64}`);
    }
    if (copyImage) referencias.push(copyImage);

    const resultado = await gerarImagemSeedream({ prompt, referencias, resolution, aspectRatio, seed });
    return NextResponse.json(resultado);
  } catch (err) {
    return errorResponse(err);
  }
}
