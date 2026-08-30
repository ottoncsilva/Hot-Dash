import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import {
  deleteAccount,
  getAccount,
  getAgentSettings,
  listAccounts,
  saveAgentSettings,
  setAccountActive,
  type IgAgentSettings,
} from "@/lib/instagram/db";
import { getInstagramAppSettings, updateInstagramAppSettings } from "@/lib/settings";
import { getProfile } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * As contas do Instagram de uma modelo, com os ajustes do agente de cada uma.
 *
 * Devolve junto as contas do Instagram que já estão no CADASTRO da modelo: são
 * elas que a tela lista como "conectáveis", para o operador não ter que lembrar
 * de cor quais @ existem. Cadastro e conexão são coisas diferentes — a primeira
 * é anotação, a segunda é token —, e a tela mostra as duas lado a lado
 * justamente para a diferença ficar visível.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const profileId = req.nextUrl.searchParams.get("profileId");
    if (!profileId) throw new ApiError(400, "Informe a modelo.");

    const perfil = await getProfile(profileId);
    const contas = listAccounts(profileId).map((c) => ({ ...c, settings: getAgentSettings(c.id) }));
    const conectadas = new Set(contas.map((c) => (c.username || "").toLowerCase()).filter(Boolean));

    return NextResponse.json({
      app: getInstagramAppSettings(),
      contas,
      // Do cadastro da modelo, só o que ainda não está conectado.
      cadastradas: (perfil?.accounts || [])
        .filter((a) => a.network === "instagram")
        .map((a) => ({ username: a.username.replace(/^@/, ""), url: a.url }))
        .filter((a) => a.username && !conectadas.has(a.username.toLowerCase())),
      // A persona que o agente vai usar. Mostrada na tela para ninguém precisar
      // adivinhar de onde vem o jeito de falar da IA neste canal.
      persona: perfil
        ? {
            name: perfil.name,
            toneTags: perfil.toneTags || [],
            temPersonalidade: Boolean(perfil.bioPhysical),
            temHistoria: Boolean(perfil.bioUnique),
            temLimites: Boolean(perfil.limits),
          }
        : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "");

    // Credenciais do app da Meta — valem para TODAS as modelos.
    if (action === "save-app") {
      return NextResponse.json({
        app: updateInstagramAppSettings({
          appId: typeof body.appId === "string" ? body.appId : undefined,
          appSecret: typeof body.appSecret === "string" ? body.appSecret : undefined,
          verifyToken: typeof body.verifyToken === "string" ? body.verifyToken : undefined,
          publicBaseUrl: typeof body.publicBaseUrl === "string" ? body.publicBaseUrl : undefined,
        }),
      });
    }

    const accountId = String(body.accountId || "");
    if (!accountId) throw new ApiError(400, "Informe a conta.");
    const conta = getAccount(accountId);
    if (!conta) throw new ApiError(404, "Conta não encontrada.");

    if (action === "save-settings") {
      const s = (body.settings || {}) as Partial<IgAgentSettings>;
      const num = (v: unknown, min: number, max: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined;
      };
      return NextResponse.json({
        settings: saveAgentSettings(accountId, {
          enabled: typeof s.enabled === "boolean" ? s.enabled : undefined,
          ctaTarget: ["bio", "stories", "ambos"].includes(String(s.ctaTarget))
            ? (s.ctaTarget as IgAgentSettings["ctaTarget"])
            : undefined,
          delayMinS: num(s.delayMinS, 0, 300),
          delayMaxS: num(s.delayMaxS, 0, 600),
          // Teto de 1000: acima disso não é operação, é engano de digitação —
          // e o estrago cai na conta da modelo, não no painel.
          dailyLimit: num(s.dailyLimit, 0, 1000),
          maxTurns: num(s.maxTurns, 1, 20),
          extraNotes: typeof s.extraNotes === "string" ? s.extraNotes : undefined,
        }),
      });
    }

    if (action === "set-active") {
      setAccountActive(accountId, Boolean(body.active));
      return NextResponse.json({ ok: true });
    }

    if (action === "disconnect") {
      deleteAccount(accountId);
      return NextResponse.json({ ok: true });
    }

    throw new ApiError(400, "Ação inválida.");
  } catch (err) {
    return errorResponse(err);
  }
}
