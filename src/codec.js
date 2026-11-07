// RACE framing and the Airoha PEQ coefficient blob (live command 0x0E03, NVKEY 0xE42C).

export const RATES = { 0: 32000, 1: 44100, 2: 48000, 3: 16000, 4: 8000, 5: 88200, 6: 96000, 7: 24000, 8: 50000, 9: 192000 };
export const RATE_ORDER = [6, 1, 2, 5];

export const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
export const rd16 = (b, o) => b[o] | (b[o + 1] << 8);
const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function frame(id, payload = [], type = 0x5a) {
  const p = Array.from(payload);
  return new Uint8Array([0x05, type, ...u16(p.length + 2), ...u16(id), ...p]);
}

// Q1.31 with the low 8 bits dropped, stored as hi16 LE then lo16 LE.
export function enc(v) {
  let i = Math.round((v * 2 ** 31) / 256) * 256;
  i = Math.max(Math.min(i, 2 ** 31 - 256), -(2 ** 31)) >>> 0;
  const hi = i >>> 16, lo = i & 0xffff;
  return [hi & 0xff, hi >> 8, lo & 0xff, lo >> 8];
}

export function dec(b, o = 0) {
  const hi = ((b[o] | (b[o + 1] << 8)) << 16) >> 16;
  return (hi * 65536 + (b[o + 2] | (b[o + 3] << 8))) / 2 ** 31;
}

export const quantize = (v) => dec(enc(v));

// Each biquad is [b0, b1/2, b2, a1/2, a2]; the gain word follows the last one.
export function parseTables(blob) {
  const out = [];
  let o = 4;
  for (let t = rd32(blob, 0); t > 0; t--) {
    const rate = rd16(blob, o), words = rd16(blob, o + 2), d = o + 4, nbq = rd16(blob, d);
    const bq = [];
    for (let i = 0; i < nbq; i++) bq.push([0, 1, 2, 3, 4].map((k) => dec(blob, d + 2 + 20 * i + 4 * k)));
    out.push({ rate, bq, gain: dec(blob, d + 2 + 20 * nbq) });
    o = d + 2 * words;
  }
  return out;
}

export function buildTables(tables) {
  const out = [...u16(tables.length), 0, 0];
  for (const t of tables) {
    const d = [...u16(t.bq.length)];
    for (const c of t.bq) for (const v of c) d.push(...enc(v));
    d.push(...enc(t.gain));
    out.push(...u16(t.rate), ...u16(d.length / 2), ...d);
  }
  return new Uint8Array(out);
}

// Overall gain of the app's flat EQ (first b0 times the gain word); the 0 dB reference.
export const REF_GAIN = dec([0x90, 0x6b, 0x00, 0x22]) * dec([0x32, 0x01, 0x00, 0x17]);
