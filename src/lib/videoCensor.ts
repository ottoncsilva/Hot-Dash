import "server-only";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { run } from "./metadata";
import { getVideoInfo } from "./videoDimensions";
import { detectExplicitRegions } from "./nudenet";
import type { BodyPart } from "./bodyParts";
import { mapLimit } from "./concurrency";

/**
 * CENSURA DE VÍDEO — as duas formas, e por que são coisas diferentes.
 *
 * 1. BORRÃO TOTAL (`borrarVideoInteiro`). Não é censura: é TEASER. O quadro
 *    inteiro sai desfocado, dessaturado e escurecido — dá para ver que existe
 *    conteúdo e não dá para ver o conteúdo. Não usa IA nenhuma, é um filtro do
 *    ffmpeg, e por isso não erra: não existe "parte que escapou".
 *
 * 2. EMOJI POR PARTE (`censurarVideoComEmoji`). Aí sim é censura: o vídeo
 *    continua assistível e só as partes ficam cobertas. Depende de detecção
 *    quadro a quadro, e é onde mora toda a dificuldade — ver o comentário de
 *    `montarTrilhas`.
 */

/** Só as partes que a UI conhece têm emoji; o resto é ignorado. */
export type EmojiPorParte = Partial<Record<BodyPart, string>>;

// ---------------------------------------------------------------------------
// 1) Borrão total
// ---------------------------------------------------------------------------

export type BorraoOpts = {
  /** 0..1 — quanto do efeito aplicar. 1 = o máximo (nada reconhecível). */
  intensidade?: number;
  trimStart?: number;
  trimEnd?: number;
};

/**
 * Monta o filtro do borrão total.
 *
 * São três efeitos somados de propósito, porque cada um sozinho falha:
 *   • só desfoque      → formas grandes continuam legíveis;
 *   • só dessaturação  → tira a cor da pele, mas o contorno fica nítido;
 *   • só escurecer     → basta aumentar o brilho para "revelar" o vídeo.
 * Juntos, o resultado não volta atrás com ajuste de tela.
 *
 * O raio do desfoque acompanha a ALTURA do vídeo: um raio fixo que apaga um
 * vídeo de 480p mal borra um de 1080p.
 */
export function filtroBorrao(altura: number, intensidade = INTENSIDADE_PADRAO): string {
  const i = Math.min(1, Math.max(0.15, intensidade));
  // 1080p com intensidade 1 → raio ~54. O limite de 100 é do próprio boxblur.
  const raio = Math.min(100, Math.max(4, Math.round((altura / 20) * i)));
  // A dessaturação e o escurecimento são de propósito MENOS agressivos que o
  // desfoque. Um teaser precisa mostrar que existe algo ali — se o quadro sai
  // preto, não desperta nada, e aí mais valia não postar. Quem carrega o peso
  // é o desfoque, que é o que impede reconhecer o que está acontecendo.
  const saturacao = (1 - i * 0.7).toFixed(2); // 1 → 0.30
  const brilho = (-0.12 * i).toFixed(2); // 1 → -0.12
  return `boxblur=${raio}:2:${Math.round(raio / 2)}:2,eq=saturation=${saturacao}:brightness=${brilho}`;
}

/** Ponto de partida do slider: some o suficiente, sem apagar a cena. */
export const INTENSIDADE_PADRAO = 0.65;

