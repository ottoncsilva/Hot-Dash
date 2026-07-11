import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { absolutePath, fileSize } from "./storage";

/**
 * Serve um arquivo de mídia com suporte a Range (necessário para
 * reprodução/scrub de vídeo) e download forçado. Compartilhado entre a
 * rota autenticada e a rota pública (link para Make/n8n).
 */
export async function serveMediaFile(
  req: NextRequest,
  row: { path: string; mime: string | null; filename: string },
): Promise<NextResponse> {
  const abs = absolutePath(row.path);
  const total = await fileSize(row.path).catch(() => -1);
  if (total < 0) {
    return NextResponse.json({ error: "Arquivo ausente." }, { status: 404 });
  }

  const mime = row.mime || "application/octet-stream";
  const download = req.nextUrl.searchParams.get("download");
  const disposition = download
    ? `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`
    : "inline";

  const range = req.headers.get("range");
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
          "Cache-Control": "private, max-age=3600",
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
      "Cache-Control": "private, max-age=3600",
    },
  });
}
