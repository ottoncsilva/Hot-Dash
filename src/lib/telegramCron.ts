import "server-only";
import { getDb } from "@/lib/db";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cronLock";
import { listProfiles } from "@/lib/profiles";
import { buttonStyleProps, planButtonStyleProps, getAppTimeZone, type ButtonStyles } from "@/lib/settings";
import { partsInTimeZone, zonedWallTimeToUtcMs, addDaysInTimeZone } from "@/lib/timezone";
import {
  getBotConfigByProfile,
  getBotConfig,
  listLeadsForDownsell,
  findActiveSubscription,
  findPendingSubscription,
  upsertTelegramLead,
  listActivePlans,
  listApprovalQueue,
  advanceApproval,
  dequeueApproval,
  saveSubscription,
  getSubscription,
  getPlan,
} from "@/lib/telegramDb";
import {
  sendTelegramMedia,
  sendTelegramMessage,
  sendTelegramPoll,
  setTelegramMessageReaction,
  banTelegramMember,
  unbanTelegramMember,
  createTelegramInviteLink,

  sendTelegramVoiceUrl,} from "@/lib/telegramApi";
import {
  listAudienceRecipients,
  getTelegramUsersByIds,
  getTelegramUser,
  setTelegramUserGroup,
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
  getMailingOffer,
  type Mailing,
} from "@/lib/telegramMailing";
import { updatePost } from "@/lib/posts";
import { stripCaptionLabels } from "@/lib/captionLabels";
import { linkDoVip } from "@/lib/vipLink";
import { enviarMensagemDoBot } from "@/lib/telegramSend";
import { aplicarVariaveis } from "@/lib/telegramVars";
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

/**
 * Trava por chave: esta tarefa roda tanto pelo ticker interno
 * (`instrumentation.ts`, a cada 1 min) quanto pela rota HTTP
 * `/api/cron/telegram/autopost` — sem a trava, as duas podiam rodar juntas e
 * duplicar o que foi postado/enviado.
 */
export async function runTelegramAutopost(): Promise<number> {
  if (!tryAcquireCronLock("telegram-autopost")) return 0;
  try {
    return await runTelegramAutopostImpl();
  } finally {
    releaseCronLock("telegram-autopost");
  }
}

async function runTelegramAutopostImpl(): Promise<number> {
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
      // O link do VIP: o que o operador escreveu ou, na falta dele, o que o
      // painel descobriu sozinho a partir do bot/grupo (lib/vipLink.ts).
      const vipLink = linkDoVip(profile);
      const wantsVipCta = isWarmup && Boolean(vipLink) && (isMediaPost || post.cta !== 0);
      // Destino do convite do VIP: o WhatsApp escolhido no post (Método MK ou
      // troca no calendário) e, quando ele não tem escolha própria, o "WhatsApp
      // particular" do cadastro — que é como todo post funcionava antes.
      const waLink = (post.wa_link as string | null) || profile.bioWhatsappLink || "";
      const wantsWaCta = post.post_type === "VIP" && post.cta === 1 && Boolean(waLink);

      let replyMarkup: { inline_keyboard: { text: string; url: string }[][] } | undefined;
      // ÚLTIMA barreira contra o rótulo da IA ("Legenda final:", "Legenda para
      // Telegram (VIP):"). A limpeza acontece na geração (ai.cleanCaption), mas
      // o dia inteiro já está agendado no banco: sem limpar aqui, tudo o que foi
      // gerado antes desta correção continuaria indo ao ar com o título — e o
      // operador só descobre depois de publicado, no grupo.
      const legenda = stripCaptionLabels(post.caption || "");
      let finalCaption = escapeHtmlAllowingLinks(legenda);

      if (wantsVipCta && vipLink) {
        // Os dois ao mesmo tempo: o BOTÃO inline (uma frase) e as 3 linhas de
        // HIPERLINK no fim da legenda (outras frases da mesma lista).
        const ctaButtonText = pickCtaButtonText(ctaList);
        if (ctaButtonText) {
          replyMarkup = { inline_keyboard: [[{ text: ctaButtonText, url: vipLink }]] };
        }
        // O gerador já grava as 3 linhas na legenda dos posts de mídia, para
        // você poder revisá-las no calendário. Aqui só completa quem ainda não
        // tem — post manual, ou agendado antes dessa mudança —, senão o convite
        // sairia duplicado.
        if (!captionHasLink(legenda, vipLink)) {
          finalCaption = buildWarmupCaption(
            legenda,
            vipLink,
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
        if (!captionHasLink(legenda, waLink)) {
          finalCaption = appendCtaLines(
            escapeHtmlAllowingLinks(legenda),
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

export type FunnelStep = {
  delayMinutes: number;
  text: string;
  discountPercent?: number;
  /** Mídias ESCOLHIDAS a dedo, na ordem de envio. É o que a tela edita hoje. */
  mediaIds?: string[];
  mediaMode?: "album" | "separate";
  /** Etiquetas — legado. Saiu da tela; ver lib/telegramSend.ts. */
  mediaTags?: string;
  isLoop?: boolean; // Se for true na última etapa, repete pra sempre.
  /**
   * Só na sequência de aprovação, e é o que decide o teclado do passo:
   *   none   → sem botão;
   *   plans  → a lista de planos (os mesmos do /start);
   *   custom → os botões escritos no próprio passo (`customButtons`).
   *
   * O modo "custom" existe porque a mensagem de quem acabou de entrar nas
   * prévias normalmente não vende: ela chama a pessoa PARA O BOT, e é um botão
   * de link, não de compra.
   */
  buttons?: "none" | "plans" | "custom";
  customButtons?: { text: string; url: string }[];
  /**
   * MODO DE BOTÕES da Recuperação: quais planos entram no teclado.
   *   all      → assinaturas e pacotes (padrão, e o comportamento de sempre);
   *   subs     → só assinaturas;
   *   packages → só pacotes;
   *   none     → sem botão.
   */
  planMode?: "all" | "subs" | "packages" | "none";
  /**
   * DESTINATÁRIOS do passo, DENTRO do público do funil. O Downsell geral já
   * fala com quem não tem assinatura ativa; isto refina:
   *   leads     → nunca comprou (padrão);
   *   expirados → já comprou e venceu;
   *   todos     → os dois.
   * Quem não se encaixa PULA o passo (e avança), em vez de travar nele.
   */
  audience?: "leads" | "expirados" | "todos";
  /**
   * Passo por HORÁRIO FIXO do dia (ex.: "16:00"), não por minutos decorridos
   * — usado no rabo do Downsell (depois de bater 50%, manda sempre nos
   * mesmos horários, todo dia). Quando presente, IGNORA `delayMinutes`
   * inteiramente; ver `passoPronto`. Só faz sentido junto de `isLoop: true`.
   */
  dailyTime?: string;
};

function buildReplyMarkup(
  bot: { id: string; buttonStyles?: ButtonStyles },
  discountPercent = 0,
  planMode: FunnelStep["planMode"] = "all",
) {
  if (planMode === "none") return undefined;
  // Só os ATIVOS: um plano desligado some do /start, e some dos funis também.
  const plans = listActivePlans(bot.id).filter((p) =>
    planMode === "subs" ? p.kind !== "package" : planMode === "packages" ? p.kind === "package" : true,
  );
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
          ...planButtonStyleProps(bot, plan.highlight),
        },
      ]);
    });
  }
  // "Not from Brazil?" — mesmo critério do /start (ver webhooks/telegram):
  // só aparece quando existe plano com priceUsdCents cadastrado. Só o
  // Downsell GERAL ganha este botão; o Downsell de PIX gerado (irmão, usa
  // `buildPixDownsellMarkup` logo abaixo) fica de fora por ora — ver Parte
  // C.4 do plano da Stripe.
  if (plans.some((p) => (p.priceUsdCents || 0) > 0)) {
    inlineKeyboard.push([
      { text: "🌎 Not from Brazil?", callback_data: "intl_menu", ...buttonStyleProps(bot, "redirect") },
    ]);
  }
  return inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;
}

