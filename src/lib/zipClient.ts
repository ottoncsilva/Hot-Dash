/**
 * Gerador de ZIP no NAVEGADOR, sem dependências externas. Método "store"
 * (sem compressão) — os frames saem como JPG/PNG, que já são comprimidos.
 *
 * Existe separado do `src/lib/zip.ts` de propósito: aquele é `server-only` e
 * usa `Buffer` + `zlib.crc32` do Node. Aqui os frames nascem no navegador
 * (canvas), então empacotar do lado do cliente evita subir dezenas de MB para
 * o servidor só para baixar de volta.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export type ZipEntry = { name: string; data: Uint8Array };

/** O TS tipa `Uint8Array` sobre `ArrayBufferLike`, mas o `Blob` só aceita
 *  views sobre `ArrayBuffer` — na prática são as mesmas bytes. */
const asPart = (view: Uint8Array): BlobPart => view as unknown as BlobPart;

export function buildZipBlob(entries: ZipEntry[]): Blob {
  const { time, date } = dosDateTime(new Date());
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // assinatura do cabeçalho local
    lv.setUint16(4, 20, true); // versão necessária
    lv.setUint16(6, 0x0800, true); // flags: bit 11 = nome em UTF-8
    lv.setUint16(8, 0, true); // compressão: 0 = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // tamanho comprimido
    lv.setUint32(22, size, true); // tamanho original
    lv.setUint16(26, nameBuf.length, true);
    lv.setUint16(28, 0, true); // campo extra

    parts.push(asPart(local), asPart(nameBuf), asPart(entry.data));

    const dir = new Uint8Array(46);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // assinatura do diretório central
    dv.setUint16(4, 20, true); // versão de criação
    dv.setUint16(6, 20, true); // versão necessária
    dv.setUint16(8, 0x0800, true); // flags
    dv.setUint16(10, 0, true); // compressão
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, nameBuf.length, true);
    dv.setUint16(30, 0, true); // extra
    dv.setUint16(32, 0, true); // comentário
    dv.setUint16(34, 0, true); // disco
    dv.setUint16(36, 0, true); // atributos internos
    dv.setUint32(38, 0, true); // atributos externos
    dv.setUint32(42, offset, true); // posição do cabeçalho local

    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + size;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // fim do diretório central
  ev.setUint16(4, 0, true); // disco
  ev.setUint16(6, 0, true); // disco do diretório central
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // comentário

  return new Blob([...parts, ...central.map(asPart), asPart(end)], {
    type: "application/zip",
  });
}

/** Garante nomes únicos dentro do ZIP ("foto.jpg", "foto-2.jpg", ...). */
export function uniqueZipName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  while (used.has(`${base}-${i}${ext}`)) i++;
  const unique = `${base}-${i}${ext}`;
  used.add(unique);
  return unique;
}
