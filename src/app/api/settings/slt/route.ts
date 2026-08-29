import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/apiAuth";
import { getSltSettingsPublic, updateSltApiKey } from "@/lib/settings";
import { syncSltEvents, testSltApiKey, sltDiagnosticoSessao } from "@/lib/sltSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Integração com o SLT (slt.bio, link na bio) — uma chave só, pra conta
 * inteira (confirmado com o operador: uma conta SLT cobre todas as
 * modelos). Mesmo padrão de segredo do Stripe/SyncPay: a chave nunca volta
 * pro navegador, só se existe uma salva.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return NextResponse.json({
      settings: getSltSettingsPublic(),
      // Diagnóstico de qualidade do dado (ver `sltDiagnosticoSessao`): diz se
      // a contagem de visualização é por visitante ou por carregamento.
      sessao: sltDiagnosticoSessao(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : undefined;

    // Limpar a chave (campo vazio) não precisa testar nada.
    if (apiKey !== undefined && apiKey !== "") {
      const teste = await testSltApiKey(apiKey);
      if (!teste.ok) {
        return NextResponse.json(
          { error: `Não consegui validar essa chave com o SLT: ${teste.error || "falha desconhecida"}` },
          { status: 400 },
        );
      }
    }

    const settings = updateSltApiKey(apiKey);
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}

/** "Sincronizar agora" — pula a trava de 15 minutos do tick de fundo. */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const resultado = await syncSltEvents({ force: true });
    return NextResponse.json({ ...resultado, settings: getSltSettingsPublic() });
  } catch (err) {
    return errorResponse(err);
  }
}