/**
 * Botão do Downsell de PIX gerado — DIFERENTE do `buildReplyMarkup` genérico:
 * este lead já escolheu um item específico (o plano ou a oferta de mailing
 * gravados em `sub` na hora que o PIX foi criado), então o desconto do passo
 * incide SÓ sobre o preço DAQUELE item, não sobre a lista inteira de planos
 * de novo — reabrir a lista faria parecer um convite pra escolher de novo,
 * quando o pedido é "termine de pagar o que você já escolheu, com desconto".
 *
 * `bumpCents` (o Order Bump que o lead pode ter aceitado na hora) fica de
 * fora do recálculo por ora — reabrir o bump aqui seria uma oferta à parte.
 *
 * Sem `planId`/`offerId` resolvível (linha órfã, plano apagado depois),
 * cai pro `buildReplyMarkup` genérico — pra nunca sair sem nenhum botão.
 */
/**
 * Resolve o item (plano ou oferta de mailing) que o lead já escolheu, com o
 * desconto do passo já aplicado — usado tanto para montar o botão quanto
 * para preencher `{plano}`/`{valor}` no texto do mesmo passo.
 */
function resolvePixItem(sub: { planId?: string; offerId?: string }, discountPercent = 0) {
  const isPlan = Boolean(sub.planId);
  const item = sub.planId ? getPlan(sub.planId) : sub.offerId ? getMailingOffer(sub.offerId) : null;
  if (!item) return null;

  let finalPrice = item.priceCents;
  if (discountPercent > 0 && discountPercent <= 100) {
    finalPrice = Math.floor(finalPrice * (1 - discountPercent / 100));
  }
  const highlight = "highlight" in item ? (item as { highlight?: string }).highlight : undefined;
  return { item, isPlan, finalPrice, highlight };
}

