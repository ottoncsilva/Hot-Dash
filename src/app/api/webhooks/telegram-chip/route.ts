import { NextRequest, NextResponse } from "next/server";
import { getTelegramChipCredentials } from "@/lib/settings";
import { responderLead } from "@/lib/ltvAgent";
import { ensureChat, getAccount, insertMessage } from "@/lib/ltvDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada das mensagens que chegam no chip do Telegram (conta real da modelo).
 * Quem chama é o microserviço MTProto — ver telegram-mtproto-service/.
 *
 * Diferente do webhook da Evolution, aqui o serviço já filtrou: só conversa
 * privada, só de gente, e nada que a própria modelo mandou. O que sobra é
 * sempre mensagem de lead.
 */
export async function POST(req: NextRequest) {
  try {
    // Este endereço é público. Sem conferir o token, qualquer um injeta
    // "mensagem de lead" e faz a IA responder — e gastar — de graça.
    const creds = getTelegramChipCredentials();
    if (!creds) return NextResponse.json({ error: "chip não configurado" }, { status: 503 });
    if (req.headers.get("authorization") !== `Bearer ${creds.token}`) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { accountId, peerRef, peerName, text, hasMedia } = body as {
      accountId?: string;
      peerRef?: string;
      peerName?: string;
      text?: string;
      hasMedia?: boolean;
    };
    if (!accountId || !peerRef) return NextResponse.json({ ok: true });

    const conta = getAccount(accountId);
    if (!conta || conta.channel !== "telegram") return NextResponse.json({ ok: true });

    const chat = ensureChat(conta.id, String(peerRef), peerName);

    // Foto ou áudio sem legenda ainda é o lead falando: registrar como uma
    // mensagem vazia deixaria a IA respondendo ao nada, então vira uma
    // descrição curta que ela consegue usar na conversa.
    const conteudo = (text || "").trim() || (hasMedia ? "[mandou um arquivo]" : "");
    if (!conteudo) return NextResponse.json({ ok: true });

    insertMessage({ chatId: chat.id, role: "user", content: conteudo });

    void responderLead(chat.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook do chip do Telegram:", err);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
