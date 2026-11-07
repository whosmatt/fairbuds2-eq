import { parseTables } from './codec.js';
import { design, solo as soloTables, response, toBands, table48, MAX_BANDS } from './dsp.js';
import { parseApo, toApo, toShare, fromShare } from './apo.js';
import { Session, PRESET_KEYS, EQ_KEY } from './race.js';
import { createEditor } from './editor.js';

const $ = (id) => document.getElementById(id);
const clone = (v) => structuredClone(v);
const STORE = 'fb2eq';
const PEAK_MAX = 12;

let s = null, opening = null, stored = null, connecting = false, sending = false, pending = false, timer = null, soloWidth = 0.7;
let groups = [];

const valid = (v) => v && Array.isArray(v.bands) && Number.isFinite(v.pre);
const slots = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    if (v && valid(v.A) && valid(v.B) && (v.cur === 'A' || v.cur === 'B')) return v;
  } catch {}
  return null;
})() || { cur: 'A', A: { pre: 0, bands: [] }, B: { pre: 0, bands: [] }, fresh: true };
const undoStack = { A: [], B: [] };
const state = () => slots[slots.cur];

function persist() {
  delete slots.fresh;
  try { localStorage.setItem(STORE, JSON.stringify(slots)); } catch {}
}

function checkpoint() {
  const h = undoStack[slots.cur];
  h.push(JSON.stringify(state()));
  if (h.length > 100) h.shift();
}

function load(v, note) {
  checkpoint();
  slots[slots.cur] = { pre: v.pre, bands: clone(v.bands) };
  editor.deselect();
  changed(true);
  msg('eqmsg', note || '');
}

function undo() {
  const v = undoStack[slots.cur].pop();
  if (!v) return;
  slots[slots.cur] = JSON.parse(v);
  editor.deselect();
  changed(true);
}

function setSlot(k) {
  if (k === slots.cur) return;
  slots.cur = k;
  editor.deselect();
  changed(true);
}

function msg(id, text, kind = '') {
  const e = $(id);
  e.textContent = text;
  e.dataset.kind = kind;
}

function log(text) {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  $('log').prepend(line);
}

function render() {
  editor.render();
  const st = state(), peak = editor.peak;
  for (const k of ['A', 'B']) $(`ab${k}`).setAttribute('aria-pressed', slots.cur === k);
  $('abcopy').textContent = `Copy to ${slots.cur === 'A' ? 'B' : 'A'}`;
  $('add').disabled = st.bands.length >= MAX_BANDS;
  $('undo').disabled = !undoStack[slots.cur].length;
  if (document.activeElement !== $('pre')) $('pre').value = st.pre;
  $('peak').textContent = peak == null ? '' : `Peak ${peak >= 0 ? '+' : ''}${peak.toFixed(1)} dB`;
  $('peak').dataset.kind = peak > PEAK_MAX + 0.05 ? 'warn' : '';
  $('peak').title = peak > PEAK_MAX + 0.05 ? `The app never goes above +${PEAK_MAX} dB. Lower the preamp if you hear distortion.` : '';
}

function changed(now) {
  persist();
  render();
  if (editor.solo || $('live').checked) kick(now);
}

function current() {
  try { return design(state().bands, state().pre); } catch (e) { msg('eqmsg', e.message, 'error'); return null; }
}

function target() {
  const b = editor.selected;
  if (editor.solo && b) return soloTables(b.f, b.type === 'peak' ? Math.max(b.q, 0.5) : soloWidth);
  return $('live').checked || !stored ? current() : stored;
}

// Send as soon as the previous update is acknowledged, always with the latest state.
function kick(now) {
  if (!s) return;
  if (now) { clearTimeout(timer); timer = null; send(); }
  else if (!timer) timer = setTimeout(() => { timer = null; send(); }, 15);
}

