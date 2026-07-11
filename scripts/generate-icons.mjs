// Gera os ícones PNG do PWA (gradiente + estrela "sparkle") sem dependências.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

// --- CRC32 para chunks PNG ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Paleta do brand (roxo -> rosa)
const A = { r: 0x7c, g: 0x3a, b: 0xed }; // brand-600
const B = { r: 0xec, g: 0x48, b: 0x99 }; // accent-500
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

function drawPng(size, padding = 0) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - padding; // raio útil (fora = transparente/base)
  const starR = R * 0.62;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const o = rowStart + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Fundo: gradiente diagonal do brand
      const t = (x + y) / (2 * size);
      let r = lerp(A.r, B.r, t);
      let g = lerp(A.g, B.g, t);
      let b = lerp(A.b, B.b, t);
      let a = 255;

      // Fora do círculo útil vira fundo escuro (bordas suaves em maskable)
      if (dist > R) {
        r = 0x0d;
        g = 0x0d;
        b = 0x14;
      }

      // Estrela de 4 pontas (astroide) em branco
      const nx = Math.abs(dx) / starR;
      const ny = Math.abs(dy) / starR;
      const star = Math.sqrt(nx) + Math.sqrt(ny);
      if (star <= 1) {
        r = 255;
        g = 255;
        b = 255;
      }

      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

const targets = [
  { name: "icon-192.png", size: 192, pad: 0 },
  { name: "icon-512.png", size: 512, pad: 0 },
  { name: "icon-maskable-512.png", size: 512, pad: 52 },
  { name: "apple-touch-icon.png", size: 180, pad: 0 },
];

for (const t of targets) {
  writeFileSync(join(OUT, t.name), drawPng(t.size, t.pad));
  console.log("gerado:", t.name);
}
