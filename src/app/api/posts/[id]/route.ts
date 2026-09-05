import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { deletePost, getPost, updatePost } from "@/lib/posts";
import { getProfile } from "@/lib/profiles";
import { whatsappAccounts } from "@/lib/socialLinks";
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

    // Troca do WhatsApp de destino. `null`/"" volta ao padrão do cadastro;
    // ausente preserva. O link tem de ser um dos números da PRÓPRIA modelo —
    // ele vai virar botão inline no Telegram, então não se aceita URL solta.
    // O número que o post já usa também passa: uma conta pode ter sido apagada
    // das Contas depois do agendamento e salvar o post não pode quebrar por isso.
    let waLink: string | null | undefined;
    if (typeof body.waLink === "string" || body.waLink === null) {
      waLink = typeof body.waLink === "string" ? body.waLink.trim() || null : null;
      if (waLink) {
        const current = getPost(params.id);
        const profile = current ? await getProfile(current.profileId) : null;
        const known = [
          profile?.bioWhatsappLink,
          current?.waLink,
          ...whatsappAccounts(profile?.accounts).map((a) => a.url),
        ].filter(Boolean);
        if (!known.includes(waLink)) {
          throw new ApiError(400, "Esse número não está nas Contas da modelo.");
        }
      }
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
          body.status === "posted" || body.status === "scheduled" || body.status === "failed"
            ? body.status
            : undefined,
        // Só o painel manda `postedAt` (ao marcar postado na mão, para valer a
        // hora do clique); a entrega no celular passa pelo `postDelivery`.
        postedAt: Number.isFinite(Number(body.postedAt)) ? Number(body.postedAt) : undefined,
        mediaIds: Array.isArray(body.mediaIds)
          ? body.mediaIds.filter((m: unknown): m is string => typeof m === "string")
          : undefined,
        cta: typeof body.cta === "boolean" ? body.cta : undefined,
        waLink,
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
