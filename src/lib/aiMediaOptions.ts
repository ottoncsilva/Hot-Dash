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

/**
 * A ESCALA de durações — todos os segundos que algum modelo aceita, em ordem.
 *
 * Não é o que a tela mostra: cada modelo traz a sua lista em `duracoes`, e é
 * ela que vira botão. Esta serve para ordenar (o "mais próximo" ao trocar de
 * modelo mede distância aqui) e para tipar.
 *
 * Vai até 30 por causa do Seedance 2.5, que aceita de 4 a 30 segundos. Os
 * modelos que param em 15 seguem parando em 15.
 */
export const VIDEO_DURACOES = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
] as const;
export type VideoDuracao = (typeof VIDEO_DURACOES)[number];

/**
 * As durações que os modelos da família Seedance 2.0 aceitam — 4 a 15, o
 * intervalo inteiro. Ficava escrito como `VIDEO_DURACOES` quando a escala e a
 * lista deles eram a mesma coisa; agora que a escala vai a 30, precisa ser
 * explícito.
 */
export const DURACOES_ATE_15 = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/**
 * O recorte para os modelos que fazem vídeo longo.
 *
 * O Seedance 2.5 aceita QUALQUER inteiro de 4 a 30 — 27 botões na tela, que é
 * mais escolha do que ajuda. Mesma lógica do recorte de formatos: passo de 1s
 * onde a diferença se nota (até 6s), depois de 2 em 2 e de 5 em 5.
 */
export const DURACOES_LONGAS = [4, 5, 6, 8, 10, 12, 15, 20, 25, 30] as const;

/** Teto de gerações por clique — um clique errado não pode virar oito vídeos. */
export const MAX_QUANTIDADE = 4;

export function quantidadeValida(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 1;
  return Math.min(MAX_QUANTIDADE, Math.max(1, v));
}

/* ------------------------------------------------------------------ *
 * CATÁLOGO DE MODELOS
 *
 * Preços e limites conferidos nas fontes oficiais (não deduzidos): os da
 * OpenRouter em /api/v1/images/models/<slug>/endpoints e na ficha de
 * /api/v1/videos/models; os do Google na documentação da Gemini API e na
 * tabela de preços dela.
 *
 * O que muda de um modelo para outro não é só o preço: é a lista de
 * resoluções, de formatos, de durações, o teto de imagens por chamada e até
 * a FORMA de cobrar (por token no Seedance, por segundo no Veo). Por isso
 * isto é uma tabela por modelo, lida pela tela E pelo servidor.
 * ------------------------------------------------------------------ */

/** Quem atende a chamada — decide o módulo que a rota usa. */
export type Provedor = "openrouter" | "google" | "magnific";

export const NOME_PROVEDOR: Record<Provedor, string> = {
  openrouter: "OpenRouter",
  google: "Google",
  magnific: "Magnific",
};

export type ModeloImagemId =
  | "pro"
  | "lite"
  | "nb-pro"
  | "nb2"
  | "nb2-lite"
  // Os mesmos modelos acima, pela Magnific. O sufixo `-mg` é o que separa as
  // duas rotas; a `familia` é o que diz que são o mesmo modelo.
  | "pro-mg"
  | "lite-mg"
  | "nb-pro-mg"
  | "nb2-mg";

export type ModeloImagem = {
  id: ModeloImagemId;
  provedor: Provedor;
  /** O que vai no campo `model` da API. Nunca vem cru do cliente. */
  slug: string;
  nome: string;
  resolucoes: readonly ImageResolucao[];
  formatos: readonly Formato[];
  /** Imagens por chamada que o modelo aceita. */
  maxN: number;
  /**
   * US$ por imagem gerada, por resolução. VAZIO quando o provedor cobra em
   * crédito e não publica valor por unidade — ver `semPrecoDeTabela`.
   */
  precoSaida: Partial<Record<ImageResolucao, number>>;
  /** US$ por imagem de referência enviada. */
  precoReferencia: number;
  /**
   * O MESMO modelo por outra rota. Duas entradas com a mesma família são o
   * mesmo Seedream/Veo/Seedance atendido por provedores diferentes: serve
   * para a tela preservar resolução e formato ao trocar de rota, e para
   * dizer que a troca não muda o resultado, só quem cobra.
   */
  familia?: string;
  /** Teto de referências deste modelo, quando difere do teto geral (14). */
  maxReferencias?: number;
  /**
   * Se aceita o formato "auto" (herdar o da referência). A Magnific não tem —
   * o formato lá é um enum fechado.
   */
  aceitaAuto?: boolean;
};

