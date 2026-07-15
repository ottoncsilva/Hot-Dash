import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getBotConfigByProfile,
  listLeadsForDownsell,
  findActiveSubscription,
  upsertTelegramLead,
  listPlans,
  saveSubscription,
  TelegramSubscription,
} from "@/lib/telegramDb";
import { sendTelegramMessage, sendTelegramMedia } from "@/lib/telegramApi";
import { listMedia, getMediaRow } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FunnelStep = {
  delayMinutes: number;
  text: string;
  discountPercent?: number;
  mediaTags?: string;
  isLoop?: boolean; // Se for true na ultima etapa, repete pra sempre.
};

function buildReplyMarkup(botId: string, discountPercent: number = 0) {
  const plans = listPlans(botId);
  const inlineKeyboard: any[] = [];
  if (plans.length > 0) {
    plans.forEach((plan) => {
      let finalPrice = plan.priceCents;
      if (discountPercent > 0 && discountPercent <= 100) {
        finalPrice = Math.floor(finalPrice * (1 - discountPercent / 100));
      }
      const priceStr = (finalPrice / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
      inlineKeyboard.push([
        {
          text: `${discountPercent > 0 ? `🔥 (-${discountPercent}%) ` : ""}${plan.name} - ${priceStr}`,
          callback_data: `buy_plan_${plan.id}${discountPercent > 0 ? `_${discountPercent}` : ""}`,
        },
      ]);
    });
  }
  return inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;
}

async function sendFunnelStep(
  botToken: string,
  chatId: string,
  profileId: string,
  step: FunnelStep,
  replyMarkup: any
) {
  let sentWithMedia = false;
  if (step.mediaTags) {
    const tagsArray = step.mediaTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tagsArray.length > 0) {
      const allMedia = listMedia(profileId);
      const candidates = allMedia.filter((m) =>
        m.tags.some((t) => tagsArray.includes(t.name.toLowerCase()))
      );
      if (candidates.length > 0) {
        const randomMedia = candidates[Math.floor(Math.random() * candidates.length)];
        const row = getMediaRow(randomMedia.id);
        if (row) {
          try {
            await sendTelegramMedia(botToken, chatId, row.path, step.text, { reply_markup: replyMarkup });
            sentWithMedia = true;
          } catch (e) {
            console.error(`Erro ao enviar midia de funil para ${chatId}:`, e);
          }
        }
      }
    }
  }

  if (!sentWithMedia) {
    try {
      await sendTelegramMessage(botToken, chatId, step.text, { reply_markup: replyMarkup });
    } catch (e) {
      console.error(`Erro ao enviar msg de funil para ${chatId}:`, e);
    }
  }
}

export async function GET(req: Request) {
  // Autenticação básica via Cron Secret
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const profiles = db.prepare("SELECT id FROM profiles").all() as { id: string }[];

  let downsellCount = 0;
  let upsellCount = 0;

  for (const p of profiles) {
    const bot = getBotConfigByProfile(p.id);
    if (!bot || !bot.botToken) continue;

    const now = Date.now();

    // 1. Processar Downsell (Remarketing)
    let downsellFunnel: FunnelStep[] = [];
    try {
      if (bot.downsellFunnel) downsellFunnel = JSON.parse(bot.downsellFunnel);
    } catch (e) {
      // JSON invalido
    }

    if (downsellFunnel.length > 0) {
      const leads = listLeadsForDownsell().filter((l) => l.profileId === p.id);
      for (const lead of leads) {
        // Verifica se já não pagou
        const activeSub = findActiveSubscription(bot.id, Number(lead.chatId));
        if (activeSub) continue; // Pagou, sai do remarketing

        let stepIndex = lead.downsellStepIndex;
        if (stepIndex >= downsellFunnel.length) {
          // Chegou no fim. É loop?
          const lastStep = downsellFunnel[downsellFunnel.length - 1];
          if (lastStep.isLoop) {
            stepIndex = downsellFunnel.length - 1; // Repete a última ad infinitum
          } else {
            continue; // Acabou
          }
        }

        const step = downsellFunnel[stepIndex];
        const elapsedMinutes = (now - lead.lastInteractionAt) / (60 * 1000);

        if (elapsedMinutes >= step.delayMinutes) {
          const replyMarkup = buildReplyMarkup(bot.id, step.discountPercent);
          await sendFunnelStep(bot.botToken, lead.chatId, p.id, step, replyMarkup);
          
          lead.lastInteractionAt = now;
          if (stepIndex === lead.downsellStepIndex && !step.isLoop) {
             lead.downsellStepIndex += 1;
          }
          upsertTelegramLead(lead);
          downsellCount++;
        }
      }
    }

    // 2. Processar Upsell (Pós-Venda)
    let upsellFunnel: FunnelStep[] = [];
    try {
      if (bot.upsellFunnel) upsellFunnel = JSON.parse(bot.upsellFunnel);
    } catch (e) {}

    if (upsellFunnel.length > 0) {
      const activeSubs = db
        .prepare("SELECT * FROM telegram_subscriptions WHERE bot_id = ? AND status = 'active'")
        .all(bot.id) as any[];

      for (const row of activeSubs) {
        const sub: TelegramSubscription = {
          id: row.id,
          botId: row.bot_id,
          transactionId: row.transaction_id || undefined,
          telegramUserId: row.telegram_user_id,
          telegramUsername: row.telegram_username || undefined,
          inviteLink: row.invite_link || undefined,
          status: row.status,
          expiresAt: row.expires_at,
          lastUpsellAt: row.last_upsell_at || undefined,
          upsellStepIndex: row.upsell_step_index || 0,
          createdAt: row.created_at,
        };

        let stepIndex = sub.upsellStepIndex;
        if (stepIndex >= upsellFunnel.length) {
          const lastStep = upsellFunnel[upsellFunnel.length - 1];
          if (lastStep.isLoop) stepIndex = upsellFunnel.length - 1;
          else continue;
        }

        const step = upsellFunnel[stepIndex];
        const lastActionAt = sub.lastUpsellAt || sub.createdAt;
        const elapsedMinutes = (now - lastActionAt) / (60 * 1000);

        if (elapsedMinutes >= step.delayMinutes) {
          const replyMarkup = buildReplyMarkup(bot.id, step.discountPercent);
          await sendFunnelStep(bot.botToken, String(sub.telegramUserId), p.id, step, replyMarkup);
          
          sub.lastUpsellAt = now;
          if (stepIndex === sub.upsellStepIndex && !step.isLoop) {
             sub.upsellStepIndex += 1;
          }
          saveSubscription(sub);
          upsellCount++;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, downsellCount, upsellCount });
}
