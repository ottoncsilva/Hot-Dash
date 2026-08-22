import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { enviarPeloPainel } from "@/lib/ltvAgent";
import { getAccount, getChat, listMessages, setChatState } from "@/lib/ltvDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { chatId: string } }) {
  try {
    await requireUser(req);
    const chat = getChat(params.chatId);
    if (!chat) throw new ApiError(404, "Conversa não encontrada.");
    const conta = getAccount(chat.accountId);
    return NextResponse.json({
      chat,
      account: conta,
      messages: listMessages(chat.id, 300),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { chatId: string } }) {
  try {
    await requireUser(req);
    const chat = getChat(params.chatId);
    if (!chat) throw new ApiError(404, "Conversa não encontrada.");
    const body = await req.json().catch(() => ({}));

    if (body.action === "toggle_ai") {
      const estado = chat.state === "active" ? "paused" : "active";
      setChatState(chat.id, estado);
      return NextResponse.json({ state: estado });
    }

    if (body.action === "send") {
      // `enviarPeloPainel` pausa a IA sozinho — quem digitou aqui assumiu a
      // conversa.
      await enviarPeloPainel(chat.id, {
        text: typeof body.content === "string" ? body.content : undefined,
        mediaId: typeof body.mediaId === "string" ? body.mediaId : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    throw new ApiError(400, "Ação desconhecida.");
  } catch (err) {
    return errorResponse(err);
  }
}
