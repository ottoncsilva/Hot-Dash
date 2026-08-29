import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/profiles";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import { getAiCredentials, type AiProvider } from "@/lib/settings";
import {
  enqueuePreviasJob,
  getActivePreviasJob,
  getLatestPreviasJob,
} from "@/lib/previasGenerator";
import { cancelActiveJob } from "@/lib/generationJobs";
import { resolverLinkDoVip } from "@/lib/vipLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Método MK — programação do dia do grupo de PRÉVIAS.
 *
 * Esta rota só ENFILEIRA: monta o plano (horários/tipos — barato, sem IA) e
 * responde na hora. Quem escreve a copy é o agendador de 1 minuto
 * (`instrumentation.ts` → `runPreviasGeneration`), em lotes.
 *
 * Antes a geração inteira rodava aqui dentro e estourava o `maxDuration` de
 * 300s: são ~33 chamadas de IA COM IMAGEM por dia gerado, sequenciais. Com
 * `days: 1` (resto de hoje + 1 dia) já encostava no teto; com `days: 14` era
 * impossível — e os posts já criados ficavam gravados, deixando meio cronograma
 * sem nenhum aviso de erro.
 *
 * GET devolve o progresso do último job (para a barra na tela).
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
    if (!bot || !bot.botToken) {
      return NextResponse.json({ error: "Bot não configurado." }, { status: 400 });
    }

    // Um terço do dia das Prévias é post de CONVERSÃO: a copy chama pro VIP e o
    // envio anexa o link. Sem link, esses posts sairiam convidando para lugar
    // nenhum — mas o painel não precisa mais PEDIR o link: ele o descobre a
    // partir do bot e do canal VIP (ver lib/vipLink.ts). Só desiste quando nem
    // a descoberta funciona, e aí diz o motivo real em vez de mandar preencher
    // um campo que ele mesmo saberia preencher.
    const vip = await resolverLinkDoVip(profile.id);
    if (!vip.link) {
      return NextResponse.json(
        {
          error:
            (vip.problem || "Não foi possível descobrir o link do VIP.") +
            " Você também pode preenchê-lo à mão no cadastro da modelo.",
        },
        { status: 400 },
      );
    }

    const temIa = (["grok", "gemini", "openai"] as AiProvider[]).some(
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
    const emAndamento = getActivePreviasJob(profile.id);
    if (emAndamento) {
      return NextResponse.json(
        {
          error: `Já existe uma geração em andamento (${emAndamento.done} de ${emAndamento.total}). Espere terminar.`,
          job: emAndamento,
        },
        { status: 409 },
      );
    }

    const job = enqueuePreviasJob(profile.id, days);
    if (job.total === 0) {
      return NextResponse.json({
        ok: true,
        job,
        message: "Nenhum horário livre no período — a programação já está montada.",
      });
    }
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    console.error("Generate Prévias Error:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "Informe o profileId." }, { status: 400 });
  return NextResponse.json({ job: getLatestPreviasJob(profileId) });
}

/** Cancela a geração em andamento — destrava o botão sem esperar o lote todo. */
export async function DELETE(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "Informe o profileId." }, { status: 400 });
  return NextResponse.json({ ok: true, cancelado: cancelActiveJob(profileId, "previas") });
}
