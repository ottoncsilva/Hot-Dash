import "server-only";

/**
 * Motor de detecção NudeNet rodando DENTRO do próprio app (Node), sem
 * microserviço externo. Usa o modelo ONNX 320n (o mesmo do pacote oficial
 * `nudenet`) via onnxruntime-node e faz o pré/pós-processamento com sharp.
 *
 * Portado 1:1 do pipeline oficial (notAI-tech/NudeNet, v3):
 *  - pré: pad para quadrado (canto superior-esquerdo, preto) → resize 320×320,
 *    canais RGB, float32 CHW normalizado por 1/255;
 *  - inferência: saída [1, 22, N] (4 bbox + 18 scores de classe, YOLOv8);
 *  - pós: score >= 0.2, escala de volta ao tamanho original, NMS (0.25 / 0.45).
 *
 * O modelo é carregado uma única vez (singleton) e reaproveitado — como o
 * detector do serviço Python.
 */

import { join } from "node:path";
// Tipos vêm da nossa declaração ambiente (src/types/onnxruntime-node.d.ts);
// a lib em si é carregada via import() dinâmico (server-only).
import type { InferenceSession } from "onnxruntime-node";

const MODEL_SIZE = 320;
// Ordem oficial das 18 classes do modelo 320n (índice = class_id).
const LABELS = [
  "FEMALE_GENITALIA_COVERED",
  "FACE_FEMALE",
  "BUTTOCKS_EXPOSED",
  "FEMALE_BREAST_EXPOSED",
  "FEMALE_GENITALIA_EXPOSED",
  "MALE_BREAST_EXPOSED",
  "ANUS_EXPOSED",
  "FEET_EXPOSED",
  "BELLY_COVERED",
  "FEET_COVERED",
  "ARMPITS_COVERED",
  "ARMPITS_EXPOSED",
  "FACE_MALE",
  "BELLY_EXPOSED",
  "MALE_GENITALIA_EXPOSED",
  "ANUS_COVERED",
  "FEMALE_BREAST_COVERED",
  "BUTTOCKS_COVERED",
] as const;

export type RawLocalDetection = {
  label: string;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LocalDetectResult = {
  width: number;
  height: number;
  detections: RawLocalDetection[];
};

// --- carregamento preguiçoso e único da sessão ONNX -------------------------

let sessionPromise: Promise<InferenceSession> | null = null;

function modelPath(): string {
  // Permite sobrescrever o caminho do modelo (útil em testes); por padrão
  // procura em <cwd>/models/320n.onnx (copiado para a imagem Docker).
  return process.env.NUDENET_MODEL_PATH || join(process.cwd(), "models", "320n.onnx");
}

async function getSession(): Promise<InferenceSession> {
  if (!sessionPromise) {
    const p = (async () => {
      const ort = await import("onnxruntime-node");
      return ort.InferenceSession.create(modelPath(), {
        // A detecção não precisa de muito paralelismo; mantém o uso de CPU
        // previsível quando o app roda junto no mesmo container.
        intraOpNumThreads: 1,
        graphOptimizationLevel: "all",
      });
    })().catch((e) => {
      // Zera para permitir nova tentativa numa próxima chamada.
      sessionPromise = null;
      throw e;
    });
    sessionPromise = p;
  }
  return sessionPromise;
}

/**
 * Indica se o motor local está disponível (modelo presente). Nunca lança.
 */
export async function localEngineAvailable(): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(modelPath());
    return true;
  } catch {
    return false;
  }
}

// --- pré-processamento (sharp) ---------------------------------------------

async function preprocess(buf: Buffer): Promise<{
  input: Float32Array;
  origW: number;
  origH: number;
  maxSize: number;
}> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buf).metadata();
  const origW = meta.width || 0;
  const origH = meta.height || 0;
  if (!origW || !origH) throw new Error("Imagem inválida ou não suportada.");
  const maxSize = Math.max(origW, origH);

  // Equivalente a: copyMakeBorder(top-left, preto) para quadrado + resize 320.
  // `fit: "contain"` preserva a proporção; `position: "left top"` ancora no
  // canto superior-esquerdo (padding vai para baixo/direita); fundo preto.
  const { data } = await sharp(buf)
    .resize(MODEL_SIZE, MODEL_SIZE, {
      fit: "contain",
      position: "left top",
      background: { r: 0, g: 0, b: 0 },
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // data é HWC (RGB, uint8). Converte para CHW float32 normalizado por 1/255.
  const plane = MODEL_SIZE * MODEL_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    input[i] = r; // canal 0 (R)
    input[plane + i] = g; // canal 1 (G)
    input[2 * plane + i] = b; // canal 2 (B)
  }
  return { input, origW, origH, maxSize };
}

