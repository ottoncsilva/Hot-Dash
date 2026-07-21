import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfile } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { listMedia, listUsedMediaIds } from "@/lib/media";
import { getAiCredentials, type AiProvider } from "@/lib/settings";
import { createPost } from "@/lib/posts";
import { generatePreviasDay } from "@/lib/previasAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Gera uma SEQUÊNCIA de prévias (metodologia de aquecimento) para os próximos
 * N dias e cria os posts agendados (texto, foto e enquete) na rede Telegram
 * como "Prévias". O envio (e os links de CTA) é feito pelo autopost.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const profileId = body.profileId as string;
    const days = Math.max(1, Math.min(14, parseInt(body.days, 10) || 1));

    if (!profileId) return NextResponse.json({ error: "Informe o profileId." }, { status: 400 });

    const profile = await getProfile(profileId);
    if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });

    const bot = getBotConfigByProfile(profile.id);
    if (!bot || !bot.botToken) return NextResponse.json({ error: "Bot não configurado." }, { status: 400 });

    const db = getDb();
    const settings = db
      .prepare("SELECT warmup_tags, warmup_mk_prompt FROM telegram_autopost_settings WHERE profile_id = ?")
      .get(profile.id) as { warmup_tags?: string; warmup_mk_prompt?: string } | undefined;
    const mkPrompt = settings?.warmup_mk_prompt || undefined;
    const allowedTagNames = (settings?.warmup_tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    // Provedor de IA (Grok primeiro — costuma aceitar conteúdo adulto).
    const provider: AiProvider | undefined = (["grok", "openai", "gemini"] as AiProvider[]).find(
      (p) => getAiCredentials(p) !== null,
    );
    if (!provider) {
      return NextResponse.json(
        { error: "Nenhum provedor de IA conectado. Ative um em Configurações → Conexão com IA." },
        { status: 400 },
      );
    }

    // Mídias das prévias ainda não usadas (para os posts do tipo "foto").
    const usedIds = listUsedMediaIds(profile.id);
    let photoPool = listMedia(profile.id).filter(
      (m) =>
        !usedIds.has(m.id) &&
        (allowedTagNames.length === 0 ||
          m.tags.some((t) => allowedTagNames.includes(t.name.toLowerCase()))),
    );

    // Posts já agendados de Prévias (idempotência por janela de 5 min).
    const existing = db
      .prepare(
        `SELECT p.scheduled_at FROM posts p JOIN post_networks pn ON pn.post_id = p.id
         WHERE p.profile_id = ? AND pn.network = 'telegram' AND pn.post_type = 'Prévias' AND p.status = 'scheduled'`,
      )
      .all(profile.id) as { scheduled_at: number }[];
    const taken = new Set(existing.map((e) => e.scheduled_at));

    let created = 0;
    let aiError: string | null = null;

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const base = new Date();
      base.setDate(base.getDate() + dayOffset);

      let dayPosts;
      try {
        const gen = await generatePreviasDay(
          {
            name: profile.name,
            physical: profile.bioPhysical,
            fetish: profile.bioUnique,
            personality: profile.bioPersonality,
            notes: profile.notes,
          },
          provider,
          base,
          mkPrompt,
        );
        dayPosts = gen.posts.map((p) => ({ post: p, at: gen.scheduledAt(p) }));
      } catch (e) {
        aiError = e instanceof Error ? e.message : "Falha na IA.";
        break;
      }

      for (const { post, at } of dayPosts) {
        if (at <= Date.now()) continue; // não agenda no passado
        // idempotência: pula se já há post muito próximo
        let clash = false;
        for (const t of taken) if (Math.abs(t - at) < 5 * 60 * 1000) clash = true;
        if (clash) continue;

        if (post.type === "enquete" && post.poll) {
          createPost({
            profileId: profile.id,
            networks: [{ network: "telegram", postType: "Prévias" }],
            scheduledAt: at,
            poll: post.poll,
          });
        } else if (post.type === "foto" && photoPool.length > 0) {
          const media = photoPool[Math.floor(Math.random() * photoPool.length)];
          photoPool = photoPool.filter((m) => m.id !== media.id); // não repete no lote
          createPost({
            profileId: profile.id,
            networks: [{ network: "telegram", postType: "Prévias" }],
            scheduledAt: at,
            caption: post.text,
            mediaIds: [media.id],
          });
        } else {
          // teaser / pergunta / oferta / prova (ou foto sem estoque) → texto puro
          createPost({
            profileId: profile.id,
            networks: [{ network: "telegram", postType: "Prévias" }],
            scheduledAt: at,
            caption: post.text,
          });
        }
        taken.add(at);
        created++;
      }
    }

    return NextResponse.json({ ok: true, generated: created, aiError });
  } catch (err) {
    console.error("Generate Prévias Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
