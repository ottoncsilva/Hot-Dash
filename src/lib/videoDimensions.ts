import "server-only";
import { runCapture } from "./metadata";

export type VideoInfo = {
  /** Largura COMO SE VÊ (já com a rotação aplicada). */
  width: number;
  /** Altura COMO SE VÊ (já com a rotação aplicada). */
  height: number;
  /** Duração em segundos, arredondada — o Telegram só aceita inteiro. */
  duration?: number;
};

type FfprobeStream = {
  width?: number;
  height?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
};

/**
 * Ângulo de rotação declarado no vídeo, normalizado para 0/90/180/270.
 *
 * Vídeo de celular quase sempre é gravado "deitado" e carrega o ângulo nos
 * metadados: o player é que gira na hora de exibir. Ou seja, a resolução
 * codificada (o que o ffprobe reporta em width/height) NÃO é a resolução que
 * se vê. O ângulo aparece em `side_data_list.rotation` (matriz de exibição,
 * ffmpeg atual) ou em `tags.rotate` (formato antigo) — lemos os dois.
 */
function rotationOf(stream: FfprobeStream): number {
  const fromSideData = stream.side_data_list?.find(
    (s) => typeof s.rotation === "number",
  )?.rotation;
  const raw =
    typeof fromSideData === "number"
      ? fromSideData
      : Number(stream.tags?.rotate ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return ((Math.round(raw) % 360) + 360) % 360;
}

/**
 * Lê a resolução de exibição e a duração de um vídeo com ffprobe.
 *
 * Devolve null quando não dá para determinar (arquivo corrompido, ffprobe
 * ausente, stream sem resolução) — quem chama deve seguir sem as dimensões
 * em vez de falhar, já que isto é informação complementar.
 */
export async function getVideoInfo(absPath: string): Promise<VideoInfo | null> {
  try {
    const out = await runCapture("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      absPath,
    ]);
    const parsed = JSON.parse(out) as {
      streams?: FfprobeStream[];
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream?.height) return null;

    // 90°/270° trocam o que é largura e o que é altura na exibição.
    const rotation = rotationOf(stream);
    const swap = rotation === 90 || rotation === 270;
    const width = swap ? stream.height : stream.width;
    const height = swap ? stream.width : stream.height;

    const rawDuration = Number(stream.duration ?? parsed.format?.duration ?? NaN);
    const duration =
      Number.isFinite(rawDuration) && rawDuration > 0
        ? Math.round(rawDuration)
        : undefined;

    return { width, height, duration };
  } catch {
    return null;
  }
}
