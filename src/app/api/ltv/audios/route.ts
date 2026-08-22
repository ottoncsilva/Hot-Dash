import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError, errorResponse, recusaSePesado, requireUser } from "@/lib/apiAuth";
import { getUploadLimitMb } from "@/lib/settings";
import { deleteFile, saveStream } from "@/lib/storage";
import {
  deleteAudio,
  getAccount,
  getAudio,
  insertAudio,
  listAudios,
  updateAudioContext,
} from "@/lib/ltvDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Áudios com a VOZ REAL da modelo. Não entram na Galeria porque `media.kind`
 * só conhece foto e vídeo — e porque o que decide qual áudio a IA manda é o
 * CONTEXTO ("saudação", "provocação"), que a mídia comum não tem.
 */
const EXTENSOES = new Set([".mp3", ".m4a", ".ogg", ".oga", ".opus", ".wav"]);

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const accountId = new URL(req.url).searchParams.get("accountId") || "";
    if (!getAccount(accountId)) throw new ApiError(404, "Conta não encontrada.");
    return NextResponse.json({ audios: listAudios(accountId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const limiteMb = getUploadLimitMb();
    recusaSePesado(req, limiteMb * 1024 * 1024, limiteMb);

    const form = await req.formData();
    const accountId = String(form.get("accountId") || "");
    const conta = getAccount(accountId);
    if (!conta) throw new ApiError(404, "Conta não encontrada.");

    const arquivo = form.get("file");
    if (!(arquivo instanceof File)) throw new ApiError(400, "Envie um arquivo de áudio.");

    const ext = extname(arquivo.name).toLowerCase();
    if (!EXTENSOES.has(ext)) {
      throw new ApiError(400, "Formato não aceito. Use MP3, M4A, OGG ou WAV.");
    }

    const relPath = `ltv/${conta.profileId}/audios/${randomUUID()}${ext}`;
    const size = await saveStream(relPath, arquivo.stream());

    const audio = insertAudio({
      accountId,
      filename: arquivo.name,
      path: relPath,
      mime: arquivo.type || undefined,
      size,
      context: String(form.get("context") || ""),
    });
    return NextResponse.json({ audio });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const audio = getAudio(String(body.id || ""));
    if (!audio) throw new ApiError(404, "Áudio não encontrado.");
    updateAudioContext(audio.id, String(body.context || ""));
    return NextResponse.json({ audio: getAudio(audio.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireUser(req);
    const audio = getAudio(new URL(req.url).searchParams.get("id") || "");
    if (!audio) throw new ApiError(404, "Áudio não encontrado.");
    deleteAudio(audio.id);
    // O arquivo sai depois da linha: um disco que falha não pode deixar um
    // áudio fantasma na tela.
    await deleteFile(audio.path).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
