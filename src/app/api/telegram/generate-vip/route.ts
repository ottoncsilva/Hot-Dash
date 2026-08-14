import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { getAiCredentials, type AiProvider } from "@/lib/settings";
import {
  enqueueVipJob,
  getActiveVipJob,
  getLatestVipJob,
  resolveVipCtaLink,
} from "@/lib/vipGenerator";
import type { VipContato } from "@/lib/vipAi";
import { cancelActiveJob } from "@/lib/generationJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Método MK — programação do dia do GRUPO VIP (pós-venda).
 *
 * Esta rota só ENFILEIRA: monta o plano (horários/tipos — barato, sem IA) e
 * responde na hora. Quem escreve a copy é o agendador de 1 minuto
 * (`instrumentation.ts` → `runVipGeneration`), em lotes.
 *
 * Antes a geração inteira rodava aqui dentro e estourava o `maxDuration` de
 * 300s: são ~22 chamadas de IA COM IMAGEM por dia gerado, sequenciais, e o campo
 * da tela aceita até 14 dias. Os posts já criados ficavam gravados, então sobrava
 * meio cronograma no calendário sem nenhum aviso de erro.
 *
 * O convite pro contato particular é decidido A CADA GERAÇÃO, pelo corpo da
 * requisição (`contato`): "whatsapp", "telegram" ou nada. O contato virou
 * produto à parte, então o padrão é NÃO entregar: sem o pedido explícito, o dia
 * sai inteiro sem CTA. Escolhido um destino, ~8 posts do dia levam o botão.
 *
 * É UM destino por geração, nunca os dois no mesmo dia: quem respondeu no zap
 * ontem não vai procurar você no Telegram hoje, e dividir a atenção não deixa
 * nenhum dos dois virar hábito.
 *
 * GET devolve o progresso do último job (para a barra na tela).
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

    const profile = await getProfile(profileId);
    if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });

    const bot = getBotConfigByProfile(profile.id);
    if (!bot || !bot.botToken) {
      return NextResponse.json({ error: "Bot não configurado." }, { status: 400 });
    }

    const temIa = (["grok", "openai", "gemini"] as AiProvider[]).some(
      (p) => getAiCredentials(p) !== null,
    );
    if (!temIa) {
      return NextResponse.json(
        { error: "Nenhum provedor de IA conectado. Ative um em Configurações → Conexão com IA." },
        { status: 400 },
      );
    }

    // Uma geração por vez por perfil: duas rodando juntas dobrariam os posts do
    // dia, porque cada uma monta o plano sem enxergar o que a outra vai agendar.
    const emAndamento = getActiveVipJob(profile.id);
    if (emAndamento) {
      return NextResponse.json(
        {
          error: `Já existe uma geração em andamento (${emAndamento.done} de ${emAndamento.total}). Espere terminar.`,
          job: emAndamento,
        },
        { status: 409 },
      );
    }

    const ctaLink = await resolveVipCtaLink(profile.id, contato, contatoAccountId);
    const job = enqueueVipJob({ profileId: profile.id, days, contato, ctaLink });
    if (job.total === 0) {
      return NextResponse.json({
        ok: true,
        job,
        message: "Nenhum horário livre no período — a programação já está montada.",
      });
    }
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    console.error("Generate VIP Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "Informe o profileId." }, { status: 400 });
  return NextResponse.json({ job: getLatestVipJob(profileId) });
}

/** Cancela a geração em andamento — destrava o botão sem esperar o lote todo. */
export async function DELETE(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "Informe o profileId." }, { status: 400 });
  return NextResponse.json({ ok: true, cancelado: cancelActiveJob(profileId, "vip") });
}
