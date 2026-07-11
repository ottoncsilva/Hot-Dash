import { NextRequest, NextResponse } from "next/server";
import { getMediaByPublicToken } from "@/lib/media";
import { serveMediaFile } from "@/lib/serveFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve o arquivo de mídia por um token público opaco — SEM exigir login.
 * Uso deliberado: URLs de compartilhamento para automações externas
 * (Make, n8n) buscarem a foto/vídeo diretamente. Só funciona para itens
 * cujo link público foi gerado explicitamente (token aleatório de 24
 * bytes); não há endpoint público por id.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const row = getMediaByPublicToken(params.token);
  if (!row) {
    return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 404 });
  }
  return serveMediaFile(req, row);
}
