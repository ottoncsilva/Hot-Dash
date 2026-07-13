import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getProfile } from "@/lib/profiles";
import { listMedia, listUsedMediaIds } from "@/lib/media";
import { listTemplateSlots, expandTemplate } from "@/lib/scheduleTemplate";
import { generateSchedulePlan, type MediaCandidate } from "@/lib/scheduleAi";
import { ratioBucket } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SLOTS_PER_PROFILE = 60;

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const profileIds = Array.isArray(body.profileIds)
      ? body.profileIds.filter((p: unknown): p is string => typeof p === "string" && p.length > 0)
      : [];
    const from = Number(body.from);
    const to = Number(body.to);
    if (profileIds.length === 0) throw new ApiError(400, "Selecione ao menos um perfil.");
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      throw new ApiError(400, "Informe um período válido.");
    }

    const templateSlots = listTemplateSlots();
    if (templateSlots.length === 0) {
      throw new ApiError(400, "Nenhum horário definido no programa semanal. Configure em “Programa”.");
    }

    const instances = expandTemplate(from, to, templateSlots);
    if (instances.length === 0) {
      throw new ApiError(400, "O período escolhido não contém nenhum horário do programa semanal.");
    }
    if (instances.length > MAX_SLOTS_PER_PROFILE) {
      throw new ApiError(
        400,
        `Esse período geraria ${instances.length} posts por perfil (máximo ${MAX_SLOTS_PER_PROFILE}). Escolha um período menor.`,
      );
    }

    const results = [];
    for (const profileId of profileIds) {
      const profile = await getProfile(profileId);
      if (!profile) {
        results.push({ profileId, profileName: undefined, proposals: [], error: "Perfil não encontrado." });
        continue;
      }

      const library = listMedia(profileId);
      if (library.length === 0) {
        results.push({
          profileId,
          profileName: profile.name,
          proposals: [],
          error: "Este perfil ainda não tem mídias na biblioteca.",
        });
        continue;
      }

      const usedIds = listUsedMediaIds(profileId);
      const media: MediaCandidate[] = library.map((m) => ({
        id: m.id,
        filename: m.filename,
        kind: m.kind,
        tags: m.tags.map((t) => t.name),
        ratio: ratioBucket(m.width, m.height),
        createdAt: m.createdAt,
        used: usedIds.has(m.id),
      }));

      let proposals;
      try {
        proposals = await generateSchedulePlan({
          profileName: profile.name,
          profileNotes: profile.notes,
          slots: instances,
          media,
        });
      } catch (e) {
        results.push({
          profileId,
          profileName: profile.name,
          proposals: [],
          error: e instanceof Error ? e.message : "Falha ao gerar cronograma.",
        });
        continue;
      }

      const byId = new Map(library.map((m) => [m.id, m]));
      const dtoProposals = proposals.map((p) => ({
        slotId: p.slotId,
        scheduledAt: p.scheduledAt,
        networks: [{ network: p.network, postType: p.postType }],
        caption: p.caption,
        media: p.mediaIds
          .map((id) => byId.get(id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m))
          .map((m) => ({ id: m.id, kind: m.kind, filename: m.filename, updatedAt: m.updatedAt })),
        usedFallback: p.usedFallback,
      }));

      results.push({ profileId, profileName: profile.name, proposals: dtoProposals, error: undefined });
    }

    return NextResponse.json({ results });
  } catch (err) {
    return errorResponse(err);
  }
}
