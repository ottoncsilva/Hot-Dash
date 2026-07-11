import { NextRequest, NextResponse } from "next/server";
import {
  checkCredentials,
  createSessionToken,
  isAuthConfigured,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthConfigured) {
    return NextResponse.json(
      {
        error:
          "Login não configurado no servidor. Defina AUTH_EMAIL e AUTH_PASSWORD.",
      },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "");
  const password = String(body.password || "");

  if (!checkCredentials(email, password)) {
    return NextResponse.json(
      { error: "E-mail ou senha incorretos." },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ email: email.trim().toLowerCase() });
  res.cookies.set(SESSION_COOKIE, createSessionToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
