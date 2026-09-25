'use strict';
// WebM do MediaRecorder: leitura mínima de EBML e a duração que falta.
// O MediaRecorder do Chromium grava ao vivo e não escreve a Duration no Info do Segment: o vídeo
// abre com duração "Infinity" até tocar inteiro. withDuration() insere a Duration (float de 8
// bytes, na escala de tempo do arquivo) calculada dos próprios blocos; info() lê duração, tamanho
// do quadro, codec e número de quadros (usado pelo modo gravação e pelos testes).
// Referência do formato: https://www.matroska.org/technical/elements.html

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecID: 0x86,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  Cues: 0x1c53bb6b,
};
const CLUSTER_CHILDREN = new Set([ID.Timecode, ID.SimpleBlock, ID.BlockGroup, 0xa7, 0xab, 0xa3]);

function readId(buf, pos) {
  const first = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 4 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 4) throw new Error(`EBML: id inválido em ${pos}`);
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}

function readSize(buf, pos) {
  const first = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 8) throw new Error(`EBML: tamanho inválido em ${pos}`);
  let value = first & (mask - 1);
  let ones = value === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) ones = false;
  }
  return { value, len, unknown: ones };
}

function encodeSize(value, len) {
  const out = Buffer.alloc(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

const uint = (buf, pos, len) => {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[pos + i];
  return v;
};

// percorre o arquivo e junta o que interessa; lança erro se não for um WebM que dê para ler
function scan(buf) {
  let pos = 0;
  const h = readId(buf, pos);
  if (h.id !== ID.EBML) throw new Error('não é EBML/WebM');
  const hs = readSize(buf, pos + h.len);
  pos += h.len + hs.len + hs.value;
  const s = readId(buf, pos);
  if (s.id !== ID.Segment) throw new Error('WebM sem Segment');
  const ss = readSize(buf, pos + s.len);
  const res = { segment: { sizePos: pos + s.len, size: ss }, scale: 1000000, duration: null, info: null, seekHead: false, width: 0, height: 0, codec: '', times: [] };
  const segEnd = ss.unknown ? buf.length : pos + s.len + ss.len + ss.value;
  pos += s.len + ss.len;
  while (pos < segEnd && pos < buf.length) {
    const e = readId(buf, pos);
    const es = readSize(buf, pos + e.len);
    const data = pos + e.len + es.len;
    if (e.id === ID.SeekHead) res.seekHead = true;
    if (e.id === ID.Info) {
      res.info = { start: pos, sizePos: pos + e.len, sizeLen: es.len, data, size: es.value };
      for (let p = data; p < data + es.value; ) {
        const c = readId(buf, p);
        const cs = readSize(buf, p + c.len);
        const cd = p + c.len + cs.len;
        if (c.id === ID.TimecodeScale) res.scale = uint(buf, cd, cs.value);
        if (c.id === ID.Duration) res.duration = cs.value === 8 ? buf.readDoubleBE(cd) : buf.readFloatBE(cd);
        p = cd + cs.value;
      }
    }
    if (e.id === ID.Tracks) {
      const walk = (from, to) => {
        for (let p = from; p < to; ) {
          const c = readId(buf, p);
          const cs = readSize(buf, p + c.len);
          const cd = p + c.len + cs.len;
          if (c.id === ID.TrackEntry || c.id === ID.Video) walk(cd, cd + cs.value);
          if (c.id === ID.CodecID) res.codec = buf.toString('latin1', cd, cd + cs.value);
          if (c.id === ID.PixelWidth) res.width = uint(buf, cd, cs.value);
          if (c.id === ID.PixelHeight) res.height = uint(buf, cd, cs.value);
          p = cd + cs.value;
        }
      };
      walk(data, data + es.value);
    }
    if (e.id === ID.Cluster) {
      // cluster ao vivo pode ter tamanho desconhecido: lê os filhos até aparecer outro elemento
      let tc = 0;
      let p = data;
      const end = es.unknown ? buf.length : data + es.value;
      while (p < end && p < buf.length) {
        const c = readId(buf, p);
        if (es.unknown && !CLUSTER_CHILDREN.has(c.id)) break;
        const cs = readSize(buf, p + c.len);
        const cd = p + c.len + cs.len;
        if (c.id === ID.Timecode) tc = uint(buf, cd, cs.value);
        if (c.id === ID.SimpleBlock) {
          const tr = readSize(buf, cd);
          res.times.push(tc + buf.readInt16BE(cd + tr.len));
        }
        p = cd + cs.value;
      }
      pos = p;
      continue;
    }
    if (es.unknown) break;
    pos = data + es.value;
  }
  return res;
}

// duração em ms a partir dos blocos (último instante + a duração média de um quadro)
function blocksDuration(r) {
  const t = [...r.times].sort((a, b) => a - b);
  if (!t.length) return 0;
  const step = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 0;
  return ((t[t.length - 1] + step) * r.scale) / 1e6;
}

function info(buf) {
  const r = scan(buf);
  const ms = r.duration != null ? (r.duration * r.scale) / 1e6 : blocksDuration(r);
  return { duracaoMs: Math.round(ms), duracaoGravada: r.duration != null, largura: r.width, altura: r.height, codec: r.codec, quadros: r.times.length };
}

// devolve um Buffer novo com a Duration no Info (ou o mesmo, se já tiver)
function withDuration(buf) {
  const r = scan(buf);
  if (r.duration != null) return buf;
  if (!r.info) throw new Error('WebM sem Info');
  if (r.seekHead) throw new Error('WebM com SeekHead: os deslocamentos mudariam');
  const units = (blocksDuration(r) * 1e6) / r.scale;
  const dur = Buffer.alloc(11);
  dur[0] = 0x44;
  dur[1] = 0x89;
  dur[2] = 0x88; // tamanho 8
  dur.writeDoubleBE(units, 3);
  const { start, sizePos, sizeLen, data, size } = r.info;
  const newSize = size + dur.length;
  const len = newSize < 2 ** (7 * sizeLen) - 1 ? sizeLen : 8;
  const parts = [buf.subarray(0, sizePos), encodeSize(newSize, len), buf.subarray(data, data + size), dur, buf.subarray(data + size)];
  const out = Buffer.concat(parts);
  const delta = out.length - buf.length;
  const seg = r.segment;
  if (!seg.size.unknown) encodeSize(seg.size.value + delta, seg.size.len).copy(out, seg.sizePos);
  void start;
  return out;
}

module.exports = { info, withDuration };
