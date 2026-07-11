import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getMediaRow } from "@/lib/media";
import { readBuffer } from "@/lib/storage";
import { buildZip } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const ids: unknown = body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "Informe ao menos uma mídia." },
        { status: 400 },
      );
    }

    const rows = ids
      .map((id) => (typeof id === "string" ? getMediaRow(id) : null))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma mídia encontrada." },
        { status: 404 },
      );
    }

    const usedNames = new Set<string>();
    const entries = [];
    for (const row of rows) {
      let name = row.filename;
      let i = 2;
      while (usedNames.has(name)) {
        const dot = row.filename.lastIndexOf(".");
        name =
          dot > 0
            ? `${row.filename.slice(0, dot)} (${i})${row.filename.slice(dot)}`
            : `${row.filename} (${i})`;
        i++;
      }
      usedNames.add(name);
      const data = await readBuffer(row.path);
      entries.push({ name, data });
    }

    const zip = buildZip(entries);

    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="hotdash-midia-${Date.now()}.zip"`,
        "Content-Length": String(zip.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
