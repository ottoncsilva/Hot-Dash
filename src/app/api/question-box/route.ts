import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getProfile } from "@/lib/profiles";
import {
  addQuestionBoxItem,
  deleteQuestionBoxItem,
  gerarIdeias,
  listQuestionBoxItems,
  setQuestionBoxUsed,
  setQuestionBoxViral,
  updateQuestionBoxItem,
  type QuestionBoxKind,
} from "@/lib/questionBox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Três provedores respondendo em paralelo, com backoff de rate-limit em cada
 * um: a rodada é bem mais lenta que uma chamada só. Dois minutos cobrem o pior
 * caso sem deixar a requisição pendurada para sempre.
 */
export const maxDuration = 120;

function tipo(v: unknown): QuestionBoxKind {
  return v === "duplo_sentido" ? "duplo_sentido" : "caixinha";
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId") || "";
    if (!profileId) throw new ApiError(400, "Informe a modelo.");
    return NextResponse.json({ items: listQuestionBoxItems(profileId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "generate") {
      const profile = await getProfile(String(body.profileId || ""));
      if (!profile) throw new ApiError(404, "Modelo não encontrada.");
      const escolhidos = Array.isArray(body.providers)
        ? body.providers.filter((x: unknown): x is string => typeof x === "string")
        : undefined;
      const r = await gerarIdeias(profile, tipo(body.kind), String(body.theme || ""), escolhidos);
      return NextResponse.json(r);
    }

    if (action === "toggle-used") {
      const item = setQuestionBoxUsed(String(body.id || ""), Boolean(body.used));
      if (!item) throw new ApiError(404, "Ideia não encontrada.");
      return NextResponse.json({ item });
    }

    if (action === "toggle-viral") {
      const item = setQuestionBoxViral(String(body.id || ""), Boolean(body.viral));
      if (!item) throw new ApiError(404, "Ideia não encontrada.");
      return NextResponse.json({ item });
    }

    if (action === "edit") {
      const text = String(body.text || "").trim();
      if (!text) throw new ApiError(400, "Escreva a pergunta ou a frase.");
      const item = updateQuestionBoxItem(String(body.id || ""), text, String(body.idea || ""));
      if (!item) throw new ApiError(404, "Ideia não encontrada.");
      return NextResponse.json({ item });
    }

    if (action === "add") {
      const profileId = String(body.profileId || "");
      const text = String(body.text || "").trim();
      if (!profileId) throw new ApiError(400, "Informe a modelo.");
      if (!text) throw new ApiError(400, "Escreva a pergunta ou a frase.");
      const item = addQuestionBoxItem(
        profileId,
        tipo(body.kind),
        text,
        String(body.idea || ""),
        String(body.theme || ""),
      );
      return NextResponse.json({ item }, { status: 201 });
    }

    if (action === "delete") {
      deleteQuestionBoxItem(String(body.id || ""));
      return NextResponse.json({ ok: true });
    }

    throw new ApiError(400, "Ação desconhecida.");
  } catch (err) {
    return errorResponse(err);
  }
}
