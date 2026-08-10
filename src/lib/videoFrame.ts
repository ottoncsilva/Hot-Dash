/**
 * Extração de frames de vídeo no NAVEGADOR (módulo First Frame).
 *
 * O vídeo nunca sobe para o servidor: ele vira um object URL local, o
 * `<video>` decodifica e o frame escolhido é copiado para um canvas. Assim dá
 * para trabalhar com arquivos grandes sem esbarrar no limite de upload.
 */

/** Extensões de vídeo aceitas (mesma lista do resto do painel). */
export const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg"];

export type FrameFormat = "image/jpeg" | "image/png";

export const FRAME_EXT: Record<FrameFormat, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

export function isVideoFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && VIDEO_EXTS.includes(name.slice(dot).toLowerCase());
}

/** Nome do arquivo sem a extensão, para montar o nome do frame. */
export function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

/** `1:07.480` — timecode com milissegundos, para saber exatamente onde parou. */
export function formatTimecode(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(3).padStart(6, "0")}`;
}

/**
 * Copia o frame que o `<video>` está exibindo para um canvas e devolve o
 * arquivo de imagem. Resolve `null` se o vídeo ainda não tem dimensões
 * (metadados não carregados) ou se o navegador não conseguiu gerar o blob.
 */
export function captureFrame(
  video: HTMLVideoElement,
  format: FrameFormat,
  quality: number,
): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, width, height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), format, format === "image/jpeg" ? quality : undefined);
  });
}
