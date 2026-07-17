import "server-only";

/**
 * Cliente do microserviço de detecção NudeNet (ver nudenet-service/).
 * Recebe os bytes de uma imagem e devolve as regiões explícitas já
 * mapeadas para as partes do corpo que o app conhece, em coordenadas
 * RELATIVAS (0..1) — independentes da resolução, o front converte para o
 * tamanho do canvas.
 */

import type { BodyPart } from "./bodyParts";
import { getNudenetConfig } from "./settings";

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

/**
 * Resolve URL + token do serviço NudeNet. Prioriza o que foi salvo na UI
 * (Configurações → Conexão com IA); se não houver, cai para as variáveis de
 * ambiente NUDENET_URL / NUDENET_API_KEY. Assim dá para configurar sem
 * redeploy, mas o env continua funcionando.
 */
function resolveService(): { base: string; token?: string } {
  const fromDb = getNudenetConfig();
  if (fromDb) return { base: fromDb.url, token: fromDb.token };

  const base = (process.env.NUDENET_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.NUDENET_API_KEY || "").trim() || undefined;
  if (base) return { base, token };

  throw new Error(
    "Detecção por IA indisponível: em Configurações → Conexão com IA, ative o NudeNet e informe a URL do serviço (ou defina NUDENET_URL no ambiente).",
  );
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
  const { base, token } = resolveService();
  const minScore = opts.minScore ?? 0.3;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(buf)]);
  form.append("file", blob, filename || "image.jpg");

  let res: Response;
  try {
    res = await fetch(`${base}/detect`, {
      method: "POST",
      headers: token ? { "X-API-Key": token } : undefined,
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

/**
 * Testa se o serviço NudeNet está acessível (endpoint /health). Usado pela
 * tela de Configurações. Nunca lança — resolve com {ok,message}.
 */
export async function pingNudenet(
  rawUrl: string,
  token?: string,
): Promise<{ ok: boolean; message?: string }> {
  const base = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!base) return { ok: false, message: "Informe a URL do serviço NudeNet." };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${base}/health`, {
      headers: token ? { "X-API-Key": token } : undefined,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, message: "Token (X-API-Key) inválido." };
    return { ok: false, message: `Serviço respondeu ${res.status}.` };
  } catch (e) {
    return {
      ok: false,
      message: `Não foi possível alcançar ${base}. Verifique a URL e se o serviço está no ar.`,
    };
  }
}