function buildPixDownsellMarkup(
  bot: { id: string; buttonStyles?: ButtonStyles },
  sub: { planId?: string; offerId?: string },
  discountPercent = 0,
) {
  const resolvido = resolvePixItem(sub, discountPercent);
  if (!resolvido) return buildReplyMarkup(bot, discountPercent);
  const { item, isPlan, finalPrice, highlight } = resolvido;

  const priceStr = (finalPrice / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const prefixo = isPlan ? "buy_plan_" : "buy_offer_";

  return {
    inline_keyboard: [
      [
        {
          text: `${discountPercent > 0 ? `🔥 (-${discountPercent}%) ` : ""}${item.name} - ${priceStr}`,
          callback_data: `${prefixo}${item.id}${discountPercent > 0 ? `_${discountPercent}` : ""}`,
          ...planButtonStyleProps(bot, highlight),
        },
      ],
    ],
  };
}

/**
 * Descobre a partir de qual índice começa o "rabo" de passos em loop — a
 * sequência de UM OU MAIS passos marcados `isLoop`, sempre os ÚLTIMOS da
 * lista. Sem nenhum passo em loop no fim, devolve `funnel.length` (não tem
 * pra onde repetir).
 */
function loopStartIndex(funnel: FunnelStep[]): number {
  let k = funnel.length;
  while (k > 0 && funnel[k - 1].isLoop) k--;
  return k;
}

/**
 * Traduz um CONTADOR sempre crescente (quantos passos essa pessoa já
 * processou, contando os pulados por destinatário) no índice FÍSICO do
 * passo a mandar agora. Dentro da sequência normal é 1:1; depois que passa
 * do fim, GIRA pelos passos em loop na ordem em que aparecem — é o que
 * permite alternar entre duas (ou mais) mensagens no rabo, em vez de
 * repetir sempre a última pra sempre. Uma sequência com só UM passo em
 * loop no fim se comporta exatamente como antes: repete sempre aquele.
 */
function resolveStepIndex(funnel: FunnelStep[], counter: number): number | null {
  if (counter < funnel.length) return counter;
  const k = loopStartIndex(funnel);
  if (k >= funnel.length) return null; // acabou e não tem loop configurado
  const loopLen = funnel.length - k;
  return k + ((counter - funnel.length) % loopLen);
}

/**
 * Próxima ocorrência de um horário fixo (ex.: "16:00") ESTRITAMENTE depois
 * de `apos`, no fuso da operação. Se o horário de hoje já passou, cai pro
 * mesmo horário amanhã — é o que faz um passo com `dailyTime` repetir todo
 * dia, sempre na mesma hora de parede, em vez de andar com o relógio UTC.
 */
function proximoHorarioFixo(hhmm: string, apos: number, tz: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10) || 0);
  const p = partsInTimeZone(apos, tz);
  const candidatoHoje = zonedWallTimeToUtcMs(p.year, p.month, p.day, h, m, tz);
  if (candidatoHoje > apos) return candidatoHoje;
  const meiaNoiteAmanha = addDaysInTimeZone(apos, 1, tz);
  const pa = partsInTimeZone(meiaNoiteAmanha, tz);
  return zonedWallTimeToUtcMs(pa.year, pa.month, pa.day, h, m, tz);
}

/**
 * Decide se É HORA de mandar este passo — e o "desde quando" depende do
 * TIPO do passo, de propósito:
 *
 *   - Passo comum (`delayMinutes`): conta do FATO GERADOR do funil inteiro
 *     — o /start no Downsell geral, a criação da cobrança no Downsell de
 *     PIX gerado — e NUNCA reinicia a cada mensagem enviada. É assim que
 *     "chega a 50% em 24h" significa 24h de verdade desde que o lead entrou
 *     no funil, e não 24h desde a ÚLTIMA mensagem (que somaria muito mais).
 *   - Passo de horário fixo (`dailyTime`): PRECISA de uma referência que
 *     ANDA (o último envio), senão "às 16h" resolveria sempre para o mesmo
 *     instante fixo no passado e disparava a cada tick do cron pra sempre,
 *     em vez de uma vez por dia.
 */
function passoPronto(
  step: FunnelStep,
  tempos: { fatoGerador: number; ultimoEnvio: number },
  now: number,
  tz: string,
): boolean {
  if (step.dailyTime) return now >= proximoHorarioFixo(step.dailyTime, tempos.ultimoEnvio, tz);
  return (now - tempos.fatoGerador) / 60000 >= step.delayMinutes;
}

/**
 * Acha o passo mais avançado que já está pronto pra envio, sem nunca mandar
 * os intermediários — se o processamento ficou atrasado (o cron parou de
 * rodar por um tempo, deploy, etc.), o lead recebe só a mensagem que
 * corresponde a AGORA, nunca uma rajada com tudo que "deveria" ter recebido
 * nesse meio-tempo.
 *
 * Anda a partir de `indiceAtual` enquanto o PRÓXIMO passo (resolvido por
 * `resolveIndice`, que decide se ele existe/repete em loop) TAMBÉM já
 * estiver pronto (`pronto`). No caso normal (nada atrasado), o passo
 * seguinte nunca está pronto ainda — o resultado é idêntico a mandar só o
 * passo atual, como sempre foi.
 */
function passoMaisAvancado(
  indiceAtual: number,
  resolveIndice: (i: number) => number | null,
  pronto: (i: number) => boolean,
): { enviar: number; proximo: number } | null {
  const idx = resolveIndice(indiceAtual);
  if (idx === null || !pronto(idx)) return null;
  let enviar = idx;
  // Trava de segurança contra loop infinito por config quebrada (ex.: delay
  // 0 num passo em loop) — nunca deve ser atingida em uso normal.
  for (let guard = 0; guard < 500; guard++) {
    const seguinte = resolveIndice(enviar + 1);
    if (seguinte === null || !pronto(seguinte)) break;
    enviar = seguinte;
  }
  return { enviar, proximo: enviar + 1 };
}

async function sendFunnelStep(
  botToken: string,
  botId: string,
  chatId: string,
  profileId: string,
  step: FunnelStep,
  replyMarkup: any,
  botUsername?: string,
  /** Só o Downsell de PIX gerado preenche isto — ver `resolvePixItem`. */
  extraVars?: { planoEscolhido?: string; valorComDesconto?: string },
) {
  // As VARIÁVEIS eram oferecidas na tela e NÃO eram trocadas no envio: o lead
  // recebia a chave literal no meio do texto. No privado o chat_id é o próprio
  // id do usuário, então os dados saem da lista de usuários.
  const pessoa = getTelegramUser(`${botId}_${chatId}`);
  const texto = aplicarVariaveis(step.text || "", {
    firstName: pessoa?.firstName,
    lastName: pessoa?.lastName,
    username: pessoa?.username,
    profileName: getProfileName(profileId),
    botUsername,
    ...extraVars,
  });

  // Mesmo caminho de envio do /start: mídias escolhidas, em álbum ou uma por
  // mensagem. Antes daqui só saía UMA mídia, sorteada por etiqueta.
  try {
    await enviarMensagemDoBot({
      botToken,
      chatId,
      profileId,
      text: texto,
      mediaIds: step.mediaIds,
      mode: step.mediaMode,
      mediaTags: step.mediaTags,
      replyMarkup,
    });
  } catch (e) {
    console.error(`Erro ao enviar passo de funil para ${chatId}:`, e);
  }
}