async function send() {
  if (sending) { pending = true; return; }
  const t = target();
  if (!t || !s) return;
  sending = true;
  pending = false;
  try { await s.live(t); } catch (e) { log(`live update: ${e.message}`); setStatus('Update failed', 'error'); }
  sending = false;
  if (pending) send();
}

function level(bands, pre) {
  const f = Array.from({ length: 160 }, (_, i) => 100 * 80 ** (i / 159));
  const r = response(table48(design(bands, pre)), f);
  return 10 * Math.log10(r.reduce((a, v) => a + 10 ** (v / 10), 0) / r.length);
}

function reference() {
  const g = groups.find((x) => x.reference);
  return g?.presets.find((p) => p.id === `${g.id}/${g.reference}`);
}

// Match the reference preset's loudness (100 Hz to 8 kHz power average), peak capped at +12 dB.
function matchLevel(bands) {
  const ref = reference();
  let pre = ref ? level(ref.bands, ref.pre) - level(bands, 0) : 0;
  const f = Array.from({ length: 200 }, (_, i) => 20 * 1000 ** (i / 199));
  const peak = Math.max(...response(table48(design(bands, pre)), f));
  if (peak > PEAK_MAX) pre -= peak - PEAK_MAX;
  return Math.round(pre * 10) / 10;
}

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

function presetMenu() {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const html = ['<option value="">Presets</option>'];
  if (stored) html.push(`<optgroup label="On your buds">${opt('stored', 'Stored EQ')}</optgroup>`);
  html.push(`<optgroup label="Neutral">${opt('flat', 'Flat (no Fairphone tuning)')}</optgroup>`);
  for (const g of groups) html.push(`<optgroup label="${esc(g.name)}">${g.presets.map((p) => opt(p.id, p.name)).join('')}</optgroup>`);
  $('preset').innerHTML = html.join('');
}

async function loadPresets() {
  try {
    const raw = await (await fetch('presets.json')).json();
    groups = raw.map((g) => ({
      ...g,
      presets: g.presets.map((p) => {
        const r = parseApo(p.text);
        return { ...p, bands: r.bands, pre: r.pre, filePre: r.pre };
      }),
    }));
    for (const g of groups) if (!g.reference) for (const p of g.presets) p.pre = matchLevel(p.bands);
  } catch (e) {
    log(`presets: ${e.message}`);
  }
  presetMenu();
}

function applyPreset(id) {
  if (id === 'flat') return load({ pre: 0, bands: [] });
  if (id === 'stored') {
    const r = toBands(stored);
    return load({ bands: r.bands, pre: r.pre }, `Loaded the stored EQ as ${r.bands.length} bands.`);
  }
  for (const g of groups) {
    const p = g.presets.find((x) => x.id === id);
    if (!p) continue;
    const notes = [];
    if (p.pre !== p.filePre) notes.push(`Preamp set to ${p.pre} dB to match the Fairbuds presets in loudness.`);
    if (p.description && !g.reference) notes.push(p.description);
    return load(p, notes.join(' '));
  }
}

async function refreshAppPresets() {
  const g = groups.find((x) => x.reference);
  if (!g) return;
  for (const [key, name] of PRESET_KEYS) {
    const p = g.presets.find((x) => x.name === name);
    if (!p) continue;
    const r = toBands(parseTables(await s.nvRead(key)));
    Object.assign(p, { bands: r.bands, pre: r.pre, filePre: r.pre });
  }
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').dataset.kind = kind;
}

function bothBuds(yes) {
  setStatus(yes ? 'Connected, both buds' : 'Connected, one bud', yes ? 'ok' : 'warn');
}

function setConnected(on) {
  $('conn').textContent = on ? 'Disconnect' : connecting ? 'Cancel' : 'Connect';
  $('conn').classList.toggle('primary', !on && !connecting);
  $('save').disabled = !on;
  document.body.classList.toggle('connected', on);
}

