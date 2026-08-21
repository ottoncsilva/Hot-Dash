import "server-only";
import {
  modeloImagem,
  resolucaoImagemValida,
  formatoImagemValido,
  FORMATO_MAGNIFIC,
  tetoReferencias,
} from "./aiMediaOptions";
import {
  submeterTarefaMagnific,
  esperarTarefaMagnific,
  baixarArquivoMagnific,
} from "./magnificTasks";
import type { PedidoImagem, RespostaImagem } from "./imageGen";
import { MAX_REFERENCIAS } from "./imageGen";

/**
 * GERADOR DE IMAGEM pela Magnific.
 *
 * Não traz modelo novo: são o Seedream 5.0 (Pro e Lite) e o Nano Banana, os
 * MESMOS que o painel já gera pela OpenRouter e pelo Google — só que por outra
 * rota, para haver com quem comparar preço e para onde correr quando uma cai.
 *
 * Mesma assinatura de `gerarImagemSeedream` e `gerarImagemGoogle`, para a rota
 * escolher o módulo pelo provedor do catálogo e não saber de mais nada.
 *
 * A DIFERENÇA QUE PRECISOU DE DESENHO: a Magnific é assíncrona (devolve uma
 * tarefa, que se consulta até ficar pronta), e a rota de imagem do painel é
 * síncrona — ela devolve o base64 na resposta. Então o laço de espera acontece
 * aqui dentro. Cabe: o próprio provedor estima 10-20s em 1K, 20-40s em 2K e
 * 40-90s em 4K, e a rota já permite 180s.
 */

/** Quanto esperar a tarefa. Fica abaixo do `maxDuration = 180` da rota para o
 *  estouro virar uma mensagem nossa, e não um corte seco da requisição. */
const TETO_ESPERA_MS = 150_000;

/** O `-edit` é a variante que aceita imagem de referência; a simples é só
 *  texto. Qual usar sai do pedido, não de uma escolha na tela. */
function caminhoDoModelo(slug: string, temReferencia: boolean): string {
  const ehSeedream = slug.startsWith("seedream");
  const nome = ehSeedream && temReferencia ? `${slug}-edit` : slug;
  return `text-to-image/${nome}`;
}

/**
 * A resolução no vocabulário da Magnific. O Seedream 5.0 lá oferece 1.5K e 2K;
 * o "1K" do painel é o mais próximo do 1.5K, e é assim que o catálogo declara.
 */
function resolucaoMagnific(res: string, slug: string): string {
  if (slug.startsWith("seedream")) return res === "1K" ? "1.5k" : "2k";
  return res.toLowerCase(); // nano banana: 1k / 2k / 4k
}

/** As referências que a rota montou vêm como `data:` URL; a Magnific quer o
 *  base64 puro. */
function soOBase64(url: string): string {
  const i = url.indexOf(",");
  return i >= 0 && url.startsWith("data:") ? url.slice(i + 1) : url;
}

export async function gerarImagemMagnific(pedido: PedidoImagem): Promise<RespostaImagem> {
  const modelo = modeloImagem(pedido.modelo);

  // O teto de referências é do MODELO, não do painel: o Seedream da Magnific
  // aceita 10, o da OpenRouter aceita 14. Cortar aqui é melhor que levar um
  // 400 depois de montar o pedido inteiro.
  const teto = tetoReferencias(modelo.id, MAX_REFERENCIAS);
  const referencias = pedido.referencias.slice(0, teto);

  const resolucao = resolucaoImagemValida(modelo.id, pedido.resolution);
  const formato = formatoImagemValido(modelo.id, pedido.aspectRatio);

  const body: Record<string, unknown> = {
    prompt: pedido.prompt,
    resolution: resolucaoMagnific(resolucao, modelo.slug),
    aspect_ratio: FORMATO_MAGNIFIC[formato],
  };
  if (typeof pedido.seed === "number" && Number.isFinite(pedido.seed)) {
    body.seed = Math.round(pedido.seed);
  }
  if (referencias.length > 0) {
    // A ordem é a mesma que a rota montou (galeria primeiro, imagem a copiar
    // por último) — é a ordem que o prompt e as citações com @ pressupõem.
    body.reference_images = referencias.map(soOBase64);
  }

  const jobId = await submeterTarefaMagnific(
    caminhoDoModelo(modelo.slug, referencias.length > 0),
    body,
  );
  const tarefa = await esperarTarefaMagnific(jobId, { tetoMs: TETO_ESPERA_MS });

  if (tarefa.gerados.length === 0) {
    throw new Error("A Magnific terminou sem devolver imagem.");
  }

  // A Magnific entrega por URL; a rota do painel devolve base64. Baixar aqui
  // mantém o mesmo formato de saída dos outros dois geradores — e o link
  // temporário deles nunca chega ao navegador.
  const imagens = [];
  for (const url of tarefa.gerados) {
    const { bytes, contentType } = await baixarArquivoMagnific(url, "image/png");
    imagens.push({ base64: bytes.toString("base64"), mediaType: contentType });
  }

  // `costUsd` fica de fora: a Magnific cobra em crédito e não informa o valor
  // da tarefa. Inventar um número aqui seria pior que não ter nenhum.
  return { imagens };
}
