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
import {
  listAudienceRecipients,
  getTelegramUsersByIds,
  setTelegramUserBlocked,
} from "@/lib/telegramUsers";
import {
  listDueMailings,
  getMailing,
  enqueueMailing,
  nextQueueBatch,
  markQueueItem,
  pendingQueueCount,
  updateMailingStatus,
  computeNextRunAt,
  renderMailingText,
  type Mailing,
} from "@/lib/telegramMailing";
import { updatePost } from "@/lib/posts";
import { listMedia, getMediaRow } from "@/lib/media";
import { audienceFromPostType, logMediaPosted, pickReplacementMedia } from "@/lib/mediaUsage";
import { getProfile } from "@/lib/profiles";
import {
  DEFAULT_CTA_BUTTONS,
  DEFAULT_VIP_CTA_BUTTONS,
  DEFAULT_TELEGRAM_CTA_BUTTONS,
  WHATSAPP_CTA_FALLBACK,
  TELEGRAM_CTA_FALLBACK,
  contatoDoLink,
  appendCtaLines,
  buildCtaLines,
  captionHasLink,
  pickCtaButtonText,
  pickCtaLinkTexts,
  CTA_BUTTON_MAX,
} from "@/lib/postTypes";

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
 *  em HIPERLINK no fim, uma por linha, com as frases dos "Botões da copy".
 *  Remove também o CTA em texto puro ("👉 Acesse: ...") que ficou salvo em
 *  posts de versões antigas. */