// --- pós-processamento ------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number };

function iou(a: Box, b: Box): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix = Math.max(a.x, b.x);
  const iy = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix);
  const ih = Math.max(0, iy2 - iy);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * NMS greedy equivalente ao cv2.dnn.NMSBoxes(boxes, scores, 0.25, 0.45):
 * descarta caixas com score < scoreThreshold e, por ordem decrescente de
 * score, remove as que têm IOU > iouThreshold com uma já mantida.
 */
function nms(
  boxes: Box[],
  scores: number[],
  scoreThreshold: number,
  iouThreshold: number,
): number[] {
  const idx = boxes
    .map((_, i) => i)
    .filter((i) => scores[i] >= scoreThreshold)
    .sort((a, b) => scores[b] - scores[a]);
  const keep: number[] = [];
  const removed = new Set<number>();
  for (const i of idx) {
    if (removed.has(i)) continue;
    keep.push(i);
    for (const j of idx) {
      if (j === i || removed.has(j)) continue;
      if (iou(boxes[i], boxes[j]) > iouThreshold) removed.add(j);
    }
  }
  return keep;
}

function postprocess(
  output: Float32Array,
  dims: readonly number[],
  origW: number,
  origH: number,
  maxSize: number,
): RawLocalDetection[] {
  // output: [1, 22, N] (canais na dim 1, âncoras na dim 2).
  const channels = dims[1]; // 22
  const anchors = dims[2]; // N
  const scale = maxSize / MODEL_SIZE;

  const boxes: Box[] = [];
  const scores: number[] = [];
  const classIds: number[] = [];

  for (let a = 0; a < anchors; a++) {
    // Encontra a classe de maior score para esta âncora (canais 4..21).
    let maxScore = 0;
    let classId = 0;
    for (let c = 4; c < channels; c++) {
      const s = output[c * anchors + a];
      if (s > maxScore) {
        maxScore = s;
        classId = c - 4;
      }
    }
    if (maxScore < 0.2) continue;

    const cx = output[0 * anchors + a];
    const cy = output[1 * anchors + a];
    const bw = output[2 * anchors + a];
    const bh = output[3 * anchors + a];

    // centro → canto e escala de volta ao tamanho original.
    let x = (cx - bw / 2) * scale;
    let y = (cy - bh / 2) * scale;
    let w = bw * scale;
    let h = bh * scale;

    // clip às bordas da imagem original.
    x = Math.max(0, Math.min(x, origW));
    y = Math.max(0, Math.min(y, origH));
    w = Math.min(w, origW - x);
    h = Math.min(h, origH - y);

    boxes.push({ x, y, w, h });
    scores.push(maxScore);
    classIds.push(classId);
  }

  const keep = nms(boxes, scores, 0.25, 0.45);
  return keep.map((i) => ({
    label: LABELS[classIds[i]],
    score: scores[i],
    x: Math.round(boxes[i].x),
    y: Math.round(boxes[i].y),
    w: Math.round(boxes[i].w),
    h: Math.round(boxes[i].h),
  }));
}

// --- API pública ------------------------------------------------------------

/**
 * Detecta partes explícitas numa imagem, in-process. Devolve caixas em
 * PIXELS da imagem original (mesmo formato do serviço HTTP /detect).
 */
export async function detectLocal(buf: Buffer): Promise<LocalDetectResult> {
  const { input, origW, origH, maxSize } = await preprocess(buf);
  const session = await getSession();
  const ort = await import("onnxruntime-node");
  const tensor = new ort.Tensor("float32", input, [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const inputName = session.inputNames[0];
  const out = await session.run({ [inputName]: tensor });
  const outName = session.outputNames[0];
  const outTensor = out[outName];
  const data = outTensor.data as Float32Array;
  const detections = postprocess(data, outTensor.dims, origW, origH, maxSize);
  return { width: origW, height: origH, detections };
}
