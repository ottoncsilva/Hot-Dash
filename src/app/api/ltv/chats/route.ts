import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { accountSummary, getAccount, listLeads } from "@/lib/ltvDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O Painel LTV de UMA conta: os números do topo e a lista de leads. Sempre de
 * uma conta só — cada número do WhatsApp tem os leads dele, e misturar os dois
 * faria a modelo responder o lead achando que é de outro chip.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId") || "";
    if (!getAccount(accountId)) throw new ApiError(404, "Conta não encontrada.");

    return NextResponse.json({
      summary: accountSummary(accountId),
      leads: listLeads(accountId, url.searchParams.get("q") || undefined),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
