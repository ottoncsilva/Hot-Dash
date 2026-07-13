import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { generateCaption, type CaptionImage } from "@/lib/ai";
import { getProfile } from "@/lib/profiles";
import { getMediaRow, videoThumbRelPath, ensureVideoThumbnail } from "@/lib/media";
import { readBuffer } from "@/lib/storage";
import type { SocialNetwork } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Limite de mídias analisadas por chamada — evita custo/latência excessivos
// num carrossel grande.
const MAX_VISION_IMAGES = 3;

async function loadCaptionImages(mediaIds: string[]): Promise<CaptionImage[]> {
  const images: CaptionImage[] = [];
  for (const id of mediaIds.slice(0, MAX_VISION_IMAGES)) {
    const row = getMediaRow(id);
    if (!row) continue;
    try {
      if (row.kind === "video") {
        const thumbPath = (await ensureVideoThumbnail(row.path)) || videoThumbRelPath(row.path);
        const buf = await readBuffer(thumbPath);
        images.push({ mime: "image/jpeg", base64: buf.toString("base64") });
      } else {
        const buf = await readBuffer(row.path);
        images.push({ mime: row.mime || "image/jpeg", base64: buf.toString("base64") });
      }
    } catch {
      // Falha ao ler um arquivo específico não deve derrubar a geração —
      // segue com as demais mídias (ou sem nenhuma, cai no modo texto).
    }
  }
  return images;
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const theme = String(body.theme || "").trim();
    const mediaIds = Array.isArray(body.mediaIds)
      ? body.mediaIds.filter((m: unknown): m is string => typeof m === "string")
      : [];
    if (!theme && mediaIds.length === 0) {
      throw new ApiError(400, "Selecione ao menos uma mídia ou descreva o tema do post para gerar a legenda.");
    }

    const provider = body.provider === "gemini" ? "gemini" : body.provider === "openai" ? "openai" : null;
    if (!provider) throw new ApiError(400, "Selecione o provedor de IA.");

    const networks = (Array.isArray(body.networks) ? body.networks : [])
      .filter(
        (n: unknown): n is { network: string; postType: string } =>
          Boolean(n) &&
          typeof (n as Record<string, unknown>).network === "string" &&
          typeof (n as Record<string, unknown>).postType === "string",
      )
      .map((n: { network: string; postType: string }) => ({
        network: n.network as SocialNetwork,
        postType: n.postType,
      }));
    if (networks.length === 0) {
      throw new ApiError(400, "Selecione ao menos uma rede social antes de gerar.");
    }

    const profile = body.profileId ? await getProfile(String(body.profileId)) : null;
    const images = mediaIds.length > 0 ? await loadCaptionImages(mediaIds) : undefined;

    let caption: string;
    try {
      caption = await generateCaption({
        provider,
        networks,
        profileName: profile?.name || "a influenciadora",
        profileNotes: profile?.notes,
        theme,
        images,
      });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao gerar legenda.");
    }
    return NextResponse.json({ caption });
  } catch (err) {
    return errorResponse(err);
  }
}
