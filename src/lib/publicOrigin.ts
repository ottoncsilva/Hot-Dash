import "server-only";
import type { NextRequest } from "next/server";

/**
 * Base pública do app (para montar URLs de webhook: Telegram, SyncPay).
 * Atrás de um proxy reverso (EasyPanel), `req.nextUrl.origin` pode resolver
 * para um host interno/local em vez do domínio público — nesse caso o
 * provedor externo (SyncPay/Telegram) nunca alcança o webhook e a confirmação
 * se perde. Prefira sempre NEXT_PUBLIC_APP_URL/WEBHOOK_APP_URL quando
 * configurados; caia para o origin da requisição só como último recurso.
 */
export function publicOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.WEBHOOK_APP_URL;
  return (env || req.nextUrl.origin).replace(/\/+$/, "");
}
