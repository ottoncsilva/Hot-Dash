import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { deletePost, updatePost } from "@/lib/posts";
import type { PostNetwork } from "@/lib/postTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    let networks: PostNetwork[] | undefined;
    if (Array.isArray(body.networks)) {
      networks = body.networks
        .filter(
          (n: unknown): n is { network: string; postType: string } =>
            Boolean(n) &&
            typeof (n as Record<string, unknown>).network === "string" &&
            typeof (n as Record<string, unknown>).postType === "string",
        )
        .map((n: { network: string; postType: string }) => n as PostNetwork);
    }

    let post;
    try {
      post = updatePost(params.id, {
        profileId: typeof body.profileId === "string" ? body.profileId : undefined,
        networks,
        scheduledAt: Number.isFinite(Number(body.scheduledAt))
          ? Number(body.scheduledAt)
          : undefined,
        caption: typeof body.caption === "string" ? body.caption : undefined,
        status:
          body.status === "posted" || body.status === "scheduled" ? body.status : undefined,
        mediaIds: Array.isArray(body.mediaIds)
          ? body.mediaIds.filter((m: unknown): m is string => typeof m === "string")
          : undefined,
        cta: typeof body.cta === "boolean" ? body.cta : undefined,
      });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : "Falha ao salvar.");
    }
    if (!post) {
      return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ post });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser(req);
    const ok = deletePost(params.id);
    if (!ok) {
      return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
