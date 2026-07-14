import "server-only";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./metadata";

export type BlurRect = { x: number; y: number; w: number; h: number };

/**
 * Aplica as edições do editor de vídeo (corte + borrão de região + uma
 * camada de sobreposição com texto/emoji/pergunta) via ffmpeg e devolve o
 * arquivo mp4 resultante. Não grava nada no banco — a rota chamadora envia
 * o buffer de volta ao cliente, que salva o resultado através das mesmas
 * rotas usadas pelo editor de fotos (nova versão ou sobrescrever).
 */
export async function renderVideoEdit(
  input: Buffer,
  ext: string,
  opts: {
    trimStart?: number;
    trimEnd?: number;
    overlayPng?: Buffer;
    blurRects?: BlurRect[];
  },
): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "hotdash-videdit-"));
  try {
    const inputPath = join(workDir, `in${ext || ".mp4"}`);
    await writeFile(inputPath, input);

    let overlayPath: string | null = null;
    if (opts.overlayPng) {
      overlayPath = join(workDir, "overlay.png");
      await writeFile(overlayPath, opts.overlayPng);
    }

    const outputPath = join(workDir, "out.mp4");
    const trimStart = opts.trimStart && opts.trimStart > 0 ? opts.trimStart : 0;
    const blurRects = (opts.blurRects || []).filter((r) => r.w > 1 && r.h > 1);

    const args: string[] = ["-y"];
    if (trimStart > 0) args.push("-ss", trimStart.toFixed(3));
    args.push("-i", inputPath);
    if (overlayPath) args.push("-loop", "1", "-i", overlayPath);

    if (blurRects.length > 0 || overlayPath) {
      let cur = "[0:v]";
      const chain: string[] = [];
      blurRects.forEach((r, i) => {
        const x = Math.max(0, Math.round(r.x));
        const y = Math.max(0, Math.round(r.y));
        const w = Math.max(2, Math.round(r.w));
        const h = Math.max(2, Math.round(r.h));
        chain.push(`${cur}split=2[base${i}][pick${i}]`);
        // chroma_radius tem limite de 10 no ffmpeg — especifica luma e
        // chroma separadamente para poder usar um raio maior na luminância.
        chain.push(`[pick${i}]crop=${w}:${h}:${x}:${y},boxblur=16:2:8:2[blur${i}]`);
        chain.push(`[base${i}][blur${i}]overlay=${x}:${y}[stage${i}]`);
        cur = `[stage${i}]`;
      });
      if (overlayPath) {
        // shortest=1: a imagem de sobreposição é aberta em loop (infinita) —
        // sem isso, sem um corte explícito (-t), o ffmpeg nunca encerraria a
        // saída sozinho.
        chain.push(`${cur}[1:v]overlay=0:0:shortest=1[vout]`);
      } else {
        chain.push(`${cur}null[vout]`);
      }
      args.push("-filter_complex", chain.join(";"), "-map", "[vout]");
    } else {
      args.push("-map", "0:v");
    }
    args.push("-map", "0:a?");

    if (opts.trimEnd != null) {
      const duration = Math.max(0.1, opts.trimEnd - trimStart);
      args.push("-t", duration.toFixed(3));
    }

    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      outputPath,
    );

    await run("ffmpeg", args);
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
