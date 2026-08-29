import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import {
  getAppTimeZone,
  getFixedGroupMembers,
  getUploadLimitMb,
  setAppTimeZone,
  setFixedGroupMembers,
  setUploadLimitMb,
  UPLOAD_MB_MAX,
  UPLOAD_MB_MIN,
} from "@/lib/settings";
import { isValidTimeZone, partsInTimeZone } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function payload() {
  const timeZone = getAppTimeZone();
  const p = partsInTimeZone(Date.now(), timeZone);
  return {
    timeZone,
    now: `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
    serverUtc: new Date().toISOString(),
    fixedGroupMembers: getFixedGroupMembers(),
    uploadLimitMb: getUploadLimitMb(),
  };
}

/** Devolve os ajustes gerais + a hora atual no fuso salvo (para conferência na tela). */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json(payload());
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Cada campo é opcional e só é gravado quando vem no corpo — a tela tem um botão
 * de salvar por bloco, e salvar um deles não pode zerar o outro.
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    if (body.timeZone !== undefined) {
      const tz = typeof body.timeZone === "string" ? body.timeZone : "";
      if (!isValidTimeZone(tz)) {
        return NextResponse.json({ error: "Fuso horário inválido." }, { status: 400 });
      }
      setAppTimeZone(tz);
    }

    if (body.fixedGroupMembers !== undefined) {
      const n = Number(body.fixedGroupMembers);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "Informe quantos integrantes fixos cada canal tem (0 ou mais)." },
          { status: 400 },
        );
      }
      setFixedGroupMembers(n);
    }

    if (body.uploadLimitMb !== undefined) {
      const n = Number(body.uploadLimitMb);
      if (!Number.isFinite(n) || n < UPLOAD_MB_MIN || n > UPLOAD_MB_MAX) {
        return NextResponse.json(
          { error: `Informe um limite entre ${UPLOAD_MB_MIN} e ${UPLOAD_MB_MAX} MB.` },
          { status: 400 },
        );
      }
      setUploadLimitMb(n);
    }

    return NextResponse.json(payload());
  } catch (err) {
    return errorResponse(err);
  }
}
