import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getProfile } from "@/lib/profiles";
import { getMediaRow, renderVisionImageBase64 } from "@/lib/media";
import { callAiRaw } from "@/lib/ai";
import { getAiCredentials, type AiProvider } from "@/lib/settings";
import {
  PROMPT_VIDEO_BASE_PADRAO,
  PROMPT_VIDEO_CONTROLE_PADRAO,
  montarInstrucaoControle,
} from "@/lib/aiMediaPrompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Monta o PROMPT FINAL do vídeo: uma IA de texto lê a foto do primeiro frame
 * e o texto da caixinha de perguntas, e devolve o roteiro base preenchido.
 *
 * Só escreve o prompt — não gera vídeo nenhum. É de propósito: o operador vê
 * e edita o resultado antes de gastar com a geração, que é a parte cara.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const caixinha = String(body.caixinha || "").trim();
    if (!caixinha) throw new ApiError(400, "Cole a pergunta e a resposta da caixinha.");

    const profileId = String(body.profileId || "").trim();
    const profile = profileId ? await getProfile(profileId) : null;

    const roteiroBase = (body.promptBase ?? profile?.videogenPromptBase ?? "").trim() || PROMPT_VIDEO_BASE_PADRAO;
    const controle =
      (body.promptControle ?? profile?.videogenPromptControle ?? "").trim() || PROMPT_VIDEO_CONTROLE_PADRAO;

    // Resolve as variáveis (@transcrição, @roteiro base, @first frame),
    // traduz os marcadores de outras ferramentas e — se o prompt de controle
    // não citar alguma peça — anexa ela no fim, para a IA nunca escrever sem
    // o template ou sem a caixinha na mão.
    const instrucao = montarInstrucaoControle(controle, roteiroBase, caixinha);

    // A foto do primeiro frame é o que o prompt de controle manda analisar
    // (figurino, cenário, luz) — sem ela a IA preencheria esses campos no
    // chute, então ela viaja junto como imagem.
    const imagens: { mime: string; base64: string }[] = [];
    const frameBase64 = typeof body.firstFrameBase64 === "string" ? body.firstFrameBase64.trim() : "";
    const frameMediaId = typeof body.firstFrameMediaId === "string" ? body.firstFrameMediaId.trim() : "";
    if (frameBase64.startsWith("data:image/")) {
      const [cabecalho, dados] = frameBase64.split(",", 2);
      const mime = /data:([^;]+)/.exec(cabecalho)?.[1] || "image/jpeg";
      if (dados) imagens.push({ mime, base64: dados });
    } else if (frameMediaId) {
      const row = getMediaRow(frameMediaId);
      if (row) {
        const b64 = await renderVisionImageBase64(row.path);
        if (b64) imagens.push({ mime: "image/jpeg", base64: b64 });
      }
    }

    // Precisa de VISÃO, então a cadeia começa pelos provedores que enxergam
    // bem. Não é escolha do operador: qual IA escreveu o roteiro não muda o
    // que ele faz, e uma seleção a mais na tela seria ruído.
    const cadeia: AiProvider[] = (["gemini", "openai", "openrouter", "grok"] as AiProvider[]).filter(
      (p) => getAiCredentials(p, "videoprompt") !== null,
    );
    if (cadeia.length === 0) {
      throw new ApiError(400, "Nenhum provedor de IA conectado. Ative um em Configurações → Conexão com IA.");
    }

    let ultimoErro = "";
    for (const provider of cadeia) {
      try {
        const texto = await callAiRaw(instrucao, provider, {
          activity: "videoprompt",
          // Roteiro completo é longo — teto apertado cortava o prompt no meio.
          maxTokens: 2000,
          images: imagens.length > 0 ? imagens : undefined,
        });
        const limpo = texto.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
        if (limpo) return NextResponse.json({ prompt: limpo, provider });
        ultimoErro = "resposta vazia";
      } catch (e) {
        ultimoErro = e instanceof Error ? e.message : "falha";
      }
    }
    throw new ApiError(502, `Não foi possível montar o prompt final (${ultimoErro}).`);
  } catch (err) {
    return errorResponse(err);
  }
}
