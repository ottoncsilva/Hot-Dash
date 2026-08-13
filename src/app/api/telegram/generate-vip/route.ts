import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfile } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { listMedia, getMediaRow, renderVisionImageBase64 } from "@/lib/media";
import {
  createMediaQueue,
  getMediaPostCounts,
  listScheduledMediaIds,
} from "@/lib/mediaUsage";
import { generateCaption, callAiRaw, isSystemicAiError } from "@/lib/ai";
import { extractVideoThumbnail, extname } from "@/lib/metadata";
import { getAiCredentials, getAppTimeZone, type AiProvider } from "@/lib/settings";
import { readBuffer } from "@/lib/storage";
import { createPost } from "@/lib/posts";
import {
  DEFAULT_VIP_CTA_BUTTONS,
  DEFAULT_TELEGRAM_CTA_BUTTONS,
  WHATSAPP_CTA_FALLBACK,
  TELEGRAM_CTA_FALLBACK,
  appendCtaLines,
  pickCtaLinkTexts,
} from "@/lib/postTypes";
import { whatsappAccounts, telegramAccounts } from "@/lib/socialLinks";
import type { MediaItem } from "@/lib/types";
import { mkSlotToUtcMs, mkDayFromToday, fallbackPoll } from "@/lib/previasAi";
import { planDayVip, captionThemeVip, fallbackTextVip, type VipContato } from "@/lib/vipAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Ângulos de variação (rotacionados por post) — para as legendas não começarem
// todas iguais.
const VARIATION_ANGLES = [
  "Abra com um carinho gostoso.",
  "Abra com uma pergunta direta pra quem tá lendo.",
  "Comece contando o que você tá fazendo ou sentindo agora.",
  "Comece com uma provocação leve e íntima.",
  "Comece reagindo à própria roupa/corpo que aparece na foto.",
  "Comece com um tom mais safado.",
  "Comece com 'tava aqui pensando em você…'.",
  "Comece descrevendo o clima/cenário da foto.",
];

