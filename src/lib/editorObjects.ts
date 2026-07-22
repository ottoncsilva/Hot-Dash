// Tipos e helpers de desenho compartilhados entre o editor de fotos e o
// editor de vídeos (PhotoEditor.tsx e VideoEditor.tsx) — mesmos objetos de
// sobreposição (texto, emoji, borrão, caixinha de pergunta) sobre um canvas.
//
// Recursos "pro":
//  - Emojis são desenhados como IMAGEM (Twemoji) — nítidos e idênticos em
//    qualquer dispositivo — com fallback para a fonte do sistema.
//  - Objetos de sobreposição (texto/emoji/pergunta) podem ser ROTACIONADOS.
//  - A caixa de seleção traz alças com ícones: redimensionar, girar e excluir.

export type TextObject = {
  id: string;
  type: "text";
  x: number;
  y: number;
  size: number;
  text: string;
  color: string;
  bg: boolean;
  /** Rotação em radianos (0 = sem rotação). */
  rotation?: number;
};
export type EmojiObject = {
  id: string;
  type: "emoji";
  x: number;
  y: number;
  size: number;
  emoji: string;
  rotation?: number;
};
export type BlurStyle = "blur" | "pixelate";
export type BlurObject = {
  id: string;
  type: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Estilo de ocultação: desfoque (padrão) ou mosaico/pixelizado. */
  style?: BlurStyle;
};
/** Caixinha de pergunta estilo sticker do Instagram — a altura sempre segue
 * do texto (quebrado dentro de `w`), só a largura é redimensionável. */
export type QuestionObject = {
  id: string;
  type: "question";
  x: number;
  y: number;
  w: number;
  question: string;
  rotation?: number;
};
export type EditorObject = TextObject | EmojiObject | BlurObject | QuestionObject;

export const TEXT_COLORS = [
  "#ffffff",
  "#000000",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

// Alvo de toque (em px de tela) das alças de manipulação (-30% do valor
// original: menos sobreposição com o corpo do objeto, ex. um emoji pequeno).
export const HANDLE_SCREEN_PX = 24;
// Raio visual das alças (em px de tela; -30% do valor original).
export const HANDLE_RADIUS_SCREEN = 9;
// Distância (px de tela) da alça de girar acima da borda superior.
export const ROTATE_OFFSET_SCREEN = 34;
// Margem (em coordenadas do canvas) que a área clicável ganha além do
// contorno exato do objeto.
export const HIT_PADDING = 10;

export const QUESTION_TITLE = "Faça uma pergunta";
export const QUESTION_PLACEHOLDER = "Digite algo...";

// ---------------------------------------------------------------------------
// Emojis como imagem (Twemoji) — nítidos e idênticos em todo lugar.
// ---------------------------------------------------------------------------

// Fork mantido do Twemoji (SVG). Servido com CORS (Access-Control-Allow-Origin
// *), então o canvas NÃO fica "tainted" e a exportação (toBlob) funciona.
const EMOJI_ASSET_BASE =
  "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/";

// Converte o emoji nos codepoints usados pelo Twemoji no nome do arquivo.
// Regra do Twemoji: remove o seletor de variação U+FE0F, exceto quando o
// emoji é uma sequência ZWJ (U+200D).
function twemojiCodePoints(emoji: string): string {
  const hasZwj = emoji.indexOf("‍") >= 0;
  const cleaned = hasZwj ? emoji : emoji.replace(/️/g, "");
  const points: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const code = cleaned.codePointAt(i)!;
    points.push(code.toString(16));
    i += code > 0xffff ? 2 : 1;
  }
  return points.join("-");
}

// undefined = ainda não pedido; HTMLImageElement = carregando/pronto; null = falhou.
const emojiImgCache = new Map<string, HTMLImageElement | null>();
const emojiPendingListener = new WeakSet<HTMLImageElement>();

function ensureEmojiImage(emoji: string): HTMLImageElement | null {
  if (emojiImgCache.has(emoji)) return emojiImgCache.get(emoji)!;
  if (typeof window === "undefined") return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onerror = () => emojiImgCache.set(emoji, null);
  img.src = `${EMOJI_ASSET_BASE}${twemojiCodePoints(emoji)}.svg`;
  emojiImgCache.set(emoji, img);
  return img;
}

