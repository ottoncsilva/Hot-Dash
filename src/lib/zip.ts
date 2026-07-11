import "server-only";
import { crc32 } from "node:zlib";

/**
 * Gerador de arquivo ZIP mínimo, sem dependências externas (usa o
 * zlib.crc32 nativo do Node 22+). Usa o método "store" (sem compressão) —
 * fotos e vídeos já vêm comprimidos, então não há ganho em recomprimir, e
 * isso evita qualquer complexidade/dependência extra.
 */
type Entry = { name: string; data: Buffer };

function dosDateTime(date: Date): { time: number; d: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const d =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, d };
}

export function buildZip(entries: Entry[]): Buffer {
  const { time, d } = dosDateTime(new Date());
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data) >>> 0;
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: bit 11 = UTF-8 filename
    local.writeUInt16LE(0, 8); // compression: 0 = store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(d, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    localChunks.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(0, 10); // compression
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(d, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // offset of local header

    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + entry.data.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central dir
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralBuf.length, 12); // central dir size
  end.writeUInt32LE(centralStart, 16); // central dir offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, centralBuf, end]);
}
