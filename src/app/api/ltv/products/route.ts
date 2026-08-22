import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import {
  copyProducts,
  getAccount,
  listAccounts,
  listProducts,
  saveProducts,
  type LtvProductInput,
} from "@/lib/ltvDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const accountId = new URL(req.url).searchParams.get("accountId") || "";
    if (!getAccount(accountId)) throw new ApiError(404, "Conta não encontrada.");
    return NextResponse.json({ products: listProducts(accountId) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** A tela salva a lista inteira de uma vez — é um "Salvar" só, no fim. */
export async function PUT(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const accountId = String(body.accountId || "");
    if (!getAccount(accountId)) throw new ApiError(404, "Conta não encontrada.");
    if (!Array.isArray(body.products)) throw new ApiError(400, "Lista de produtos inválida.");

    const produtos: LtvProductInput[] = body.products
      .filter((p: any) => p && typeof p.name === "string" && p.name.trim())
      .map((p: any) => ({
        id: typeof p.id === "string" ? p.id : undefined,
        name: String(p.name).trim(),
        priceCents: Number(p.priceCents) || 0,
        description: typeof p.description === "string" ? p.description : "",
        deliveryKind: p.deliveryKind === "videocall" ? "videocall" : "media",
        extraMessage: typeof p.extraMessage === "string" ? p.extraMessage : "",
        mediaIds: Array.isArray(p.mediaIds)
          ? p.mediaIds.filter((m: unknown) => typeof m === "string")
          : [],
      }));

    return NextResponse.json({ products: saveProducts(accountId, produtos) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * "Copiar do WhatsApp": clona os produtos da conta de WhatsApp da mesma
 * modelo. Com vários números, copia do primeiro que tiver produto cadastrado —
 * é o que a pessoa espera de um botão sem opção de escolha.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const destino = getAccount(String(body.accountId || ""));
    if (!destino) throw new ApiError(404, "Conta não encontrada.");

    const origem = listAccounts(destino.profileId, "whatsapp")
      .filter((c) => c.id !== destino.id)
      .find((c) => listProducts(c.id).length > 0);
    if (!origem) throw new ApiError(400, "Esta modelo ainda não tem produtos no WhatsApp.");

    return NextResponse.json({ products: copyProducts(origem.id, destino.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
