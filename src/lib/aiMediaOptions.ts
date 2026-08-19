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

/**
 * Resoluções que EXISTEM na família. Qual delas cada modelo aceita está no
 * catálogo abaixo — não são as mesmas: o Seedream Pro faz 1K/2K e o Lite faz
 * 2K/4K, o Seedance 2.0 vai até 4K e o Mini/Fast param no 720p.
 */
export const IMAGE_RESOLUCOES = ["1K", "2K", "4K"] as const;
export type ImageResolucao = (typeof IMAGE_RESOLUCOES)[number];

export const VIDEO_RESOLUCOES = ["480p", "720p", "1080p", "4K"] as const;
export type VideoResolucao = (typeof VIDEO_RESOLUCOES)[number];

export const VIDEO_DURACOES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type VideoDuracao = (typeof VIDEO_DURACOES)[number];

/** Teto de gerações por clique — um clique errado não pode virar oito vídeos. */
export const MAX_QUANTIDADE = 4;

export function quantidadeValida(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 1;
  return Math.min(MAX_QUANTIDADE, Math.max(1, v));
}

/* ------------------------------------------------------------------ *
 * CATÁLOGO DE MODELOS
 *
 * Preços e limites conferidos AO VIVO na OpenRouter (não deduzidos):
 * imagem em /api/v1/images/models/<slug>/endpoints, vídeo na ficha de
 * /api/v1/videos/models. O que muda de um modelo para outro não é só o
 * preço — é a lista de resoluções e o `n` — e é por isso que isto é uma
 * tabela por modelo em vez de constantes soltas.
 * ------------------------------------------------------------------ */

export type ModeloImagemId = "pro" | "lite";

export type ModeloImagem = {
  id: ModeloImagemId;
  /** O que vai no campo `model` da API. Nunca vem cru do cliente. */
  slug: string;
  nome: string;
  resolucoes: readonly ImageResolucao[];
  /** Imagens por chamada que o modelo aceita. O Pro trava em 1. */
  maxN: number;
  /** US$ por imagem gerada, por resolução. */
  precoSaida: Partial<Record<ImageResolucao, number>>;
  /** US$ por imagem de referência enviada. O Lite não cobra. */
  precoReferencia: number;
};

export const MODELOS_IMAGEM: readonly ModeloImagem[] = [
  {
    id: "pro",
    slug: "bytedance-seed/seedream-5-0-pro",
    nome: "Seedream 5.0 Pro",
    resolucoes: ["1K", "2K"],
    maxN: 1,
    // output_image US$ 0,045 · variante high_resolution (2K) US$ 0,090
    precoSaida: { "1K": 0.045, "2K": 0.09 },
    precoReferencia: 0.003,
  },
  {
    id: "lite",
    slug: "bytedance-seed/seedream-5-0-lite",
    nome: "Seedream 5.0 Lite",
    resolucoes: ["2K", "4K"],
    maxN: 4,
    // Preço único de US$ 0,035, sem variante de alta resolução e sem linha
    // de input_image — o provedor não cobra as referências à parte aqui.
    precoSaida: { "2K": 0.035, "4K": 0.035 },
    precoReferencia: 0,
  },
];

export type ModeloVideoId = "seedance" | "mini" | "fast";

export type ModeloVideo = {
  id: ModeloVideoId;
  slug: string;
  nome: string;
  resolucoes: readonly VideoResolucao[];
  /** US$ por "video token", por faixa de resolução. */
  precoPorToken: Partial<Record<VideoResolucao, number>>;
};

export const MODELOS_VIDEO: readonly ModeloVideo[] = [
  {
    id: "seedance",
    slug: "bytedance/seedance-2.0",
    nome: "Seedance 2.0",
    resolucoes: ["480p", "720p", "1080p", "4K"],
    precoPorToken: { "480p": 0.000007, "720p": 0.000007, "1080p": 0.0000077, "4K": 0.000004 },
  },
  {
    id: "mini",
    slug: "bytedance/seedance-2.0-mini",
    nome: "Seedance 2.0 Mini",
    resolucoes: ["480p", "720p"],
    precoPorToken: { "480p": 0.0000035, "720p": 0.0000035 },
  },
  {
    id: "fast",
    slug: "bytedance/seedance-2.0-fast",
    nome: "Seedance 2.0 Fast",
    resolucoes: ["480p", "720p"],
    precoPorToken: { "480p": 0.0000042, "720p": 0.0000042 },
  },
];

