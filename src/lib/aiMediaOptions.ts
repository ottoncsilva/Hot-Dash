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

/** R$ a partir do valor em dólar e da cotação do dia. */
export function formatarBrl(valorUsd: number, brlPorUsd: number): string {
  return `R$ ${(valorUsd * brlPorUsd).toFixed(2).replace(".", ",")}`;
}

/**
 * MENÇÕES A IMAGENS DENTRO DO PROMPT (`@[id:rótulo:tipo]`).
 *
 * Prompts trazidos de outras ferramentas vêm cheios desses marcadores, que lá
 * apontam para arquivos daquele sistema. Aqui eles não significam nada: o
 * Seedream recebe uma LISTA ORDENADA de imagens, sem rótulo nenhum — quem diz
 * o que é cada uma é o texto do prompt.
 *
 * Então, em vez de mandar o marcador cru (que o modelo lê como lixo), a gente
 * traduz cada um para a posição real que aquela imagem ocupa no nosso envio:
 * a imagem a copiar vai sempre primeiro, as da modelo vêm depois.
 */
export type PapelMencao = "copia" | "modelo";

export type MencaoPrompt = {
  id: string;
  label: string;
  tipo: string;
  /** Palpite inicial, que o operador pode corrigir na tela. */
  papel: PapelMencao;
  ocorrencias: number;
};

const RE_MENCAO = /@\[([^\]]+)\]/g;

const TEXTO_PAPEL: Record<PapelMencao, string> = {
  copia: "a ÚLTIMA imagem de referência (a composição/cenário a copiar)",
  modelo: "as primeiras imagens de referência (as fotos da modelo)",
};

function partesDaMencao(bruto: string): { id: string; label: string; tipo: string } {
  const partes = bruto.split(":");
  return {
    id: partes[0] || bruto,
    tipo: partes.length > 1 ? partes[partes.length - 1] : "",
    label: partes.length > 2 ? partes.slice(1, -1).join(":") : "",
  };
}

/**
 * Palpite do papel. O discriminador bom é o TIPO: a ferramenta de origem marca
 * a imagem de cenário/composição como `output-images` e as fotos da modelo
 * como `output`. O rótulo entra como reforço quando o tipo não decide.
 */
function palpitarPapel(label: string, tipo: string): PapelMencao {
  if (/output-images/i.test(tipo)) return "copia";
  if (/\bref\b|refer|cen[áa]rio|lista|copiar/i.test(label)) return "copia";
  return "modelo";
}

/** As menções distintas encontradas, na ordem em que aparecem. */
export function acharMencoes(prompt: string): MencaoPrompt[] {
  const porId = new Map<string, MencaoPrompt>();
  for (const m of prompt.matchAll(RE_MENCAO)) {
    const { id, label, tipo } = partesDaMencao(m[1]);
    const existente = porId.get(id);
    if (existente) {
      existente.ocorrencias += 1;
      continue;
    }
    porId.set(id, { id, label, tipo, papel: palpitarPapel(label, tipo), ocorrencias: 1 });
  }
  return [...porId.values()];
}

/**
 * Troca cada menção pela descrição da posição correspondente e junta as
 * repetições coladas: seis fotos da modelo enfileiradas viram UMA frase, não
 * a mesma frase seis vezes.
 */
export function aplicarMencoes(prompt: string, papeis: Record<string, PapelMencao>): string {
  const trocado = prompt.replace(RE_MENCAO, (inteiro, bruto: string) => {
    const { id, label, tipo } = partesDaMencao(bruto);
    const papel = papeis[id] || palpitarPapel(label, tipo);
    return TEXTO_PAPEL[papel];
  });

  let saida = trocado;
  for (const frase of Object.values(TEXTO_PAPEL)) {
    const escapada = frase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    saida = saida.replace(new RegExp(`${escapada}(\\s*${escapada})+`, "g"), frase);
  }
  return saida;
}


/**
 * CITAÇÃO DE IMAGEM COM @ (marcador nosso).
 *
 * O operador digita "@" no prompt e escolhe uma das imagens que ele já pôs na
 * tela. O marcador fica LEGÍVEL no texto — "@referência 2", "@imagem a
 * copiar" — em vez de um id opaco: quem lê o prompt tem que entender o que
 * está escrito sem decifrar código.
 *
 * Por ser legível, o marcador é POSICIONAL. A troco disso, quem cita uma
 * posição que não existe mais recebe um aviso na tela (ver citacoesInvalidas)
 * em vez de mandar calado a foto errada.
 */
export const TOKEN_COPIA = "@imagem a copiar";

export function tokenReferencia(n: number): string {
  return `@referência ${n}`;
}

/** Casa os marcadores nossos — é o mesmo padrão usado para pintar na tela. */
export const RE_CITACAO = /@(?:referência\s+(\d+)|imagem a copiar)/gi;

/** Quantas referências o prompt cita além das que existem. */
export function citacoesInvalidas(
  prompt: string,
  qtdReferencias: number,
  temCopia: boolean,
): string[] {
  const problemas: string[] = [];
  for (const m of prompt.matchAll(RE_CITACAO)) {
    if (m[1]) {
      const n = Number(m[1]);
      if (n < 1 || n > qtdReferencias) problemas.push(`@referência ${n}`);
    } else if (!temCopia) {
      problemas.push(TOKEN_COPIA);
    }
  }
  return [...new Set(problemas)];
}

/**
 * Troca os marcadores pela posição real no envio. É o último passo antes de
 * mandar ao modelo, que recebe as imagens numa lista sem rótulo.
 */
export function resolverFotos(
  prompt: string,
  qtdReferencias: number,
  temCopia: boolean,
): string {
  const trocado = prompt.replace(RE_CITACAO, (_, num?: string) => {
    if (num) {
      const n = Number(num);
      if (n < 1 || n > qtdReferencias) return "uma das imagens de referência";
      return `a ${n}ª imagem de referência`;
    }
    return temCopia
      ? "a ÚLTIMA imagem de referência (a composição/cenário a copiar)"
      : "a composição de referência";
  });
  // Os rótulos começam com "a ", então a preposição anterior produziria
  // "de a 1ª imagem". Contrai para o prompt não sair com português capenga —
  // o modelo lê esse texto.
  return trocado.replace(
    /\b(de|em|por)\s+a\s+(?=(?:\d+ª imagem|ÚLTIMA imagem|composição de refer|uma das imagens))/gi,
    (_, prep: string) => {
      const c: Record<string, string> = { de: "da", em: "na", por: "pela" };
      const base = c[prep.toLowerCase()];
      return prep[0] === prep[0].toUpperCase()
        ? base[0].toUpperCase() + base.slice(1) + " "
        : base + " ";
    },
  );
}

/**
 * Converte os marcadores do formato antigo (`@[foto:id]`, opaco) para o
 * legível. Roda ao abrir a tela, porque prompt já salvo com o formato velho
 * continuaria ilegível — e, pior, casava com o regex das menções trazidas de
 * fora, aparecendo como uma "referência" chamada `foto`.
 */
export function migrarFotosAntigas(
  prompt: string,
  referenciaIds: string[],
  idCopia = "copia",
): string {
  return prompt.replace(/@\[foto:([^\]]+)\]/g, (_, id: string) => {
    const limpo = id.trim();
    if (limpo === idCopia) return TOKEN_COPIA;
    const i = referenciaIds.indexOf(limpo);
    return i >= 0 ? tokenReferencia(i + 1) : "uma das imagens de referência";
  });
}
