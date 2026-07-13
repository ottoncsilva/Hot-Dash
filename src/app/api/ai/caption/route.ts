import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { generateCaption } from "@/lib/ai";
import { getProfile } from "@/lib/profiles";
import type { SocialNetwork } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const theme = String(body.theme || "").trim();
    if (!theme) throw new ApiError(400, "Descreva o tema do post para gerar a legenda.");

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

    let caption: string;
    try {
      caption = await generateCaption({
        networks,
        profileName: profile?.name || "a influenciadora",
        profileNotes: profile?.notes,
        theme,
      });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao gerar legenda.");
    }
    return NextResponse.json({ caption });
  } catch (err) {
    return errorResponse(err);
  }
}
