/**
 * Opções e PREÇO das gerações de imagem (Seedream) e vídeo (Seedance).
 *
 * Fica FORA de imageGen.ts/videoGen.ts de propósito: aqueles são
 * `server-only` (falam com a chave da OpenRouter), e a tela precisa das
 * mesmas listas e do mesmo cálculo para mostrar o custo ANTES de gerar. Um
 * módulo só evita as duas cópias divergirem — que é exatamente o risco de
 * uma tabela de preço duplicada.
 *
 * Os números vieram da própria OpenRouter (endpoint de preços do modelo e a
 * ficha do Seedance), não de estimativa nossa — ver comentário de cada bloco.
 */

/**
 * Formatos oferecidos. É um recorte proposital do que os modelos aceitam:
 * são os que fazem sentido para post de rede social (retrato, quadrado,
 * paisagem), e ter menos opção na tela é o ponto — a lista cheia tinha 18
 * itens, quase todos cinema ultrawide que nunca seriam usados aqui.
 */
export const FORMATOS = ["3:4", "9:16", "1:1", "4:3", "16:9"] as const;
export type Formato = (typeof FORMATOS)[number];

export const IMAGE_RESOLUCOES = ["1K", "2K"] as const;
export type ImageResolucao = (typeof IMAGE_RESOLUCOES)[number];

export const VIDEO_RESOLUCOES = ["480p", "720p", "1080p", "4K"] as const;
export type VideoResolucao = (typeof VIDEO_RESOLUCOES)[number];

export const VIDEO_DURACOES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type VideoDuracao = (typeof VIDEO_DURACOES)[number];

/**
 * PREÇO DA IMAGEM (bytedance-seed/seedream-5-0-pro).
 *
 * Vem da tabela de preços do provedor em
 * /api/v1/images/models/bytedance-seed/seedream-5-0-pro/endpoints:
 *   output_image ........................ US$ 0,045 por imagem
 *   output_image (high_resolution) ...... US$ 0,090 por imagem
 *   input_image ......................... US$ 0,003 por imagem de referência
 *
 * "high_resolution" é o 2K. As referências são cobradas UMA A UMA, por isso
 * a conta soma a imagem a copiar junto com as da modelo.
 */
const IMAGEM_SAIDA_1K = 0.045;
const IMAGEM_SAIDA_2K = 0.09;
const IMAGEM_REFERENCIA = 0.003;

export function custoImagem(resolucao: ImageResolucao, referencias: number): number {
  const saida = resolucao === "2K" ? IMAGEM_SAIDA_2K : IMAGEM_SAIDA_1K;
  return saida + Math.max(0, referencias) * IMAGEM_REFERENCIA;
}

/**
 * PREÇO DO VÍDEO (bytedance/seedance-2.0).
 *
 * O Seedance cobra por "video token", e a própria ficha do modelo dá a
 * fórmula: tokens = (largura × altura × duração × 24) ÷ 1024. O preço do
 * token muda por faixa de resolução (campo `pricing_skus` do modelo).
 *
 * Conferido contra os dois preços por segundo que a OpenRouter publica:
 *   480p 9:16 → 480×854×24÷1024 = 9607,5 tokens/s × 0,000007 = US$ 0,0673/s
 *               (a ficha diz US$ 0,06726/s ✔)
 *   4K 16:9  → 3840×2160×24÷1024 = 194400 tokens/s × 0,000004 = US$ 0,7776/s
 *               (a ficha diz US$ 0,7776/s ✔)
 */
const VIDEO_USD_POR_TOKEN: Record<VideoResolucao, number> = {
  "480p": 0.000007,
  "720p": 0.000007,
  "1080p": 0.0000077,
  "4K": 0.000004,
};

/**
 * As dimensões exatas que o modelo produz para cada par (resolução, formato).
 * São os `supported_sizes` da ficha do Seedance — não dá para deduzir por
 * regra de três, porque o modelo arredonda cada combinação para um tamanho
 * fixo da lista dele.
 */
const VIDEO_TAMANHOS: Record<VideoResolucao, Record<Formato, [number, number]>> = {
  "480p": { "1:1": [480, 480], "3:4": [480, 640], "9:16": [480, 854], "4:3": [640, 480], "16:9": [854, 480] },
  "720p": { "1:1": [720, 720], "3:4": [720, 960], "9:16": [720, 1280], "4:3": [960, 720], "16:9": [1280, 720] },
  "1080p": {
    "1:1": [1080, 1080],
    "3:4": [1080, 1440],
    "9:16": [1080, 1920],
    "4:3": [1440, 1080],
    "16:9": [1920, 1080],
  },
  "4K": {
    "1:1": [2160, 2160],
    "3:4": [2160, 2880],
    "9:16": [2160, 3840],
    "4:3": [2880, 2160],
    "16:9": [3840, 2160],
  },
};

export function custoVideo(
  resolucao: VideoResolucao,
  formato: Formato,
  duracaoSegundos: number,
): number {
  const [largura, altura] = VIDEO_TAMANHOS[resolucao][formato];
  const tokens = (largura * altura * duracaoSegundos * 24) / 1024;
  return tokens * VIDEO_USD_POR_TOKEN[resolucao];
}

/**
 * US$ com casas suficientes para o valor não sumir no arredondamento: abaixo
 * de dez centavos usa três casas, senão os US$ 0,003 de cada referência de
 * imagem desapareceriam da conta (0,090 e 0,093 virariam o mesmo "$0.09").
 */
export function formatarUsd(valor: number): string {
  return `$${valor < 0.1 ? valor.toFixed(3) : valor.toFixed(2)}`;
}
