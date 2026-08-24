import { NextRequest, NextResponse } from "next/server";
import { getAudio } from "@/lib/ltvDb";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { fileExists, readBuffer } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve o áudio para o player da tela de configuração. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  // A credencial é conferida ANTES de olhar o banco: responder 404 primeiro
  // deixaria qualquer um sondar ids de áudio sem estar logado. Só a tela usa
  // esta rota — o envio pelos canais lê o arquivo direto do disco.
  if (!verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const audio = getAudio(params.id);
  if (!audio) return NextResponse.json({ error: "Áudio não encontrado." }, { status: 404 });

  if (!(await fileExists(audio.path))) {
    return NextResponse.json({ error: "Arquivo não está mais no disco." }, { status: 404 });
  }
  const buf = await readBuffer(audio.path);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": audio.mime || "audio/ogg",
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
