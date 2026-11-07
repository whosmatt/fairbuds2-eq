import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTables, buildTables, enc, dec, REF_GAIN } from '../src/codec.js';
import { design, response, solo, toBands, table48, MAX_BANDS } from '../src/dsp.js';
import { parseApo, toApo, toShare, fromShare } from '../src/apo.js';

const hex = readFileSync(new URL('fixtures/e410-default.hex', import.meta.url), 'utf8').trim();
const blob = Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
const F = Array.from({ length: 120 }, (_, i) => 20 * 1000 ** (i / 119));

test('stored blob round-trips byte for byte', () => {
  const t = parseTables(blob);
  assert.deepEqual(t.map((x) => x.rate), [1, 2, 5, 6]);
  assert.deepEqual(buildTables(t), blob);
});

test('coefficients saturate instead of wrapping', () => {
  assert.equal(dec(enc(2)), 1 - 2 ** -23);
  assert.equal(dec(enc(-2)), -1);
  assert.equal(dec(enc(0.5)), 0.5);
});

test('the Default preset is recovered as bands that reproduce it', () => {
  const t = parseTables(blob), r = toBands(t);
  assert.equal(r.bands.length, 6);
  assert.ok(Math.abs(r.pre) < 0.01);
  const a = response(table48(t), F), b = response(table48(design(r.bands, r.pre)), F);
  for (let i = 0; i < F.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.01, `${F[i]} Hz: ${a[i]} vs ${b[i]}`);
});

test('a flat design sits at the reference level', () => {
  const t = design([], 0);
  assert.equal(t.length, 4);
  assert.ok(t.every((x) => x.bq.length === MAX_BANDS && x.gain === REF_GAIN));
  assert.ok(response(table48(t), F).every((v) => Math.abs(v) < 1e-3));
});

test('design rejects more than ten bands', () => {
  const b = Array.from({ length: 11 }, (_, i) => ({ on: true, type: 'peak', f: 100 * (i + 1), gain: 1, q: 1 }));
  assert.throws(() => design(b));
  b[10].on = false;
  assert.doesNotThrow(() => design(b));
});

test('solo band-pass is 0 dB at the centre and -3 dB half an octave out', () => {
  const [lo, c, hi] = response(table48(solo(1000, Math.SQRT2)), [1000 / Math.SQRT2, 1000, 1000 * Math.SQRT2]);
  assert.ok(Math.abs(c) < 0.05);
  assert.ok(Math.abs(lo + 3) < 0.1 && Math.abs(hi + 3) < 0.1, `${lo} ${hi}`);
});

test('APO text round-trips, with metadata', () => {
  const text = '# Name: Test\n# Author: me\nPreamp: -3.5 dB\nFilter 1: ON PK Fc 1000 Hz Gain 3 dB Q 1.41\nFilter 2: OFF LSC Fc 105 Hz Gain 4 dB Q 0.71\nFilter 3: ON HP Fc 30 Hz BW Oct 1\n';
  const r = parseApo(text);
  assert.deepEqual(r.meta, { name: 'Test', author: 'me' });
  assert.equal(r.pre, -3.5);
  assert.equal(r.bands.length, 3);
  assert.equal(r.bands[1].on, false);
  assert.ok(Math.abs(r.bands[2].q - Math.SQRT2) < 1e-9);
  const again = parseApo(toApo(r.bands, r.pre, r.meta));
  assert.deepEqual(again.meta, r.meta);
  assert.equal(again.bands.length, 3);
});

test('unsupported filters are reported', () => {
  assert.equal(parseApo('Filter 1: ON NO Fc 50 Hz Q 30\n').warnings.length, 1);
});

test('share strings round-trip', () => {
  const v = { pre: -2.5, bands: [{ on: true, type: 'peak', f: 1000, gain: 3, q: 1.41 }, { on: false, type: 'hpf', f: 30, gain: 0, q: 0.707 }] };
  const s = toShare(v.bands, v.pre);
  assert.equal(s, '-2.5;pk,1000,3,1.41;-hp,30,0,0.707');
  assert.deepEqual(fromShare(s), v);
  assert.throws(() => fromShare('0;zz,1,1,1'));
});
