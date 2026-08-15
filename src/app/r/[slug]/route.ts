import { NextRequest, NextResponse } from "next/server";
import { getSourceLinkBySlug, getBotConfig } from "@/lib/telegramDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * REDIRECIONADOR público: `/r/<slug>` → `t.me/<bot>?start=<codigo>`.
 *
 * É o link que se põe na bio, no anúncio ou no story. Duas razões para ele
 * existir em vez de publicar o deep-link direto:
 *
 *  • O destino fica sob nosso controle. Trocar o bot (ou o código) não invalida
 *    o link já impresso em mil lugares — muda-se o registro e pronto.
 *  • O código de origem viaja junto sem aparecer na URL divulgada, então a
 *    atribuição de tráfego não depende de ninguém copiar o `?start=` certo.
 *
 * NÃO exige login: é uma URL pública, para o lead. Ela só revela o @username do
 * bot, que é público de qualquer forma.
 */
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const link = getSourceLinkBySlug(String(params.slug || "").toLowerCase());
  if (!link) {
    return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });
  }

  const bot = getBotConfig(link.botId);
  const username = bot?.botUsername?.replace(/^@/, "");
  if (!username) {
    // O bot existe mas ainda não teve o @username resolvido (só acontece antes
    // do primeiro registro de webhook, que é quando chamamos o getMe).
    return NextResponse.json(
      { error: "O bot deste link ainda não foi conectado." },
      { status: 409 },
    );
  }

  const destino = `https://t.me/${username}?start=${encodeURIComponent(link.code)}`;
  // 302 e não 301: um permanente ficaria gravado no navegador do lead e
  // sobreviveria a qualquer troca de destino — exatamente o que este
  // redirecionador existe para evitar.
  return NextResponse.redirect(destino, 302);
}
