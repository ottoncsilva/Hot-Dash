import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import { getBotConfigByProfile, listPlans } from "@/lib/telegramDb";
import {
  listMailings,
  getMailing,
  saveMailing,
  deleteMailing,
  updateMailingStatus,
  enqueueMailing,
  pendingQueueCount,
  computeNextRunAt,
  type MailingScheduleType,
  type MailingStatus,
} from "@/lib/telegramMailing";
import {
  audienceCounts,
  listAudienceRecipients,
  AUDIENCES,
  type Audience,
} from "@/lib/telegramUsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHEDULE_TYPES: MailingScheduleType[] = ["once", "daily", "interval", "weekdays"];

/** Máximo aceito pelo Telegram numa mensagem/legenda. */
const MESSAGE_MAX = 4096;

function normalizeAudiences(raw: unknown): Audience[] {
  const list = Array.isArray(raw) ? raw : [];
  const out = list
    .map((a) => String(a))
    .filter((a): a is Audience => (AUDIENCES as readonly string[]).includes(a));
  return out.length > 0 ? Array.from(new Set(out)) : ["todos"];
}

/** Lê do corpo o que define o disparo, validando o que é obrigatório. */
function readMailingInput(body: any, botId: string, profileId: string) {
  const name = String(body.name || "").trim();
  const message = String(body.message || "").trim();
  if (!name) throw new ApiError(400, "Dê um nome ao mailing.");
  if (message.length > MESSAGE_MAX) {
    throw new ApiError(400, `A mensagem passa do limite do Telegram (${MESSAGE_MAX} caracteres).`);
  }

  const scheduleType: MailingScheduleType = SCHEDULE_TYPES.includes(body.scheduleType)
    ? body.scheduleType
    : "once";

  const offers = (Array.isArray(body.offers) ? body.offers : [])
    .map((o: any) => ({
      planId: typeof o.planId === "string" && o.planId ? o.planId : undefined,
      name: String(o.name || "").trim(),
      priceCents: Math.max(0, Math.round(Number(o.priceCents) || 0)),
      durationDays: Math.max(1, Math.round(Number(o.durationDays) || 30)),
      kind: o.kind === "package" ? ("package" as const) : ("subscription" as const),
      deliverable: typeof o.deliverable === "string" && o.deliverable.trim() ? o.deliverable.trim() : undefined,
    }))
    .filter((o: { name: string; priceCents: number }) => o.name && o.priceCents > 0);

  const buttons = (Array.isArray(body.buttons) ? body.buttons : [])
    .map((b: any) => ({ text: String(b.text || "").trim(), url: String(b.url || "").trim() }))
    .filter((b: { text: string; url: string }) => b.text && b.url);

  // Sem texto, sem mídia e sem oferta não há mensagem para enviar.
  if (!message && !String(body.mediaTags || "").trim() && offers.length === 0) {
    throw new ApiError(400, "Escreva a mensagem, escolha uma mídia ou adicione uma oferta.");
  }

  return {
    botId,
    profileId,
    name,
    message,
    audiences: normalizeAudiences(body.audiences),
    mediaTags: String(body.mediaTags || "").trim() || undefined,
    buttons,
    scheduleType,
    scheduleTimes: String(body.scheduleTimes || "").trim() || undefined,
    scheduleWeekdays: String(body.scheduleWeekdays || "").trim() || undefined,
    intervalHours: Number(body.intervalHours) || undefined,
    scheduledAt: Number(body.scheduledAt) || undefined,
    offers,
  };
}

function requireBot(profileId: string) {
  if (!profileId) throw new ApiError(400, "Informe o profileId.");
  const bot = getBotConfigByProfile(profileId);
  if (!bot) {
    throw new ApiError(400, "Configure primeiro o bot no cadastro do modelo (token e IDs dos grupos).");
  }
  return bot;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId");
    if (!profileId) throw new ApiError(400, "Informe o profileId.");

    const bot = getBotConfigByProfile(profileId);
    if (!bot) {
      return NextResponse.json({ bot: null, mailings: [], plans: [], audiences: {}, availableTags: [] });
    }

    return NextResponse.json({
      bot: { id: bot.id, botUsername: bot.botUsername, operationActive: bot.operationActive },
      mailings: listMailings(bot.id),
      plans: listPlans(bot.id),
      audiences: audienceCounts(bot.id),
      availableTags: getDb().prepare("SELECT * FROM tags ORDER BY name").all(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    // ---- Salvar como rascunho (sem disparar) ----
    if (action === "save") {
      const bot = requireBot(String(body.profileId || ""));
      const input = readMailingInput(body, bot.id, bot.profileId);
      const mailing = saveMailing({ ...input, id: body.id, status: "draft", nextRunAt: undefined });
      return NextResponse.json({ ok: true, mailing });
    }

    // ---- Disparar (agora) ou agendar ----
    if (action === "send") {
      const bot = requireBot(String(body.profileId || ""));
      const input = readMailingInput(body, bot.id, bot.profileId);

      // "Uma vez" sem data marcada = agora. Os demais tipos (e o "uma vez" com
      // data futura) entram na agenda e o agendador cuida do resto.
      const sendNow = input.scheduleType === "once" && !input.scheduledAt;
      const nextRunAt = sendNow ? undefined : computeNextRunAt(input);

      if (!sendNow && !nextRunAt) {
        throw new ApiError(400, "A frequência escolhida não tem um próximo horário válido. Confira a data/horários.");
      }

      const status: MailingStatus = sendNow ? "sending" : "scheduled";
      const mailing = saveMailing({ ...input, id: body.id, status, nextRunAt: nextRunAt ?? undefined });

      if (sendNow) {
        // Enfileira já: a tela mostra o total na hora e o agendador drena a
        // fila em lotes (mandar tudo dentro do request estouraria o tempo).
        const recipients = listAudienceRecipients(bot.id, mailing.audiences);
        if (recipients.length === 0) {
          updateMailingStatus(mailing.id, "draft");
          throw new ApiError(
            400,
            "Nenhum destinatário nos públicos escolhidos. Só recebem disparo quem já falou com o bot e não o bloqueou.",
          );
        }
        enqueueMailing(mailing.id, recipients);
      }

      return NextResponse.json({ ok: true, mailing: getMailing(mailing.id) });
    }

    // ---- Pausar / retomar / apagar ----
    if (action === "pause" || action === "resume" || action === "delete") {
      const mailing = getMailing(String(body.id || ""));
      if (!mailing) throw new ApiError(404, "Mailing não encontrado.");

      if (action === "delete") {
        deleteMailing(mailing.id);
        return NextResponse.json({ ok: true });
      }
      if (action === "pause") {
        updateMailingStatus(mailing.id, "paused");
        return NextResponse.json({ ok: true, mailing: getMailing(mailing.id) });
      }

      // Pausado NO MEIO de um envio: retoma a fila de onde parou. Voltar para
      // "agendado" recomeçaria o disparo do zero e quem já recebeu receberia
      // de novo.
      if (pendingQueueCount(mailing.id) > 0) {
        updateMailingStatus(mailing.id, "sending");
        return NextResponse.json({ ok: true, mailing: getMailing(mailing.id) });
      }

      const next = computeNextRunAt(mailing);
      if (!next) {
        throw new ApiError(400, "Este disparo não tem próxima data. Edite a frequência antes de retomar.");
      }
      updateMailingStatus(mailing.id, "scheduled", next);
      return NextResponse.json({ ok: true, mailing: getMailing(mailing.id) });
    }

    throw new ApiError(400, "Ação inválida.");
  } catch (err) {
    return errorResponse(err);
  }
}
