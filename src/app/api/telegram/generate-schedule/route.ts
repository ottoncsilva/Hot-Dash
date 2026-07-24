import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfile } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { listMedia, listUsedMediaIds, getMediaRow, renderVisionImageBase64 } from "@/lib/media";
import { generateCaption, isSystemicAiError } from "@/lib/ai";
import { extractVideoThumbnail, extname } from "@/lib/metadata";
import { getAiCredentials, type AiProvider } from "@/lib/settings";
import { createPost } from "@/lib/posts";
import { readBuffer } from "@/lib/storage";

export const runtime = "nodejs";

function generateSlots(type: string, interval: number, fixedTimes: string, days: number): number[] {
  const slots: number[] = [];
  const now = Date.now();
  const end = now + days * 24 * 60 * 60 * 1000;

  if (type === "fixed") {
    const times = (fixedTimes || "").split(",").map(t => t.trim()).filter(Boolean);
    if (times.length === 0) return [];

    // Tenta cada um dos próximos `days` dias, começando de hoje e avançando.
    // Assim permite que posts fixos sejam preenchidos inclusive hoje, se o horário ainda não passou.
    for (let i = 0; i <= days; i++) {
      const baseDate = new Date(now + i * 24 * 60 * 60 * 1000);
      for (const timeStr of times) {
        const [h, m] = timeStr.split(":");
        baseDate.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
        const timeMs = baseDate.getTime();
        if (timeMs > now && timeMs <= end) {
          slots.push(timeMs);
        }
      }
    }
  } else {
    // interval
    if (interval <= 0) interval = 120; // fallback 2h
    let t = now + interval * 60 * 1000;
    while (t <= end) {
      slots.push(t);
      t += interval * 60 * 1000;
    }
  }
  
  // Remove duplicates and sort
  return Array.from(new Set(slots)).sort((a, b) => a - b);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const profileId = body.profileId;
    const target = body.target as "vip" | "warmup";
    const days = parseInt(body.days, 10) || 7;
    const single = !!body.single;

    if (!profileId || !target) {
      return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
    }

    const profile = await getProfile(profileId);
    if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });

    const bot = getBotConfigByProfile(profile.id);
    if (!bot || !bot.botToken) return NextResponse.json({ error: "Bot não configurado." }, { status: 400 });

    const db = getDb();
    const settings = db.prepare("SELECT * FROM telegram_autopost_settings WHERE profile_id = ?").get(profile.id) as any;
    if (!settings) return NextResponse.json({ error: "Configuração de autopost ausente." }, { status: 400 });

    // Determina tags e configurações do alvo
    const isVip = target === "vip";
    const tagsString = isVip ? settings.vip_tags : settings.warmup_tags;
    const promptTemplate = isVip ? settings.vip_prompt : settings.warmup_prompt;
    const scheduleType = isVip ? settings.vip_schedule_type : settings.warmup_schedule_type;
    const interval = isVip ? settings.vip_post_interval : settings.warmup_post_interval;
    const fixedTimes = isVip ? settings.vip_fixed_times : settings.warmup_fixed_times;
    const postTypeTarget = isVip ? "VIP" : "Prévias";

    if (!tagsString) {
      return NextResponse.json({ error: `Nenhuma etiqueta selecionada para ${postTypeTarget}.` }, { status: 400 });
    }

    const allowedTagNames = tagsString.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean);
    if (allowedTagNames.length === 0) {
      return NextResponse.json({ error: `Nenhuma etiqueta válida selecionada para ${postTypeTarget}.` }, { status: 400 });
    }

    // Calcula todos os horários projetados para os próximos X dias
    const slots = single 
      ? [Date.now() + 10 * 1000]
      : generateSlots(scheduleType || "interval", interval, fixedTimes, days);

    if (slots.length === 0) {
      return NextResponse.json({ error: "Nenhum horário projetado com as configurações atuais." }, { status: 400 });
    }

    // Filtra horários que já possuem agendamento para este alvo (margem de 5 minutos)
    // Isso torna a geração idempotente (se clicar duas vezes, não duplica)
    const existingPosts = db.prepare(`
      SELECT p.scheduled_at 
      FROM posts p 
      JOIN post_networks pn ON pn.post_id = p.id 
      WHERE p.profile_id = ? AND pn.network = 'telegram' AND pn.post_type = ? AND p.status = 'scheduled'
    `).all(profile.id, postTypeTarget) as any[];

    const emptySlots = slots.filter(slot => {
      return !existingPosts.some(ep => Math.abs(ep.scheduled_at - slot) < 5 * 60 * 1000);
    });

    if (emptySlots.length === 0) {
      return NextResponse.json({ ok: true, generated: 0, message: "Todos os horários já estão preenchidos." });
    }

    // Lista mídias da biblioteca e IDs já utilizados
    const library = listMedia(profile.id);
    // Usamos um set na memória que será atualizado durante o loop
    const usedIds = listUsedMediaIds(profile.id);

    // Cadeia de provedores conectados, do MAIS PERMISSIVO ao mais restritivo.
    // Este endpoint gera legendas para conteúdo adulto (VIP/Prévias): Gemini e
    // OpenAI frequentemente RECUSAM analisar imagens explícitas (voltam sem
    // texto/erro), enquanto o Grok (x.ai) costuma aceitar. Por isso tentamos
    // Grok primeiro e só caímos para os demais se ele não estiver conectado ou
    // falhar. A cadeia é percorrida até um provedor devolver uma legenda válida.
    const providerChain: AiProvider[] = (["grok", "openai", "gemini"] as AiProvider[]).filter(
      (p) => getAiCredentials(p) !== null,
    );

    // Reserva usada SÓ quando a IA falha num post — variada e na voz da modelo
    // (informal, brasileira) pra não sair tudo igual como o antigo "Novo
    // conteúdo disponível no canal!". Sorteia uma diferente por post.
    const FALLBACK_CAPTIONS = [
      "Postei coisa nova aqui 🙈 corre ver antes que eu me arrependa 🔥",
      "Novidade no ar 😈 vem que hoje tá quentinho",
      "Acabei de soltar um conteúdo novo 🔥 dá uma espiada",
      "Cê tá perdendo tempo aí… tem coisa nova te esperando 😏",
      "Deixei algo bem safadinho pra você agora 💦",
      "Chega mais 😈 tem conteúdo novo fresquinho",
      "Tô me sentindo perigosa hoje… vem ver o que postei 🔥",
      "Novo post no ar, amor 😏 já é seu",
      "Olha o que eu trouxe pra você hoje 🙈🔥",
      "Conteúdo novinho saindo do forno 😈 corre",
    ];
    const pickFallback = () => FALLBACK_CAPTIONS[Math.floor(Math.random() * FALLBACK_CAPTIONS.length)];
    let generatedCount = 0;
    // Provedor que efetivamente funcionou — travado no primeiro sucesso para não
    // reprocessar a cadeia inteira a cada slot.
    let activeProvider: AiProvider | null = null;
    // Primeiro erro de IA encontrado (reportado ao final). `aiFailed` interrompe
    // novas tentativas de IA no lote: se TODA a cadeia falhar num slot, a causa é
    // sistêmica (chaves/modelos/cota), então os demais posts saem com o texto
    // padrão e o usuário vê o motivo em vez de falhar em silêncio.
    let aiError: string | null = null;
    let aiFailed = false;

    if (providerChain.length === 0) {
      aiError =
        "Nenhum provedor de IA está conectado. Ative um em Configurações → Conexão com IA. As legendas foram criadas com o texto padrão.";
    }

    // Ganchos rotativos: como cada legenda é gerada numa chamada independente, a
    // IA tende a repetir sempre a mesma abertura. Injetar um ângulo diferente por
    // post empurra variação real ao longo do lote (além da regra geral de variar).
    const VARIATION_ANGLES = [
      "Abra com uma provocação ousada.",
      "Abra com uma pergunta direta para quem está lendo.",
      "Comece contando o que você está fazendo ou sentindo agora.",
      "Comece com um convite safado e direto.",
      "Comece reagindo à própria roupa/corpo que aparece na foto.",
      "Comece com um tom mais carinhoso e íntimo.",
      "Comece com uma provocação do tipo 'será que você aguenta?'.",
      "Comece descrevendo o clima ou o cenário da foto.",
    ];

    for (const [slotIndex, slot] of emptySlots.entries()) {
      // Mídias disponíveis com as etiquetas (ainda não usadas neste perfil)
      const candidates = library
        .filter((m) => !usedIds.has(m.id))
        .filter((m) => m.tags.some((tag) => allowedTagNames.includes(tag.name.toLowerCase())));

      if (candidates.length === 0) break; // Acabou o estoque de mídias

      // Escolhe uma mídia ALEATÓRIA (antes era sempre da mais antiga para a mais nova).
      const media = candidates[Math.floor(Math.random() * candidates.length)];
      const row = getMediaRow(media.id);
      if (!row) continue;

      // Gera legenda via IA
      let caption = "";
      if (providerChain.length > 0 && !aiFailed) {
        const images: any[] = [];
        // Envia a mídia para a IA analisar de verdade, mas SEMPRE reduzida
        // (~1024px). Mandar a foto em resolução cheia (vários MB) engrossa o
        // request e é uma causa comum de falha (timeout/413) que fazia a legenda
        // cair na reserva. Foto: render dedicado; vídeo: 1º frame em ~1024px.
        try {
          if (media.kind === "video") {
            const buf = await readBuffer(row.path);
            const frame = await extractVideoThumbnail(buf, extname(row.path), 1024);
            images.push({ mime: "image/jpeg", base64: frame.toString("base64") });
          } else {
            const b64 = await renderVisionImageBase64(row.path);
            if (b64) images.push({ mime: "image/jpeg", base64: b64 });
          }
        } catch (err) {
          console.error("Erro ao ler mídia para IA:", err);
        }

        // Personalização Profunda baseada no Perfil
        let richNotes = profile.notes || "";
        if (profile.bioPhysical) richNotes += `\nCaracterísticas Físicas da modelo: ${profile.bioPhysical}`;
        if (profile.bioUnique) richNotes += `\nMecanismo Único / Fetiche: ${profile.bioUnique}`;
        if (profile.bioPersonality) {
          const pType = profile.bioPersonality === "santinha"
            ? "Santinha (inocente por fora)"
            : profile.bioPersonality === "explicita"
            ? "Explícita (sem papas na língua, bem ousada e direta)"
            : "Safadinha (safada na medida)";
          richNotes += `\nPersonalidade/Estilo de escrita: ${pType}`;
        }

        // Provedores a tentar neste slot: se já travamos um que funcionou, usa só
        // ele; caso contrário, percorre a cadeia inteira (permissivo → restritivo).
        const toTry: AiProvider[] = activeProvider ? [activeProvider] : providerChain;
        const errors: string[] = [];

        // Gancho de variação para este post (rotaciona pela lista).
        const angle = VARIATION_ANGLES[slotIndex % VARIATION_ANGLES.length];
        const themeWithAngle = [
          promptTemplate || "Analise a foto e crie uma legenda natural e envolvente.",
          `Variação desta legenda específica (só um empurrão de diversidade, mantenha o tom das instruções): ${angle}`,
        ].join("\n\n");

        for (const p of toTry) {
          // Uma retentativa curta em caso de rate-limit (429): esses erros são
          // passageiros e derrubavam a legenda à toa.
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const result = await generateCaption({
                provider: p,
                networks: [{ network: "telegram", postType: postTypeTarget }],
                profileName: profile.name,
                profileNotes: richNotes,
                theme: themeWithAngle,
                images,
              });
              if (!result.trim()) throw new Error("retornou uma legenda vazia.");
              caption = result;
              activeProvider = p; // Trava o provedor que funcionou para os próximos slots
              break;
            } catch (aiErr) {
              const msg = aiErr instanceof Error ? aiErr.message : "falha desconhecida";
              const rateLimited = /\b429\b|rate.?limit|too many requests/i.test(msg);
              if (rateLimited && attempt === 0) {
                await sleep(1500);
                continue; // tenta o mesmo provedor mais uma vez
              }
              console.error(`Erro ao gerar legenda com IA (${p}):`, aiErr);
              errors.push(`${p}: ${msg}`);
              break;
            }
          }
          if (caption) break;
        }

        if (!caption) {
          if (!aiError) {
            aiError = `Falha ao legendar com IA em algum(ns) post(s). Detalhes → ${errors.join(" | ")}`;
          }
          // Só desiste do LOTE INTEIRO quando a causa é SISTÊMICA (chave/cota/
          // conexão) — aí não adianta insistir. Falhas pontuais (rate-limit,
          // timeout, recusa de conteúdo, resposta vazia) NÃO travam o lote: o
          // próximo post volta a tentar a cadeia inteira, pra não perder o dia
          // inteiro por um tropeço isolado.
          if (errors.length > 0 && errors.every((e) => isSystemicAiError(e))) {
            aiFailed = true;
          } else {
            activeProvider = null; // recomeça a cadeia no próximo post
          }
          caption = pickFallback();
        }
      } else {
        caption = pickFallback();
      }

      // O CTA de acesso ao VIP (3 hiperlinks "ACESSAR O VIP 🎁") é adicionado no
      // momento do envio (telegramCron), apenas nas Prévias. A legenda salva no
      // banco fica limpa, sem link cru nem HTML.

      // Cria o post agendado no banco
      createPost({
        profileId: profile.id,
        networks: [{ network: "telegram", postType: postTypeTarget }],
        scheduledAt: slot,
        caption,
        mediaIds: [media.id],
      });

      // Marca a mídia como usada em memória para não repetir no próximo slot do loop
      usedIds.add(media.id);
      generatedCount++;
    }

    return NextResponse.json({ ok: true, generated: generatedCount, aiError });
  } catch (err) {
    console.error("Generate Schedule Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
