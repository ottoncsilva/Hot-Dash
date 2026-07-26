import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getBotConfigByProfile } from "@/lib/telegramDb";
import {
  listTelegramUsers,
  userStats,
  getTelegramUser,
  deleteTelegramUser,
  setTelegramUserBlocked,
  type UserFilter,
} from "@/lib/telegramUsers";
import { sendTelegramMessage } from "@/lib/telegramApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS: UserFilter[] = ["todos", "vips", "expirados", "leads", "bloqueados"];

/** Lista de usuários do bot de um modelo (tela Telegram → Usuários). */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const profileId = sp.get("profileId");
    if (!profileId) throw new ApiError(400, "Informe o profileId.");

    const bot = getBotConfigByProfile(profileId);
    if (!bot) {
      return NextResponse.json({
        bot: null,
        users: [],
        total: 0,
        stats: { total: 0, vips: 0, expirados: 0, leads: 0, bloqueados: 0 },
      });
    }

    const rawFilter = sp.get("filter") as UserFilter | null;
    const filter = rawFilter && FILTERS.includes(rawFilter) ? rawFilter : "todos";

    const { users, total } = listTelegramUsers({
      botId: bot.id,
      filter,
      search: sp.get("search") || undefined,
      limit: Number(sp.get("limit")) || 50,
      offset: Number(sp.get("offset")) || 0,
    });

    return NextResponse.json({
      bot: { id: bot.id, botUsername: bot.botUsername, operationActive: bot.operationActive },
      users,
      total,
      stats: userStats(bot.id),
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

    // Remove alguém da LISTA do painel. Não expulsa de grupo nenhum nem
    // bloqueia: se a pessoa voltar a interagir, ela reaparece.
    if (action === "delete-user") {
      const user = getTelegramUser(String(body.userId || ""));
      if (!user) throw new ApiError(404, "Usuário não encontrado.");
      deleteTelegramUser(user.id);
      return NextResponse.json({ ok: true });
    }

    // Mensagem avulsa para uma pessoa (o aviãozinho da lista).
    if (action === "send-message") {
      const user = getTelegramUser(String(body.userId || ""));
      if (!user) throw new ApiError(404, "Usuário não encontrado.");
      const text = String(body.text || "").trim();
      if (!text) throw new ApiError(400, "Escreva a mensagem.");

      const bot = getBotConfigByProfile(user.profileId);
      if (!bot) throw new ApiError(400, "Bot não configurado para este modelo.");
      if (!user.chatId) {
        throw new ApiError(400, "Esta pessoa ainda não iniciou conversa com o bot — o Telegram não permite enviar.");
      }

      try {
        await sendTelegramMessage(bot.botToken, user.chatId, text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha ao enviar.";
        if (/blocked by the user|user is deactivated|chat not found/i.test(msg)) {
          setTelegramUserBlocked(bot.id, user.telegramUserId, true);
          throw new ApiError(400, "Esta pessoa bloqueou o bot — a mensagem não pode ser entregue.");
        }
        throw new ApiError(400, msg);
      }
      return NextResponse.json({ ok: true });
    }

    throw new ApiError(400, "Ação inválida.");
  } catch (err) {
    return errorResponse(err);
  }
}
