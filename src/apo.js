// Equalizer APO / AutoEq / REW parametric text, and the compact form used in share links.

const FROM_APO = {
  PK: 'peak', PEQ: 'peak', LS: 'lowshelf', LSC: 'lowshelf', LSQ: 'lowshelf',
  HS: 'highshelf', HSC: 'highshelf', HSQ: 'highshelf', LP: 'lpf', LPQ: 'lpf', HP: 'hpf', HPQ: 'hpf',
};
const TO_APO = { peak: 'PK', lowshelf: 'LSC', highshelf: 'HSC', hpf: 'HPQ', lpf: 'LPQ' };
const SHORT = { peak: 'pk', lowshelf: 'ls', highshelf: 'hs', hpf: 'hp', lpf: 'lp' };
const FROM_SHORT = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));

// "# Key: value" lines before the first filter are metadata.
export function parseApo(text) {
  const bands = [], warnings = [], meta = {};
  let pre = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^#\s*([A-Za-z]+)\s*:\s*(.+)$/);
    if (m && !bands.length) { meta[m[1].toLowerCase()] = m[2].trim(); continue; }
    if (!line || line.startsWith('#')) continue;
    const p = line.match(/^preamp\s*:\s*([-+\d.]+)\s*db/i);
    if (p) { pre = +p[1]; continue; }
    const f = line.match(/^filter\s*\d*\s*:\s*(on|off)\s+([a-z]+)(?:\s+([\d.]+)\s*db)?\s*(.*)$/i);
    if (!f) continue;
    const on = f[1].toUpperCase() === 'ON', code = f[2].toUpperCase(), type = FROM_APO[code], rest = f[4];
    if (!type) {
      if (on && code !== 'NONE') warnings.push(`unsupported filter type ${f[2]} skipped`);
      continue;
    }
    const fc = rest.match(/fc\s+([\d.]+)\s*hz/i), gain = rest.match(/gain\s+([-+\d.]+)\s*db/i);
    const q = rest.match(/\bq\s+([\d.]+)/i), bw = rest.match(/bw\s*oct\s+([\d.]+)/i);
    if (!fc) { warnings.push(`no frequency in "${line}"`); continue; }
    if (!q && !bw && f[3] && (type === 'lowshelf' || type === 'highshelf')) warnings.push(`shelf slope ${f[3]} dB approximated as Q 0.707`);
    const n = bw ? 2 ** +bw[1] : 0;
    bands.push({ on, type, f: +fc[1], gain: gain ? +gain[1] : 0, q: q ? +q[1] : bw ? Math.sqrt(n) / (n - 1) : 0.707 });
  }
  return { bands, pre, warnings, meta };
}

export function toApo(bands, pre, meta = {}) {
  const lines = Object.entries(meta).filter(([, v]) => v).map(([k, v]) => `# ${k[0].toUpperCase()}${k.slice(1)}: ${v}`);
  lines.push(`Preamp: ${(+pre).toFixed(1)} dB`);
  bands.forEach((b, i) => {
    const gain = b.type === 'hpf' || b.type === 'lpf' ? '' : ` Gain ${(+b.gain).toFixed(1)} dB`;
    lines.push(`Filter ${i + 1}: ${b.on === false ? 'OFF' : 'ON'} ${TO_APO[b.type]} Fc ${+b.f} Hz${gain} Q ${(+b.q).toFixed(3)}`);
  });
  return lines.join('\n') + '\n';
}

// pre;type,f,gain,q;... with a leading "-" on bypassed bands, e.g. "-2.5;pk,1000,3,1.41;-ls,105,4,0.71"
export function toShare(bands, pre) {
  const num = (v, d) => String(Math.round(v * 10 ** d) / 10 ** d);
  return [num(pre, 1), ...bands.map((b) => `${b.on === false ? '-' : ''}${SHORT[b.type]},${num(b.f, 1)},${num(+b.gain || 0, 2)},${num(b.q, 3)}`)].join(';');
}

export function fromShare(s) {
  const [pre, ...parts] = s.split(';');
  const bands = parts.map((p) => {
    const off = p.startsWith('-'), [t, f, gain, q] = (off ? p.slice(1) : p).split(',');
    const b = { on: !off, type: FROM_SHORT[t], f: +f, gain: +gain, q: +q };
    if (!b.type || !(b.f > 0) || !Number.isFinite(b.gain) || !(b.q > 0)) throw new Error(`invalid band "${p}"`);
    return b;
  });
  if (!Number.isFinite(+pre)) throw new Error('invalid preamp');
  return { bands, pre: +pre };
}