/**
 * Trava por chave: esta tarefa roda tanto pelo ticker interno
 * (`instrumentation.ts`, a cada 1 min) quanto pela rota HTTP
 * `/api/cron/telegram/funnels` — sem a trava, as duas podiam rodar juntas e
 * mandar a mesma mensagem de downsell/upsell/renovação mais de uma vez.
 */
export async function runTelegramFunnels(): Promise<{
  downsellCount: number;
  upsellCount: number;
  renewalCount: number;
}> {
  if (!tryAcquireCronLock("telegram-funnels")) {
    return { downsellCount: 0, upsellCount: 0, renewalCount: 0 };
  }
  try {
    return await runTelegramFunnelsImpl();
  } finally {
    releaseCronLock("telegram-funnels");
  }
}

async function runTelegramFunnelsImpl(): Promise<{
  downsellCount: number;
  upsellCount: number;
  renewalCount: number;
}> {
  const db = getDb();
  const profiles = db.prepare("SELECT id FROM profiles").all() as { id: string }[];
  const tz = getAppTimeZone();

  let downsellCount = 0;
  let upsellCount = 0;
  let renewalCount = 0;

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

    if (downsellFunnel.length > 0 && bot.downsellEnabled !== false) {
      const leads = listLeadsForDownsell().filter((l) => l.profileId === p.id);
      for (const lead of leads) {
        // Verifica se já não pagou
        const activeSub = findActiveSubscription(bot.id, Number(lead.chatId));
        if (activeSub) continue; // Pagou, sai do remarketing

        // Gerou o PIX: sai do Downsell geral e passa a ser cuidado pelo
        // Downsell de PIX gerado (bloco 1b) — os dois nunca correm juntos
        // pro mesmo lead, senão ele levaria mensagem dobrada.
        if (findPendingSubscription(bot.id, Number(lead.chatId))) continue;

        const idx = resolveStepIndex(downsellFunnel, lead.downsellStepIndex);
        if (idx === null) continue; // Acabou e não repete

        const step = downsellFunnel[idx];

        // DESTINATÁRIOS do passo. Quem não se encaixa PULA a mensagem e avança
        // — travar a pessoa num passo que nunca vai ser dela pararia a
        // sequência inteira para ela, em silêncio. O contador SEMPRE avança
        // (mesmo pulando), então dentro do rabo em loop ela continua girando
        // pelos passos certos em vez de travar num só.
        if (!encaixaNoPublico(bot.id, Number(lead.chatId), step.audience)) {
          lead.downsellStepIndex += 1;
          upsertTelegramLead(lead);
          continue;
        }

        // O FATO GERADOR é o /start (`lead.downsellStartedAt`), fixo até o
        // PRÓXIMO /start — ao contrário de `lead.createdAt` (o PRIMEIRO
        // /start pra sempre, usado nas métricas do Funil de Vendas), este
        // campo é reiniciado toda vez que o lead volta e dá /start de novo,
        // pra ele entrar de novo do zero e não achar o funil na metade (ou
        // já esgotado) por causa da vez em que apareceu pela primeira vez.
        // Sem valor salvo (lead de antes desta coluna existir), cai pro
        // `createdAt` — mesmo comportamento de hoje até o próximo /start dele.
        // `lastInteractionAt` segue de referência só pro rabo em horário
        // fixo (`passoPronto`), que precisa de um ponto que ANDA a cada
        // envio pra repetir uma vez por dia, não do começo do funil.
        //
        // `passoMaisAvancado` evita a rajada quando o processamento ficou
        // atrasado (cron parado, deploy): em vez de mandar SÓ o passo atual
        // e avançar 1 por tick — o que varreria o funil inteiro em rajada se
        // vários passos já estiverem vencidos ao mesmo tempo — ele acha o
        // passo mais recente que já é válido e manda só ele, pulando os
        // intermediários sem enviar (nunca reenvia o que ficou pra trás). Um
        // passo cujo público não bate também para o avanço aqui (fica pro
        // "pula sem enviar" de cima, no próximo tick).
        const tempos = {
          fatoGerador: lead.downsellStartedAt || lead.createdAt,
          ultimoEnvio: lead.lastInteractionAt,
        };
        const alvo = passoMaisAvancado(
          idx,
          (i) => resolveStepIndex(downsellFunnel, i),
          (i) =>
            encaixaNoPublico(bot.id, Number(lead.chatId), downsellFunnel[i].audience) &&
            passoPronto(downsellFunnel[i], tempos, now, tz),
        );
        if (alvo) {
          const stepFinal = downsellFunnel[alvo.enviar];
          const replyMarkup = buildReplyMarkup(bot, stepFinal.discountPercent, stepFinal.planMode);
          await sendFunnelStep(bot.botToken, bot.id, lead.chatId, p.id, stepFinal, replyMarkup, bot.botUsername);

          lead.lastInteractionAt = now;
          lead.downsellStepIndex = alvo.proximo;
          upsertTelegramLead(lead);
          downsellCount++;
        }
      }
    }

    // 1b. PIX GERADO E NÃO PAGO — o terceiro gatilho da recuperação.
    //
    // Público diferente do downsell geral: essa pessoa já escolheu o plano e
    // chegou na tela de pagamento. Falta menos, e por isso a conversa (e o
    // desconto) podem ser outros. O gatilho é a inscrição PENDENTE, que é
    // exatamente o registro de "gerou PIX e não confirmou".
    let pixFunnel: FunnelStep[] = [];
    try {
      if (bot.pixDownsellFunnel) pixFunnel = JSON.parse(bot.pixDownsellFunnel);
    } catch {
      /* JSON inválido = sem funil */
    }

    if (pixFunnel.length > 0 && bot.pixDownsellEnabled !== false) {
      const pendentes = db
        .prepare("SELECT * FROM telegram_subscriptions WHERE bot_id = ? AND status = 'pending'")
        .all(bot.id) as any[];

      for (const row of pendentes) {
        // Pagou por outra cobrança no meio do caminho: sai da recuperação.
        if (findActiveSubscription(bot.id, row.telegram_user_id)) continue;

        const counter = row.pix_step_index || 0;
        // O FATO GERADOR é a CRIAÇÃO DA COBRANÇA (`row.created_at`), fixo pra
        // sempre — é o momento em que ele viu o PIX e não pagou. O último
        // envio (`last_pix_step_at`) só serve de referência pro rabo em
        // horário fixo, que precisa andar a cada disparo pra repetir uma vez
        // por dia.
        const ultimoEnvio = row.last_pix_step_at || row.created_at;
        const tempos = { fatoGerador: row.created_at, ultimoEnvio };
        // `passoMaisAvancado` evita a rajada quando o processamento ficou
        // atrasado: em vez de mandar o passo atual e avançar 1 por tick — o
        // que varreria o funil inteiro em rajada se vários passos já
        // estiverem vencidos ao mesmo tempo —, acha o passo mais recente
        // que já é válido e manda só ele, nunca reenviando o que ficou pra
        // trás.
        const alvo = passoMaisAvancado(
          counter,
          (i) => resolveStepIndex(pixFunnel, i),
          (i) => passoPronto(pixFunnel[i], tempos, now, tz),
        );
        if (!alvo) continue;
        const step = pixFunnel[alvo.enviar];

        // Botão baseado no que ELE JÁ ESCOLHEU (planId/offerId gravados na
        // hora que o PIX foi gerado), não na lista genérica de planos — ver
        // o comentário de `buildPixDownsellMarkup`.
        const sub = getSubscription(row.id);
        const resolvido = sub ? resolvePixItem(sub, step.discountPercent) : null;
        const markup = sub
          ? buildPixDownsellMarkup(bot, sub, step.discountPercent)
          : buildReplyMarkup(bot, step.discountPercent, step.planMode);
        const extraVars = resolvido
          ? {
              planoEscolhido: resolvido.item.name,
              valorComDesconto: (resolvido.finalPrice / 100).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              }),
            }
          : undefined;
        await sendFunnelStep(
          bot.botToken,
          bot.id,
          String(row.telegram_user_id),
          p.id,
          step,
          markup,
          bot.botUsername,
          extraVars,
        );

        db.prepare(
          "UPDATE telegram_subscriptions SET pix_step_index = ?, last_pix_step_at = ? WHERE id = ?",
        ).run(alvo.proximo, now, row.id);
        downsellCount++;
      }
    }

    // 2. Processar Upsell (Pós-Venda)
    let upsellFunnel: FunnelStep[] = [];
    try {
      if (bot.upsellFunnel) upsellFunnel = JSON.parse(bot.upsellFunnel);
    } catch {
      // JSON inválido
    }

    if (upsellFunnel.length > 0 && bot.upsellEnabled !== false) {
      const activeSubs = db
        .prepare("SELECT * FROM telegram_subscriptions WHERE bot_id = ? AND status = 'active'")
        .all(bot.id) as any[];

      for (const row of activeSubs) {
        // Lida pelo `getSubscription`, e não remontada campo a campo aqui: a
        // versão manual esquecia pix_code/bump_cents/pix_step_index (e agora
        // renewal_step_index) — o `saveSubscription` no fim do laço gravaria
        // esses campos como se tivessem voltado a zero, apagando o progresso
        // de OUTRO funil só porque o upsell salvou por cima.
        const sub = getSubscription(row.id);
        if (!sub) continue;

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
          const replyMarkup = buildReplyMarkup(bot, step.discountPercent, step.planMode);
          await sendFunnelStep(bot.botToken, bot.id, String(sub.telegramUserId), p.id, step, replyMarkup, bot.botUsername);

          sub.lastUpsellAt = now;
          if (stepIndex === sub.upsellStepIndex && !step.isLoop) {
            sub.upsellStepIndex += 1;
          }
          saveSubscription(sub);
          upsellCount++;
        }
      }
    }

    // 3. ALERTA DE RENOVAÇÃO — avisa quem está VIP de que o acesso está
    // vencendo, com desconto para renovar. Ao contrário do upsell, a
    // contagem é REGRESSIVA: cada passo dispara quando falta X tempo para
    // `expires_at`, não X tempo desde a última ação. Por isso os passos são
    // lidos NA ORDEM (mais distante → mais perto do vencimento) e não há
    // "loop": uma vez vencida a distância de um passo ela só diminui, então
    // repetir o último para sempre significaria mandar a cada minuto.
    let renewalFunnel: FunnelStep[] = [];
    try {
      if (bot.renewalFunnel) renewalFunnel = JSON.parse(bot.renewalFunnel);
    } catch {
      // JSON inválido
    }

    if (renewalFunnel.length > 0 && bot.renewalEnabled !== false) {
      // expires_at > 0 exclui pacote (compra única, sem vencimento) e
      // expires_at > now exclui quem já venceu — daí em diante quem cuida é
      // a expiração (`runTelegramEviction`), não este funil. stripe_subscription_id
      // IS NULL exclui quem já tem renovação AUTOMÁTICA (checkout internacional,
      // Stripe cobra o cartão sozinha) — avisar "renove manualmente" pra
      // quem nem precisa fazer nada não faz sentido nenhum.
      const vencendo = db
        .prepare(
          `SELECT * FROM telegram_subscriptions
            WHERE bot_id = ? AND status = 'active' AND expires_at > ? AND stripe_subscription_id IS NULL`,
        )
        .all(bot.id, now) as any[];

      for (const row of vencendo) {
        const sub = getSubscription(row.id);
        if (!sub) continue;

        const stepIndex = sub.renewalStepIndex || 0;
        if (stepIndex >= renewalFunnel.length) continue; // Já mandou todos os avisos.

        const minutosParaVencer = (sub.expiresAt - now) / (60 * 1000);
        // `passoMaisAvancado` evita a rajada quando o processamento ficou
        // atrasado: sem loop aqui (a distância só diminui), então só avança
        // enquanto o próximo aviso também já valer — nunca reenvia os que
        // ficaram pra trás. Os passos vêm em ordem decrescente de distância,
        // então isso pousa direto no aviso mais próximo do vencimento que já
        // é válido agora.
        const alvo = passoMaisAvancado(
          stepIndex,
          (i) => (i < renewalFunnel.length ? i : null),
          (i) => minutosParaVencer <= renewalFunnel[i].delayMinutes,
        );

        if (alvo) {
          const step = renewalFunnel[alvo.enviar];
          const replyMarkup = buildReplyMarkup(bot, step.discountPercent, step.planMode);
          await sendFunnelStep(bot.botToken, bot.id, String(sub.telegramUserId), p.id, step, replyMarkup, bot.botUsername);

          sub.renewalStepIndex = alvo.proximo;
          saveSubscription(sub);
          renewalCount++;
        }
      }
    }
  }

  return { downsellCount, upsellCount, renewalCount };
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

