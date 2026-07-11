import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Exige uma sessão válida (cookie assinado). Retorna o e-mail do usuário.
 * Como é uma plataforma de uso próprio, o único usuário é o das variáveis
 * de ambiente.
 */
export async function requireUser(req: NextRequest): Promise<string> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);
  if (!session) {
    throw new ApiError(401, "Não autenticado.");
  }
  return session.email;
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message =
    err instanceof Error ? err.message : "Erro interno do servidor.";
  return NextResponse.json({ error: message }, { status: 500 });
}
