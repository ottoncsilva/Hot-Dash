import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfile } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { listMedia, listUsedMediaIds, getMediaRow, ensureVideoThumbnail, videoThumbRelPath } from "@/lib/media";
import { generateCaption } from "@/lib/ai";
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

    const FALLBACK_CAPTION = "Novo conteúdo disponível no canal! 🔥😘";
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
      // Pega próxima mídia disponível com as tags
      const candidates = library
        .filter((m) => !usedIds.has(m.id))
        .filter((m) => m.tags.some((tag) => allowedTagNames.includes(tag.name.toLowerCase())))
        .sort((a, b) => a.createdAt - b.createdAt); // Mais antiga primeiro
      
      if (candidates.length === 0) break; // Acabou o estoque de mídias

      const media = candidates[0];
      const row = getMediaRow(media.id);
      if (!row) continue;

      // Gera legenda via IA
      let caption = "";
      if (providerChain.length > 0 && !aiFailed) {
        const images: any[] = [];
        // Envia a mídia para a IA analisar de verdade. Para vídeos, extrai a
        // miniatura (primeiro frame) — mesma abordagem do endpoint de legenda
        // manual — para que a legenda combine com o conteúdo, e não seja escrita
        // "às cegas".
        try {
          if (media.kind === "video") {
            const thumbPath = (await ensureVideoThumbnail(row.path)) || videoThumbRelPath(row.path);
            const buf = await readBuffer(thumbPath);
            images.push({ mime: "image/jpeg", base64: buf.toString("base64") });
          } else {
            const buf = await readBuffer(row.path);
            images.push({ mime: media.mime || "image/jpeg", base64: buf.toString("base64") });
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
            console.error(`Erro ao gerar legenda com IA (${p}):`, aiErr);
            errors.push(`${p}: ${msg}`);
          }
        }

        if (!caption) {
          // Toda a cadeia falhou neste slot → causa sistêmica: para de tentar.
          if (!aiError) {
            aiError = `Todos os provedores de IA conectados falharam ao legendar. Detalhes → ${errors.join(" | ")}`;
          }
          aiFailed = true;
          caption = FALLBACK_CAPTION;
        }
      } else {
        caption = FALLBACK_CAPTION;
      }

      // Regra do Link: Injeta o bioVipLink APENAS no alvo Prévias (warmup)
      if (!isVip && profile.bioVipLink) {
        caption = `${caption}\n\n👉 Acesse: ${profile.bioVipLink}`;
      }

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
