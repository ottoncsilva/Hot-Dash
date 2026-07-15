import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBotConfig, saveSubscription } from "@/lib/telegramDb";
import { banTelegramMember, unbanTelegramMember, sendTelegramMessage, createTelegramInviteLink } from "@/lib/telegramApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Rota protegida por token do cron (opcionalmente SESSION_SECRET para segurança)
    const token = req.nextUrl.searchParams.get("token");
    if (!token || token !== process.env.SESSION_SECRET) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }

    const now = Date.now();
    const db = getDb();
    
    // Busca inscrições ativas que já expiraram
    const expiredRows = db
      .prepare(
        "SELECT * FROM telegram_subscriptions WHERE status = 'active' AND expires_at < ?"
      )
      .all(now) as any[];

    let evictedCount = 0;

    for (const row of expiredRows) {
      const bot = getBotConfig(row.bot_id);
      if (!bot) continue;

      try {
        // 1. Expulsa do grupo VIP (baniu)
        await banTelegramMember(bot.botToken, bot.idVip, row.telegram_user_id);
        
        // 2. Limpa o ban (para permitir que compre e entre de novo no futuro)
        await unbanTelegramMember(bot.botToken, bot.idVip, row.telegram_user_id);
        
        // 3. Atualiza status no banco
        row.status = "expired";
        saveSubscription({
          id: row.id,
          botId: row.bot_id,
          transactionId: row.transaction_id || undefined,
          telegramUserId: row.telegram_user_id,
          telegramUsername: row.telegram_username || undefined,
          inviteLink: row.invite_link || undefined,
          status: "expired",
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        });

        // 4. Cria link de convite para o grupo de aquecimento gratuito
        const warmupInvite = await createTelegramInviteLink(
          bot.botToken,
          bot.idAquecimento,
          `Warmup_${row.telegram_user_id}`
        ).catch(() => null);

        const warmupLink = warmupInvite?.invite_link || `https://t.me/${bot.botUsername || ""}`;

        // 5. Envia mensagem informando a expiração e convidando para o aquecimento
        const expiredMsg = `⚠️ <b>Sua assinatura VIP expirou!</b>\n\n` +
          `Para continuar recebendo o conteúdo completo e exclusivo, renove seu plano no chat do bot.\n\n` +
          `Enquanto isso, você foi redirecionado para o nosso grupo de prévias gratuitas:\n` +
          `👉 <a href="${warmupLink}">Entrar no Grupo de Prévias</a>`;

        await sendTelegramMessage(bot.botToken, String(row.telegram_user_id), expiredMsg).catch(() => {});
        evictedCount++;
      } catch (err) {
        console.error(`Erro ao processar expiração do usuário ${row.telegram_user_id}:`, err);
      }
    }

    return NextResponse.json({ ok: true, evicted: evictedCount });
  } catch (err) {
    console.error("Cron Eviction Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
