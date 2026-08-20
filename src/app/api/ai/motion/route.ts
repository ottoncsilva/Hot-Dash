import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getMediaRow, getOrCreatePublicToken } from "@/lib/media";
import { submeterMotion } from "@/lib/motionGen";
import { getVideoInfo } from "@/lib/videoDimensions";
import { absolutePath } from "@/lib/storage";
import { resolvePublicOrigin, origemAlcancavel } from "@/lib/publicOrigin";
import {
  codificarJob,
  modeloMotion,
  MOTION_VIDEO_SEGUNDOS_MIN,
  MOTION_VIDEO_SEGUNDOS_MAX,
  type OrientacaoMotion,
} from "@/lib/aiMediaOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A frase que explica por que o pedido não pode nem sair daqui. */
function avisoDeOrigem(origin: string): string {
  return (
    `A Magnific precisa BAIXAR a foto e o vídeo pela internet, e o painel se enxerga em ${origin} — ` +
    "um endereço que só existe aqui dentro. Publique o painel em um domínio público (ou defina a " +
    "variável de ambiente WEBHOOK_APP_URL com ele) antes de gerar, senão o job falha depois de cobrado."
  );
}

/**
 * Estado da origem pública, para a tela avisar ANTES de o operador gastar.
 * É a única checagem que dá para fazer sem chamar a API paga.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const { origin, source } = resolvePublicOrigin(req);
    const publico = origemAlcancavel(origin);
    return NextResponse.json({
      origin,
      source,
      publico,
      aviso: publico ? null : avisoDeOrigem(origin),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * MOTION CONTROL — só SUBMETE o job, como o gerador de vídeo.
 *
 * O trabalho próprio desta rota é montar os dois LINKS PÚBLICOS: a API da
 * Magnific não aceita base64, então a foto e o vídeo precisam estar em URLs
 * que o servidor dela alcance. Os dois já estão gravados como mídia (o upload
 * entra pela rota de mídia do perfil, marcado como oculto), e aqui viram
 * `/api/public/media/{token}` sobre a origem pública do painel.
 *
 * O acompanhamento reaproveita /api/ai/video-gen/[jobId] — é o prefixo `mg.`
 * do id que diz àquela rota a quem perguntar.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const profileId = String(body.profileId || "").trim();
    if (!profileId) throw new ApiError(400, "Escolha a modelo.");

    const modelo = modeloMotion(body.modelo);

    const fotoId = String(body.fotoMediaId || "").trim();
    const videoId = String(body.videoMediaId || "").trim();
    if (!fotoId) throw new ApiError(400, "Escolha a foto da modelo.");
    if (!videoId) throw new ApiError(400, "Escolha o vídeo de referência.");

    // Cada peça é conferida de verdade: existe, é do perfil escolhido e é do
    // tipo certo. Trocar foto por vídeo aqui só daria erro depois de cobrado.
    const foto = getMediaRow(fotoId);
    if (!foto || foto.profile_id !== profileId) throw new ApiError(404, "Foto não encontrada.");
    if (foto.kind !== "image") throw new ApiError(400, "A referência do personagem precisa ser uma foto.");

    const video = getMediaRow(videoId);
    if (!video || video.profile_id !== profileId) throw new ApiError(404, "Vídeo não encontrado.");
    if (video.kind !== "video") throw new ApiError(400, "A referência de movimento precisa ser um vídeo.");

    // A duração é conferida AQUI, e não só na tela: o navegador pode não
    // saber abrir o arquivo (build de Chromium sem codec proprietário, por
    // exemplo) e deixar passar um vídeo fora da faixa. O ffprobe do servidor
    // sempre sabe, e isto ainda roda antes de qualquer chamada paga.
    const info = await getVideoInfo(absolutePath(video.path));
    const seg = info?.duration;
    if (seg !== undefined && (seg < MOTION_VIDEO_SEGUNDOS_MIN || seg > MOTION_VIDEO_SEGUNDOS_MAX)) {
      throw new ApiError(
        400,
        `O vídeo tem ${seg}s — a Kling só aceita de ${MOTION_VIDEO_SEGUNDOS_MIN} a ${MOTION_VIDEO_SEGUNDOS_MAX}s. Corte antes de gerar.`,
      );
    }

    const { origin } = resolvePublicOrigin(req);
    if (!origemAlcancavel(origin)) throw new ApiError(400, avisoDeOrigem(origin));

    // O token é estável e permanente por desenho (é o mesmo link que as
    // automações usam). Quem gera motion control aceita que a foto e o vídeo
    // fiquem acessíveis por link — a tela diz isso.
    const tokenFoto = getOrCreatePublicToken(fotoId);
    const tokenVideo = getOrCreatePublicToken(videoId);
    if (!tokenFoto || !tokenVideo) throw new ApiError(500, "Falha ao montar os links públicos.");

    const orientacao: OrientacaoMotion = body.orientacao === "image" ? "image" : "video";
    const cfgScale =
      typeof body.cfgScale === "number" && Number.isFinite(body.cfgScale) ? body.cfgScale : undefined;

    const job = await submeterMotion({
      modelo: modelo.id,
      imageUrl: `${origin}/api/public/media/${tokenFoto}`,
      videoUrl: `${origin}/api/public/media/${tokenVideo}`,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      orientacao,
      cfgScale,
    });

    return NextResponse.json({
      job: { ...job, jobId: codificarJob(modelo.provedor, job.jobId) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
