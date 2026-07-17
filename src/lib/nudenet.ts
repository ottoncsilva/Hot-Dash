import "server-only";

/**
 * Cliente do microserviço de detecção NudeNet (ver nudenet-service/).
 * Recebe os bytes de uma imagem e devolve as regiões explícitas já
 * mapeadas para as partes do corpo que o app conhece, em coordenadas
 * RELATIVAS (0..1) — independentes da resolução, o front converte para o
 * tamanho do canvas.
 */

import type { BodyPart } from "./bodyParts";

export type { BodyPart } from "./bodyParts";
export { BODY_PARTS, BODY_PART_LABELS, DEFAULT_PART_EMOJI } from "./bodyParts";

// Rótulos do NudeNet (v3) → parte do corpo. Só os "EXPOSED" interessam;
// as versões "COVERED" (partes cobertas por roupa) são ignoradas.
const LABEL_TO_PART: Record<string, BodyPart> = {
  FEMALE_BREAST_EXPOSED: "seios",
  FEMALE_GENITALIA_EXPOSED: "vagina",
  MALE_GENITALIA_EXPOSED: "penis",
  BUTTOCKS_EXPOSED: "bunda",
  ANUS_EXPOSED: "anus",
};

export type DetectedRegion = {
  part: BodyPart;
  score: number;
  /** Caixa em coordenadas relativas (0..1) da imagem. */
  x: number;
  y: number;
  w: number;
  h: number;
};

type RawDetection = {
  label: string;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DetectResult = {
  regions: DetectedRegion[];
  imageWidth: number;
  imageHeight: number;
};

function serviceUrl(): string {
  const url = (process.env.NUDENET_URL || "").trim().replace(/\/+$/, "");
  if (!url) {
    throw new Error(
      "Detecção por IA indisponível: configure NUDENET_URL apontando para o serviço NudeNet.",
    );
  }
  return url;
}

/**
 * Detecta regiões explícitas numa imagem.
 *
 * @param buf      bytes da imagem
 * @param filename nome do arquivo (só para a extensão)
 * @param opts.minScore filtra detecções abaixo desse score (sensibilidade)
 */
export async function detectExplicitRegions(
  buf: Buffer,
  filename: string,
  opts: { minScore?: number } = {},
): Promise<DetectResult> {
  const base = serviceUrl();
  const apiKey = (process.env.NUDENET_API_KEY || "").trim();
  const minScore = opts.minScore ?? 0.3;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(buf)]);
  form.append("file", blob, filename || "image.jpg");

  let res: Response;
  try {
    res = await fetch(`${base}/detect`, {
      method: "POST",
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      body: form,
    });
  } catch (e) {
    throw new Error(
      `Não foi possível falar com o serviço de detecção (${base}). ${
        e instanceof Error ? e.message : ""
      }`.trim(),
    );
  }

  const data = (await res.json().catch(() => ({}))) as {
    detections?: RawDetection[];
    width?: number;
    height?: number;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.detail || `Serviço de detecção retornou erro ${res.status}.`);
  }

  const iw = Math.max(1, data.width || 1);
  const ih = Math.max(1, data.height || 1);

  const regions = (data.detections || [])
    .map((d): DetectedRegion | null => {
      const part = LABEL_TO_PART[d.label];
      if (!part) return null;
      if (d.score < minScore) return null;
      return {
        part,
        score: d.score,
        x: d.x / iw,
        y: d.y / ih,
        w: d.w / iw,
        h: d.h / ih,
      };
    })
    .filter((r): r is DetectedRegion => r !== null);

  return { regions, imageWidth: iw, imageHeight: ih };
}
