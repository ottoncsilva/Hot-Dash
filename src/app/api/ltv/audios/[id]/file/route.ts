import { NextRequest, NextResponse } from "next/server";
import { getAudio } from "@/lib/ltvDb";
import { getTelegramChipCredentials } from "@/lib/settings";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { fileExists, readBuffer } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve o arquivo de áudio. Dois consumidores, duas credenciais:
 * a tela (cookie de sessão) e o microserviço do chip, que precisa BAIXAR o
 * áudio para mandá-lo como mensagem de voz pelo Telegram e só tem o token
 * compartilhado.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  // A credencial é conferida ANTES de olhar o banco: responder 404 primeiro
  // deixaria qualquer um sondar ids de áudio sem estar logado.
  const logado = Boolean(verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value));
  const creds = getTelegramChipCredentials();
  const doChip = creds !== null && req.headers.get("authorization") === `Bearer ${creds.token}`;
  if (!logado && !doChip) {
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