function buildWarmupCaption(rawCaption: string, vipLink: string, texts: string[]): string {
  const body = (rawCaption || "").replace(/\n*👉\s*Acesse:.*$/s, "").trimEnd();
  const cta = buildCtaLines(vipLink, texts);
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
  // Resumo do ciclo para o alerta no celular (um push por ciclo, não por post:
  // o Método MK publica 20-35 vezes por dia e viraria spam).
  const cycle = { vip: 0, previas: 0, failed: 0 };

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
      .prepare(
        "SELECT warmup_cta_buttons, vip_cta_buttons FROM telegram_autopost_settings WHERE profile_id = ?",
      )
      .get(profile.id) as { warmup_cta_buttons?: string; vip_cta_buttons?: string } | undefined;
    const ctaList = (apRow?.warmup_cta_buttons ?? "").trim() || DEFAULT_CTA_BUTTONS;
    // Lista própria do VIP: lá o convite aponta para o WhatsApp particular.
    const vipCtaList = (apRow?.vip_cta_buttons ?? "").trim() || DEFAULT_VIP_CTA_BUTTONS;

    // Busca todos os posts agendados pendentes para Telegram (VIP ou Prévias)
    // deste perfil cujo horário já chegou.
    const pendingPosts = db
      .prepare(
        `
        SELECT p.id, p.caption, p.poll, p.cta, p.wa_link, pn.post_type, pm.media_id
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

      // Obtém o caminho da mídia.
      //
      // Se a mídia escolhida na geração não estiver mais na galeria, o post NÃO
      // pode virar texto: a legenda foi escrita para uma imagem ("olha esse
      // vestido") e sairia descrevendo uma foto que ninguém vê. Busca outra do
      // acervo do mesmo grupo, na ordem do Método MK — a menos postada primeiro,
      // que é a mesma regra da geração.
      let mediaPath = "";
      let mediaIdUsada = post.media_id as string | null;
      if (post.media_id) {
        const row = getMediaRow(post.media_id);
        if (row) mediaPath = row.path;
        else {
          const audience = audienceFromPostType(post.post_type);
          const substituta = audience
            ? pickReplacementMedia(profile.id, audience, listMedia(profile.id))
            : null;
          if (substituta) {
            const subRow = getMediaRow(substituta.id);
            if (subRow) {
              mediaPath = subRow.path;
              mediaIdUsada = substituta.id;
              console.warn(
                `[hotdash] Mídia ${post.media_id} sumiu do acervo; post ${post.id} saiu com ${substituta.id}.`,
              );
            }
          }
          // Sem substituta o acervo está vazio: aí o post sai só com o texto,
          // que é o melhor possível — mas fica o registro do motivo.
          if (!mediaPath) {
            console.warn(
              `[hotdash] Post ${post.id} pedia mídia, mas ${post.media_id} sumiu e não há substituta no acervo.`,
            );
          }
        }
      }

      // Enquete do post (se houver). Lida antes do CTA porque é ela que define
      // se o post é de MÍDIA — e post de mídia das Prévias sempre leva convite.
      let poll: { question?: string; options?: unknown } | null = null;
      try {
        if (post.poll) poll = JSON.parse(post.poll);
      } catch {
        poll = null;
      }
      const pollOptions = Array.isArray(poll?.options)
        ? (poll!.options as unknown[]).filter((o): o is string => typeof o === "string")
        : [];
      const hasPoll = Boolean(poll?.question) && pollOptions.length >= 2;
      const isMediaPost = !hasPoll && Boolean(mediaPath);

      // Link de saída do post, dependente do GRUPO:
      //  • PRÉVIAS: convite pro VIP. TODA foto e TODO vídeo leva o convite,
      //    independente do cta — a mídia é o que prende o olho, e é onde o
      //    convite converte. Sem mídia (texto puro/enquete) vale a regra do
      //    método: só conversão tem cta=1; humanização/reação/enquete têm
      //    cta=0. cta=NULL = post legado/manual → sempre com CTA, como antes.
      //  • VIP: botão do WhatsApp particular (puxa o lead pro WhatsApp p/ LTV).
      //    Só quando o post estiver MARCADO (cta=1) e o link estiver configurado
      //    — o padrão do VIP é SEM link (cta=NULL/0).
      const wantsVipCta =
        isWarmup && Boolean(profile.bioVipLink) && (isMediaPost || post.cta !== 0);
      // Destino do convite do VIP: o WhatsApp escolhido no post (Método MK ou
      // troca no calendário) e, quando ele não tem escolha própria, o "WhatsApp
      // particular" do cadastro — que é como todo post funcionava antes.
      const waLink = (post.wa_link as string | null) || profile.bioWhatsappLink || "";
      const wantsWaCta = post.post_type === "VIP" && post.cta === 1 && Boolean(waLink);

      let replyMarkup: { inline_keyboard: { text: string; url: string }[][] } | undefined;
      let finalCaption = escapeHtmlAllowingLinks(post.caption || "");

      if (wantsVipCta && profile.bioVipLink) {
        // Os dois ao mesmo tempo: o BOTÃO inline (uma frase) e as 3 linhas de
        // HIPERLINK no fim da legenda (outras frases da mesma lista).
        const ctaButtonText = pickCtaButtonText(ctaList);
        if (ctaButtonText) {
          replyMarkup = { inline_keyboard: [[{ text: ctaButtonText, url: profile.bioVipLink }]] };
        }
        // O gerador já grava as 3 linhas na legenda dos posts de mídia, para
        // você poder revisá-las no calendário. Aqui só completa quem ainda não
        // tem — post manual, ou agendado antes dessa mudança —, senão o convite
        // sairia duplicado.
        if (!captionHasLink(post.caption || "", profile.bioVipLink)) {
          finalCaption = buildWarmupCaption(
            post.caption || "",
            profile.bioVipLink,
            pickCtaLinkTexts(ctaList, 3),
          );
        }
      } else if (wantsWaCta && waLink) {
        // Mesmo esquema das Prévias, com o destino do VIP: botão do contato
        // particular MAIS as 3 linhas de hiperlink no fim da legenda.
        //
        // O destino sai da própria URL (ver contatoDoLink): a geração grava o
        // link resolvido no post, e é ele que manda no texto do botão e nas
        // frases. Um post de Telegram com o botão "meu whatsapp particular"
        // seria pior que não ter botão.
        const contato = contatoDoLink(waLink);
        const padraoBotao =
          contato === "telegram" ? "meu telegram particular" : "meu whatsapp particular";
        const botaoCadastro =
          contato === "telegram" ? profile.bioTelegramButton : profile.bioWhatsappButton;
        const waText = (botaoCadastro || padraoBotao).slice(0, CTA_BUTTON_MAX) || padraoBotao;
        replyMarkup = { inline_keyboard: [[{ text: waText, url: waLink }]] };
        if (!captionHasLink(post.caption || "", waLink)) {
          finalCaption = appendCtaLines(
            escapeHtmlAllowingLinks(post.caption || ""),
            waLink,
            pickCtaLinkTexts(
              contato === "telegram" ? DEFAULT_TELEGRAM_CTA_BUTTONS : vipCtaList,
              3,
            ),
            contato === "telegram" ? TELEGRAM_CTA_FALLBACK : WHATSAPP_CTA_FALLBACK,
          );
        }
      }

      const sendOpts = replyMarkup ? { reply_markup: replyMarkup } : {};

      // Post sem enquete, sem mídia e sem texto não tem o que enviar: marca como
      // postado para não travar a fila tentando repetidamente uma mensagem vazia.
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
        // Só conta o que REALMENTE foi ao ar (falha cai no catch e o post
        // continua agendado): é esse registro que alimenta o contador da
        // galeria e faz o Método MK preferir a mídia menos postada no grupo.
        // Registra a mídia que REALMENTE saiu — se houve substituição, é a
        // substituta que precisa contar, senão ela repetiria antes da hora.
        if (mediaIdUsada) {
          const audience = audienceFromPostType(post.post_type);
          // Nunca deixa uma falha de REGISTRO virar falha de ENVIO: o post já
          // saiu e já está marcado como postado — cair no catch de baixo o
          // contabilizaria como erro e alertaria à toa.
          try {
            if (audience) logMediaPosted([mediaIdUsada], profile.id, audience, post.id);
          } catch (e) {
            console.error(`Falha ao registrar publicação da mídia do post ${post.id}:`, e);
          }
        }
        totalPosted++;
        if (isWarmup) cycle.previas++;
        else cycle.vip++;

        if (isWarmup && sent?.message_id) {
          await setTelegramMessageReaction(bot.botToken, chatId, sent.message_id, seedEmoji).catch(() => {});
        }
      } catch (e) {
        console.error(`Erro ao postar post ${post.id} no Telegram:`, e);
        cycle.failed++;
        // O post permanece 'scheduled' e será tentado novamente no próximo ciclo
      }
    }
  }

  // Alerta de POSTAGEM DO TELEGRAM: um resumo por ciclo. Falha tem prioridade,
  // porque é o caso em que você precisa agir.
  if (cycle.vip + cycle.previas + cycle.failed > 0) {
    try {
      const { sendPushEvent } = await import("@/lib/push");
      const partes: string[] = [];
      if (cycle.vip) partes.push(`${cycle.vip} no VIP`);
      if (cycle.previas) partes.push(`${cycle.previas} nas Prévias`);
      const enviados = partes.join(" e ");
      if (cycle.failed > 0) {
        await sendPushEvent(
          "telegramPost",
          `⚠️ Falha ao postar no Telegram (${cycle.failed})`,
          enviados ? `${enviados} saíram; ${cycle.failed} falharam e serão tentados de novo.`
                   : `${cycle.failed} post(s) falharam e serão tentados de novo.`,
          "/dashboard/telegram",
        );
      } else {
        await sendPushEvent(
          "telegramPost",
          `✅ Publicado no Telegram — ${totalPosted} post(s)`,
          enviados,
          "/dashboard/telegram",
        );
      }
    } catch (pErr) {
      console.error("Erro ao enviar push de postagem do Telegram:", pErr);
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
          planId: row.plan_id || undefined,
          offerId: row.offer_id || undefined,
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
// 3) MAILING — disparo de mensagem em massa para os usuários do bot
// ---------------------------------------------------------------------------

/**
 * Quantas mensagens saem por ciclo (o agendador roda de minuto em minuto) e o
 * intervalo entre elas. O Telegram tolera ~30 mensagens por segundo no total;
 * 50 ms entre envios (20/s) deixa folga para o bot seguir atendendo /start e
 * pagamentos enquanto o disparo acontece. Com 300 por ciclo, uma base de mil
 * pessoas leva ~4 minutos — e a fila garante que um restart no meio retome de
 * onde parou em vez de mandar tudo de novo.
 */
const MAILING_BATCH = 300;
const MAILING_DELAY_MS = 50;
/** Limite de legenda de mídia do Telegram (a mensagem de texto vai a 4096). */
const CAPTION_MAX = 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Classifica a recusa do Telegram: bloqueio do usuário ≠ falha de envio. */
function classifySendError(err: unknown): { kind: "blocked" | "failed" | "flood"; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.toLowerCase();
  if (m.includes("too many requests") || m.includes("retry after")) {
    return { kind: "flood", message };
  }
  if (
    m.includes("bot was blocked by the user") ||
    m.includes("user is deactivated") ||
    m.includes("chat not found") ||
    m.includes("bot can't initiate conversation") ||
    m.includes("peer_id_invalid")
  ) {
    return { kind: "blocked", message };
  }
  return { kind: "failed", message };
}

/** Botões do disparo: ofertas (compra) + links personalizados. */
function buildMailingMarkup(mailing: Mailing) {
  const rows: { text: string; url?: string; callback_data?: string }[][] = [];
  for (const offer of mailing.offers) {
    const priceStr = (offer.priceCents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    rows.push([{ text: `${offer.name} - ${priceStr}`, callback_data: `buy_offer_${offer.id}` }]);
  }
  for (const btn of mailing.buttons) {
    if (btn.text.trim() && btn.url.trim()) rows.push([{ text: btn.text, url: btn.url }]);
  }
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

/** Uma mídia aleatória entre as que têm as etiquetas escolhidas (se houver). */
function pickMailingMedia(profileId: string, mediaTags?: string): string | null {
  const tags = (mediaTags || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tags.length === 0) return null;
  const candidates = listMedia(profileId).filter((m) =>
    m.tags.some((t) => tags.includes(t.name.toLowerCase())),
  );
  if (candidates.length === 0) return null;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  const row = getMediaRow(chosen.id);
  return row ? row.path : null;
}

export async function runTelegramMailings(): Promise<{ sent: number; failed: number }> {
  const due = listDueMailings();
  let sent = 0;
  let failed = 0;

  for (const mailing of due) {
    const bot = getBotConfig(mailing.botId);
    if (!bot || !bot.botToken) continue;

    // 1) Agendado cujo horário chegou → monta a fila desta rodada.
    if (mailing.status === "scheduled") {
      const recipients = listAudienceRecipients(mailing.botId, mailing.audiences);
      if (recipients.length === 0) {
        // Nada a enviar agora: reagenda (ou encerra, se era de uma vez só).
        const next = computeNextRunAt(mailing);
        updateMailingStatus(mailing.id, next ? "scheduled" : "sent", next ?? null);
        continue;
      }
      enqueueMailing(mailing.id, recipients);
    }

    // 2) Drena um lote da fila.
    const batch = nextQueueBatch(mailing.id, MAILING_BATCH);
    if (batch.length > 0) {
      const profile = await getProfile(mailing.profileId);
      const users = getTelegramUsersByIds(
        mailing.botId,
        batch.map((b) => b.telegramUserId),
      );
      const replyMarkup = buildMailingMarkup(mailing);
      const mediaPath = pickMailingMedia(mailing.profileId, mailing.mediaTags);

      for (const item of batch) {
        const user = users.get(item.telegramUserId);
        const text = renderMailingText(
          mailing.message,
          {
            firstName: user?.firstName,
            lastName: user?.lastName,
            username: user?.username,
            telegramUserId: item.telegramUserId,
          },
          { profileName: profile?.name, botUsername: bot.botUsername },
        );

        try {
          if (mediaPath && text.length > CAPTION_MAX) {
            // Legenda de mídia no Telegram vai até 1024 caracteres (a mensagem
            // de texto vai a 4096). Texto longo com mídia sai em duas partes,
            // com os botões na segunda — senão o envio inteiro seria recusado.
            await sendTelegramMedia(bot.botToken, item.chatId, mediaPath, undefined);
            await sendTelegramMessage(bot.botToken, item.chatId, text, {
              reply_markup: replyMarkup,
            });
          } else if (mediaPath) {
            await sendTelegramMedia(bot.botToken, item.chatId, mediaPath, text, {
              reply_markup: replyMarkup,
            });
          } else {
            await sendTelegramMessage(bot.botToken, item.chatId, text, {
              reply_markup: replyMarkup,
            });
          }
          markQueueItem(item.id, mailing.id, "sent");
          sent++;
        } catch (err) {
          const { kind, message } = classifySendError(err);
          if (kind === "flood") {
            // Limite do Telegram: para o lote e tenta de novo no próximo ciclo,
            // deixando os itens restantes como pendentes.
            console.warn(`[hotdash] mailing ${mailing.id} pausado por flood control: ${message}`);
            break;
          }
          if (kind === "blocked") {
            setTelegramUserBlocked(mailing.botId, item.telegramUserId, true);
            markQueueItem(item.id, mailing.id, "blocked", message);
          } else {
            markQueueItem(item.id, mailing.id, "failed", message);
            failed++;
          }
        }
        await sleep(MAILING_DELAY_MS);
      }
    }

    // 3) Fila vazia → encerra ou reagenda a próxima rodada.
    if (pendingQueueCount(mailing.id) === 0) {
      // Recarrega para o resumo sair com os contadores desta rodada.
      const fresh = getMailing(mailing.id);
      const next = computeNextRunAt(mailing);
      updateMailingStatus(mailing.id, next ? "scheduled" : "sent", next ?? null);

      try {
        const { sendPushEvent } = await import("@/lib/push");
        const s = fresh?.sentCount ?? 0;
        const f = fresh?.failedCount ?? 0;
        const b = fresh?.blockedCount ?? 0;
        await sendPushEvent(
          "mailing",
          `📣 Mailing enviado — ${s} mensagem(ns)`,
          `${mailing.name}${f ? ` · ${f} falha(s)` : ""}${b ? ` · ${b} bloqueado(s)` : ""}`,
          "/dashboard/telegram/mailing",
        );
      } catch (pErr) {
        console.error("Erro ao enviar push de mailing:", pErr);
      }
    }
  }

  return { sent, failed };
}

// ---------------------------------------------------------------------------
// 4) EXPIRAÇÃO — remove do VIP quem venceu e reconduz ao grupo de prévias
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
        planId: row.plan_id || undefined,
        offerId: row.offer_id || undefined,
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