/**
 * Devolve a imagem do emoji se já estiver pronta para desenhar; senão inicia
 * o carregamento e chama `onLoad` (uma vez) quando ficar pronta, para o
 * componente re-renderizar. Retorna null quando não há imagem pronta (o
 * chamador deve cair no fallback de fonte).
 */
export function getEmojiImageForDraw(
  emoji: string,
  onLoad: () => void,
): HTMLImageElement | null {
  const img = ensureEmojiImage(emoji);
  if (!img) return null; // falhou → fallback
  if (img.complete && img.naturalWidth > 0) return img;
  if (!emojiPendingListener.has(img)) {
    emojiPendingListener.add(img);
    img.addEventListener(
      "load",
      () => {
        emojiPendingListener.delete(img);
        onLoad();
      },
      { once: true },
    );
  }
  return null;
}

/** Pré-carrega as imagens dos emojis dos objetos (usado antes de exportar,
 *  para o PNG sair com os emojis nítidos e não o fallback). */
export function preloadEmojiImages(objects: EditorObject[]): Promise<void> {
  const uniq = Array.from(
    new Set(
      objects
        .filter((o): o is EmojiObject => o.type === "emoji")
        .map((o) => o.emoji),
    ),
  );
  return Promise.all(
    uniq.map(
      (e) =>
        new Promise<void>((resolve) => {
          const img = ensureEmojiImage(e);
          if (!img || img.complete) return resolve();
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Geometria / texto
// ---------------------------------------------------------------------------

export function rotationOf(o: EditorObject): number {
  return "rotation" in o && typeof o.rotation === "number" ? o.rotation : 0;
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${current} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Layout em duas camadas, como o sticker de pergunta do Instagram: título
 * fixo em negrito no topo, e abaixo uma pílula cinza separada com a
 * pergunta digitada (ou o placeholder, quando vazia).
 */
export function measureQuestionBox(ctx: CanvasRenderingContext2D, o: QuestionObject) {
  const outerPad = o.w * 0.07;
  const titleSize = Math.max(12, o.w * 0.052);
  const titleHeight = titleSize * 1.3;
  const gap = titleSize * 0.55;
  const pillPadX = o.w * 0.05;
  const pillPadY = o.w * 0.035;
  const qSize = Math.max(11, o.w * 0.042);
  const pillWidth = o.w - outerPad * 2;
  const hasQuestion = Boolean(o.question && o.question.trim());
  ctx.font = `600 ${qSize}px sans-serif`;
  const lines = wrapText(ctx, hasQuestion ? o.question : QUESTION_PLACEHOLDER, pillWidth - pillPadX * 2);
  const lineHeight = qSize * 1.3;
  const pillHeight = pillPadY * 2 + lines.length * lineHeight;
  const h = outerPad + titleHeight + gap + pillHeight + outerPad;
  return {
    outerPad,
    titleSize,
    titleHeight,
    gap,
    pillPadX,
    pillPadY,
    qSize,
    pillWidth,
    lines,
    lineHeight,
    pillHeight,
    hasQuestion,
    h,
  };
}

export function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Caixa (não rotacionada) que envolve o objeto, ancorada no seu x/y. */
export function computeBounds(ctx: CanvasRenderingContext2D, o: EditorObject) {
  if (o.type === "blur") return { x: o.x, y: o.y, w: o.w, h: o.h };
  if (o.type === "emoji") return { x: o.x, y: o.y, w: o.size, h: o.size };
  if (o.type === "question") {
    const { h } = measureQuestionBox(ctx, o);
    return { x: o.x, y: o.y, w: o.w, h };
  }
  ctx.font = `700 ${o.size}px sans-serif`;
  const w = ctx.measureText(o.text || " ").width;
  return { x: o.x, y: o.y, w: Math.max(w, o.size * 0.5), h: o.size };
}

export function centerOf(b: { x: number; y: number; w: number; h: number }) {
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

/** Converte um ponto do mundo para o referencial LOCAL do objeto (centrado
 *  no centro do objeto e desrotacionado). */
export function toLocalPoint(
  b: { x: number; y: number; w: number; h: number },
  rotation: number,
  x: number,
  y: number,
) {
  const { cx, cy } = centerOf(b);
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return { lx: dx * cos + dy * sin, ly: -dx * sin + dy * cos };
}

// ---------------------------------------------------------------------------
// Alças de manipulação (com ícone)
// ---------------------------------------------------------------------------

type HandleKind = "resize" | "rotate" | "delete" | "move";

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: HandleKind,
  r: number,
) {
  ctx.save();
  ctx.translate(x, y);
  // Corpo do botão
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 2 * Math.PI);
  ctx.fillStyle =
    kind === "resize"
      ? "#10b981"
      : kind === "rotate"
        ? "#3b82f6"
        : kind === "move"
          ? "#f59e0b"
          : "#ef4444";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  // Ícone
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = r * 0.5;
  if (kind === "delete") {
    ctx.beginPath();
    ctx.moveTo(-s, -s);
    ctx.lineTo(s, s);
    ctx.moveTo(s, -s);
    ctx.lineTo(-s, s);
    ctx.stroke();
  } else if (kind === "resize") {
    // Seta diagonal dupla (↘ / ↖)
    ctx.beginPath();
    ctx.moveTo(-s, -s);
    ctx.lineTo(s, s);
    ctx.stroke();
    const a = r * 0.34;
    ctx.beginPath();
    ctx.moveTo(s, s);
    ctx.lineTo(s - a, s);
    ctx.moveTo(s, s);
    ctx.lineTo(s, s - a);
    ctx.moveTo(-s, -s);
    ctx.lineTo(-s + a, -s);
    ctx.moveTo(-s, -s);
    ctx.lineTo(-s, -s + a);
    ctx.stroke();
  } else if (kind === "rotate") {
    // Girar: arco com ponta de seta
    ctx.beginPath();
    ctx.arc(0, 0, s, Math.PI * 0.75, Math.PI * 2.15);
    ctx.stroke();
    const ex = s * Math.cos(Math.PI * 2.15);
    const ey = s * Math.sin(Math.PI * 2.15);
    const a = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - a, ey - a * 0.2);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + a * 0.2, ey - a);
    ctx.stroke();
  } else {
    // Mover: cruz com pontas de seta nas 4 direções.
    const a = r * 0.28;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(0, s);
    ctx.moveTo(0, -s);
    ctx.lineTo(-a, -s + a);
    ctx.moveTo(0, -s);
    ctx.lineTo(a, -s + a);
    ctx.moveTo(0, s);
    ctx.lineTo(-a, s - a);
    ctx.moveTo(0, s);
    ctx.lineTo(a, s - a);
    ctx.moveTo(-s, 0);
    ctx.lineTo(s, 0);
    ctx.moveTo(-s, 0);
    ctx.lineTo(-s + a, -a);
    ctx.moveTo(-s, 0);
    ctx.lineTo(-s + a, a);
    ctx.moveTo(s, 0);
    ctx.lineTo(s - a, -a);
    ctx.moveTo(s, 0);
    ctx.lineTo(s - a, a);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; w: number; h: number },
  rotation: number,
  scale: number,
  opts?: { handles?: boolean },
) {
  const showHandles = opts?.handles !== false;
  const { cx, cy } = centerOf(b);
  const lx = -b.w / 2;
  const ly = -b.h / 2;
  const r = HANDLE_RADIUS_SCREEN * scale;
  const rotOffset = ROTATE_OFFSET_SCREEN * scale;

  ctx.save();
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate(rotation);

  // Contorno: preto por baixo + branco tracejado por cima (contraste em
  // qualquer fundo).
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 4 * scale;
  ctx.setLineDash([]);
  ctx.strokeRect(lx, ly, b.w, b.h);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * scale;
  ctx.setLineDash([7 * scale, 5 * scale]);
  ctx.strokeRect(lx, ly, b.w, b.h);
  ctx.setLineDash([]);

  if (showHandles) {
    // Haste da alça de girar
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(0, ly - rotOffset);
    ctx.stroke();

    drawHandle(ctx, 0, ly - rotOffset, "rotate", r);
    drawHandle(ctx, lx + b.w, ly + b.h, "resize", r);
    drawHandle(ctx, lx, ly, "delete", r);
    drawHandle(ctx, lx, ly + b.h, "move", r);
  }

  ctx.restore();
}

// Posições das alças no referencial LOCAL (centrado).
function handlePositions(b: { w: number; h: number }, scale: number) {
  const rotOffset = ROTATE_OFFSET_SCREEN * scale;
  return {
    resize: { lx: b.w / 2, ly: b.h / 2 },
    rotate: { lx: 0, ly: -b.h / 2 - rotOffset },
    delete: { lx: -b.w / 2, ly: -b.h / 2 },
    move: { lx: -b.w / 2, ly: b.h / 2 },
  };
}

function nearLocal(
  b: { x: number; y: number; w: number; h: number },
  rotation: number,
  x: number,
  y: number,
  target: { lx: number; ly: number },
  tol: number,
): boolean {
  const { lx, ly } = toLocalPoint(b, rotation, x, y);
  return Math.hypot(lx - target.lx, ly - target.ly) <= tol;
}

export function hitResizeHandle(
  ctx: CanvasRenderingContext2D,
  o: EditorObject,
  x: number,
  y: number,
  scaleX: number,
): boolean {
  const b = computeBounds(ctx, o);
  const tol = HANDLE_SCREEN_PX * scaleX;
  return nearLocal(b, rotationOf(o), x, y, handlePositions(b, scaleX).resize, tol);
}

export function hitRotateHandle(
  ctx: CanvasRenderingContext2D,
  o: EditorObject,
  x: number,
  y: number,
  scaleX: number,
): boolean {
  const b = computeBounds(ctx, o);
  const tol = HANDLE_SCREEN_PX * scaleX;
  return nearLocal(b, rotationOf(o), x, y, handlePositions(b, scaleX).rotate, tol);
}

export function hitDeleteHandle(
  ctx: CanvasRenderingContext2D,
  o: EditorObject,
  x: number,
  y: number,
  scaleX: number,
): boolean {
  const b = computeBounds(ctx, o);
  const tol = HANDLE_SCREEN_PX * scaleX;
  return nearLocal(b, rotationOf(o), x, y, handlePositions(b, scaleX).delete, tol);
}

/** Alça dedicada de ARRASTAR (canto inferior-esquerdo) — evita depender só
 *  de clicar no corpo do objeto, que em objetos pequenos (ex. emoji) ficava
 *  perto demais da alça de excluir e causava exclusão acidental ao arrastar. */
export function hitMoveHandle(
  ctx: CanvasRenderingContext2D,
  o: EditorObject,
  x: number,
  y: number,
  scaleX: number,
): boolean {
  const b = computeBounds(ctx, o);
  const tol = HANDLE_SCREEN_PX * scaleX;
  return nearLocal(b, rotationOf(o), x, y, handlePositions(b, scaleX).move, tol);
}

// ---------------------------------------------------------------------------
// Desenho dos objetos
// ---------------------------------------------------------------------------

function withTransform(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; w: number; h: number },
  rotation: number,
  fn: () => void,
) {
  const { cx, cy } = centerOf(b);
  ctx.save();
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate(rotation);
  fn();
  ctx.restore();
}

/**
 * Desenha as áreas borradas/pixelizadas amostrando o conteúdo já pintado no
 * canvas (imagem estática ou quadro de vídeo — o quadro base já foi
 * desenhado antes desta chamada). Áreas de censura são sempre alinhadas aos
 * eixos (sem rotação).
 */
export function drawBlurObjects(
  ctx: CanvasRenderingContext2D,
  objects: EditorObject[],
  selectedId: string | null,
  forExport: boolean,
  scale = 1,
) {
  const canvas = ctx.canvas;
  for (const o of objects) {
    if (o.type !== "blur") continue;
    const w = Math.max(1, Math.round(o.w));
    const h = Math.max(1, Math.round(o.h));

    if (o.style === "pixelate") {
      // Mosaico: reduz a região a poucos blocos e reamplia sem suavizar.
      const blocks = Math.max(6, Math.round(Math.min(w, h) / 22));
      const bw = Math.max(1, Math.round((blocks * w) / Math.max(w, h)));
      const bh = Math.max(1, Math.round((blocks * h) / Math.max(w, h)));
      const off = document.createElement("canvas");
      off.width = bw;
      off.height = bh;
      const octx = off.getContext("2d");
      if (octx) {
        octx.imageSmoothingEnabled = false;
        octx.drawImage(canvas, o.x, o.y, w, h, 0, 0, bw, bh);
        const prev = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, bw, bh, o.x, o.y, w, h);
        ctx.imageSmoothingEnabled = prev;
      }
    } else {
      // Desfoque forte e proporcional ao tamanho da área.
      const radius = Math.min(60, Math.max(10, Math.min(w, h) * 0.2));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const octx = off.getContext("2d");
      if (octx) {
        octx.filter = `blur(${radius}px)`;
        const pad = Math.ceil(radius);
        octx.drawImage(
          canvas,
          o.x - pad,
          o.y - pad,
          w + pad * 2,
          h + pad * 2,
          -pad,
          -pad,
          w + pad * 2,
          h + pad * 2,
        );
        ctx.drawImage(off, o.x, o.y);
      }
    }

    if (!forExport && selectedId === o.id) {
      drawSelectionBox(ctx, computeBounds(ctx, o), 0, scale);
    }
  }
}

/** Desenha texto, emoji e a caixinha de pergunta (sem a área borrada). */
export function drawOverlayObjects(
  ctx: CanvasRenderingContext2D,
  objects: EditorObject[],
  selectedId: string | null,
  forExport: boolean,
  scale = 1,
  onEmojiLoad?: () => void,
) {
  for (const o of objects) {
    if (o.type === "blur") continue;
    const b = computeBounds(ctx, o);
    const rotation = rotationOf(o);

    withTransform(ctx, b, rotation, () => {
      if (o.type === "text") {
        const lx = -b.w / 2;
        const ly = -b.h / 2;
        ctx.font = `700 ${o.size}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const tw = ctx.measureText(o.text || "").width;
        if (o.bg) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(lx - o.size * 0.15, ly - o.size * 0.08, tw + o.size * 0.3, o.size * 1.2);
        }
        ctx.lineWidth = Math.max(2, o.size * 0.08);
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.strokeText(o.text || "", lx, ly);
        ctx.fillStyle = o.color;
        ctx.fillText(o.text || "", lx, ly);
      } else if (o.type === "emoji") {
        const img = onEmojiLoad ? getEmojiImageForDraw(o.emoji, onEmojiLoad) : null;
        if (img) {
          ctx.drawImage(img, -o.size / 2, -o.size / 2, o.size, o.size);
        } else {
          ctx.font = `${o.size * 0.92}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(o.emoji, 0, o.size * 0.03);
        }
      } else if (o.type === "question") {
        const m = measureQuestionBox(ctx, o);
        const lx = -o.w / 2;
        const ly = -m.h / 2;

        drawRoundRect(ctx, lx, ly, o.w, m.h, Math.min(20, o.w * 0.05));
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        ctx.fillStyle = "#050505";
        ctx.font = `700 ${m.titleSize}px sans-serif`;
        ctx.fillText(QUESTION_TITLE, 0, ly + m.outerPad);

        const pillY = ly + m.outerPad + m.titleHeight + m.gap;
        drawRoundRect(ctx, lx + m.outerPad, pillY, m.pillWidth, m.pillHeight, Math.min(m.pillHeight / 2, o.w * 0.035));
        ctx.fillStyle = "#e4e4e7";
        ctx.fill();

        ctx.fillStyle = m.hasQuestion ? "#18181b" : "#71717a";
        ctx.font = `600 ${m.qSize}px sans-serif`;
        let ty = pillY + m.pillPadY;
        for (const line of m.lines) {
          ctx.fillText(line, 0, ty);
          ty += m.lineHeight;
        }
      }
    });

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    if (!forExport && selectedId === o.id) {
      drawSelectionBox(ctx, b, rotation, scale);
    }
  }
}

export function hitTestObjects(
  ctx: CanvasRenderingContext2D,
  objects: EditorObject[],
  x: number,
  y: number,
): EditorObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    const b = computeBounds(ctx, o);
    const { lx, ly } = toLocalPoint(b, rotationOf(o), x, y);
    if (
      Math.abs(lx) <= b.w / 2 + HIT_PADDING &&
      Math.abs(ly) <= b.h / 2 + HIT_PADDING
    ) {
      return o;
    }
  }
  return null;
}
