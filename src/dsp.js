import { RATES, RATE_ORDER, REF_GAIN, quantize } from './codec.js';

export const TYPES = ['peak', 'lowshelf', 'highshelf', 'hpf', 'lpf'];
// More than 10 per table destabilises the partner bud.
export const MAX_BANDS = 10;
const FLAT = [1, 0, 0, 0, 0];

export const isPass = (type) => type === 'hpf' || type === 'lpf';

// RBJ cookbook, normalised to b0 = 1; g is the original b0.
export function rbj(type, f, fs, gainDb, q) {
  const A = 10 ** (gainDb / 40), w = (2 * Math.PI * f) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b, a;
  switch (type) {
    case 'peak':
      b = [1 + al * A, -2 * c, 1 - al * A];
      a = [1 + al / A, -2 * c, 1 - al / A];
      break;
    case 'lowshelf':
    case 'highshelf': {
      const r = 2 * Math.sqrt(A) * al, s = type === 'lowshelf' ? 1 : -1;
      b = [A * (A + 1 - s * (A - 1) * c + r), s * 2 * A * (A - 1 - s * (A + 1) * c), A * (A + 1 - s * (A - 1) * c - r)];
      a = [A + 1 + s * (A - 1) * c + r, -s * 2 * (A - 1 + s * (A + 1) * c), A + 1 + s * (A - 1) * c - r];
      break;
    }
    case 'hpf': b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]; a = [1 + al, -2 * c, 1 - al]; break;
    case 'lpf': b = [(1 - c) / 2, 1 - c, (1 - c) / 2]; a = [1 + al, -2 * c, 1 - al]; break;
    case 'bpf': b = [al, 0, -al]; a = [1 + al, -2 * c, 1 - al]; break;
    default: throw new Error(`unknown filter type ${type}`);
  }
  const g = b[0] / a[0];
  return { g, c: [1, b[1] / b[0] / 2, b[2] / b[0], a[1] / a[0] / 2, a[2] / a[0]] };
}

// b0 normally goes into the gain word. Low-pass and band-pass keep it in the section:
// folded out, the section gain would overflow the DSP.
export function section(type, f, fs, gainDb, q) {
  const { g, c } = rbj(type, f, fs, gainDb, q);
  if (type === 'lpf' || type === 'bpf') return { g: 1, c: [g, c[1] * g, c[2] * g, c[3], c[4]] };
  return { g, c };
}

function pad(bq) {
  while (bq.length < MAX_BANDS) bq.push(FLAT.slice());
  return bq;
}

// The buds want all four rate tables in every update.
export function design(bands, preDb = 0) {
  const active = bands.filter((b) => b.on !== false);
  if (active.length > MAX_BANDS) throw new Error(`at most ${MAX_BANDS} bands`);
  return RATE_ORDER.map((rate) => {
    const fs = RATES[rate];
    let gain = REF_GAIN * 10 ** (preDb / 20);
    const bq = active.map((b) => {
      if (!TYPES.includes(b.type)) throw new Error(`unknown filter type ${b.type}`);
      if (!(b.f > 0 && b.f < fs / 2 && b.q > 0)) throw new Error(`invalid band ${b.f} Hz Q ${b.q}`);
      const s = section(b.type, b.f, fs, +b.gain || 0, b.q);
      gain *= s.g;
      return s.c;
    });
    return { rate, bq: pad(bq), gain };
  });
}

// Two band-pass sections, Q scaled so the -3 dB width matches a single section of q.
export function solo(f, q) {
  const qs = q * Math.sqrt(Math.SQRT2 - 1);
  return RATE_ORDER.map((rate) => {
    const fs = RATES[rate], fc = Math.min(Math.max(f, 10), fs * 0.45), s = section('bpf', fc, fs, 0, qs).c;
    return { rate, bq: pad([s, s.slice()]), gain: REF_GAIN };
  });
}