/**
 * Trava por chave: esta tarefa roda tanto pelo ticker interno
 * (`instrumentation.ts`, a cada 1 min) quanto pela rota HTTP
 * `/api/cron/telegram/mailing` — sem a trava, as duas podiam rodar juntas e
 * duplicar o disparo em massa.
 */
export async function runTelegramMailings(): Promise<{ sent: number; failed: number }> {
  if (!tryAcquireCronLock("telegram-mailings")) return { sent: 0, failed: 0 };
  try {
    return await runTelegramMailingsImpl();
  } finally {
    releaseCronLock("telegram-mailings");
  }
}

async function runTelegramMailingsImpl(): Promise<{ sent: number; failed: number }> {
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
          // Mesmo caminho de envio do /start e da Recuperação: mídias
          // escolhidas a dedo, em álbum ou uma por mensagem, com o sorteio por
          // etiqueta ainda aceito como legado.
          await enviarMensagemDoBot({
            botToken: bot.botToken,
            chatId: item.chatId,
            profileId: mailing.profileId,
            text,
            mediaIds: mailing.mediaIds,
            mode: mailing.mediaMode,
            mediaTags: mailing.mediaTags,
            replyMarkup,
          });
          // Áudio DEPOIS do texto, como no PIX: o que o lead veio ler não pode
          // ficar atrás de uma mensagem de voz. Best-effort — uma URL fora do
          // ar não pode derrubar o disparo inteiro.
          if (mailing.audioUrl?.trim()) {
            await sendTelegramVoiceUrl(bot.botToken, item.chatId, mailing.audioUrl.trim()).catch(
              () => {},
            );
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
// 4) EXPIRAÇÃO
// ---------------------------------------------------------------------------

/**
 * A pessoa se encaixa no público escolhido para o passo?
 *
 * O Downsell geral já roda só para quem NÃO tem assinatura ativa. Isto separa,
 * dentro desse grupo, quem nunca comprou de quem comprou e venceu — porque a
 * conversa com os dois é diferente: um precisa ser convencido, o outro precisa
 * ser lembrado.
 */
function encaixaNoPublico(
  botId: string,
  telegramUserId: number,
  audience: FunnelStep["audience"],
): boolean {
  if (!audience || audience === "todos") return true;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) c FROM telegram_subscriptions
        WHERE bot_id = ? AND telegram_user_id = ? AND status IN ('active','expired')`,
    )
    .get(botId, telegramUserId) as { c: number };
  const jaComprou = row.c > 0;
  return audience === "expirados" ? jaComprou : !jaComprou;
}

/** Nome da modelo, para a variável {modelo}. Consulta direta e barata. */
function getProfileName(profileId: string): string {
  const row = getDb().prepare("SELECT name FROM profiles WHERE id = ?").get(profileId) as
    | { name: string }
    | undefined;
  return row?.name || "";
}

/**
 * Espera antes de CADA nova tentativa de remoção, em minutos, pela contagem de
 * tentativas já feitas.
 *
 * Cresce e para de crescer em 1 hora. As duas pontas importam: sem espera, uma
 * assinatura travada faria uma chamada por minuto para sempre; com espera
 * grande demais, alguém que já pagou continuaria dentro do VIP horas depois de
 * o operador ter arrumado a permissão do bot. Uma hora é o pior atraso possível
 * depois do conserto.
 */
const ESPERA_REMOCAO_MIN = [1, 5, 15, 60];

function esperaDaTentativa(tentativas: number): number {
  return ESPERA_REMOCAO_MIN[Math.min(tentativas, ESPERA_REMOCAO_MIN.length - 1)] * 60_000;
}

/**
 * Tira alguém do grupo VIP. Devolve `null` quando deu certo, ou o motivo.
 *
 * Bane e desbane em seguida: o desban limpa a restrição, senão a pessoa não
 * conseguiria voltar ao comprar de novo.
 */
async function tirarDoVip(
  bot: { id: string; botToken: string; idVip: string },
  telegramUserId: number,
): Promise<string | null> {
  try {
    await banTelegramMember(bot.botToken, bot.idVip, telegramUserId);
    await unbanTelegramMember(bot.botToken, bot.idVip, telegramUserId);
    // A lista de Usuários é atualizada na hora. O evento `chat_member` diria o
    // mesmo, mas pode não chegar (webhook fora do ar, update perdido) — e aí a
    // tela mostraria "no VIP" para quem já saiu.
    setTelegramUserGroup(bot.id, telegramUserId, "vip", false);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "falha ao remover do VIP";
  }
}

/** Anota o resultado da tentativa na própria inscrição. */
function registrarTentativa(db: any, id: string, erro: string | null, tentativas: number): void {
  if (erro) {
    db.prepare(
      `UPDATE telegram_subscriptions
          SET removal_pending = 1, removal_attempts = ?, last_removal_at = ?
        WHERE id = ?`,
    ).run(tentativas + 1, Date.now(), id);
  } else {
    db.prepare(
      `UPDATE telegram_subscriptions
          SET removal_pending = 0, removal_attempts = 0, last_removal_at = ?
        WHERE id = ?`,
    ).run(Date.now(), id);
  }
}

/**
 * EXPIRAÇÃO — tira do VIP quem venceu e reconduz ao grupo de prévias.
 *
 * Quem tira é o SISTEMA, pelo bot, e ele insiste até conseguir. Antes, uma
 * falha na remoção (o caso real é o bot ter deixado de ser admin do grupo)
 * caía num catch que só escrevia no console E pulava a marcação de expirado:
 * a inscrição ficava 'active' para sempre, o painel mostrava a pessoa como VIP
 * em dia, e a rotina repetia a mesma chamada a cada minuto, em silêncio.
 *
 * Agora são duas coisas separadas, porque são fatos de naturezas diferentes:
 *   • a inscrição vence — isso é calendário, e é registrado sempre;
 *   • a saída do grupo depende do Telegram, e por isso fica PENDENTE e é
 *     retentada com espera crescente até dar certo.
 *
 * Trava por chave: esta tarefa roda tanto pelo ticker interno
 * (`instrumentation.ts`, a cada 1 min) quanto pela rota HTTP
 * `/api/cron/telegram/eviction` — sem a trava, as duas podiam rodar juntas e
 * disputar a remoção/expiração das mesmas assinaturas.
 */
export async function runTelegramEviction(): Promise<number> {
  if (!tryAcquireCronLock("telegram-eviction")) return 0;
  try {
    return await runTelegramEvictionImpl();
  } finally {
    releaseCronLock("telegram-eviction");
  }
}

async function runTelegramEvictionImpl(): Promise<number> {
  const now = Date.now();
  const db = getDb();
  let removidos = 0;

  // ---- 1) Assinaturas que acabaram de vencer -------------------------------
  const vencidas = db
    // expires_at > 0 exclui as compras de PACOTE (compra única, sem VIP).
    .prepare("SELECT * FROM telegram_subscriptions WHERE status = 'active' AND expires_at > 0 AND expires_at < ?")
    .all(now) as any[];

  for (const row of vencidas) {
    const bot = getBotConfig(row.bot_id);
    if (!bot) continue;
    // Operação DESLIGADA = outro sistema está no comando do bot. Expulsar
    // alguém de um grupo é a ação mais destrutiva que este painel faz, e ele
    // não pode fazê-la enquanto não é o dono da operação.
    if (!bot.operationActive) continue;

    const erro = await tirarDoVip(bot, row.telegram_user_id);

    // A inscrição é marcada como expirada DÊ NO QUE DER: o prazo acabou, e
    // isso é fato do calendário, não do Telegram. Deixá-la 'active' porque a
    // remoção falhou faria o painel mentir sobre quem está pagando.
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
    registrarTentativa(db, row.id, erro, 0);

    if (erro) {
      console.error(
        `[hotdash] Expiração: não consegui remover ${row.telegram_user_id} do VIP ` +
          `(bot ${bot.id}, grupo ${bot.idVip}). Vou continuar tentando. ` +
          `O bot precisa ser ADMIN com permissão de banir. Erro:`,
        erro,
      );
      // Um aviso só, na primeira falha — não um por tentativa.
      db.prepare("UPDATE telegram_subscriptions SET removal_notified = 1 WHERE id = ?").run(row.id);
      try {
        const { sendPushEvent } = await import("@/lib/push");
        await sendPushEvent(
          "sale",
          "⚠️ Vencido ainda no VIP",
          `${row.telegram_username ? "@" + row.telegram_username : row.telegram_user_id} não saiu do grupo. ` +
            "O bot vai continuar tentando — confira se ele é admin com permissão de banir.",
          "/dashboard/telegram/usuarios",
        );
      } catch {
        /* push é aviso, não pode derrubar a expiração */
      }
    } else {
      removidos++;
    }

    // Convite para as prévias e aviso de vencimento: uma vez só, aqui. Nas
    // retentativas a pessoa não pode receber a mesma mensagem de novo.
    const convite = await createTelegramInviteLink(
      bot.botToken,
      bot.idAquecimento,
      `Warmup_${row.telegram_user_id}`,
    ).catch(() => null);
    const linkPrevias = convite?.invite_link || `https://t.me/${bot.botUsername || ""}`;

    await sendTelegramMessage(
      bot.botToken,
      String(row.telegram_user_id),
      `⚠️ <b>Sua assinatura VIP expirou!</b>\n\n` +
        `Para continuar recebendo o conteúdo completo e exclusivo, renove seu plano no chat do bot.\n\n` +
        `Enquanto isso, você foi redirecionado para o nosso grupo de prévias gratuitas:\n` +
        `👉 <a href="${linkPrevias}">Entrar no Grupo de Prévias</a>`,
    ).catch(() => {});
  }

  // ---- 2) Remoções que ficaram pendentes -----------------------------------
  // É aqui que o sistema cumpre o combinado sozinho: assim que a permissão do
  // bot é arrumada, a próxima tentativa tira a pessoa do VIP sem ninguém
  // precisar clicar em nada.
  const pendentes = db
    .prepare("SELECT * FROM telegram_subscriptions WHERE removal_pending = 1")
    .all() as any[];

  for (const row of pendentes) {
    const bot = getBotConfig(row.bot_id);
    if (!bot || !bot.operationActive) continue;

    const tentativas = Number(row.removal_attempts) || 0;
    const desde = Number(row.last_removal_at) || 0;
    if (now - desde < esperaDaTentativa(tentativas)) continue;

    const erro = await tirarDoVip(bot, row.telegram_user_id);
    registrarTentativa(db, row.id, erro, tentativas);
    if (!erro) {
      removidos++;
      console.log(
        `[hotdash] Expiração: ${row.telegram_user_id} finalmente saiu do VIP ` +
          `na tentativa ${tentativas + 1}.`,
      );
    }
  }

  return removidos;
}


