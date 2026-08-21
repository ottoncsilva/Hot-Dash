import { NextRequest, NextResponse } from "next/server";
import { extname } from "node:path";
import { errorResponse, recusaSePesado, requireUser } from "@/lib/apiAuth";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/uploadLimit";
import { borrarVideoInteiro, censurarVideoComEmoji, INTENSIDADE_PADRAO } from "@/lib/videoCensor";
import { BODY_PARTS, type BodyPart } from "@/lib/bodyParts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Vídeo de 30s: amostrar + detectar leva alguns segundos, mas quem manda no
 * relógio é a RECODIFICAÇÃO. Cinco minutos cobre com folga o limite de 30s que
 * a tela impõe, e ainda assim corta um arquivo grande demais em vez de deixar
 * a requisição pendurada para sempre.
 */
export const maxDuration = 300;

/** 30 segundos, como combinado — vídeo de prévia é curto por definição. */
const DURACAO_MAX = 30;

/**
 * Censura de VÍDEO. Dois modos, e eles resolvem problemas diferentes:
 *
 *   modo=borrao → desfoca o quadro inteiro. É TEASER: mostra que existe
 *                 conteúdo sem mostrar o conteúdo. Não usa IA, então não tem
 *                 como "escapar" nada.
 *   modo=emoji  → detecta as partes e cobre com emoji, deixando o resto do
 *                 vídeo visível. Usa IA quadro a quadro.
 *
 * Responde com o mp4 direto (o cliente salva na galeria pelas rotas de sempre)
 * e um cabeçalho com o diagnóstico, para a tela poder dizer o que foi achado.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    // Barra pelo cabeçalho, antes de o corpo virar memória.
    recusaSePesado(req, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Envie um arquivo de vídeo." }, { status: 400 });
    }
    // O MESMO limite do resto do app. Tinha um teto próprio, menor: a tela de
    // censura aceitava o vídeo, subia os 100% e só então ouvia "não" — com um
    // número que ela nunca mostrou.
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Vídeo acima de ${MAX_UPLOAD_MB} MB.` },
        { status: 413 },
      );
    }

    const modo = String(form.get("modo") || "borrao");
    const ext = extname(file.name || "").toLowerCase() || ".mp4";
    const buf = Buffer.from(await file.arrayBuffer());

    if (modo === "borrao") {
      const out = await borrarVideoInteiro(buf, ext, {
        intensidade: numero(form.get("intensidade"), INTENSIDADE_PADRAO),
        trimEnd: DURACAO_MAX,
      });
      return responder(out, { modo: "borrao" });
    }

    // ---- emoji ------------------------------------------------------------
    // O mapa de emoji vem da tela como JSON {parte: emoji}. Parte desconhecida
    // é descartada aqui: o resto do pipeline confia no tipo.
    let emojiPorParte: Partial<Record<BodyPart, string>> = {};
    try {
      const cru = JSON.parse(String(form.get("emojis") || "{}"));
      for (const p of BODY_PARTS) {
        const e = cru?.[p];
        if (typeof e === "string" && e.trim()) emojiPorParte[p] = e;
      }
    } catch {
      emojiPorParte = {};
    }
    if (Object.keys(emojiPorParte).length === 0) {
      return NextResponse.json(
        { error: "Escolha ao menos uma parte para cobrir." },
        { status: 400 },
      );
    }

    const r = await censurarVideoComEmoji(buf, ext, {
      emojiPorParte,
      escalaEmoji: numero(form.get("escala"), 1.45),
      borrarPorBaixo: String(form.get("borrarPorBaixo") || "1") !== "0",
    });

    return responder(r.buffer, {
      modo: "emoji",
      partes: r.partesEncontradas.join(","),
      amostras: String(r.quadrosAmostrados),
      comDeteccao: String(r.quadrosComDeteccao),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function numero(v: FormDataEntryValue | null, padrao: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

/**
 * Devolve o mp4 com o diagnóstico em CABEÇALHOS.
 *
 * O corpo é o vídeo, então não cabe JSON junto — e a tela precisa saber se a
 * IA achou alguma coisa. Sem isso, um vídeo que voltou intacto (nada
 * detectado) seria indistinguível de um censurado.
 */
function responder(buf: Buffer, meta: Record<string, string>): NextResponse {
  const headers = new Headers({
    "content-type": "video/mp4",
    "content-length": String(buf.length),
    "cache-control": "no-store",
  });
  for (const [k, v] of Object.entries(meta)) headers.set(`x-censura-${k}`, v);
  headers.set("access-control-expose-headers", Object.keys(meta).map((k) => `x-censura-${k}`).join(","));
  return new NextResponse(new Uint8Array(buf), { headers });
}
