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

/**
 * Recusa um upload grande demais ANTES de ler o corpo.
 *
 * `req.formData()` monta a requisição inteira na memória antes de devolver o
 * arquivo — inclusive quando ele vai ser recusado logo depois. Medido: mandar
 * 550 MB para um limite de 500 fazia o processo chegar a 2,2 GB só para
 * responder "excede o limite". O `Content-Length` chega no cabeçalho, muito
 * antes disso, e é o que decide aqui.
 *
 * A folga de 1 MB é do embrulho multipart (fronteiras e nomes de campo), que
 * pesa alguns bytes por campo e não deve derrubar um arquivo no limite.
 */
export function recusaSePesado(req: NextRequest, maxBytes: number, maxMb: number): void {
  const bruto = Number(req.headers.get("content-length") || "");
  if (Number.isFinite(bruto) && bruto > maxBytes + 1024 * 1024) {
    throw new ApiError(413, `Arquivo excede o limite de ${maxMb} MB.`);
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message =
    err instanceof Error ? err.message : "Erro interno do servidor.";
  return NextResponse.json({ error: message }, { status: 500 });
}
