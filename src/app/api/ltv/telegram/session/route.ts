import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { SenhaNecessaria, confirmarCodigo, pedirCodigo, statusChip } from "@/lib/telegramChip";
import { createAccount, getAccount, listAccounts, updateAccount } from "@/lib/ltvDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Login do chip: telefone → código → (senha de duas etapas, se a conta tiver).
 * É outro fluxo do QR do WhatsApp, por isso rota própria.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const etapa = String(body.step || "");

    if (etapa === "start") {
      const profileId = String(body.profileId || "");
      if (!profileId) throw new ApiError(400, "Informe a modelo.");
      const telefone = String(body.phone || "").trim();
      if (!telefone) throw new ApiError(400, "Informe o telefone do chip.");

      // Um chip por modelo: reaproveita a conta que já existe em vez de criar
      // outra e esbarrar no índice único.
      const conta =
        listAccounts(profileId, "telegram")[0] ||
        createAccount({ profileId, channel: "telegram", label: "Chip" });

      await pedirCodigo(conta.id, telefone);
      updateAccount(conta.id, { externalRef: telefone, status: "connecting" });
      return NextResponse.json({ accountId: conta.id, status: "code_sent" });
    }

    if (etapa === "confirm") {
      const conta = getAccount(String(body.accountId || ""));
      if (!conta) throw new ApiError(404, "Conta não encontrada.");
      const code = String(body.code || "").trim();
      if (!code) throw new ApiError(400, "Informe o código que chegou no Telegram.");

      try {
        const chip = await confirmarCodigo(conta.id, code, body.password || undefined);
        return NextResponse.json({ status: "connected", chip });
      } catch (e) {
        // A conta tem verificação em duas etapas: a tela precisa pedir a senha
        // em vez de acusar código errado.
        if (e instanceof SenhaNecessaria) {
          return NextResponse.json({ status: "password_needed" });
        }
        throw e;
      }
    }

    if (etapa === "status") {
      const conta = getAccount(String(body.accountId || ""));
      if (!conta) throw new ApiError(404, "Conta não encontrada.");
      return NextResponse.json(await statusChip(conta.id));
    }

    throw new ApiError(400, "Etapa desconhecida.");
  } catch (err) {
    return errorResponse(err);
  }
}
