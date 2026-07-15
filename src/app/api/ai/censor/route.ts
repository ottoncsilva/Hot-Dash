import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getAiCredentials } from "@/lib/settings";
import { getDb } from "@/lib/db";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const { mediaId } = await req.json().catch(() => ({}));
    if (!mediaId) {
      return NextResponse.json({ error: "Faltando mediaId." }, { status: 400 });
    }

    // 1. Validar se a chave API está configurada
    const credentials = getAiCredentials("sightengine");
    if (!credentials || !credentials.apiUser || !credentials.apiKey) {
      return NextResponse.json(
        { error: "Credenciais do Sightengine não configuradas no menu de IA." },
        { status: 400 }
      );
    }

    // 2. Localizar o arquivo local
    const db = getDb();
    const media = db.prepare("SELECT path FROM media WHERE id = ?").get(mediaId) as { path: string } | undefined;
    
    if (!media) {
      return NextResponse.json({ error: "Mídia não encontrada no banco de dados." }, { status: 404 });
    }

    const fullPath = join(process.env.MEDIA_STORAGE_DIR || "./data", media.path);
    
    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(fullPath);
    } catch (e) {
      return NextResponse.json({ error: "Arquivo físico não encontrado." }, { status: 404 });
    }

    // 3. Montar FormData para o Sightengine
    const formData = new FormData();
    formData.append("models", "nudity-2.0");
    formData.append("api_user", credentials.apiUser);
    formData.append("api_secret", credentials.apiKey);
    
    // Converte o Buffer em Blob para o FormData nativo do Node
    const blob = new Blob([new Uint8Array(fileBuffer)]);
    formData.append("media", blob, media.path.split('/').pop() || "image.jpg");

    // 4. Disparar HTTP Request para a Nuvem
    const sightengineRes = await fetch("https://api.sightengine.com/1.0/check.json", {
      method: "POST",
      body: formData,
    });

    const data = await sightengineRes.json();

    if (!sightengineRes.ok || data.status === "failure") {
      console.error("Sightengine Error:", data);
      return NextResponse.json(
        { error: data.error?.message || "Erro retornado pela API da Sightengine." },
        { status: 500 }
      );
    }

    // 5. Mapear o retorno da Sightengine para um formato simples de caixas
    // O Sightengine nudity-2.0 retorna data.nudity.parts = [{ type, left, top, width, height }]
    
    const parts = data.nudity?.parts || [];
    const boxes = parts.map((p: any) => ({
      type: p.type, // 'female_breast', 'female_genitalia', etc.
      score: p.score,
      left: p.left, // coordenadas relativas (ex: 0.5 é no meio da tela) ou pixels, varia conforme API, repassamos cru.
      top: p.top,
      width: p.width,
      height: p.height,
    }));

    return NextResponse.json({ boxes, raw: data });
  } catch (err) {
    return errorResponse(err);
  }
}