// dB relative to REF_GAIN, using the coefficients as the buds will store them.
export function response(table, freqs) {
  const fs = RATES[table.rate], bq = table.bq.map((c) => c.map(quantize)), g = quantize(table.gain) / REF_GAIN;
  return freqs.map((f) => {
    const w = (2 * Math.PI * f) / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    let m = g;
    for (const [b0, b1h, b2, a1h, a2] of bq) {
      const b1 = 2 * b1h, a1 = 2 * a1h;
      const nr = b0 + b1 * c1 + b2 * c2, ni = b1 * s1 + b2 * s2, dr = 1 + a1 * c1 + a2 * c2, di = a1 * s1 + a2 * s2;
      m *= Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
    return 20 * Math.log10(m);
  });
}

export function bandResponse(b, freqs) {
  const { g, c } = section(b.type, b.f, 48000, +b.gain || 0, b.q);
  return response({ rate: 2, bq: [c], gain: REF_GAIN * g }, freqs);
}

export const table48 = (tables) => tables.find((t) => t.rate === 2) || tables[0];

function nelderMead(fn, x0, step, iters = 400) {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) pts.push(x0.map((v, j) => v + (i === j ? step[i] : 0)));
  let vals = pts.map(fn);
  const toward = (p, c, k) => c.map((v, j) => v + k * (p[j] - v));
  for (let it = 0; it < iters; it++) {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    const c = pts.slice(0, n).reduce((acc, p) => acc.map((v, j) => v + p[j] / n), Array(n).fill(0));
    const r = toward(pts[n], c, -1), fr = fn(r);
    if (fr < vals[0]) {
      const e = toward(pts[n], c, -2), fe = fn(e);
      [pts[n], vals[n]] = fe < fr ? [e, fe] : [r, fr];
    } else if (fr < vals[n - 1]) {
      [pts[n], vals[n]] = [r, fr];
    } else {
      const k = toward(pts[n], c, 0.5), fk = fn(k);
      if (fk < vals[n]) [pts[n], vals[n]] = [k, fk];
      else for (let i = 1; i <= n; i++) { pts[i] = toward(pts[i], pts[0], 0.5); vals[i] = fn(pts[i]); }
    }
  }
  return { x: pts[0], err: vals[0] };
}

function fitSection(c, fs) {
  const [b0, b1h, b2, a1h, a2] = c;
  const target = [1, b1h / b0, b2 / b0, a1h, a2];
  if (Math.abs(target[1] - a1h) < 1e-6 && Math.abs(target[2] - a2) < 1e-6) return null;
  const w0 = Math.acos(Math.max(-1, Math.min(1, -a1h / Math.sqrt(Math.max(a2, 1e-9)))));
  const f0 = Math.max(10, Math.min(fs / 2.2, (w0 * fs) / (2 * Math.PI)));
  let best = null;
  for (const type of TYPES) {
    const pass = isPass(type);
    const fn = ([lf, lq, g]) => {
      const f = Math.exp(lf), q = Math.exp(lq);
      if (!(f > 5 && f < fs / 2 && q > 0.02 && q < 50)) return 1e9;
      return rbj(type, f, fs, pass ? 0 : g, q).c.reduce((a, v, i) => a + (v - target[i]) ** 2, 0);
    };
    const x0 = pass ? [Math.log(f0), Math.log(0.707)] : [Math.log(f0), 0, type === 'peak' ? 0 : 3];
    const step = pass ? [0.3, 0.3] : [0.3, 0.3, 4];
    let r = nelderMead(fn, x0, step);
    r = nelderMead(fn, r.x, step.map((v) => v / 10));
    if (!best || r.err < best.err) best = { err: r.err, type, f: Math.exp(r.x[0]), q: Math.exp(r.x[1]), gain: pass ? 0 : r.x[2] };
  }
  return best;
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// Recover editable bands from stored tables (the 48 kHz one).
export function toBands(tables) {
  const t = table48(tables), fs = RATES[t.rate];
  const bands = [];
  let lin = t.gain, err = 0;
  for (const c of t.bq) {
    lin *= c[0];
    const r = fitSection(c, fs);
    if (!r) continue;
    err = Math.max(err, r.err);
    if (r.type === 'peak' && Math.abs(r.gain) < 0.05) continue;
    // A low shelf of +g and a high shelf of -g differ only by a constant gain.
    if (r.type === 'highshelf' && r.f < 1000) { r.type = 'lowshelf'; r.gain = -r.gain; }
    else if (r.type === 'lowshelf' && r.f >= 1000) { r.type = 'highshelf'; r.gain = -r.gain; }
    const b = { on: true, type: r.type, f: round(r.f, r.f < 100 ? 1 : 0), gain: round(r.gain, 2), q: round(r.q, 3) };
    const s = section(b.type, b.f, fs, b.gain, b.q);
    lin /= s.c[0] * s.g;
    bands.push(b);
  }
  return { bands, pre: round(20 * Math.log10(lin / REF_GAIN), 2), err };
}