/** Aplica o borrão no vídeo inteiro e devolve o mp4. */
export async function borrarVideoInteiro(
  input: Buffer,
  ext: string,
  opts: BorraoOpts = {},
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "hotdash-censura-"));
  try {
    const entrada = join(dir, `in${ext || ".mp4"}`);
    await writeFile(entrada, input);
    const info = await getVideoInfo(entrada);
    const saida = join(dir, "out.mp4");

    const args: string[] = ["-y"];
    if (opts.trimStart && opts.trimStart > 0) args.push("-ss", opts.trimStart.toFixed(3));
    args.push("-i", entrada, "-vf", filtroBorrao(info?.height || 720, opts.intensidade));
    if (opts.trimEnd != null) {
      const dur = Math.max(0.1, opts.trimEnd - (opts.trimStart || 0));
      args.push("-t", dur.toFixed(3));
    }
    args.push(...ARGS_SAIDA, saida);

    await run("ffmpeg", args, 300_000);
    return await readFile(saida);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const ARGS_SAIDA = [
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "22",
  "-pix_fmt", "yuv420p",
  "-c:a", "copy",
  "-movflags", "+faststart",
];

// ---------------------------------------------------------------------------
// 2) Emoji por parte
// ---------------------------------------------------------------------------

/** Caixa em coordenadas RELATIVAS (0..1), como o detector devolve. */
type Caixa = { x: number; y: number; w: number; h: number };
type Amostra = { t: number; caixa: Caixa | null };
/** Uma parte do corpo ao longo do tempo, já suavizada e sem buracos. */
type Trilha = { part: BodyPart; emoji: string; amostras: Amostra[] };

export type CensuraVideoOpts = {
  emojiPorParte: EmojiPorParte;
  /** Multiplicador do tamanho do emoji sobre a caixa detectada. */
  escalaEmoji?: number;
  /** Quadros por segundo AMOSTRADOS para detecção. */
  fpsAmostra?: number;
  /** Borra a região por baixo do emoji. Escolha do operador: cobre o erro de
   *  posição do emoji sem depender de a detecção estar perfeita. */
  borrarPorBaixo?: boolean;
  intensidadeBorrao?: number;
};

export type CensuraVideoResultado = {
  buffer: Buffer;
  /** Diagnóstico honesto do que aconteceu — a tela mostra isto. */
  partesEncontradas: BodyPart[];
  quadrosAmostrados: number;
  quadrosComDeteccao: number;
};

/**
 * Censura por emoji num vídeo.
 *
 * O caminho é: amostrar quadros → detectar em cada um → montar trilhas →
 * desenhar a camada de emojis → sobrepor com o ffmpeg.
 */
export async function censurarVideoComEmoji(
  input: Buffer,
  ext: string,
  opts: CensuraVideoOpts,
): Promise<CensuraVideoResultado> {
  const dir = await mkdtemp(join(tmpdir(), "hotdash-censura-"));
  try {
    const entrada = join(dir, `in${ext || ".mp4"}`);
    await writeFile(entrada, input);
    const info = await getVideoInfo(entrada);
    const largura = info?.width || 720;
    const altura = info?.height || 1280;
    const duracao = info?.duration || 30;
    const fpsAmostra = Math.min(10, Math.max(2, opts.fpsAmostra ?? 5));

    // --- a) amostra os quadros -------------------------------------------
    // Detectar em 640px de largura em vez da resolução original: o modelo
    // trabalha em 320×320 de qualquer jeito, então mandar 1080p só custa
    // decodificação. As caixas voltam em coordenadas relativas, que servem
    // para qualquer resolução.
    const dirAmostras = join(dir, "amostras");
    await mkdir(dirAmostras, { recursive: true });
    await run("ffmpeg", [
      "-y",
      "-i", entrada,
      "-vf", `fps=${fpsAmostra},scale=640:-2`,
      "-q:v", "4",
      join(dirAmostras, "%05d.jpg"),
    ], 300_000);

    const arquivos = (await readdir(dirAmostras)).filter((f) => f.endsWith(".jpg")).sort();

    // --- b) detecta ------------------------------------------------------
    // Em paralelo limitado: o modelo roda no mesmo processo do painel, e
    // saturar os núcleos aqui trava o resto (autopost, funis, disparos).
    const deteccoes = await mapLimit(arquivos, 2, async (nome) => {
      const bytes = await readFile(join(dirAmostras, nome));
      try {
        return await detectExplicitRegions(bytes, nome);
      } catch {
        return null;
      }
    });

    const trilhas = montarTrilhas(deteccoes, opts.emojiPorParte, fpsAmostra);
    const quadrosComDeteccao = deteccoes.filter((d) => d && d.regions.length > 0).length;

    if (trilhas.length === 0) {
      // Nada detectado: devolve o vídeo como está, e a tela avisa. Recodificar
      // à toa só perderia qualidade.
      return {
        buffer: input,
        partesEncontradas: [],
        quadrosAmostrados: arquivos.length,
        quadrosComDeteccao,
      };
    }

    // --- c) desenha a camada de emojis e, se ativado, a máscara do borrão --
    const dirCamada = join(dir, "camada");
    await mkdir(dirCamada, { recursive: true });
    const usaBorrao = opts.borrarPorBaixo !== false;
    const dirMascara = join(dir, "mascara");
    if (usaBorrao) await mkdir(dirMascara, { recursive: true });

    // As camadas são montadas em MEIA resolução e o ffmpeg amplia na hora de
    // sobrepor: é 4x menos pixel para o sharp compor, e tanto o emoji quanto
    // a máscara do borrão são manchas — ninguém nota a borda um pouco mais
    // macia (e no caso da máscara, a intenção é que a borda SEJA macia).
    const escalaCamada = 0.5;
    const lc = Math.round((largura * escalaCamada) / 2) * 2;
    const ac = Math.round((altura * escalaCamada) / 2) * 2;
    const fpsCamada = fpsAmostra; // o ffmpeg repete os quadros até o fps do vídeo
    const totalQuadros = Math.max(1, Math.ceil(duracao * fpsCamada));
    // Caixa do borrão ~30% maior que a do emoji: cobre a folga de posição do
    // detector do mesmo jeito que a margem dos blocos antigos cobria.
    const margemBorrao = 1.3;
    const textura = usaBorrao ? await texturaBorrao() : null;
    const escalaTextura = textura ? TEXTURA_BORRAO_CANVAS / TEXTURA_BORRAO_CAIXA : 1;

    for (let i = 0; i < totalQuadros; i++) {
      const t = i / fpsCamada;
      const composicoesEmoji: sharp.OverlayOptions[] = [];
      const composicoesBorrao: sharp.OverlayOptions[] = [];
      for (const trilha of trilhas) {
        const caixa = caixaEm(trilha, t);
        if (!caixa) continue;
        const base = Math.max(caixa.w * lc, caixa.h * ac);
        const cx = (caixa.x + caixa.w / 2) * lc;
        const cy = (caixa.y + caixa.h / 2) * ac;

        const png = await emojiPng(trilha.emoji);
        if (png) {
          const lado = Math.max(16, Math.round(base * (opts.escalaEmoji ?? 1.45)));
          composicoesEmoji.push({
            input: await sharp(png).resize(lado, lado, { fit: "inside" }).png().toBuffer(),
            left: Math.max(0, Math.min(lc - 1, Math.round(cx - lado / 2))),
            top: Math.max(0, Math.min(ac - 1, Math.round(cy - lado / 2))),
          });
        }

        if (textura) {
          const ladoCaixa = Math.max(16, Math.round(base * margemBorrao));
          const ladoTextura = Math.round(ladoCaixa * escalaTextura);
          composicoesBorrao.push({
            input: await sharp(textura).resize(ladoTextura, ladoTextura).png().toBuffer(),
            left: Math.max(0, Math.min(lc - 1, Math.round(cx - ladoTextura / 2))),
            top: Math.max(0, Math.min(ac - 1, Math.round(cy - ladoTextura / 2))),
            // "lighten" em vez do "over" padrão: quando duas trilhas se
            // sobrepõem, fica o pixel mais claro dos dois em vez de a
            // segunda cortar o gradiente da primeira — sem isso, a borda
            // esfumaçada de uma trilha "apagava" a outra na sobreposição.
            blend: "lighten",
          });
        }
      }

      await sharp({
        create: { width: lc, height: ac, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite(composicoesEmoji)
        .png()
        .toFile(join(dirCamada, `${String(i + 1).padStart(5, "0")}.png`));

      if (usaBorrao) {
        await sharp({
          create: { width: lc, height: ac, channels: 3, background: { r: 0, g: 0, b: 0 } },
        })
          .composite(composicoesBorrao)
          .png()
          .toFile(join(dirMascara, `${String(i + 1).padStart(5, "0")}.png`));
      }
    }

    // --- d) junta tudo ---------------------------------------------------
    const saida = join(dir, "out.mp4");
    const entradas: string[] = ["-i", entrada, "-framerate", String(fpsCamada), "-i", join(dirCamada, "%05d.png")];
    const cadeia: string[] = [];
    let base = "[0:v]";

    if (usaBorrao) {
      entradas.push("-framerate", String(fpsCamada), "-i", join(dirMascara, "%05d.png"));
      const raio = raioBorraoDe(trilhas, largura, altura);
      // Borrão do quadro INTEIRO + revelado só onde a máscara está branca
      // (`maskedmerge`), em vez do crop+overlay reto de antes. Como a
      // máscara tem borda esfumaçada (ver `texturaBorrao`), a transição
      // pro vídeo nítido ao redor vira gradiente — não o "quadrado" que
      // denunciava edição. E como a posição vem de `caixaEm` (interpolação
      // contínua, a mesma do emoji), acompanha o movimento quadro a quadro
      // em vez de pular a cada bloco de 2s como antes.
      cadeia.push(`[0:v]boxblur=${raio}:2[blur]`);
      cadeia.push(`[2:v]scale=${largura}:${altura},format=gray[mascara]`);
      cadeia.push(`[0:v][blur][mascara]maskedmerge[borrado]`);
      base = "[borrado]";
    }

    cadeia.push(`[1:v]scale=${largura}:${altura}[camada]`);
    cadeia.push(`${base}[camada]overlay=0:0:shortest=1[vout]`);

    await run("ffmpeg", [
      "-y",
      ...entradas,
      "-filter_complex", cadeia.join(";"),
      "-map", "[vout]",
      "-map", "0:a?",
      ...ARGS_SAIDA,
      saida,
    ], 600_000);

    return {
      buffer: await readFile(saida),
      partesEncontradas: trilhas.map((t) => t.part),
      quadrosAmostrados: arquivos.length,
      quadrosComDeteccao,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Transforma as detecções soltas em TRILHAS utilizáveis.
 *
 * A detecção crua não serve para desenhar direto, por três motivos, e cada um
 * exige um tratamento:
 *
 *   • ELA TREME. A caixa varia alguns pixels entre quadros vizinhos, e um
 *     emoji seguindo isso a 30fps vibra. → média móvel de 3 amostras.
 *   • ELA PISCA. Num quadro o modelo acha, no seguinte não — sem nada ter
 *     mudado na cena. Se o emoji sumisse junto, apareceria o que se quer
 *     esconder por uma fração de segundo. → PERSISTÊNCIA: a última posição é
 *     mantida por até 1 segundo.
 *   • ELA DUPLICA. Duas caixas da mesma parte no mesmo quadro. → fica a de
 *     maior score, que é a aposta do próprio modelo.
 *
 * Uma parte só vira trilha se aparecer em pelo menos 3 amostras: uma detecção
 * isolada quase sempre é falso positivo, e um emoji piscando no meio do vídeo
 * é pior que não ter emoji.
 */
function montarTrilhas(
  deteccoes: ({ regions: { part: BodyPart; score: number; x: number; y: number; w: number; h: number }[] } | null)[],
  emojiPorParte: EmojiPorParte,
  fpsAmostra: number,
): Trilha[] {
  const partes = new Set<BodyPart>();
  for (const d of deteccoes) for (const r of d?.regions || []) partes.add(r.part);

  const trilhas: Trilha[] = [];
  const persistencia = Math.round(fpsAmostra); // ~1 segundo

  for (const part of partes) {
    const emoji = emojiPorParte[part];
    if (!emoji) continue; // "Nenhum" para esta parte

    const cruas: (Caixa | null)[] = deteccoes.map((d) => {
      const candidatas = (d?.regions || []).filter((r) => r.part === part);
      if (candidatas.length === 0) return null;
      const melhor = candidatas.reduce((a, b) => (b.score > a.score ? b : a));
      return { x: melhor.x, y: melhor.y, w: melhor.w, h: melhor.h };
    });

    if (cruas.filter(Boolean).length < 3) continue;

    // Persistência: preenche o buraco com a última posição conhecida.
    const cheias: (Caixa | null)[] = [];
    let ultima: Caixa | null = null;
    let desde = 0;
    for (const c of cruas) {
      if (c) {
        ultima = c;
        desde = 0;
        cheias.push(c);
      } else if (ultima && desde < persistencia) {
        desde++;
        cheias.push(ultima);
      } else {
        cheias.push(null);
      }
    }

    // Média móvel de 3, ignorando os vazios.
    const suaves: Amostra[] = cheias.map((c, i) => {
      if (!c) return { t: i / fpsAmostra, caixa: null };
      const janela = [cheias[i - 1], c, cheias[i + 1]].filter(Boolean) as Caixa[];
      const m = (f: (b: Caixa) => number) => janela.reduce((s, b) => s + f(b), 0) / janela.length;
      return {
        t: i / fpsAmostra,
        caixa: { x: m((b) => b.x), y: m((b) => b.y), w: m((b) => b.w), h: m((b) => b.h) },
      };
    });

    trilhas.push({ part, emoji, amostras: suaves });
  }
  return trilhas;
}

/** Posição da trilha num instante, interpolando entre as amostras vizinhas. */
function caixaEm(trilha: Trilha, t: number): Caixa | null {
  const { amostras } = trilha;
  if (amostras.length === 0) return null;
  const passo = amostras.length > 1 ? amostras[1].t - amostras[0].t : 1;
  const i = Math.floor(t / passo);
  const a = amostras[Math.max(0, Math.min(amostras.length - 1, i))];
  const b = amostras[Math.max(0, Math.min(amostras.length - 1, i + 1))];
  if (!a?.caixa) return null;
  if (!b?.caixa) return a.caixa;
  const f = Math.min(1, Math.max(0, (t - a.t) / passo));
  const mix = (p: keyof Caixa) => a.caixa![p] + (b.caixa![p] - a.caixa![p]) * f;
  return { x: mix("x"), y: mix("y"), w: mix("w"), h: mix("h") };
}

/**
 * Textura reutilizável do halo do borrão: um quadrado branco com a borda bem
 * esfumaçada (Gaussian blur), calculada UMA vez e redimensionada por
 * caixa/quadro — mesmo truque do `emojiPng`. É essa borda em gradiente que
 * faz o `maskedmerge` (ver `censurarVideoComEmoji`) revelar o desfoque aos
 * poucos em vez de cortar reto: o corte reto era exatamente o que denunciava
 * a edição a olho nu.
 */
const TEXTURA_BORRAO_CAIXA = 200; // lado da parte "cheia" (branco sólido)
const TEXTURA_BORRAO_HALO = 0.4; // fração da caixa que vira halo, de cada lado
const TEXTURA_BORRAO_CANVAS = Math.round(TEXTURA_BORRAO_CAIXA * (1 + TEXTURA_BORRAO_HALO * 2));
let texturaBorraoCache: Promise<Buffer> | null = null;
function texturaBorrao(): Promise<Buffer> {
  if (!texturaBorraoCache) {
    const pad = Math.round(TEXTURA_BORRAO_CAIXA * TEXTURA_BORRAO_HALO);
    const svg =
      `<svg width="${TEXTURA_BORRAO_CANVAS}" height="${TEXTURA_BORRAO_CANVAS}">` +
      `<rect x="${pad}" y="${pad}" width="${TEXTURA_BORRAO_CAIXA}" height="${TEXTURA_BORRAO_CAIXA}" fill="white"/></svg>`;
    texturaBorraoCache = sharp(Buffer.from(svg)).blur(pad / 2).png().toBuffer();
  }
  return texturaBorraoCache;
}

/**
 * Raio (px) do `boxblur` de quadro inteiro — o maior que qualquer caixa
 * detectada pediria, isolada (mesma conta de antes: lado/6). Usar o maior em
 * vez de um por caixa não custa nada a mais: o `boxblur` roda no quadro
 * inteiro de qualquer jeito, é a MÁSCARA (não o raio) que decide onde o
 * borrão aparece.
 */
function raioBorraoDe(trilhas: Trilha[], largura: number, altura: number): number {
  let maior = 0;
  for (const trilha of trilhas) {
    for (const amostra of trilha.amostras) {
      if (!amostra.caixa) continue;
      maior = Math.max(maior, Math.min(amostra.caixa.w * largura, amostra.caixa.h * altura));
    }
  }
  return Math.min(100, Math.max(10, Math.round(maior / 6)));
}

/**
 * PNG do emoji, do disco.
 *
 * No navegador o emoji é desenhado pela fonte do sistema; no servidor essa
 * fonte não existe (a imagem instala só exiftool e ffmpeg). Por isso os
 * emojis do conjunto curado vêm rasterizados em `public/emoji/`, nomeados
 * pelos codepoints — assim o resultado é o mesmo em qualquer máquina, sem
 * depender de fonte instalada.
 */
const cacheEmoji = new Map<string, Buffer | null>();

async function emojiPng(emoji: string): Promise<Buffer | null> {
  if (cacheEmoji.has(emoji)) return cacheEmoji.get(emoji)!;
  const nome = [...emoji].map((c) => c.codePointAt(0)!.toString(16)).join("-");
  let buf: Buffer | null = null;
  try {
    buf = await readFile(join(process.cwd(), "public", "emoji", `${nome}.png`));
  } catch {
    buf = null;
  }
  cacheEmoji.set(emoji, buf);
  return buf;
}