/**
 * Método MK — versão do GRUPO VIP (pós-venda). O SERVIDOR planeja o dia (20–25
 * posts de relacionamento e engajamento); a IA ESCREVE a legenda de cada post
 * ANALISANDO A FOTO.
 *
 * O convite pro contato particular é decidido A CADA GERAÇÃO, pelo corpo da
 * requisição (`contato`): "whatsapp", "telegram" ou nada. O contato virou
 * produto à parte, então o padrão é NÃO entregar: sem o pedido explícito, o dia
 * sai inteiro sem CTA. Escolhido um destino, ~8 posts do dia levam o botão.
 *
 * É UM destino por geração, nunca os dois no mesmo dia: quem respondeu no zap
 * ontem não vai procurar você no Telegram hoje, e dividir a atenção não deixa
 * nenhum dos dois virar hábito.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const profileId = body.profileId as string;
    const days = Math.max(1, Math.min(14, parseInt(body.days, 10) || 1));
    // Destino do convite nesta geração. Só entra quando pedido explicitamente —
    // o padrão é o dia sem CTA nenhum. `whatsappCta` é aceito por compatibilidade
    // com telas antigas, que só sabiam ligar/desligar o WhatsApp.
    const contato: VipContato | null =
      body.contato === "whatsapp" || body.contato === "telegram"
        ? body.contato
        : body.whatsappCta === true
          ? "whatsapp"
          : null;
    // Qual conta da modelo o convite leva. Vazio = o link particular do cadastro,
    // que era o único destino possível antes deste campo.
    const contatoAccountId =
      typeof body.contatoAccountId === "string"
        ? body.contatoAccountId.trim()
        : typeof body.whatsappAccountId === "string"
          ? body.whatsappAccountId.trim()
          : "";
    if (!profileId) return NextResponse.json({ error: "Informe o profileId." }, { status: 400 });

    const profileMaybe = await getProfile(profileId);
    if (!profileMaybe) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
    const profile = profileMaybe;

    const bot = getBotConfigByProfile(profile.id);
    if (!bot || !bot.botToken) return NextResponse.json({ error: "Bot não configurado." }, { status: 400 });

    const db = getDb();
    const settings = db
      .prepare(
        "SELECT vip_tags, vip_cta_buttons FROM telegram_autopost_settings WHERE profile_id = ?",
      )
      .get(profile.id) as { vip_tags?: string; vip_cta_buttons?: string } | undefined;
    const allowedTagNames = (settings?.vip_tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    // Frases dos "Botões da copy (VIP)". A lista configurada é escrita pensando
    // no WhatsApp ("chama no meu zap"); quando o destino é o Telegram ela não
    // serve, e as frases próprias do Telegram entram no lugar.
    const configurada = (settings?.vip_cta_buttons ?? "").trim();
    const ctaList =
      contato === "telegram"
        ? DEFAULT_TELEGRAM_CTA_BUTTONS
        : configurada || DEFAULT_VIP_CTA_BUTTONS;
    const ctaFallback =
      contato === "telegram" ? TELEGRAM_CTA_FALLBACK : WHATSAPP_CTA_FALLBACK;

    // Destino do convite desta geração. A conta escolhida vira URL aqui, uma vez
    // só, e o link resolvido é gravado em cada post: assim o post continua
    // apontando para o destino certo mesmo que a conta seja editada ou apagada
    // depois. Conta que não existe mais (ou de outra modelo) cai no padrão.
    const contas =
      contato === "telegram"
        ? telegramAccounts(profile.accounts)
        : whatsappAccounts(profile.accounts);
    const escolhida = contatoAccountId
      ? contas.find((a) => a.id === contatoAccountId)
      : undefined;
    const padraoDoCadastro =
      contato === "telegram" ? profile.bioTelegramLink : profile.bioWhatsappLink;
    const ctaLink = escolhida?.url || padraoDoCadastro || "";

    // Cadeia de provedores (grok primeiro — costuma aceitar conteúdo adulto).
    const providerChain: AiProvider[] = (["grok", "openai", "gemini"] as AiProvider[]).filter(
      (p) => getAiCredentials(p) !== null,
    );
    if (providerChain.length === 0) {
      return NextResponse.json(
        { error: "Nenhum provedor de IA conectado. Ative um em Configurações → Conexão com IA." },
        { status: 400 },
      );
    }
    let activeProvider: AiProvider | null = null;
    let aiFailed = false;
    let aiError: string | null = null;

    // Persona rica (mesmo detalhamento dos outros geradores).
    let richNotes = profile.notes || "";
    if (profile.bioPhysical) richNotes += `\nCaracterísticas físicas: ${profile.bioPhysical}`;
    if (profile.bioUnique) richNotes += `\nDiferencial/fetiche: ${profile.bioUnique}`;
    if (profile.bioPersonality) {
      const pType =
        profile.bioPersonality === "santinha"
          ? "Santinha (inocente por fora, safada por dentro)"
          : profile.bioPersonality === "explicita"
            ? "Explícita (sem papas na língua, ousada e direta)"
            : "Safadinha (safada na medida)";
      richNotes += `\nPersonalidade/estilo: ${pType}`;
    }

    // Mídias candidatas do VIP, na ordem em que o método deve consumi-las:
    // menos postada NO GRUPO VIP → inserida mais recentemente → há mais tempo
    // sem sair. As etiquetas seguem mandando em quem entra na lista, e o que já
    // está agendado para o VIP fica de fora para não repetir dentro da fila.
    const scheduledIds = listScheduledMediaIds(profile.id, "vip");
    const queue = createMediaQueue(
      listMedia(profile.id).filter(
        (m) =>
          !scheduledIds.has(m.id) &&
          (allowedTagNames.length === 0 ||
            m.tags.some((t) => allowedTagNames.includes(t.name.toLowerCase()))),
      ),
      getMediaPostCounts(profile.id),
      "vip",
    );

    // Idempotência: horários já ocupados por posts VIP agendados (janela 5 min).
    const existing = db
      .prepare(
        `SELECT p.scheduled_at FROM posts p JOIN post_networks pn ON pn.post_id = p.id
         WHERE p.profile_id = ? AND pn.network = 'telegram' AND pn.post_type = 'VIP' AND p.status = 'scheduled'`,
      )
      .all(profile.id) as { scheduled_at: number }[];
    const taken = new Set(existing.map((e) => e.scheduled_at));

    // Imagem (base64) reduzida (~1024px) para a IA "ver" a foto. Vídeo usa o 1º frame.
    async function mediaImageBase64(media: MediaItem): Promise<{ mime: string; base64: string } | null> {
      try {
        const row = getMediaRow(media.id);
        if (!row) return null;
        if (media.kind === "video") {
          const frame = await extractVideoThumbnail(await readBuffer(row.path), extname(row.path), 1024);
          return { mime: "image/jpeg", base64: frame.toString("base64") };
        }
        const base64 = await renderVisionImageBase64(row.path);
        if (!base64) return null;
        return { mime: "image/jpeg", base64 };
      } catch {
        return null;
      }
    }

    async function writeCaption(
      type: Parameters<typeof captionThemeVip>[0],
      images: { mime: string; base64: string }[],
      angleIdx: number,
    ): Promise<string> {
      if (aiFailed) return fallbackTextVip(type, contato ?? "whatsapp");
      const theme = `${captionThemeVip(type, contato ?? "whatsapp")}\n${VARIATION_ANGLES[angleIdx % VARIATION_ANGLES.length]}`;
      const toTry = activeProvider ? [activeProvider] : providerChain;
      const errors: string[] = [];
      for (const p of toTry) {
        try {
          const out = await generateCaption({
            provider: p,
            networks: [{ network: "telegram", postType: "VIP" }],
            profileName: profile.name,
            profileNotes: richNotes,
            theme,
            images,
          });
          if (out && out.trim()) {
            activeProvider = p;
            return out.trim().slice(0, 800);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Falha na IA.";
          aiError = msg;
          errors.push(msg);
        }
      }
      // Só desiste do dia todo em falha SISTÊMICA (chave/cota/conexão).
      if (errors.length > 0 && errors.every((e) => isSystemicAiError(e))) {
        aiFailed = true;
      } else {
        activeProvider = null;
      }
      return fallbackTextVip(type, contato ?? "whatsapp");
    }

    async function writePoll(): Promise<{ question: string; options: string[] }> {
      if (aiFailed) return fallbackPoll();
      const toTry = activeProvider ? [activeProvider] : providerChain;
      for (const p of toTry) {
        try {
          const raw = await callAiRaw(
            'Crie UMA enquete curta e safada (sem vender nada) pro grupo VIP no Telegram, tom íntimo de quem já conhece o público. Responda SÓ um JSON: {"question":"...","options":["..","..",".."]} com 2 a 4 opções curtas.',
            p,
            { json: true, maxTokens: 300 },
          );
          const parsed = JSON.parse(raw) as { question?: string; options?: unknown };
          const q = typeof parsed.question === "string" ? parsed.question.trim() : "";
          const opts = Array.isArray(parsed.options)
            ? parsed.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
            : [];
          if (q && opts.length >= 2) {
            activeProvider = p;
            return { question: q, options: opts.slice(0, 4) };
          }
        } catch (e) {
          aiError = e instanceof Error ? e.message : "Falha na IA.";
        }
      }
      return fallbackPoll();
    }

    let created = 0;
    let createdToday = 0;
    let angleIdx = 0;

    // Gera o RESTO de hoje (offset 0 — horários passados pulados) + os `days`
    // dias seguintes completos. O dia base vem do FUSO DA OPERAÇÃO, não do
    // relógio do servidor (UTC): senão, das 21h às 23h59 de Brasília o servidor
    // já estava em "amanhã" e o resto da noite era pulado.
    const tz = getAppTimeZone();
    for (let dayOffset = 0; dayOffset <= days; dayOffset++) {
      const base = mkDayFromToday(dayOffset, tz);
      const plan = planDayVip({ contato });

      for (const slot of plan) {
        const at = mkSlotToUtcMs(base, slot.time, tz, true);
        if (at <= Date.now()) continue; // não agenda no passado
        let clash = false;
        for (const t of taken) if (Math.abs(t - at) < 5 * 60 * 1000) clash = true;
        if (clash) continue;

        // Enquete: gera pergunta/opções, sem mídia, sem link.
        if (slot.kind === "enquete") {
          const poll = await writePoll();
          createPost({
            profileId: profile.id,
            networks: [{ network: "telegram", postType: "VIP" }],
            scheduledAt: at,
            poll,
            cta: false,
          });
          taken.add(at);
          created++;
          if (dayOffset === 0) createdToday++;
          continue;
        }

        // Próxima mídia da fila (vídeo cai para foto quando não há vídeo).
        let media: MediaItem | null = null;
        if (slot.media === "video") media = queue.take("video");
        else if (slot.media === "photo") media = queue.take("photo");

        // Legenda: com a FOTO (visão) quando houver mídia; senão texto puro.
        const images: { mime: string; base64: string }[] = [];
        if (media) {
          const img = await mediaImageBase64(media);
          if (img) images.push(img);
        }
        const written = await writeCaption(slot.type, images, angleIdx++);
        // Só os slots de convite levam o link — e eles só existem quando a
        // geração pediu. Neles as 3 linhas já saem GRAVADAS na legenda, para
        // aparecerem no editor do calendário e poderem ser revisadas.
        const caption =
          slot.cta && ctaLink
            ? appendCtaLines(written, ctaLink, pickCtaLinkTexts(ctaList, 3), ctaFallback)
            : written;

        createPost({
          profileId: profile.id,
          networks: [{ network: "telegram", postType: "VIP" }],
          scheduledAt: at,
          caption,
          mediaIds: media ? [media.id] : undefined,
          cta: slot.cta, // true só nos posts de convite → botão no envio
          // Só os posts de convite carregam o destino; nos outros ele não é
          // usado e gravá-lo só faria ruído no banco. Aqui o link vai SEMPRE
          // resolvido (não só quando há conta escolhida): sem isso o envio cairia
          // no WhatsApp do cadastro mesmo numa geração de Telegram.
          waLink: slot.cta ? ctaLink : undefined,
        });
        taken.add(at);
        created++;
        if (dayOffset === 0) createdToday++;
      }
    }

    return NextResponse.json({ ok: true, generated: created, generatedToday: createdToday, aiError });
  } catch (err) {
    console.error("Generate VIP Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
