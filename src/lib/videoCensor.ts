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

    // --- c) desenha a camada de emojis -----------------------------------
    const dirCamada = join(dir, "camada");
    await mkdir(dirCamada, { recursive: true });
    // A camada é montada em MEIA resolução e o ffmpeg amplia na hora de
    // sobrepor: é 4x menos pixel para o sharp compor, e o emoji é uma mancha
    // colorida — ninguém nota a borda um pouco mais macia.
    const escalaCamada = 0.5;
    const lc = Math.round((largura * escalaCamada) / 2) * 2;
    const ac = Math.round((altura * escalaCamada) / 2) * 2;
    const fpsCamada = fpsAmostra; // o ffmpeg repete os quadros até o fps do vídeo
    const totalQuadros = Math.max(1, Math.ceil(duracao * fpsCamada));

    for (let i = 0; i < totalQuadros; i++) {
      const t = i / fpsCamada;
      const composicoes: sharp.OverlayOptions[] = [];
      for (const trilha of trilhas) {
        const caixa = caixaEm(trilha, t);
        if (!caixa) continue;
        const png = await emojiPng(trilha.emoji);
        if (!png) continue;
        const base = Math.max(caixa.w * lc, caixa.h * ac);
        const lado = Math.max(16, Math.round(base * (opts.escalaEmoji ?? 1.45)));
        const cx = Math.round((caixa.x + caixa.w / 2) * lc - lado / 2);
        const cy = Math.round((caixa.y + caixa.h / 2) * ac - lado / 2);
        composicoes.push({
          input: await sharp(png).resize(lado, lado, { fit: "inside" }).png().toBuffer(),
          left: Math.max(0, Math.min(lc - 1, cx)),
          top: Math.max(0, Math.min(ac - 1, cy)),
        });
      }
      const quadro = sharp({
        create: { width: lc, height: ac, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      });
      await quadro
        .composite(composicoes)
        .png()
        .toFile(join(dirCamada, `${String(i + 1).padStart(5, "0")}.png`));
    }

    // --- d) junta tudo ---------------------------------------------------
    const saida = join(dir, "out.mp4");
    const cadeia: string[] = [];
    let atual = "[0:v]";

    if (opts.borrarPorBaixo !== false) {
      // Borrão por baixo, seguindo a trilha em BLOCOS de tempo: para cada
      // bloco, a caixa é a UNIÃO das posições daquele trecho, então o
      // movimento dentro do bloco já está coberto. É o que o operador pediu ao
      // escolher "prefiro o borrão" quando a detecção titubeia — se o emoji
      // sair um pouco fora do lugar, embaixo dele não há nada legível.
      const blocos = blocosDeBorrao(trilhas, duracao);
      blocos.forEach((b, i) => {
        const x = Math.max(0, Math.round(b.caixa.x * largura));
        const y = Math.max(0, Math.round(b.caixa.y * altura));
        const w = Math.max(2, Math.min(largura - x, Math.round(b.caixa.w * largura)));
        const h = Math.max(2, Math.min(altura - y, Math.round(b.caixa.h * altura)));
        const raio = Math.min(100, Math.max(6, Math.round(Math.min(w, h) / 6)));
        cadeia.push(`${atual}split=2[b${i}][p${i}]`);
        cadeia.push(`[p${i}]crop=${w}:${h}:${x}:${y},boxblur=${raio}:2[bl${i}]`);
        cadeia.push(
          `[b${i}][bl${i}]overlay=${x}:${y}:enable='between(t,${b.de.toFixed(2)},${b.ate.toFixed(2)})'[s${i}]`,
        );
        atual = `[s${i}]`;
      });
    }

    cadeia.push(`[1:v]scale=${largura}:${altura}[camada]`);
    cadeia.push(`${atual}[camada]overlay=0:0:shortest=1[vout]`);

    await run("ffmpeg", [
      "-y",
      "-i", entrada,
      "-framerate", String(fpsCamada),
      "-i", join(dirCamada, "%05d.png"),
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
 * Blocos de borrão: um retângulo por trecho de tempo, cobrindo a UNIÃO das
 * posições da trilha naquele trecho.
 *
 * Blocos de 2 segundos são o meio-termo: menos que isso enche o ffmpeg de
 * filtros (cada bloco vira três nós no grafo) e mais que isso faz a caixa
 * crescer demais quando a pessoa se move.
 */
function blocosDeBorrao(
  trilhas: Trilha[],
  duracao: number,
): { de: number; ate: number; caixa: Caixa }[] {
  const BLOCO = 2;
  const saida: { de: number; ate: number; caixa: Caixa }[] = [];
  for (const trilha of trilhas) {
    for (let de = 0; de < duracao; de += BLOCO) {
      const ate = Math.min(duracao, de + BLOCO);
      const dentro = trilha.amostras.filter((a) => a.t >= de && a.t < ate && a.caixa).map((a) => a.caixa!);
      if (dentro.length === 0) continue;
      const x0 = Math.min(...dentro.map((c) => c.x));
      const y0 = Math.min(...dentro.map((c) => c.y));
      const x1 = Math.max(...dentro.map((c) => c.x + c.w));
      const y1 = Math.max(...dentro.map((c) => c.y + c.h));
      // Margem de 15%: a caixa do detector encosta na parte, e o emoji é
      // redondo — sem folga, sobra borda aparecendo nos cantos. Borrar um
      // pouco a mais não custa nada; a menos, custa o motivo de existir.
      const mx = (x1 - x0) * 0.15;
      const my = (y1 - y0) * 0.15;
      saida.push({
        de,
        ate,
        caixa: {
          x: Math.max(0, x0 - mx),
          y: Math.max(0, y0 - my),
          w: Math.min(1, x1 - x0 + mx * 2),
          h: Math.min(1, y1 - y0 + my * 2),
        },
      });
    }
  }
  return saida;
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
