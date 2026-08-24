import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { agendarResposta } from "@/lib/ltvAgent";
import { sendPushEvent } from "@/lib/push";
import * as uazapi from "@/lib/uazapi";
import {
  ensureChat,
  findAccountByRef,
  getAccountSession,
  insertMessage,
  setChatState,
  updateAccount,
  type LtvAccount,
} from "@/lib/ltvDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada de tudo que acontece no WhatsApp da modelo.
 *
 * A uazapi manda três eventos que interessam: `messages` (o lead falou),
 * `call` (alguém está ligando) e `connection` (o número caiu ou voltou).
 *
 * O webhook é registrado com `excludeMessages: ["wasSentByApi"]`, e isso
 * simplifica muito: o que a própria IA manda nunca volta como evento, então
 * não há laço para quebrar nem eco para adivinhar. Um `fromMe` que chegue aqui
 * é a modelo digitando no celular dela.
 */

/**
 * Descobre de qual conta é o evento.
 *
 * O payload identifica a instância de formas diferentes conforme o evento, e
 * o telefone só existe depois que a conta conecta — por isso a busca aceita
 * tanto o id da instância quanto o número.
 */
function contaDoEvento(body: any): LtvAccount | null {
  const candidatos = [
    body?.instance_id,
    body?.instanceId,
    body?.instance?.id,
    body?.owner,
    body?.instance,
  ];
  for (const c of candidatos) {
    const ref = typeof c === "string" ? c.trim() : "";
    if (!ref) continue;
    const conta = findAccountByRef("whatsapp", ref);
    if (conta) return conta;
  }
  return null;
}

function tokenDe(conta: LtvAccount): string | null {
  const enc = getAccountSession(conta.id);
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

/** O número do lead, sem o sufixo do WhatsApp. */
function numeroDoChat(chatid: string): string {
  return String(chatid || "").split("@")[0];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const conta = contaDoEvento(body);
    if (!conta) return NextResponse.json({ ok: true });
    const token = tokenDe(conta);

    const evento = String(body?.event || body?.EventType || "").toLowerCase();

    /* ---------------------------------------------------------- conexão */
    if (evento.includes("connection")) {
      const status = String(
        body?.instance?.status || body?.data?.status || body?.status || "",
      ).toLowerCase();
      const conectado = status === "connected";
      if (conta.status !== (conectado ? "connected" : "disconnected")) {
        updateAccount(conta.id, { status: conectado ? "connected" : "disconnected" });
      }
      if (!conectado && status) {
        // Enquanto o número está fora, NENHUM lead é respondido. É o alerta
        // que mais custa caro perder, por isso nasce ligado nas preferências.
        const motivo =
          body?.instance?.lastDisconnectReason || body?.data?.reason || "sem motivo informado";
        await sendPushEvent(
          "whatsappDown",
          `📵 WhatsApp caiu — ${conta.label}`,
          `Nenhum lead está sendo respondido neste número. Motivo: ${motivo}`,
          "/dashboard/ltv/whatsapp",
        ).catch(() => {});
      }
      return NextResponse.json({ ok: true });
    }

    /* --------------------------------------------------------- chamadas */
    if (evento.includes("call")) {
      // Chamada de voz não tem como ser atendida por uma IA, e deixar tocando
      // é pior que recusar: o lead fica esperando e a conta acumula chamada
      // perdida, que é sinal de spam para o WhatsApp.
      if (token) {
        const c = body?.data || body?.call || {};
        await uazapi
          .rejeitarChamada(token, {
            number: c.from ? numeroDoChat(c.from) : undefined,
            id: c.id || undefined,
          })
          .catch((e) => console.error("uazapi: falha rejeitando chamada:", e));
      }
      return NextResponse.json({ ok: true });
    }

    /* --------------------------------------------------------- mensagem */
    const msg = body?.message || body?.data || {};
    const chatid = String(msg.chatid || msg.chatId || msg.from || "");
    if (!chatid || chatid.includes("@g.us") || chatid.includes("status@")) {
      return NextResponse.json({ ok: true });
    }

    const peerRef = numeroDoChat(chatid);
    const chat = ensureChat(conta.id, peerRef, msg.senderName || undefined);

    // A modelo respondeu do celular dela: assume a conversa e cala a IA. Duas
    // vozes no mesmo chat é o pior resultado possível.
    if (msg.fromMe) {
      setChatState(chat.id, "paused");
      return NextResponse.json({ ok: true });
    }

    const conteudo = String(msg.text || msg.content || "").trim();
    const messageid = String(msg.messageid || msg.id || "");

    // Marcar como lida ANTES de responder, e não junto do envio: a IA leva de
    // 20 a 90 segundos para responder, e um lead que fica todo esse tempo com
    // a mensagem "não lida" é exatamente o padrão que o WhatsApp pune.
    if (token && messageid) {
      await uazapi
        .marcarComoLida(token, [messageid])
        .catch((e) => console.error("uazapi: falha marcando como lida:", e));
    }

    if (!conteudo) return NextResponse.json({ ok: true });

    // O id da uazapi é a trava contra a mensagem duplicada: o provedor
    // reentrega o evento quando não recebe 200 a tempo.
    if (messageid) {
      const jaTem = getDb().prepare(`SELECT 1 FROM ltv_messages WHERE id = ?`).get(messageid);
      if (jaTem) return NextResponse.json({ ok: true });
      getDb()
        .prepare(
          `INSERT INTO ltv_messages (id, chat_id, role, content, type, created_at)
           VALUES (?, ?, 'user', ?, 'text', ?)`,
        )
        .run(messageid, chat.id, conteudo, Date.now());
      getDb()
        .prepare(`UPDATE ltv_chats SET last_interaction_at = ? WHERE id = ?`)
        .run(Date.now(), chat.id);
    } else {
      insertMessage({ chatId: chat.id, role: "user", content: conteudo });
    }

    agendarResposta(chat.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook da uazapi:", err);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
