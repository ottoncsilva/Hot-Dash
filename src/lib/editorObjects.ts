// Tipos e helpers de desenho compartilhados entre o editor de fotos e o
// editor de vídeos (PhotoEditor.tsx e VideoEditor.tsx) — mesmos objetos de
// sobreposição (texto, emoji, borrão, caixinha de pergunta) sobre um canvas.

export type TextObject = {
  id: string;
  type: "text";
  x: number;
  y: number;
  size: number;
  text: string;
  color: string;
  bg: boolean;
};
export type EmojiObject = {
  id: string;
  type: "emoji";
  x: number;
  y: number;
  size: number;
  emoji: string;
};
export type BlurObject = {
  id: string;
  type: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
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

// Alvo de toque maior (mobile) para a alça de redimensionar.
export const HANDLE_SCREEN_PX = 34;
// Margem (em coordenadas do canvas) que a área clicável ganha além do
// contorno exato do objeto — bate com a margem visual do tracejado de
// seleção, para "selecionar" não parecer mais difícil do que "ver selecionado".
export const HIT_PADDING = 10;

export const QUESTION_TITLE = "Faça uma pergunta";
export const QUESTION_PLACEHOLDER = "Digite algo...";

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

export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; w: number; h: number },
) {
  ctx.save();
  // Borda pontilhada branca e preta para dar contraste em fundos claros e escuros
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.lineWidth = 4;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  
  // Alça superior esquerda (Movimentar)
  const rMove = 8;
  ctx.beginPath();
  ctx.arc(b.x, b.y, rMove, 0, 2 * Math.PI);
  ctx.fillStyle = "#3b82f6"; // Azul para mover
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Alça inferior direita (Redimensionar)
  const rResize = 10;
  ctx.beginPath();
  ctx.arc(b.x + b.w, b.y + b.h, rResize, 0, 2 * Math.PI);
  ctx.fillStyle = "#10b981"; // Verde para redimensionar
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

/**
 * Desenha as áreas borradas amostrando o próprio conteúdo já pintado no
 * canvas (funciona tanto para uma imagem estática quanto para um quadro de
 * vídeo — em ambos os casos o quadro base já foi desenhado no canvas antes
 * desta chamada).
 */
export function drawBlurObjects(
  ctx: CanvasRenderingContext2D,
  objects: EditorObject[],
  selectedId: string | null,
  forExport: boolean,
) {
  const canvas = ctx.canvas;
  for (const o of objects) {
    if (o.type !== "blur") continue;
    const w = Math.max(1, Math.round(o.w));
    const h = Math.max(1, Math.round(o.h));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const octx = off.getContext("2d");
    if (octx) {
      octx.filter = "blur(16px)";
      octx.drawImage(canvas, o.x, o.y, w, h, -16, -16, w + 32, h + 32);
      ctx.drawImage(off, o.x, o.y);
    }
    if (!forExport && selectedId === o.id) drawSelectionBox(ctx, computeBounds(ctx, o));
  }
}

/** Desenha texto, emoji e a caixinha de pergunta (sem a área borrada). */
export function drawOverlayObjects(
  ctx: CanvasRenderingContext2D,
  objects: EditorObject[],
  selectedId: string | null,
  forExport: boolean,
) {
  for (const o of objects) {
    if (o.type === "text") {
      ctx.font = `700 ${o.size}px sans-serif`;
      ctx.textBaseline = "top";
      const w = ctx.measureText(o.text || "").width;
      if (o.bg) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(
          o.x - o.size * 0.15,
          o.y - o.size * 0.08,
          w + o.size * 0.3,
          o.size * 1.2,
        );
      }
      ctx.lineWidth = Math.max(2, o.size * 0.08);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(o.text || "", o.x, o.y);
      ctx.fillStyle = o.color;
      ctx.fillText(o.text || "", o.x, o.y);
    } else if (o.type === "emoji") {
      ctx.font = `${o.size}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      // Centraliza perfeitamente no container w/h = size/size
      ctx.fillText(o.emoji, o.x + o.size / 2, o.y + o.size / 2 + o.size * 0.05); // pequeno ajuste de centro visual
      ctx.textAlign = "left";
    } else if (o.type === "question") {
      const {
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
      } = measureQuestionBox(ctx, o);

      // Caixa branca externa
      drawRoundRect(ctx, o.x, o.y, o.w, h, Math.min(20, o.w * 0.05));
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      // Título fixo, em negrito, centralizado
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      ctx.fillStyle = "#050505";
      ctx.font = `700 ${titleSize}px sans-serif`;
      ctx.fillText(QUESTION_TITLE, o.x + o.w / 2, o.y + outerPad);

      // Pílula cinza separada com a pergunta (ou o placeholder), texto centralizado
      const pillY = o.y + outerPad + titleHeight + gap;
      drawRoundRect(ctx, o.x + outerPad, pillY, pillWidth, pillHeight, Math.min(pillHeight / 2, o.w * 0.035));
      ctx.fillStyle = "#e4e4e7";
      ctx.fill();

      ctx.fillStyle = hasQuestion ? "#18181b" : "#71717a";
      ctx.font = `600 ${qSize}px sans-serif`;
      const pillCenterX = o.x + outerPad + pillWidth / 2;
      let ty = pillY + pillPadY;
      for (const line of lines) {
        ctx.fillText(line, pillCenterX, ty);
        ty += lineHeight;
      }
      ctx.textAlign = "left";
    }
    if (!forExport && selectedId === o.id) drawSelectionBox(ctx, computeBounds(ctx, o));
    ctx.textAlign = "left";
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
    if (
      x >= b.x - HIT_PADDING &&
      x <= b.x + b.w + HIT_PADDING &&
      y >= b.y - HIT_PADDING &&
      y <= b.y + b.h + HIT_PADDING
    )
      return o;
  }
  return null;
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
  return x >= b.x + b.w - tol && x <= b.x + b.w + tol && y >= b.y + b.h - tol && y <= b.y + b.h + tol;
}
