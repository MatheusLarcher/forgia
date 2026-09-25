import { unzipSync } from 'three/addons/libs/fflate.module.js';

// ZIP sem dependência nova, para o .3MF (src/exportar3mf.js) e o projeto .forgia (src/projeto.js).
// Escrita: cabeçalhos e CRC32 à mão; compressão pelo CompressionStream('deflate-raw') do próprio
// Chromium (e do Node, nos testes). Quando comprimir não ajuda, a entrada vai sem compressão
// (método 0). Sem ZIP64: cada arquivo e o total ficam abaixo de 4 GB (os modelos vão até 200 MB).
// Leitura: o unzipSync do fflate que já vem com o three.js (o mesmo do leitor de 3MF).

let table = null;
function crcTable() {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(bytes) {
  const tb = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = tb[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// data e hora no formato do MS-DOS (o ZIP guarda assim)
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const utf8 = (s) => new TextEncoder().encode(s);
const bytesOf = (data) => (typeof data === 'string' ? utf8(data) : data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

// entries: [{ nome, dados: string | Uint8Array | TypedArray, comprimir = true }] -> Uint8Array do .zip
export async function zipFiles(entries, { data = new Date() } = {}) {
  const { time, date } = dosTime(data);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = utf8(e.nome);
    const raw = bytesOf(e.dados);
    const crc = crc32(raw);
    let body = raw;
    let method = 0;
    if (e.comprimir !== false && raw.length > 64) {
      const z = await deflateRaw(raw);
      if (z.length < raw.length) {
        body = z;
        method = 8;
      }
    }
    if (body.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('ZIP grande demais (limite de 4 GB)');
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true); // versão necessária 2.0
    head.setUint16(6, 0x0800, true); // nomes em UTF-8
    head.setUint16(8, method, true);
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, raw.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), name, body);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // feito por: 2.0, MS-DOS
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    // extra, comentário, disco, atributos internos e externos: 0
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Uint8Array do .zip -> { 'caminho/no/zip': Uint8Array }
export function unzipFiles(bytes) {
  return unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}
