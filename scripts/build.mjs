#!/usr/bin/env node
// Validates presets/ and writes presets.json. With --site, also assembles _site/ for GitHub Pages.
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { parseApo } from '../src/apo.js';
import { design, TYPES, MAX_BANDS } from '../src/dsp.js';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, 'presets');
const errors = [];
const groups = [];

for (const g of JSON.parse(readFileSync(join(dir, 'groups.json'), 'utf8'))) {
  const gdir = join(dir, g.id);
  if (!existsSync(gdir)) continue;
  const presets = [];
  for (const file of readdirSync(gdir).filter((f) => f.endsWith('.txt')).sort()) {
    const where = `presets/${g.id}/${file}`;
    if (!/^[a-z0-9][a-z0-9-]*\.txt$/.test(file)) errors.push(`${where}: file name must be lower-case-with-dashes.txt`);
    const text = readFileSync(join(gdir, file), 'utf8');
    const { bands, pre, warnings, meta } = parseApo(text);
    for (const w of warnings) errors.push(`${where}: ${w}`);
    if (!meta.name) errors.push(`${where}: missing "# Name:" line`);
    if (!meta.author) errors.push(`${where}: missing "# Author:" line`);
    if (!bands.length) errors.push(`${where}: no filters`);
    if (bands.filter((b) => b.on).length > MAX_BANDS) errors.push(`${where}: more than ${MAX_BANDS} active filters`);
    if (bands.some((b) => !TYPES.includes(b.type) || b.f < 10 || b.f > 20000 || b.q <= 0 || Math.abs(b.gain) > 24)) errors.push(`${where}: filter out of range`);
    try { design(bands, pre); } catch (e) { errors.push(`${where}: ${e.message}`); }
    presets.push({ id: `${g.id}/${file.slice(0, -4)}`, ...meta, text });
  }
  presets.sort((a, b) => (b.id === `${g.id}/${g.reference}`) - (a.id === `${g.id}/${g.reference}`));
  if (presets.length) groups.push({ ...g, presets });
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
writeFileSync(join(root, 'presets.json'), JSON.stringify(groups));
console.log(`presets.json: ${groups.map((g) => `${g.id} ${g.presets.length}`).join(', ')}`);

if (process.argv.includes('--site')) {
  const site = join(root, '_site');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site);
  for (const f of ['index.html', 'style.css', 'icon.svg', 'presets.json', 'src']) cpSync(join(root, f), join(site, f), { recursive: true });
  console.log('_site ready');
}
