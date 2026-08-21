import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getMediaRow, renderVisionImageBase64 } from "@/lib/media";
import { gerarImagemSeedream, ASPECT_RATIOS, MAX_REFERENCIAS, type AspectRatio } from "@/lib/imageGen";
import { gerarImagemGoogle } from "@/lib/googleImageGen";
import { gerarImagemMagnific } from "@/lib/magnificImageGen";
import {
  modeloImagem,
  resolucaoImagemValida,
  quantidadeValida,
  type ImagemGeradaSaida,
} from "@/lib/aiMediaOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Geração de imagem em 2K pode levar dezenas de segundos — folga generosa
 *  para não cortar a chamada no meio de um pedido que estava indo bem.
 *
 *  Pela Magnific o custo de tempo é maior: ela é assíncrona, e quem espera a
 *  tarefa ficar pronta é o servidor (ver magnificImageGen). O teto de lá é
 *  150s, escolhido para caber aqui com folga — o estouro vira uma mensagem
 *  nossa em vez de um corte seco da requisição. */
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const prompt = String(body.prompt || "").trim();
    if (!prompt) throw new ApiError(400, "Escreva o prompt da imagem.");

    // Modelo e resolução andam juntos: a resolução válida depende de qual
    // modelo foi escolhido (Pro faz 1K/2K, Lite faz 2K/4K).
    const modelo = modeloImagem(body.modelo);
    const resolution = resolucaoImagemValida(modelo.id, body.resolution);
    const quantidade = quantidadeValida(body.quantidade);
    const aspectRatio: AspectRatio = ASPECT_RATIOS.includes(body.aspectRatio) ? body.aspectRatio : "auto";
    const seed =
      typeof body.seed === "number" && Number.isFinite(body.seed) ? body.seed : undefined;

    // A IMAGEM A COPIAR (se houver) já chega do cliente como data: URL, já
    // redimensionada lá — o cliente é quem tem a foto original na mão, e
    // mandá-la sem redimensionar só para o servidor encolher depois seria
    // gastar banda à toa.
    //
    // Ela vai SEMPRE POR ÚLTIMO na lista, depois das fotos da modelo. Essa é
    // a ordem que os prompts escritos à mão já usavam (primeiro QUEM é a
    // pessoa, depois a CENA a reproduzir), e é o que o prompt padrão e a
    // citação com @ pressupõem ao falar em "última imagem de referência".
    // Ela também pode vir da Galeria, escolhida na mesma grade das outras —
    // aí é aqui que vira base64, com a mesma renderização das referências.
    let copyImage = typeof body.copyImageBase64 === "string" ? body.copyImageBase64.trim() : "";
    if (copyImage && !copyImage.startsWith("data:image/")) {
      throw new ApiError(400, "Imagem a copiar inválida.");
    }
    const copyImageMediaId =
      typeof body.copyImageMediaId === "string" ? body.copyImageMediaId.trim() : "";
    if (!copyImage && copyImageMediaId) {
      const row = getMediaRow(copyImageMediaId);
      if (row) {
        const b64 = await renderVisionImageBase64(row.path);
        if (b64) copyImage = `data:image/jpeg;base64,${b64}`;
      }
    }

    const referenceMediaIds = (
      Array.isArray(body.referenceMediaIds)
        ? body.referenceMediaIds.filter((x: unknown): x is string => typeof x === "string")
        : []
    )
      // A mesma foto nos dois papéis iria duas vezes e ainda bagunçaria a
      // contagem das citações com @ — vale como imagem a copiar, que é a
      // escolha mais específica.
      .filter((id: string) => id !== copyImageMediaId);

    // Reserva a última vaga para a imagem a copiar, para o teto do modelo não
    // engolir justamente a cena que se quer reproduzir.
    const tetoGaleria = copyImage ? MAX_REFERENCIAS - 1 : MAX_REFERENCIAS;
    const referencias: string[] = [];
    for (const id of referenceMediaIds) {
      if (referencias.length >= tetoGaleria) break;
      const row = getMediaRow(id);
      if (!row) continue;
      // Mesma renderização usada para a IA "ver" fotos na legenda: até 1024px,
      // JPEG q82 — leve o bastante para embutir em base64 sem perder o que
      // importa (rosto, corpo, roupa).
      const b64 = await renderVisionImageBase64(row.path);
      if (b64) referencias.push(`data:image/jpeg;base64,${b64}`);
    }
    if (copyImage) referencias.push(copyImage);

    // Quando o modelo não faz várias imagens numa chamada (o Pro trava em
    // n:1), a quantidade vira chamadas repetidas. Uma que falhe no meio não
    // descarta as que já vieram — elas já foram cobradas.
    const imagens: { base64: string; mediaType: string }[] = [];
    let custoTotal = 0;
    let erroParcial = "";
    const chamadas = Math.ceil(quantidade / modelo.maxN);
    for (let i = 0; i < chamadas; i++) {
      const faltam = quantidade - imagens.length;
      if (faltam <= 0) break;
      try {
        // O provedor do catálogo decide o módulo; os três têm a mesma
        // assinatura, então o resto da rota não muda.
        const gerar =
          modelo.provedor === "google"
            ? gerarImagemGoogle
            : modelo.provedor === "magnific"
              ? gerarImagemMagnific
              : gerarImagemSeedream;
        const r = await gerar({
          prompt,
          referencias,
          resolution,
          aspectRatio,
          seed,
          modelo: modelo.id,
          quantidade: faltam,
        });
        imagens.push(...r.imagens);
        if (typeof r.costUsd === "number") custoTotal += r.costUsd;
      } catch (e) {
        erroParcial = e instanceof Error ? e.message : "falha";
        break;
      }
    }
    // Nenhuma imagem veio: o erro é o resultado.
    if (imagens.length === 0) throw new ApiError(502, erroParcial || "O provedor não devolveu imagem nenhuma.");

    const saida: ImagemGeradaSaida = {
      imagens: imagens.slice(0, quantidade),
      costUsd: custoTotal > 0 ? custoTotal : undefined,
      aviso: erroParcial || undefined,
    };
    return NextResponse.json(saida);
  } catch (err) {
    return errorResponse(err);
  }
}
