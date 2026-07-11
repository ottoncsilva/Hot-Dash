import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sessão de login sem dependências externas: um cookie assinado (HMAC-SHA256).
 * O login/senha ficam em variáveis de ambiente (AUTH_EMAIL / AUTH_PASSWORD).
 */
export const SESSION_COOKIE = "hotdash_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.APP_ENCRYPTION_KEY;
  if (!s) {
    throw new Error(
      "Defina SESSION_SECRET (ou APP_ENCRYPTION_KEY) para assinar as sessões.",
    );
  }
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", secret()).update(data).digest());
}

export function createSessionToken(email: string): string {
  const payload = b64url(
    JSON.stringify({ email, exp: Date.now() + SESSION_MAX_AGE * 1000 }),
  );
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(
  token: string | undefined,
): { email: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64").toString("utf8"),
    ) as { email: string; exp: number };
    if (!data.exp || data.exp < Date.now()) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

export const isAuthConfigured = Boolean(
  process.env.AUTH_EMAIL && process.env.AUTH_PASSWORD,
);

/** Compara credenciais com as variáveis de ambiente (timing-safe). */
export function checkCredentials(email: string, password: string): boolean {
  const envEmail = process.env.AUTH_EMAIL || "";
  const envPass = process.env.AUTH_PASSWORD || "";
  if (!envEmail || !envPass) return false;
  const okEmail = safeEqual(
    email.trim().toLowerCase(),
    envEmail.trim().toLowerCase(),
  );
  const okPass = safeEqual(password, envPass);
  return okEmail && okPass;
}

function safeEqual(a: string, b: string): boolean {
  // Compara digests de tamanho fixo para não vazar o comprimento.
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}