async function readStored() {
  stored = parseTables(await s.nvRead(EQ_KEY));
  presetMenu();
  render();
}

async function openWithRetry() {
  if (!opening) throw new Error('cancelled');
  const deadline = Date.now() + 180000;
  for (;;) {
    try { return await opening.open(); } catch (e) {
      if (!connecting) throw new Error('cancelled');
      if (!/not paired/i.test(e.message) || Date.now() > deadline) throw e;
      setStatus('Waiting for pairing', 'wait');
      msg('connmsg', 'Pair “Fairbuds 2” in your system’s Bluetooth settings (Add device, then Bluetooth). This page connects by itself once they are paired.', 'warn');
      opening?.close();
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

async function connect() {
  if (s || connecting) {
    connecting = false;
    (s || opening)?.close();
    s = opening = null;
    setConnected(false);
    setStatus('Not connected');
    return;
  }
  msg('connmsg', '');
  const session = new Session(log);
  session.onNotify = (type, id, p) => {
    if (type === 0x5d && id === 0x0d00) bothBuds(p[0] === 5 && p[1] === 6);
  };
  try { await session.pick(); } catch (e) {
    if (!/cancel/i.test(e.message)) msg('connmsg', e.message, 'error');
    return;
  }
  opening = session;
  connecting = true;
  setConnected(false);
  setStatus('Connecting', 'wait');
  try {
    await openWithRetry();
  } catch (e) {
    connecting = false;
    session.close();
    opening = null;
    setConnected(false);
    setStatus('Not connected');
    if (e.message !== 'cancelled') msg('connmsg', e.message, 'error');
    return;
  }
  connecting = false;
  opening = null;
  s = session;
  msg('connmsg', '');
  session.dev.addEventListener('gattserverdisconnected', () => {
    if (s !== session || connecting) return;
    s = null;
    setConnected(false);
    setStatus('Disconnected', 'warn');
  });
  setConnected(true);
  try {
    bothBuds(await s.partnerReachable());
    await readStored();
    if (slots.fresh) {
      const r = toBands(stored);
      slots.A = { pre: r.pre, bands: r.bands };
      slots.B = clone(slots.A);
      changed(false);
    }
    await refreshAppPresets();
    if ($('live').checked) kick(true);
  } catch (e) {
    log(`after connect: ${e.message}`);
  }
}

async function save() {
  const t = current();
  if (!t) return;
  $('save').disabled = true;
  $('save').textContent = 'Saving';
  msg('savemsg', '');
  try {
    await s.save(t);
    await readStored();
    msg('savemsg', `Saved to both buds at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`, 'ok');
  } catch (e) {
    msg('savemsg', `Not saved: ${e.message}`, 'error');
    log(`save: ${e.message}`);
  }
  $('save').textContent = 'Save to buds';
  $('save').disabled = !s;
}

function repository() {
  const meta = document.querySelector('meta[name=repository]')?.content;
  if (meta) return meta;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return null;
  const first = location.pathname.split('/')[1];
  return `${m[1]}/${first || `${m[1]}.github.io`}`;
}

function shareLink() {
  return `${location.origin}${location.pathname}#eq=${toShare(state().bands, state().pre)}`;
}

async function copyLink() {
  const url = shareLink();
  try {
    await navigator.clipboard.writeText(url);
    msg('sharemsg', 'Link copied.', 'ok');
  } catch {
    $('apo').value = url;
    msg('sharemsg', 'Copy the link from the text box.', 'warn');
  }
}

function submit() {
  const q = new URLSearchParams({ template: 'preset.yml', title: 'Preset: ', eq: toApo(state().bands, state().pre), link: shareLink() });
  open(`https://github.com/${repository()}/issues/new?${q}`, '_blank', 'noopener');
}

function fromHash() {
  const m = location.hash.match(/^#eq=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    load(fromShare(decodeURIComponent(m[1])), 'Loaded the EQ from the link.');
  } catch (e) {
    msg('eqmsg', `The link does not contain a valid EQ: ${e.message}`, 'error');
  }
}

function importText(text) {
  const r = parseApo(text);
  if (!r.bands.length) { msg('sharemsg', 'No filters found.', 'error'); return; }
  if (r.bands.filter((b) => b.on).length > MAX_BANDS) { msg('sharemsg', `${r.bands.length} filters, but the buds support at most ${MAX_BANDS}.`, 'error'); return; }
  load(r);
  msg('sharemsg', `Imported ${r.bands.length} filters${r.warnings.length ? `. ${r.warnings.join('; ')}` : ''}.`, r.warnings.length ? 'warn' : 'ok');
}

const editor = createEditor($('editor'), {
  state,
  stored: () => stored,
  soloTables: () => target(),
  checkpoint,
  discardCheckpoint: () => undoStack[slots.cur].pop(),
  changed,
  notify: (t) => msg('eqmsg', t, 'warn'),
  solo: (on) => { if (on) soloWidth = 0.7; kick(true); },
  soloWidth: (k) => { soloWidth = Math.min(12, Math.max(0.5, soloWidth * k)); kick(false); },
});

$('conn').onclick = connect;
$('save').onclick = save;
$('live').onchange = () => kick(true);
$('abA').onclick = () => setSlot('A');
$('abB').onclick = () => setSlot('B');
$('abcopy').onclick = () => {
  const other = slots.cur === 'A' ? 'B' : 'A';
  undoStack[other].push(JSON.stringify(slots[other]));
  slots[other] = clone(state());
  persist();
  msg('eqmsg', `Copied ${slots.cur} to ${other}.`, 'ok');
};
$('undo').onclick = undo;
$('add').onclick = () => {
  const used = new Set(state().bands.map((b) => Math.round(b.f)));
  const f = [1000, 100, 3000, 300, 8000, 50, 500, 2000, 5000, 12000].find((x) => !used.has(x)) || 1000;
  editor.add({ on: true, type: 'peak', f, gain: 0, q: 1 });
};
$('pre').onfocus = checkpoint;
$('pre').oninput = () => {
  const v = parseFloat($('pre').value);
  if (Number.isFinite(v)) { state().pre = Math.max(-24, Math.min(12, v)); changed(false); }
};
$('range').onclick = () => {
  editor.range = editor.range === 18 ? 12 : 18;
  $('range').textContent = `±${editor.range} dB`;
};
$('preset').onchange = () => {
  const id = $('preset').value;
  $('preset').value = '';
  if (id) applyPreset(id);
};
$('copylink').onclick = copyLink;
$('submit').onclick = submit;
$('export').onclick = () => { $('apo').value = toApo(state().bands, state().pre); msg('sharemsg', 'Exported.', 'ok'); };
$('import').onclick = () => importText($('apo').value);
$('file').onchange = async () => {
  const f = $('file').files[0];
  if (f) { const t = await f.text(); $('apo').value = t; importText(t); }
};
document.addEventListener('keydown', (ev) => {
  if (ev.target.closest('input, textarea, select')) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === 'a' || ev.key === 'b')) setSlot(ev.key.toUpperCase());
});
window.addEventListener('hashchange', fromHash);

if (!('bluetooth' in navigator)) {
  $('conn').disabled = true;
  msg('connmsg', 'This browser has no Web Bluetooth. Use Chrome on Android, or Chrome, Edge or Brave on a computer (Brave: enable brave://flags/#brave-web-bluetooth-api).', 'error');
}
if (repository()) $('source').href = `https://github.com/${repository()}`;
$('submit').hidden = $('source').hidden = !repository();

await loadPresets();
if (slots.fresh) {
  const d = reference();
  if (d) { slots.A = { pre: d.pre, bands: clone(d.bands) }; slots.B = clone(slots.A); }
}
setConnected(false);
render();
fromHash();
