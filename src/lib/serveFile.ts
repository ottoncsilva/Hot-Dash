import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { absolutePath, fileStat } from "./storage";

/** Um ano — o teto que a RFC recomenda para `max-age`. */
const UM_ANO = 31536000;

/**
 * Serve um arquivo de mídia com suporte a Range (necessário para
 * reprodução/scrub de vídeo) e download forçado. Compartilhado entre a
 * rota autenticada e a rota pública (link para Make/n8n).
 *
 * CACHE. Toda resposta leva `ETag` (tamanho + mtime do arquivo), então mesmo
 * quando o cache expira o navegador revalida com `If-None-Match` e recebe um
 * 304 vazio em vez do arquivo inteiro.
 *
 * `immutable` só deve ser ligado por quem serve uma URL VERSIONADA — as rotas
 * de miniatura e de arquivo montam `?v=<updatedAt>` (ver `mediaThumbUrl`), de
 * modo que trocar a imagem troca a URL. Aí o cache pode durar um ano e a
 * galeria para de rebaixar centenas de miniaturas a cada visita.
 *
 * A rota PÚBLICA por token não passa `immutable` de propósito: a URL dela não
 * tem versão e o arquivo pode ser trocado pelo /replace — com cache imutável,
 * o Make/n8n continuaria buscando a foto antiga indefinidamente.
 */
export async function serveMediaFile(
  req: NextRequest,
  row: { path: string; mime: string | null; filename: string },
  opts?: { immutable?: boolean },
): Promise<NextResponse> {
  const abs = absolutePath(row.path);
  const info = await fileStat(row.path).catch(() => null);
  if (!info) {
    return NextResponse.json({ error: "Arquivo ausente." }, { status: 404 });
  }
  const total = info.size;

  const mime = row.mime || "application/octet-stream";
  const download = req.nextUrl.searchParams.get("download");
  const disposition = download
    ? `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`
    : "inline";

  const etag = `"${total.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  const cacheControl = opts?.immutable
    ? `private, max-age=${UM_ANO}, immutable`
    : "private, max-age=3600, must-revalidate";

  const range = req.headers.get("range");

  // 304 só fora de Range: uma requisição com Range quer bytes, e responder
  // "não mudou" no meio de um scrub de vídeo confunde o player.
  if (!range && req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (start >= total || end >= total || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      const stream = createReadStream(abs, { start, end });
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          "Content-Disposition": disposition,
          "Cache-Control": cacheControl,
          ETag: etag,
        },
      });
    }
  }

  const stream = createReadStream(abs);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
      "Cache-Control": cacheControl,
      ETag: etag,
    },
  });
}
