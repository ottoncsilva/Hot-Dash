import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfile } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { listMedia, listUsedMediaIds, getMediaRow } from "@/lib/media";
import { generateCaption } from "@/lib/ai";
import { getAiCredentials } from "@/lib/settings";
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
    const slots = generateSlots(scheduleType || "interval", interval, fixedTimes, days);
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

    const provider = getAiCredentials("gemini") !== null ? "gemini" : (getAiCredentials("openai") !== null ? "openai" : "grok");

    let generatedCount = 0;

    for (const slot of emptySlots) {
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
      if (provider) {
        const images: any[] = [];
        if (media.kind === "image") {
          try {
            const buf = await readBuffer(row.path);
            images.push({
              mime: media.mime || "image/jpeg",
              base64: buf.toString("base64"),
            });
          } catch (err) {
            console.error("Erro ao ler imagem para IA:", err);
          }
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
        
        try {
          caption = await generateCaption({
            provider,
            networks: [{ network: "telegram", postType: postTypeTarget }],
            profileName: profile.name,
            profileNotes: richNotes,
            theme: promptTemplate || "Analise a foto e crie uma legenda natural e envolvente.",
            images,
          });
        } catch (aiErr) {
          console.error("Erro ao gerar legenda com IA:", aiErr);
          caption = "Novo conteúdo disponível no canal! 🔥😘";
        }
      } else {
        caption = "Novo conteúdo disponível no canal! 🔥😘";
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

    return NextResponse.json({ ok: true, generated: generatedCount });
  } catch (err) {
    console.error("Generate Schedule Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
