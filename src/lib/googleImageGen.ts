import "server-only";
import { getGoogleMediaKey } from "./settings";
import { modeloImagem, resolucaoImagemValida, formatoImagemValido } from "./aiMediaOptions";
import { mensagemDeModeracao } from "./aiMediaErros";
import type { PedidoImagem, RespostaImagem } from "./imageGen";

/**
 * GERADOR DE IMAGEM DO GOOGLE — família Nano Banana, pela Gemini API direto.
 *
 * Mesma finalidade de imageGen.ts (que fala com a OpenRouter), com a mesma
 * assinatura de entrada e saída, para as rotas escolherem o módulo pelo
 * provedor do catálogo sem saber o resto.
 *
 * A API é bem diferente da Images API da OpenRouter: é o endpoint
 * `/v1beta/interactions`, a chave vai em cabeçalho (não em query), o prompt
 * e as referências viajam numa lista `input[]` heterogênea, e a resposta traz
 * UMA imagem por chamada — não existe `n`. Por isso o `maxN` destes modelos
 * é 1 no catálogo, e a quantidade vira chamadas repetidas na rota.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** Traduz os erros da Gemini API para o operador. */
function mensagemDoErro(status: number, apiMsg: string): string {
  const moderacao = mensagemDeModeracao(apiMsg);
  if (moderacao) return moderacao;
  const base = apiMsg ? ` (${apiMsg})` : "";
  switch (status) {
    case 400:
      return `Pedido recusado pelo Google — parâmetro inválido ou conteúdo barrado${base}.`;
    case 401:
    case 403:
      return "Chave do Google recusada. Confira em Configurações → Conexão com IA (e veja se o projeto está no plano pago: Nano Banana exige).";
    case 404:
      return "Modelo não encontrado nesta conta do Google — pode não estar liberado para o seu projeto.";
    case 429:
      return "Limite de uso do Google atingido — aguarde um instante e tente de novo.";
    case 500:
    case 503:
      return "O Google falhou ao gerar (não foi cobrado). Tente de novo.";
    default:
      return `Falha ao gerar a imagem no Google (${status})${base}.`;
  }
}

/** Separa o cabeçalho `data:` do base64 puro que a API espera. */
function partesDataUrl(url: string): { mime: string; dados: string } | null {
  const m = /^data:([^;,]+)[^,]*,(.*)$/s.exec(url);
  if (!m) return null;
  return { mime: m[1], dados: m[2] };
}

export async function gerarImagemGoogle(pedido: PedidoImagem): Promise<RespostaImagem> {
  const apiKey = getGoogleMediaKey();
  if (!apiKey) {
    throw new Error(
      "Google não está conectado. Ative o Gemini (ou cole a chave de mídia) em Configurações → Conexão com IA.",
    );
  }

  const modelo = modeloImagem(pedido.modelo);

  // O prompt vem primeiro e as referências depois, na MESMA ordem em que a
  // rota as montou (galeria primeiro, imagem a copiar por último) — é a
  // ordem que o texto do prompt pressupõe ao falar em "última imagem".
  const input: Record<string, unknown>[] = [{ type: "text", text: pedido.prompt }];
  for (const url of pedido.referencias) {
    const partes = partesDataUrl(url);
    if (partes) {
      input.push({ type: "image", mime_type: partes.mime, data: partes.dados });
    } else {
      // URL http: a API aceita só bytes aqui, então é ignorada em vez de
      // derrubar a geração inteira.
      continue;
    }
  }

  const body = {
    model: modelo.slug,
    input,
    response_format: {
      type: "image",
      mime_type: "image/png",
      aspect_ratio: formatoImagemValido(modelo.id, pedido.aspectRatio),
      image_size: resolucaoImagemValida(modelo.id, pedido.resolution),
    },
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new Error(mensagemDoErro(res.status, typeof err?.message === "string" ? err.message : ""));
  }

  // O caminho curto é `output_image`; o longo percorre os passos. Lê os dois
  // porque a resposta traz um ou outro conforme o modelo.
  const direto = (data.output_image as { data?: string; mime_type?: string } | undefined)?.data;
  let base64 = typeof direto === "string" ? direto : "";
  let mediaType =
    (data.output_image as { mime_type?: string } | undefined)?.mime_type || "image/png";

  if (!base64) {
    const passos = (data.steps as { content?: { type?: string; data?: string; mime_type?: string }[] }[]) || [];
    for (const passo of passos) {
      const img = (passo.content || []).find((c) => c?.type === "image" && c.data);
      if (img?.data) {
        base64 = img.data;
        mediaType = img.mime_type || mediaType;
        break;
      }
    }
  }

  if (!base64) throw new Error("O Google não devolveu imagem nenhuma.");

  // A Gemini API não informa custo na resposta; a estimativa da tela (tabela
  // de preços por resolução) é o que aparece para o operador.
  return { imagens: [{ base64, mediaType }] };
}
