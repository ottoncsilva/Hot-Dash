import { NextRequest, NextResponse } from "next/server";
import { assinaturaConfere } from "@/lib/instagram/api";
import { responderDm } from "@/lib/instagram/agent";
import { addMessage, getAccountByIgId, marcarEventoNovo, registrarEntrada } from "@/lib/instagram/db";
import { getInstagramAppSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Onde as DMs do Instagram chegam.
 *
 * Duas metades bem diferentes: o GET é o aperto de mão que a Meta faz UMA vez,
 * quando a URL é cadastrada; o POST é o tráfego real.
 */

/**
 * APERTO DE MÃO. A Meta chama com `hub.mode=subscribe`, o `hub.verify_token`
 * que foi cadastrado e um `hub.challenge`. Só é aceita a URL que devolver o
 * challenge CRU — nem JSON, nem aspas. É o passo em que a integração mais
 * emperra, e o motivo costuma ser exatamente esse.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const esperado = getInstagramAppSettings().verifyToken;
  if (
    sp.get("hub.mode") === "subscribe" &&
    esperado &&
    sp.get("hub.verify_token") === esperado
  ) {
    return new NextResponse(sp.get("hub.challenge") || "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type EventoMeta = {
  object?: string;
  entry?: {
    id?: string;
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        is_deleted?: boolean;
        attachments?: unknown[];
      };
    }[];
  }[];
};

export async function POST(req: NextRequest) {
  // O CORPO CRU, antes de virar objeto: a assinatura é sobre os bytes exatos
  // que chegaram, e um `JSON.parse` seguido de `stringify` muda espaçamento e
  // ordem de chaves — o HMAC não bateria mais.
  const cru = await req.text();

  // Esta URL é pública por definição. Sem conferir a assinatura, qualquer um
  // que a descubra injeta conversa falsa e faz a IA responder pela conta da
  // modelo, para quem ele quiser.
  if (!assinaturaConfere(cru, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  let payload: EventoMeta;
  try {
    payload = JSON.parse(cru) as EventoMeta;
  } catch {
    return NextResponse.json({ ok: true }); // corpo ilegível: engolir, não reenviar
  }

  for (const entry of payload.entry || []) {
    for (const ev of entry.messaging || []) {
      try {
        const msg = ev.message;
        // `is_echo` é a NOSSA própria mensagem voltando. Sem descartar, o
        // agente responderia a si mesmo em laço, pela conta da modelo.
        if (!msg || msg.is_echo || msg.is_deleted) continue;

        const texto = (msg.text || "").trim();
        // Sem texto (só figurinha, foto, reação): a conversa é registrada para
        // aparecer no painel, mas a IA não tem o que responder — e responder
        // no escuro é pior do que ficar quieta.
        const peerRef = ev.sender?.id;
        const igUserId = ev.recipient?.id || entry.id;
        if (!peerRef || !igUserId) continue;

        // Reenvio da Meta (acontece quando demoramos a responder 200). Sem
        // isto, a mesma DM vira duas respostas.
        if (msg.mid && !marcarEventoNovo(msg.mid)) continue;

        const conta = getAccountByIgId(String(igUserId));
        if (!conta) continue; // conta que não é nossa (ou foi desconectada)

        const chat = registrarEntrada({ accountId: conta.id, peerRef: String(peerRef) });
        if (!texto) continue;
        addMessage(chat.id, "user", texto);

        // Solta em segundo plano de propósito: a Meta espera um 200 rápido, e
        // a resposta tem espera humana de vários segundos mais a chamada de IA.
        // Segurar a requisição até o fim faria a Meta considerar falha e
        // reenviar o evento — o reenvio que a idempotência acima já barra, mas
        // que ainda assim conta contra a saúde do app.
        void responderDm(chat.id);
      } catch (err) {
        // Um evento estranho não pode derrubar os outros do mesmo lote.
        console.error("[hotdash] erro processando evento do Instagram:", err);
      }
    }
  }

  // SEMPRE 200: um erro nosso virando 500 faz a Meta reenviar em laço e, se
  // insistir, desativar o webhook do app inteiro.
  return NextResponse.json({ ok: true });
}
