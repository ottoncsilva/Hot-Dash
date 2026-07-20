import "server-only";
import { getDb } from "@/lib/db";
import { listProfiles } from "@/lib/profiles";
import {
  getBotConfigByProfile,
  getBotConfig,
  listLeadsForDownsell,
  findActiveSubscription,
  upsertTelegramLead,
  listPlans,
  saveSubscription,
  type TelegramSubscription,
} from "@/lib/telegramDb";
import {
  sendTelegramMedia,
  sendTelegramMessage,
  banTelegramMember,
  unbanTelegramMember,
  createTelegramInviteLink,
} from "@/lib/telegramApi";
import { updatePost } from "@/lib/posts";
import { listMedia, getMediaRow } from "@/lib/media";

/**
 * Núcleo das tarefas agendadas do Telegram (autopost, funis e expiração).
 *
 * Estas funções contêm TODA a lógica de negócio e são chamadas por dois
 * lugares:
 *   1. O agendador em segundo plano (`src/instrumentation.ts`), que roda de
 *      minuto em minuto dentro do próprio processo do servidor — é o que faz
 *      as postagens saírem sozinhas, sem depender de cron externo.
 *   2. As rotas HTTP em `src/app/api/cron/telegram/*`, que permanecem como
 *      gatilho manual/externo (protegidas por token) para depuração.
 *
 * Nenhuma delas lança para o chamador: erros por item são apenas logados,
 * para que uma falha isolada (um bot mal configurado, uma mídia sumida) não
 * interrompa o processamento dos demais perfis.
 */

// ---------------------------------------------------------------------------
// 1) AUTOPOST — envia posts agendados (VIP / Prévias) cujo horário já chegou
// ---------------------------------------------------------------------------

export async function runTelegramAutopost(): Promise<number> {
  const profiles = await listProfiles();
  const now = Date.now();
  const db = getDb();

  let totalPosted = 0;

  for (const profile of profiles) {
    const bot = getBotConfigByProfile(profile.id);
    if (!bot || !bot.botToken) continue;

    // Busca todos os posts agendados pendentes para Telegram (VIP ou Prévias)
    // deste perfil cujo horário já chegou.
    const pendingPosts = db
      .prepare(
        `
        SELECT p.id, p.caption, pn.post_type, pm.media_id
        FROM posts p
        JOIN post_networks pn ON pn.post_id = p.id
        LEFT JOIN post_media pm ON pm.post_id = p.id AND pm.sort_order = 0
        WHERE p.profile_id = ? AND p.status = 'scheduled' AND p.scheduled_at <= ? AND pn.network = 'telegram'
      `,
      )
      .all(profile.id, now) as any[];

    for (const post of pendingPosts) {
      // Define o alvo
      let chatId = "";
      if (post.post_type === "VIP") chatId = bot.idVip;
      else if (post.post_type === "Prévias") chatId = bot.idAquecimento;
      else continue; // Ignora post genérico manual ("Mensagem"/"Outro") sem alvo específico

      if (!chatId) {
        updatePost(post.id, { status: "posted" }); // Ignora para não travar a fila se o bot não estiver configurado
        continue;
      }

      // Obtém o caminho da mídia
      let mediaPath = "";
      if (post.media_id) {
        const row = getMediaRow(post.media_id);
        if (row) mediaPath = row.path;
      }

      // Prepara call-to-action (o link/botões SÓ vão para as Prévias, nunca no VIP)
      const options: Record<string, any> = {};
      if (post.post_type === "Prévias" && profile.bioVipLink) {
        options.reply_markup = {
          inline_keyboard: [
            [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }],
            [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }],
            [{ text: "👉 VEM PRO MEU VIP AGORA", url: profile.bioVipLink }],
          ],
        };
      }

      // Dispara no Telegram
      try {
        await sendTelegramMedia(bot.botToken, chatId, mediaPath, post.caption || "", options);
        updatePost(post.id, { status: "posted" });
        totalPosted++;
      } catch (e) {
        console.error(`Erro ao postar post ${post.id} no Telegram:`, e);
        // O post permanece 'scheduled' e será tentado novamente no próximo ciclo
      }
    }
  }

  return totalPosted;
}

