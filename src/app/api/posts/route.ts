import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { createPost, listPosts } from "@/lib/posts";
import type { PostNetwork, PostStatus } from "@/lib/postTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseNetworks(raw: unknown): PostNetwork[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (n): n is { network: string; postType: string; accountId?: string } =>
        Boolean(n) && typeof n.network === "string" && typeof n.postType === "string",
    )
    .map(
      (n) =>
        ({
          network: n.network,
          postType: n.postType,
          accountId: typeof n.accountId === "string" ? n.accountId : undefined,
        }) as PostNetwork,
    );
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const status = sp.get("status");
    const posts = listPosts({
      profileId: sp.get("profileId") || undefined,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      status: status === "scheduled" || status === "posted" ? (status as PostStatus) : undefined,
    });
    return NextResponse.json({ posts });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const profileId = String(body.profileId || "");
    const scheduledAt = Number(body.scheduledAt);
    const networks = parseNetworks(body.networks);
    if (!profileId) throw new ApiError(400, "Informe o perfil.");
    if (!Number.isFinite(scheduledAt)) throw new ApiError(400, "Informe a data e hora.");
    if (networks.length === 0) throw new ApiError(400, "Selecione ao menos uma rede social.");
    const mediaIds = Array.isArray(body.mediaIds)
      ? body.mediaIds.filter((m: unknown): m is string => typeof m === "string")
      : [];
    const post = createPost({
      profileId,
      networks,
      scheduledAt,
      caption: typeof body.caption === "string" ? body.caption : undefined,
      mediaIds,
    });
    return NextResponse.json({ post }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