export const MODELOS_IMAGEM: readonly ModeloImagem[] = [
  {
    id: "pro",
    familia: "seedream-5-pro",
    provedor: "openrouter",
    slug: "bytedance-seed/seedream-5-0-pro",
    nome: "Seedream 5.0 Pro",
    resolucoes: ["1K", "2K"],
    formatos: FORMATOS,
    maxN: 1,
    // output_image US$ 0,045 · variante high_resolution (2K) US$ 0,090
    precoSaida: { "1K": 0.045, "2K": 0.09 },
    precoReferencia: 0.003,
  },
  {
    id: "lite",
    familia: "seedream-5-lite",
    provedor: "openrouter",
    slug: "bytedance-seed/seedream-5-0-lite",
    nome: "Seedream 5.0 Lite",
    resolucoes: ["2K", "4K"],
    formatos: FORMATOS,
    maxN: 4,
    // Preço único de US$ 0,035, sem variante de alta resolução e sem linha
    // de input_image — o provedor não cobra as referências à parte aqui.
    precoSaida: { "2K": 0.035, "4K": 0.035 },
    precoReferencia: 0,
  },
  // --- Google (Nano Banana). Uma imagem por chamada: a Images API deles não
  // tem `n`, então quantidade vira chamadas repetidas.
  {
    id: "nb-pro",
    familia: "nano-banana-pro",
    provedor: "google",
    slug: "gemini-3-pro-image",
    nome: "Nano Banana Pro",
    resolucoes: ["1K", "2K", "4K"],
    formatos: FORMATOS,
    maxN: 1,
    // 1120 tokens (1K e 2K) e 2000 (4K) a US$ 120/1M de tokens de saída.
    precoSaida: { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
    precoReferencia: 0.0011,
  },
  {
    id: "nb2",
    familia: "nano-banana-2",
    provedor: "google",
    slug: "gemini-3.1-flash-image",
    nome: "Nano Banana 2",
    resolucoes: ["1K", "2K", "4K"],
    formatos: FORMATOS,
    maxN: 1,
    // 1120 / 1680 / 2520 tokens a US$ 60/1M.
    precoSaida: { "1K": 0.067, "2K": 0.101, "4K": 0.151 },
    precoReferencia: 0,
  },
  {
    id: "nb2-lite",
    provedor: "google",
    slug: "gemini-3.1-flash-lite-image",
    nome: "Nano Banana 2 Lite",
    resolucoes: ["1K", "2K", "4K"],
    formatos: FORMATOS,
    maxN: 1,
    // A tabela publica só o de 1K (US$ 0,0336). Os outros saem da mesma
    // contagem de tokens por resolução (1120/1680/2520) vezes os US$ 30/1M
    // deste modelo — método conferido contra o número de 1K, que bate exato.
    precoSaida: { "1K": 0.0336, "2K": 0.0504, "4K": 0.0756 },
    precoReferencia: 0,
  },

  // --- Magnific (ex-Freepik). Não são modelos novos: são os MESMOS quatro
  // acima, revendidos por ela. Existir em duas rotas serve para comparar
  // preço e para ter para onde correr quando uma delas cai.
  //
  // `precoSaida` vazio de propósito: a Magnific cobra em crédito e não
  // publica valor por unidade — nem na documentação, nem na resposta da
  // tarefa. Um número aqui seria inventado, e a tela mostra a nota de crédito
  // em vez da estimativa.
  //
  // `aceitaAuto: false` em todas: o formato lá é um enum fechado
  // (`square_1_1`, `social_story_9_16`…), sem a opção de herdar o da
  // referência.
  {
    id: "pro-mg",
    familia: "seedream-5-pro",
    provedor: "magnific",
    // O slug real depende de haver referência ou não (`-edit` ou simples);
    // quem resolve isso é o magnificImageGen, porque só ele sabe do pedido.
    slug: "seedream-v5-pro",
    nome: "Seedream 5.0 Pro",
    // A Magnific oferece 1.5K e 2K neste modelo; o 1.5K entra como "1K" na
    // escala do painel, que é a mais próxima que existe aqui.
    resolucoes: ["1K", "2K"],
    formatos: FORMATOS,
    maxN: 1,
    precoSaida: {},
    precoReferencia: 0,
    maxReferencias: 10,
    aceitaAuto: false,
  },
  {
    id: "lite-mg",
    familia: "seedream-5-lite",
    provedor: "magnific",
    slug: "seedream-v5-lite",
    nome: "Seedream 5.0 Lite",
    resolucoes: ["1K", "2K"],
    formatos: FORMATOS,
    maxN: 1,
    precoSaida: {},
    precoReferencia: 0,
    maxReferencias: 10,
    aceitaAuto: false,
  },
  {
    id: "nb-pro-mg",
    familia: "nano-banana-pro",
    provedor: "magnific",
    slug: "nano-banana-pro",
    nome: "Nano Banana Pro",
    resolucoes: ["1K", "2K", "4K"],
    formatos: FORMATOS,
    maxN: 1,
    precoSaida: {},
    precoReferencia: 0,
    aceitaAuto: false,
  },
  {
    id: "nb2-mg",
    familia: "nano-banana-2",
    provedor: "magnific",
    slug: "nano-banana-pro-flash",
    nome: "Nano Banana 2",
    resolucoes: ["1K", "2K", "4K"],
    formatos: FORMATOS,
    maxN: 1,
    precoSaida: {},
    precoReferencia: 0,
    aceitaAuto: false,
  },
];

export type ModeloVideoId =
  | "seedance"
  | "mini"
  | "fast"
  | "seedance25"
  | "veo"
  | "veo-fast"
  // Pela Magnific: os mesmos quatro, mais o Kling, que só existe lá.
  | "seedance-mg"
  | "mini-mg"
  | "fast-mg"
  | "veo-mg"
  | "veo-fast-mg"
  | "kling26";

/**
 * Como o modelo cobra. O Seedance cobra por "video token" (fórmula de
 * dimensão × duração); o Veo cobra por segundo, direto. Uma tabela de preço
 * só não modelaria os dois.
 */
export type PrecoVideo =
  | { tipo: "token"; porToken: Partial<Record<VideoResolucao, number>> }
  | { tipo: "segundo"; porSegundo: Partial<Record<VideoResolucao, number>> }
  /**
   * Cobrado em crédito, sem preço por unidade publicado — é o caso da
   * Magnific. Não é "preço zero": é "não dá para estimar", e a tela diz isso
   * em vez de mostrar um número inventado.
   */
  | { tipo: "creditos" };

export type ModeloVideo = {
  id: ModeloVideoId;
  provedor: Provedor;
  slug: string;
  nome: string;
  resolucoes: readonly VideoResolucao[];
  formatos: readonly Formato[];
  duracoes: readonly number[];
  /** Vídeos por chamada. O Veo tem `numberOfVideos`; o Seedance não tem `n`. */
  maxN: number;
  preco: PrecoVideo;
  /**
   * As dimensões exatas por (resolução, formato), quando o modelo NÃO usa as
   * da família Seedance 2.0. Só importa para quem cobra por token, porque é a
   * área do quadro que vira preço.
   *
   * O Seedance 2.5 é o caso: em 16:9 e 9:16 ele bate com a 2.0, mas em 1:1,
   * 4:3 e 3:4 usa quadros bem maiores (640×640 no lugar de 480×480, por
   * exemplo). Reaproveitar a tabela da 2.0 subestimaria o custo em quase 80%
   * nesses três formatos — o contrário do que uma estimativa serve para fazer.
   */
  tamanhos?: Record<string, Partial<Record<Formato, [number, number]>>>;
  /** O MESMO modelo por outra rota — ver `familia` em ModeloImagem. */
  familia?: string;
  /** O Veo sempre gera áudio, e isso não muda o preço — a tela esconde o interruptor. */
  audioSempre?: boolean;
  /**
   * Se o modelo aceita `enable_safety_checker` — o filtro de conteúdo da
   * Magnific, que vem LIGADO por padrão e pode ser desligado no pedido.
   *
   * É por modelo, não por provedor: na Magnific o Seedance Pro e o Fast têm o
   * campo, o Mini NÃO tem, e mandá-lo para quem não aceita é parâmetro
   * inválido. Fora da Magnific não existe em modelo nenhum — nem a OpenRouter
   * nem o Google expõem algo assim na API de vídeo.
   */
  aceitaFiltroSeguranca?: boolean;
  /** Resoluções que obrigam a duração máxima (regra do Veo para 1080p e 4k). */
  exigemDuracaoMaxima?: readonly VideoResolucao[];
};

export const MODELOS_VIDEO: readonly ModeloVideo[] = [
  {
    id: "seedance",
    familia: "seedance-2-pro",
    provedor: "openrouter",
    slug: "bytedance/seedance-2.0",
    nome: "Seedance 2.0",
    resolucoes: ["480p", "720p", "1080p", "4K"],
    formatos: FORMATOS,
    duracoes: DURACOES_ATE_15,
    maxN: 1,
    preco: {
      tipo: "token",
      porToken: { "480p": 0.000007, "720p": 0.000007, "1080p": 0.0000077, "4K": 0.000004 },
    },
  },
  {
    id: "mini",
    familia: "seedance-2-mini",
    provedor: "openrouter",
    slug: "bytedance/seedance-2.0-mini",
    nome: "Seedance 2.0 Mini",
    resolucoes: ["480p", "720p"],
    formatos: FORMATOS,
    duracoes: DURACOES_ATE_15,
    maxN: 1,
    preco: { tipo: "token", porToken: { "480p": 0.0000035, "720p": 0.0000035 } },
  },
  {
    id: "fast",
    familia: "seedance-2-fast",
    provedor: "openrouter",
    slug: "bytedance/seedance-2.0-fast",
    nome: "Seedance 2.0 Fast",
    resolucoes: ["480p", "720p"],
    formatos: FORMATOS,
    duracoes: DURACOES_ATE_15,
    maxN: 1,
    preco: { tipo: "token", porToken: { "480p": 0.0000042, "720p": 0.0000042 } },
  },
  {
    id: "seedance25",
    familia: "seedance-2-5",
    provedor: "openrouter",
    slug: "bytedance/seedance-2.5",
    nome: "Seedance 2.5",
    // Números da ficha do próprio modelo na OpenRouter, não deduzidos:
    // /api/v1/videos/models → bytedance/seedance-2.5.
    //
    // Ao contrário da 2.0, a 2.5 NÃO faz 1080p nem 4K — para em 720p. Em
    // compensação vai a 30 segundos, contra os 15 da 2.0.
    resolucoes: ["480p", "720p"],
    formatos: FORMATOS,
    duracoes: DURACOES_LONGAS,
    maxN: 1,
    // `video_tokens: 0.0000107`, o mesmo nas duas resoluções — a 2.0 cobra
    // 0,000007 em 480p/720p, então a 2.5 sai ~53% mais cara por token.
    preco: { tipo: "token", porToken: { "480p": 0.0000107, "720p": 0.0000107 } },
    // `supported_sizes` da ficha. 16:9 e 9:16 coincidem com a 2.0; os outros
    // três não, e é por isso que esta tabela existe.
    tamanhos: {
      "480p": {
        "16:9": [854, 480],
        "4:3": [752, 560],
        "1:1": [640, 640],
        "3:4": [560, 752],
        "9:16": [480, 854],
      },
      "720p": {
        "16:9": [1280, 720],
        "4:3": [1112, 834],
        "1:1": [960, 960],
        "3:4": [834, 1112],
        "9:16": [720, 1280],
      },
    },
  },

  // --- Google (Veo 3.1). Limites bem mais estreitos: dois formatos, três
  // durações, e 1080p/4k só em 8 segundos.
  {
    id: "veo",
    familia: "veo-3-1",
    provedor: "google",
    slug: "veo-3.1-generate-preview",
    nome: "Veo 3.1",
    resolucoes: ["720p", "1080p", "4K"],
    formatos: ["9:16", "16:9"],
    duracoes: [4, 6, 8],
    maxN: 4,
    preco: { tipo: "segundo", porSegundo: { "720p": 0.4, "1080p": 0.4, "4K": 0.6 } },
    audioSempre: true,
    exigemDuracaoMaxima: ["1080p", "4K"],
  },
  {
    id: "veo-fast",
    familia: "veo-3-1-fast",
    provedor: "google",
    slug: "veo-3.1-fast-generate-preview",
    nome: "Veo 3.1 Fast",
    resolucoes: ["720p", "1080p", "4K"],
    formatos: ["9:16", "16:9"],
    duracoes: [4, 6, 8],
    maxN: 4,
    preco: { tipo: "segundo", porSegundo: { "720p": 0.1, "1080p": 0.12, "4K": 0.3 } },
    audioSempre: true,
    exigemDuracaoMaxima: ["1080p", "4K"],
  },

  // --- Magnific. Os mesmos Seedance e Veo de cima, por outra rota, mais o
  // Kling, que só existe aqui. Preço em crédito, sem tabela — ver o bloco
  // equivalente em MODELOS_IMAGEM.
  //
  // Uma diferença que fica no módulo, não aqui: no Seedance da Magnific a
  // RESOLUÇÃO VAI NO CAMINHO da URL (`seedance-2-pro-1080p`), não num campo
  // do corpo. O slug abaixo é o prefixo; quem completa é o magnificVideoGen.
  {
    id: "seedance-mg",
    familia: "seedance-2-pro",
    provedor: "magnific",
    slug: "video/seedance-2-pro",
    nome: "Seedance 2.0",
    resolucoes: ["480p", "720p", "1080p", "4K"],
    formatos: FORMATOS,
    duracoes: DURACOES_ATE_15,
    maxN: 1,
    preco: { tipo: "creditos" },
    aceitaFiltroSeguranca: true,
  },
  {
    id: "mini-mg",
    familia: "seedance-2-mini",
    provedor: "magnific",
    slug: "video/seedance-2-mini",
    nome: "Seedance 2.0 Mini",
    resolucoes: ["480p", "720p"],
    formatos: FORMATOS,
    duracoes: DURACOES_ATE_15,
    maxN: 1,
    preco: { tipo: "creditos" },
  },
  {
    id: "fast-mg",
    familia: "seedance-2-fast",
    provedor: "magnific",
    slug: "video/seedance-2-fast",
    nome: "Seedance 2.0 Fast",
    resolucoes: ["480p", "720p"],
    formatos: FORMATOS,
    duracoes: DURACOES_ATE_15,
    maxN: 1,
    preco: { tipo: "creditos" },
    aceitaFiltroSeguranca: true,
  },
  {
    id: "veo-mg",
    familia: "veo-3-1",
    provedor: "magnific",
    slug: "image-to-video/veo-3-1",
    nome: "Veo 3.1",
    resolucoes: ["720p", "1080p", "4K"],
    formatos: ["9:16", "16:9"],
    duracoes: [4, 6, 8],
    maxN: 1,
    preco: { tipo: "creditos" },
    audioSempre: true,
    exigemDuracaoMaxima: ["1080p", "4K"],
  },
  {
    id: "veo-fast-mg",
    familia: "veo-3-1-fast",
    provedor: "magnific",
    slug: "image-to-video/veo-3-1-fast",
    nome: "Veo 3.1 Fast",
    resolucoes: ["720p", "1080p", "4K"],
    formatos: ["9:16", "16:9"],
    duracoes: [4, 6, 8],
    maxN: 1,
    preco: { tipo: "creditos" },
    audioSempre: true,
    exigemDuracaoMaxima: ["1080p", "4K"],
  },
  {
    id: "kling26",
    provedor: "magnific",
    slug: "image-to-video/kling-v2-6-pro",
    nome: "Kling 2.6 Pro",
    // Sem `familia`: é o único do painel que não tem irmão em outra rota.
    // A Kling escolhe a resolução sozinha — a lista abaixo existe só para o
    // seletor da tela não ficar vazio, e o módulo não manda o campo.
    resolucoes: ["1080p"],
    formatos: ["9:16", "16:9", "1:1"],
    // Só 5 ou 10 segundos, e é a própria API que impõe.
    duracoes: [5, 10],
    maxN: 1,
    preco: { tipo: "creditos" },
  },
];

/**
 * Os provedores que aparecem na lista suspensa, na ordem do catálogo.
 *
 * DERIVADO, e não escrito à mão: as duas telas traziam `["openrouter",
 * "google"]` fixo, então acrescentar a Magnific ao catálogo não a fazia
 * aparecer em lugar nenhum — o modelo existia e era inalcançável. Tirando a
 * lista daqui, a próxima rota entra sozinha.
 */
/**
 * O que a tela precisa ter conectado para gerar com determinado modelo.
 *
 * Antes as duas telas olhavam SÓ o OpenRouter e travavam o botão sem ele —
 * mesmo com um modelo do Google escolhido, que não passa nem perto da chave
 * do OpenRouter. Com uma terceira rota o erro ficaria mais visível ainda, e a
 * checagem passa a seguir o provedor do modelo escolhido.
 *
 * O Google entra por dois lugares (o Gemini normal ou a chave só de mídia), e
 * a Magnific compartilha o slot com o Kling — por isso cada um lista mais de
 * uma chave possível.
 */
export const CHAVES_DO_PROVEDOR: Record<Provedor, readonly string[]> = {
  openrouter: ["openrouter"],
  google: ["gemini", "googleMedia"],
  magnific: ["magnific", "kling"],
};

export function provedoresComModelo(
  modelos: readonly { provedor: Provedor }[],
): Provedor[] {
  const vistos: Provedor[] = [];
  for (const m of modelos) if (!vistos.includes(m.provedor)) vistos.push(m.provedor);
  return vistos;
}

export function modeloImagem(id: unknown): ModeloImagem {
  return MODELOS_IMAGEM.find((m) => m.id === id) || MODELOS_IMAGEM[0];
}

export function modeloVideo(id: unknown): ModeloVideo {
  return MODELOS_VIDEO.find((m) => m.id === id) || MODELOS_VIDEO[0];
}

/**
 * O valor pedido, se o modelo aceita; senão o MAIS PRÓXIMO que ele faz.
 *
 * Existe porque a escolha sobrevive à troca de modelo: sair do Seedance em
 * 15s e 3:4 para o Veo (que só faz 4/6/8s e dois formatos) deixaria valores
 * que a API recusa. "Mais próximo", e não "o primeiro": cair de 4K para 480p
 * só porque o modelo novo não faz 4K é uma queda de dezesseis vezes, capaz
 * de estragar a geração que se acabou de pagar.
 *
 * A tela usa ao trocar de modelo; a rota usa como guarda, porque não pode
 * confiar que o cliente mandou um conjunto coerente.
 */
function maisProxima<T extends string | number>(
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

export function resolucaoImagemValida(modeloId: unknown, resolucao: unknown): ImageResolucao {
  const m = modeloImagem(modeloId);
  return maisProxima(IMAGE_RESOLUCOES, m.resolucoes, resolucao);
}

export function resolucaoVideoValida(modeloId: unknown, resolucao: unknown): VideoResolucao {
  const m = modeloVideo(modeloId);
  return maisProxima(VIDEO_RESOLUCOES, m.resolucoes, resolucao);
}

export function formatoImagemValido(modeloId: unknown, formato: unknown): Formato {
  return maisProxima(FORMATOS, modeloImagem(modeloId).formatos, formato);
}

/**
 * O formato a mostrar na tela, já contando com o "auto".
 *
 * "auto" (herdar o formato da referência) existe na OpenRouter e no Google,
 * mas não na Magnific. Ao trocar para um modelo que não o aceita, quem estava
 * em "auto" precisa cair em algo concreto — e cai no 9:16, que é o formato de
 * quase tudo que este painel publica.
 */
export function formatoImagemDaTela(modeloId: unknown, formato: unknown): string {
  const m = modeloImagem(modeloId);
  const aceitaAuto = m.aceitaAuto !== false;
  if (formato === "auto") return aceitaAuto ? "auto" : "9:16";
  return formatoImagemValido(modeloId, formato);
}

/** Quantas referências este modelo aceita. */
export function tetoReferencias(modeloId: unknown, tetoGeral: number): number {
  return Math.min(tetoGeral, modeloImagem(modeloId).maxReferencias ?? tetoGeral);
}

export function formatoVideoValido(modeloId: unknown, formato: unknown): Formato {
  return maisProxima(FORMATOS, modeloVideo(modeloId).formatos, formato);
}

/**
 * A duração válida para o par (modelo, resolução). Além da lista do modelo,
 * há a regra cruzada do Veo: 1080p e 4k só saem com a duração máxima.
 */
export function duracaoValida(
  modeloId: unknown,
  resolucao: unknown,
  duracao: unknown,
): number {
  const m = modeloVideo(modeloId);
  const res = resolucaoVideoValida(modeloId, resolucao);
  if (m.exigemDuracaoMaxima?.includes(res)) return Math.max(...m.duracoes);
  return maisProxima(VIDEO_DURACOES, m.duracoes, duracao);
}

/**
 * Se dá para estimar o custo deste modelo ANTES de gerar.
 *
 * Os modelos da Magnific não têm: ela cobra em crédito e não publica valor por
 * unidade. Isto é uma pergunta de propósito, e não um preço zero enfiado na
 * tabela — a diferença entre "custa nada" e "não dá para saber" é justamente
 * o que a tela precisa dizer.
 */
export function semPrecoDeTabela(m: ModeloImagem | ModeloVideo): boolean {
  if ("preco" in m) return m.preco.tipo === "creditos";
  return Object.keys(m.precoSaida).length === 0;
}

/** O custo estimado, ou `null` quando o provedor não publica preço. */
export function custoImagem(
  modeloId: ModeloImagemId,
  resolucao: ImageResolucao,
  referencias: number,
  quantidade = 1,
): number | null {
  const m = modeloImagem(modeloId);
  if (semPrecoDeTabela(m)) return null;
  const res = resolucaoImagemValida(modeloId, resolucao);
  const saida = m.precoSaida[res] ?? 0;
  const porImagem = saida + Math.max(0, referencias) * m.precoReferencia;
  return porImagem * quantidadeValida(quantidade);
}

/**
 * As dimensões exatas que o Seedance produz para cada par (resolução,
 * formato). São os `supported_sizes` da ficha dele — não dá para deduzir por
 * regra de três, porque o modelo arredonda cada combinação para um tamanho
 * fixo da lista. Só serve à cobrança por token; o Veo cobra por segundo e
 * não passa por aqui.
 *
 * Conferido contra os preços por segundo que a OpenRouter publica:
 *   480p 9:16 → 480×854×24÷1024 = 9607,5 tokens/s × 0,000007 = US$ 0,0673/s
 *               (a ficha diz US$ 0,06726/s ✔)
 *   4K 16:9  → 3840×2160×24÷1024 = 194400 tokens/s × 0,000004 = US$ 0,7776/s
 *               (a ficha diz US$ 0,7776/s ✔)
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

/** O custo estimado, ou `null` quando o provedor não publica preço. */
export function custoVideo(
  modeloId: ModeloVideoId,
  resolucao: VideoResolucao,
  formato: Formato,
  duracaoSegundos: number,
  quantidade = 1,
): number | null {
  const m = modeloVideo(modeloId);
  if (m.preco.tipo === "creditos") return null;
  const res = resolucaoVideoValida(modeloId, resolucao);
  const qtd = quantidadeValida(quantidade);

  if (m.preco.tipo === "segundo") {
    return (m.preco.porSegundo[res] ?? 0) * duracaoSegundos * qtd;
  }
  const fmt = formatoVideoValido(modeloId, formato);
  // A tabela do MODELO quando ele tem uma; senão a da família Seedance 2.0,
  // que é a que quase todos seguem.
  const [largura, altura] = m.tamanhos?.[res]?.[fmt] ?? VIDEO_TAMANHOS[res][fmt];
  const tokens = (largura * altura * duracaoSegundos * 24) / 1024;
  return tokens * (m.preco.porToken[res] ?? 0) * qtd;
}

/**
 * O nome que a Magnific dá a cada formato. Ela não usa "9:16": usa
 * `social_story_9_16`, num enum fechado — e não tem "auto".
 */
export const FORMATO_MAGNIFIC: Record<Formato, string> = {
  "1:1": "square_1_1",
  "3:4": "traditional_3_4",
  "9:16": "social_story_9_16",
  "4:3": "classic_4_3",
  "16:9": "widescreen_16_9",
};

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

/* ------------------------------------------------------------------ *
 * IDENTIFICADOR DE JOB DE VÍDEO
 *
 * As rotas de acompanhamento são /api/ai/video-gen/[jobId], um segmento só.
 * A OpenRouter devolve um id simples, mas o Google devolve o NOME de uma
 * operação — "operations/abc123", com barra, que partiria o segmento em dois
 * e daria 404.
 *
 * Então o id que trafega leva um prefixo de provedor (para a rota saber a
 * quem perguntar) e troca a barra por "~". Sem base64 de propósito: o valor
 * continua legível num log, que é onde ele costuma ser lido.
 * ------------------------------------------------------------------ */

const PREFIXO: Record<Provedor, string> = { google: "gg.", openrouter: "or.", magnific: "mg." };

export function codificarJob(provedor: Provedor, id: string): string {
  // A barra vira "~" porque o nome da operação do Google tem uma, e ela
  // partiria o segmento da rota /api/ai/video-gen/[jobId] em dois.
  return `${PREFIXO[provedor]}${id.replace(/\//g, "~")}`;
}

export function decodificarJob(token: string): { provedor: Provedor; id: string } {
  for (const [prov, pre] of Object.entries(PREFIXO) as [Provedor, string][]) {
    if (token.startsWith(pre)) {
      return { provedor: prov, id: token.slice(pre.length).replace(/~/g, "/") };
    }
  }
  // Job criado antes do prefixo existir: continua sendo da OpenRouter.
  return { provedor: "openrouter", id: token };
}


/* ------------------------------------------------------------------ *
 * MOTION CONTROL (Kling 2.6)
 *
 * Catálogo SEPARADO do de vídeo de propósito: aquele carrega resolução,
 * formato e duração escolhíveis, e aqui nada disso existe — a Kling deriva
 * tudo do vídeo de referência. Enfiar estes modelos lá obrigaria campos
 * falsos na tela.
 *
 * Cada entrada já carrega `provedor`, como as de imagem e vídeo. Hoje todas
 * são "magnific"; acrescentar a API oficial da Kuaishou depois é somar
 * entradas com `provedor: "kling"` e um módulo irmão, sem mexer na tela nem
 * nas rotas.
 * ------------------------------------------------------------------ */

export type ModeloMotionId = "kling26-pro" | "kling26-std";

export type ModeloMotion = {
  id: ModeloMotionId;
  provedor: Provedor;
  /** Vai no caminho da URL da API. Nunca vem cru do cliente. */
  slug: string;
  nome: string;
};

export const MODELOS_MOTION: readonly ModeloMotion[] = [
  {
    id: "kling26-pro",
    provedor: "magnific",
    slug: "kling-v2-6-motion-control-pro",
    nome: "Kling 2.6 Pro",
  },
  {
    id: "kling26-std",
    provedor: "magnific",
    slug: "kling-v2-6-motion-control-std",
    nome: "Kling 2.6 Standard",
  },
];

export function modeloMotion(id: unknown): ModeloMotion {
  return MODELOS_MOTION.find((m) => m.id === id) || MODELOS_MOTION[0];
}

/** Limites que a API impõe ao vídeo de referência — a tela barra antes de gastar. */
export const MOTION_VIDEO_SEGUNDOS_MIN = 3;
export const MOTION_VIDEO_SEGUNDOS_MAX = 30;
export const MOTION_VIDEO_FORMATOS = [".mp4", ".mov", ".webm", ".m4v"] as const;
export const MOTION_IMAGEM_FORMATOS = [".jpg", ".jpeg", ".png", ".webp"] as const;

/** Como a modelo se orienta na cena. Muda o teto de duração da saída. */
export const ORIENTACOES = [
  { value: "video", label: "Seguir o vídeo", hint: "Saída até 30s" },
  { value: "image", label: "Seguir a foto", hint: "Saída até 10s" },
] as const;
export type OrientacaoMotion = (typeof ORIENTACOES)[number]["value"];