// ---------------------------------------------------------------------------
// 2) FUNIS — remarketing (downsell) para quem não pagou e pós-venda (upsell)
// ---------------------------------------------------------------------------

type FunnelStep = {
  delayMinutes: number;
  text: string;
  discountPercent?: number;
  mediaTags?: string;
  isLoop?: boolean; // Se for true na última etapa, repete pra sempre.
};

function buildReplyMarkup(botId: string, discountPercent = 0) {
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
  replyMarkup: any,
) {
  let sentWithMedia = false;
  if (step.mediaTags) {
    const tagsArray = step.mediaTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tagsArray.length > 0) {
      const allMedia = listMedia(profileId);
      const candidates = allMedia.filter((m) =>
        m.tags.some((t) => tagsArray.includes(t.name.toLowerCase())),
      );
      if (candidates.length > 0) {
        const randomMedia = candidates[Math.floor(Math.random() * candidates.length)];
        const row = getMediaRow(randomMedia.id);
        if (row) {
          try {
            await sendTelegramMedia(botToken, chatId, row.path, step.text, { reply_markup: replyMarkup });
            sentWithMedia = true;
          } catch (e) {
            console.error(`Erro ao enviar mídia de funil para ${chatId}:`, e);
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

export async function runTelegramFunnels(): Promise<{ downsellCount: number; upsellCount: number }> {
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
    } catch {
      // JSON inválido
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
    } catch {
      // JSON inválido
    }

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

  return { downsellCount, upsellCount };
}

// ---------------------------------------------------------------------------
// 3) EXPIRAÇÃO — remove do VIP quem venceu e reconduz ao grupo de prévias
// ---------------------------------------------------------------------------

export async function runTelegramEviction(): Promise<number> {
  const now = Date.now();
  const db = getDb();

  // Busca inscrições ativas que já expiraram
  const expiredRows = db
    .prepare("SELECT * FROM telegram_subscriptions WHERE status = 'active' AND expires_at < ?")
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
      saveSubscription({
        id: row.id,
        botId: row.bot_id,
        transactionId: row.transaction_id || undefined,
        telegramUserId: row.telegram_user_id,
        telegramUsername: row.telegram_username || undefined,
        inviteLink: row.invite_link || undefined,
        status: "expired",
        expiresAt: row.expires_at,
        lastUpsellAt: row.last_upsell_at || undefined,
        upsellStepIndex: row.upsell_step_index || 0,
        createdAt: row.created_at,
      });

      // 4. Cria link de convite para o grupo de aquecimento gratuito
      const warmupInvite = await createTelegramInviteLink(
        bot.botToken,
        bot.idAquecimento,
        `Warmup_${row.telegram_user_id}`,
      ).catch(() => null);

      const warmupLink = warmupInvite?.invite_link || `https://t.me/${bot.botUsername || ""}`;

      // 5. Envia mensagem informando a expiração e convidando para o aquecimento
      const expiredMsg =
        `⚠️ <b>Sua assinatura VIP expirou!</b>\n\n` +
        `Para continuar recebendo o conteúdo completo e exclusivo, renove seu plano no chat do bot.\n\n` +
        `Enquanto isso, você foi redirecionado para o nosso grupo de prévias gratuitas:\n` +
        `👉 <a href="${warmupLink}">Entrar no Grupo de Prévias</a>`;

      await sendTelegramMessage(bot.botToken, String(row.telegram_user_id), expiredMsg).catch(() => {});
      evictedCount++;
    } catch (err) {
      console.error(`Erro ao processar expiração do usuário ${row.telegram_user_id}:`, err);
    }
  }

  return evictedCount;
}
