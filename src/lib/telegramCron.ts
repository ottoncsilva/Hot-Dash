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
  sendTelegramPoll,
  setTelegramMessageReaction,
  banTelegramMember,
  unbanTelegramMember,
  createTelegramInviteLink,
} from "@/lib/telegramApi";
import { updatePost } from "@/lib/posts";
import { listMedia, getMediaRow } from "@/lib/media";
import { DEFAULT_CTA_BUTTONS, pickCtaButtonText } from "@/lib/postTypes";

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

/** Escapa os caracteres especiais de HTML no texto — o envio ao Telegram usa
 *  parse_mode "HTML", então o corpo da legenda precisa ser neutralizado antes
 *  de anexarmos tags <a> (hiperlinks) do CTA. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Como escapeHtml, mas PRESERVA os hiperlinks <a ...>...</a> que o usuário
 *  inseriu na legenda pelo painel — só escapa o texto ao redor deles. Assim os
 *  links manuais viram clicáveis no Telegram sem quebrar o parse. */
function escapeHtmlAllowingLinks(s: string): string {
  return s
    .split(/(<a\s[^>]*>.*?<\/a>)/gis)
    .map((part, i) => (i % 2 === 1 ? part : escapeHtml(part)))
    .join("");
}

/** Monta a legenda das Prévias: corpo (limpo/escapado) + 3 chamadas para ação
 *  em HIPERLINK ("ACESSAR O VIP 🎁"), em vez do link cru. Remove também o CTA
 *  em texto puro ("👉 Acesse: ...") que ficou salvo em posts de versões antigas. */
function buildWarmupCaption(rawCaption: string, vipLink: string): string {
  const body = (rawCaption || "").replace(/\n*👉\s*Acesse:.*$/s, "").trimEnd();
  const href = vipLink.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const linkLine = `<a href="${href}">ACESSAR O VIP 🎁</a>`;
  const cta = `${linkLine}\n${linkLine}\n${linkLine}`;
  return body ? `${escapeHtmlAllowingLinks(body)}\n\n${cta}` : cta;
}

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

    // "Semear reação" nas Prévias é EMBUTIDO (parte do método): o bot dá a 1ª
    // reação 🔥 em cada post de prévia (social proof). Best-effort — só funciona
    // se o grupo tiver reações habilitadas e o bot for admin.
    const seedEmoji = "🔥";

    // "Botões da copy": frases de CTA (1 por linha). O sistema escolhe 1 por
    // post de prévia e anexa como botão inline com o link do VIP.
    const apRow = db
      .prepare("SELECT warmup_cta_buttons FROM telegram_autopost_settings WHERE profile_id = ?")
      .get(profile.id) as { warmup_cta_buttons?: string } | undefined;
    const ctaList = (apRow?.warmup_cta_buttons ?? "").trim() || DEFAULT_CTA_BUTTONS;

    // Busca todos os posts agendados pendentes para Telegram (VIP ou Prévias)
    // deste perfil cujo horário já chegou.
    const pendingPosts = db
      .prepare(
        `
        SELECT p.id, p.caption, p.poll, p.cta, pn.post_type, pm.media_id
        FROM posts p
        JOIN post_networks pn ON pn.post_id = p.id
        LEFT JOIN post_media pm ON pm.post_id = p.id AND pm.sort_order = 0
        WHERE p.profile_id = ? AND p.status = 'scheduled' AND p.scheduled_at <= ? AND pn.network = 'telegram'
      `,
      )
      .all(profile.id, now) as any[];

    for (const post of pendingPosts) {
      // Define o alvo. "Aquecimento" é aceito como sinônimo legado de "Prévias"
      // (posts manuais antigos usavam esse rótulo) para não travarem na fila.
      let chatId = "";
      const isWarmup = post.post_type === "Prévias" || post.post_type === "Aquecimento";
      if (post.post_type === "VIP") chatId = bot.idVip;
      else if (isWarmup) chatId = bot.idAquecimento;
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

      // CTA das Prévias: só anexa o botão do VIP quando o post PEDE CTA. No
      // Método MK só os tipos de conversão têm cta=1; humanização/reação/enquete
      // têm cta=0 (sem link). cta=NULL = post legado/manual → mantém o
      // comportamento antigo (sempre com CTA). Com botão, a legenda vai limpa;
      // com CTA mas sem lista de frases, cai nos hiperlinks "ACESSAR O VIP 🎁".
      const wantsCta = isWarmup && Boolean(profile.bioVipLink) && post.cta !== 0;
      const ctaButtonText = wantsCta ? pickCtaButtonText(ctaList) : null;
      const ctaMarkup =
        ctaButtonText && profile.bioVipLink
          ? { inline_keyboard: [[{ text: ctaButtonText, url: profile.bioVipLink }]] }
          : undefined;
      const sendOpts = ctaMarkup ? { reply_markup: ctaMarkup } : {};

      const finalCaption = ctaMarkup
        ? escapeHtmlAllowingLinks(post.caption || "")
        : wantsCta && profile.bioVipLink
          ? buildWarmupCaption(post.caption || "", profile.bioVipLink)
          : escapeHtmlAllowingLinks(post.caption || "");

      // Enquete do post (se houver).
      let poll: { question?: string; options?: unknown } | null = null;
      try {
        if (post.poll) poll = JSON.parse(post.poll);
      } catch {
        poll = null;
      }
      const pollOptions = Array.isArray(poll?.options)
        ? (poll!.options as unknown[]).filter((o): o is string => typeof o === "string")
        : [];

      // Post sem enquete, sem mídia e sem texto não tem o que enviar: marca como
      // postado para não travar a fila tentando repetidamente uma mensagem vazia.
      const hasPoll = Boolean(poll?.question) && pollOptions.length >= 2;
      if (!hasPoll && !mediaPath && !finalCaption.trim()) {
        updatePost(post.id, { status: "posted" });
        continue;
      }

      // Dispara no Telegram: enquete → sendPoll; com mídia → foto/vídeo;
      // sem mídia → mensagem de texto. Depois, nas Prévias, semeia a reação.
      try {
        let sent: { message_id?: number } | undefined;
        if (poll?.question && pollOptions.length >= 2) {
          sent = await sendTelegramPoll(bot.botToken, chatId, poll.question, pollOptions, sendOpts);
        } else if (mediaPath) {
          sent = (await sendTelegramMedia(bot.botToken, chatId, mediaPath, finalCaption, sendOpts)) as
            | { message_id?: number }
            | undefined;
        } else {
          sent = (await sendTelegramMessage(bot.botToken, chatId, finalCaption, sendOpts)) as
            | { message_id?: number }
            | undefined;
        }
        updatePost(post.id, { status: "posted" });
        totalPosted++;

        if (isWarmup && sent?.message_id) {
          await setTelegramMessageReaction(bot.botToken, chatId, sent.message_id, seedEmoji).catch(() => {});
        }
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

  // Busca inscrições VIP ativas que já expiraram. expires_at > 0 exclui as
  // compras de PACOTE (compra única, sem VIP), que ficam com expires_at = 0.
  const expiredRows = db
    .prepare("SELECT * FROM telegram_subscriptions WHERE status = 'active' AND expires_at > 0 AND expires_at < ?")
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
