import "server-only";

/**
 * Lê a resolução (largura/altura) de uma imagem direto dos bytes do
 * arquivo, sem dependências externas. Suporta PNG e JPEG (os formatos mais
 * comuns de câmeras e do nosso editor). Outros formatos retornam null —
 * o item fica sem resolução conhecida (tratado como "outra" no filtro).
 */
export function getImageDimensions(
  buf: Buffer,
  ext: string,
): { width: number; height: number } | null {
  const e = ext.toLowerCase();
  try {
    if (e === ".png") return pngDimensions(buf);
    if (e === ".jpg" || e === ".jpeg") return jpegDimensions(buf);
    return null;
  } catch {
    return null;
  }
}

function pngDimensions(buf: Buffer) {
  if (buf.length < 24) return null;
  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  if (!isPng) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width && height ? { width, height } : null;
}

function jpegDimensions(buf: Buffer) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // SOFn (início de frame): C0-CF exceto C4 (DHT), C8 (JPG), CC (DAC)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      if (offset + 9 > buf.length) return null;
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return width && height ? { width, height } : null;
    }
    // Marcadores sem payload (SOI/EOI/RSTn)
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buf.length) return null;
    const length = buf.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  return null;
}
