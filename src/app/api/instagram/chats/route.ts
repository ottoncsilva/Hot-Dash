import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { enviarPeloPainel, janelaLegivel } from "@/lib/instagram/agent";
import { getAccount, getChat, listChats, listMessages, setChatState } from "@/lib/instagram/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** As conversas de uma conta, e o histórico de uma delas. */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const chatId = sp.get("chatId");

    if (chatId) {
      const chat = getChat(chatId);
      if (!chat) throw new ApiError(404, "Conversa não encontrada.");
      return NextResponse.json({
        chat: { ...chat, janela: janelaLegivel(chat) },
        mensagens: listMessages(chatId, 80),
      });
    }

    const accountId = sp.get("accountId");
    if (!accountId) throw new ApiError(400, "Informe a conta.");
    if (!getAccount(accountId)) throw new ApiError(404, "Conta não encontrada.");
    return NextResponse.json({
      // `janela` vai calculada do servidor: o relógio de quem abre o painel
      // pode estar torto, e essa é a informação que decide se ainda dá para
      // responder.
      chats: listChats(accountId, 60).map((c) => ({ ...c, janela: janelaLegivel(c) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const chatId = String(body.chatId || "");
    if (!chatId) throw new ApiError(400, "Informe a conversa.");
    const action = String(body.action || "");

    // Assumir/devolver a conversa. Pausada, o agente não responde mais nela —
    // é o botão de "deixa comigo".
    if (action === "set-state") {
      const state = body.state === "paused" ? "paused" : "active";
      setChatState(chatId, state);
      return NextResponse.json({ ok: true, state });
    }

    if (action === "send") {
      const texto = String(body.text || "").trim();
      if (!texto) throw new ApiError(400, "Escreva a mensagem.");
      await enviarPeloPainel(chatId, texto);
      return NextResponse.json({ ok: true });
    }

    throw new ApiError(400, "Ação inválida.");
  } catch (err) {
    return errorResponse(err);
  }
}