/**
 * SEQUÊNCIA DE BOAS-VINDAS de quem foi aprovado num grupo.
 *
 * A aprovação em si acontece no webhook, que precisa responder rápido ao
 * Telegram — por isso ela só enfileira, e a entrega dos passos (que pode levar
 * horas, se o operador puser atraso) mora aqui, no tick de 1 minuto.
 *
 * O atraso é ACUMULADO desde a aprovação: um passo com 10 min e outro com 30
 * saem aos 10 e aos 40 minutos, não aos 10 e 30. É como os funis já contam, e
 * é o que a tela promete ao dizer "10 min depois de entrar".
 */
export async function runTelegramApprovalSequences(): Promise<number> {
  const fila = listApprovalQueue();
  if (fila.length === 0) return 0;

  const agora = Date.now();
  let enviados = 0;

  for (const item of fila) {
    const bot = getBotConfig(item.botId);
    if (!bot || !bot.operationActive) {
      dequeueApproval(item);
      continue;
    }

    const cru = item.grupo === "vip" ? bot.vipWelcomeFunnel : bot.previasWelcomeFunnel;
    let passos: FunnelStep[] = [];
    try {
      const v = cru ? JSON.parse(cru) : [];
      if (Array.isArray(v)) passos = v;
    } catch {
      /* JSON quebrado: trata como sequência vazia em vez de derrubar o tick */
    }

    // "Usar a mesma mensagem de boas-vindas": ela entra como PASSO ZERO, na
    // frente da sequência própria. Vira um passo comum de propósito — assim o
    // atraso acumulado, o avanço e o fim da fila continuam funcionando sem
    // nenhum caso especial, e ainda dá para escrever passos depois dela.
    const usaBoasVindas = item.grupo === "vip" ? bot.vipUseWelcome : bot.previasUseWelcome;
    if (usaBoasVindas) {
      passos = [
        {
          delayMinutes: 0,
          text: bot.welcomeMessage,
          mediaIds: bot.welcomeMediaIds,
          mediaMode: bot.welcomeMediaMode,
          mediaTags: bot.welcomeMediaTags,
          buttons: "plans",
        },
        ...passos,
      ];
    }

    if (item.stepIndex >= passos.length) {
      dequeueApproval(item);
      continue;
    }

    // Quando o passo atual vence: soma os atrasos de todos até ele.
    const atrasoAcumulado = passos
      .slice(0, item.stepIndex + 1)
      .reduce((soma, p) => soma + Math.max(0, Number(p.delayMinutes) || 0), 0);
    if (item.approvedAt + atrasoAcumulado * 60_000 > agora) continue;

    const passo = passos[item.stepIndex];
    let markup: unknown;
    if (passo.buttons === "plans") {
      markup = buildReplyMarkup(bot);
    } else if (passo.buttons === "custom") {
      // Botão sem texto ou sem URL é descartado aqui: o Telegram recusaria a
      // mensagem INTEIRA por causa de um teclado malformado, e a pessoa que
      // acabou de entrar no grupo não receberia nada.
      const botoes = (passo.customButtons || []).filter(
        (b) => b?.text?.trim() && b?.url?.trim(),
      );
      if (botoes.length > 0) {
        markup = {
          inline_keyboard: botoes.map((b) => [
            { text: b.text.trim(), url: b.url.trim(), ...buttonStyleProps(bot, "redirect") },
          ]),
        };
      }
    }
    try {
      await sendFunnelStep(bot.botToken, bot.id, item.chatId, bot.profileId, passo, markup, bot.botUsername);
      enviados++;
    } catch (e) {
      console.error("[hotdash] Falha na sequência de aprovação:", e);
    }

    const proximo = item.stepIndex + 1;
    if (proximo >= passos.length) dequeueApproval(item);
    else advanceApproval(item, proximo);
  }

  return enviados;
}
