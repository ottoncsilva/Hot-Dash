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
 * Resolve URL + token de um serviço NudeNet EXTERNO, se houver. Prioriza o que
 * foi salvo na UI (Configurações → Conexão com IA); se não houver, cai para as
 * variáveis de ambiente NUDENET_URL / NUDENET_API_KEY.
 *
 * Retorna null quando nada está configurado — nesse caso o app usa o motor
 * embutido (nudenetLocal.ts), sem precisar de serviço externo. Assim, a censura
 * por IA já funciona "de fábrica", e apontar para um serviço externo continua
 * sendo uma opção (basta informar a URL).
 */
function resolveService(): { base: string; token?: string } | null {
  const fromDb = getNudenetConfig();
  if (fromDb?.url) return { base: fromDb.url.replace(/\/+$/, ""), token: fromDb.token };

  const base = (process.env.NUDENET_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.NUDENET_API_KEY || "").trim() || undefined;
  if (base) return { base, token };

  return null;
}

/** Converte detecções cruas (rótulo + caixa em pixels) em regiões relativas. */
function toRegions(
  raw: RawDetection[],
  iw: number,
  ih: number,
  minScore: number,
): DetectedRegion[] {
  const W = Math.max(1, iw);
  const H = Math.max(1, ih);
  return raw
    .map((d): DetectedRegion | null => {
      const part = LABEL_TO_PART[d.label];
      if (!part) return null;
      if (d.score < minScore) return null;
      return { part, score: d.score, x: d.x / W, y: d.y / H, w: d.w / W, h: d.h / H };
    })
    .filter((r): r is DetectedRegion => r !== null);
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
  const minScore = opts.minScore ?? 0.3;
  const svc = resolveService();

  // Sem serviço externo configurado → usa o motor embutido (in-process).
  if (!svc) {
    const { detectLocal, localEngineAvailable } = await import("./nudenetLocal");
    if (!(await localEngineAvailable())) {
      throw new Error(
        "Detecção por IA indisponível: o modelo embutido não foi encontrado. " +
          "Verifique se models/320n.onnx está presente na imagem, ou informe a URL " +
          "de um serviço NudeNet em Configurações → Conexão com IA.",
      );
    }
    const { detections, width, height } = await detectLocal(buf);
    return {
      regions: toRegions(detections, width, height, minScore),
      imageWidth: width,
      imageHeight: height,
    };
  }

  // Serviço externo configurado → fala com ele por HTTP (comportamento antigo).
  return detectViaHttp(svc.base, svc.token, buf, filename, minScore);
}

/** Detecção via microserviço HTTP externo (nudenet-service). */
async function detectViaHttp(
  base: string,
  token: string | undefined,
  buf: Buffer,
  filename: string,
  minScore: number,
): Promise<DetectResult> {
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
  return {
    regions: toRegions(data.detections || [], iw, ih, minScore),
    imageWidth: iw,
    imageHeight: ih,
  };
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
  // Sem URL → verifica o motor embutido (in-process). Se o modelo estiver
  // presente, a censura por IA já funciona sem serviço externo.
  if (!base) {
    const { localEngineAvailable } = await import("./nudenetLocal");
    if (await localEngineAvailable()) {
      return { ok: true, message: "Motor embutido ativo (não precisa de serviço externo)." };
    }
    return {
      ok: false,
      message: "Modelo embutido não encontrado (models/320n.onnx). Informe a URL de um serviço NudeNet.",
    };
  }
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