export function modeloImagem(id: unknown): ModeloImagem {
  return MODELOS_IMAGEM.find((m) => m.id === id) || MODELOS_IMAGEM[0];
}

export function modeloVideo(id: unknown): ModeloVideo {
  return MODELOS_VIDEO.find((m) => m.id === id) || MODELOS_VIDEO[0];
}

/**
 * A resolução, se o modelo aceita; senão a MAIS PRÓXIMA que ele faz.
 *
 * Existe porque a resolução escolhida sobrevive à troca de modelo: sair do
 * Pro em "1K" para o Lite (que só faz 2K/4K) deixaria um valor que a API
 * recusa. A tela usa isto ao trocar de modelo, e a rota usa como guarda —
 * ela não pode confiar que o cliente mandou um par coerente.
 *
 * "Mais próxima", e não "a primeira": cair de 4K para 480p só porque o
 * modelo novo não faz 4K é uma queda de dezesseis vezes, capaz de estragar
 * a geração que se acabou de pagar. Quem estava em 4K vai para o teto do
 * modelo novo; quem estava no mínimo continua no mínimo.
 */
function maisProxima<T extends string>(
  ordem: readonly T[],
  aceitas: readonly T[],
  desejada: unknown,
): T {
  const alvo = ordem.indexOf(desejada as T);
  if (alvo < 0) return aceitas[0];
  let escolha = aceitas[0];
  let melhor = Infinity;
  for (const r of aceitas) {
    const d = Math.abs(ordem.indexOf(r) - alvo);
    if (d < melhor) {
      melhor = d;
      escolha = r;
    }
  }
  return escolha;
}

export function resolucaoImagemValida(
  modeloId: unknown,
  resolucao: unknown,
): ImageResolucao {
  const m = modeloImagem(modeloId);
  return maisProxima(IMAGE_RESOLUCOES, m.resolucoes, resolucao);
}

export function resolucaoVideoValida(
  modeloId: unknown,
  resolucao: unknown,
): VideoResolucao {
  const m = modeloVideo(modeloId);
  return maisProxima(VIDEO_RESOLUCOES, m.resolucoes, resolucao);
}

export function custoImagem(
  modeloId: ModeloImagemId,
  resolucao: ImageResolucao,
  referencias: number,
  quantidade = 1,
): number {
  const m = modeloImagem(modeloId);
  const res = resolucaoImagemValida(modeloId, resolucao);
  const saida = m.precoSaida[res] ?? 0;
  const porImagem = saida + Math.max(0, referencias) * m.precoReferencia;
  return porImagem * quantidadeValida(quantidade);
}

/**
 * PREÇO DO VÍDEO.
 *
 * O Seedance cobra por "video token", e a própria ficha do modelo dá a
 * fórmula: tokens = (largura × altura × duração × 24) ÷ 1024. O preço do
 * token muda por faixa de resolução e por modelo (`pricing_skus`).
 *
 * Conferido contra os preços por segundo que a OpenRouter publica:
 *   480p 9:16 → 480×854×24÷1024 = 9607,5 tokens/s × 0,000007 = US$ 0,0673/s
 *               (a ficha diz US$ 0,06726/s ✔)
 *   4K 16:9  → 3840×2160×24÷1024 = 194400 tokens/s × 0,000004 = US$ 0,7776/s
 *               (a ficha diz US$ 0,7776/s ✔)
 */

/**
 * As dimensões exatas que o modelo produz para cada par (resolução, formato).
 * São os `supported_sizes` da ficha do Seedance — não dá para deduzir por
 * regra de três, porque o modelo arredonda cada combinação para um tamanho
 * fixo da lista dele. Mini e Fast usam as mesmas medidas nas faixas que
 * atendem (480p e 720p).
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
  modeloId: ModeloVideoId,
  resolucao: VideoResolucao,
  formato: Formato,
  duracaoSegundos: number,
  quantidade = 1,
): number {
  const m = modeloVideo(modeloId);
  const res = resolucaoVideoValida(modeloId, resolucao);
  const [largura, altura] = VIDEO_TAMANHOS[res][formato];
  const tokens = (largura * altura * duracaoSegundos * 24) / 1024;
  return tokens * (m.precoPorToken[res] ?? 0) * quantidadeValida(quantidade);
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

/** O que a rota de imagem devolve — lista, porque um pedido pode render várias. */
export type ImagemGeradaSaida = {
  imagens: { base64: string; mediaType: string }[];
  costUsd?: number;
  /** Preenchido quando parte das imagens veio e o resto falhou. */
  aviso?: string;
};
