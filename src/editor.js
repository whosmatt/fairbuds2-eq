// Response plot with draggable bands, the band popup and keyboard control.
import { design, response, bandResponse, table48, TYPES, MAX_BANDS, isPass } from './dsp.js';

const NS = 'http://www.w3.org/2000/svg';
const FREQS = Array.from({ length: 301 }, (_, i) => 20 * 1000 ** (i / 300));
const GRID_F = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const MINOR_F = [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000];
const LABEL = { peak: 'Bell', lowshelf: 'Low shelf', highshelf: 'High shelf', hpf: 'Low cut', lpf: 'High cut' };
const ICON = {
  peak: 'M1 11C8 11 9 2 13 2s5 9 12 9', lowshelf: 'M1 3h7c4 0 6 8 10 8h7', highshelf: 'M1 11h7c4 0 6-8 10-8h7',
  hpf: 'M3 13C6 3 9 4 12 4h13', lpf: 'M1 4h13c3 0 6-1 9 9',
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export function createEditor(el, m) {
  const svg = el.querySelector('svg'), pop = el.querySelector('.pop');
  const P = { w: 900, h: 340, l: 34, r: 12, t: 12, b: 26 };
  let sel = -1, range = 18, drag = null, solo = null, last = null;

  const pw = () => P.w - P.l - P.r, ph = () => P.h - P.t - P.b;
  const X = (f) => P.l + (Math.log10(clamp(f, 20, 20000) / 20) / 3) * pw();
  const F = (x) => 20 * 1000 ** ((x - P.l) / pw());
  const Y = (db) => P.t + ((range - clamp(db, -range, range)) / (2 * range)) * ph();
  const DB = (y) => range - ((y - P.t) / ph()) * 2 * range;
  const path = (v) => v.map((d, i) => `${i ? 'L' : 'M'}${X(FREQS[i]).toFixed(1)} ${Y(d).toFixed(1)}`).join('');
  const area = (v, base) => `${path(v)}L${X(20000)} ${Y(base)}L${X(20)} ${Y(base)}Z`;
  const point = (ev) => { const r = svg.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const bands = () => m.state().bands;

  function node(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent?.append(n);
    return n;
  }

  function resize() {
    const w = svg.clientWidth || 900;
    P.w = w;
    P.h = Math.round(clamp(w * 0.42, 240, 380));
    svg.setAttribute('viewBox', `0 0 ${P.w} ${P.h}`);
    svg.style.height = `${P.h}px`;
  }

  function render() {
    const st = m.state();
    let tables = null;
    try { tables = design(st.bands, st.pre); } catch {}
    const total = tables && response(table48(tables), FREQS);
    last = total;
    svg.replaceChildren();
    const grid = node('g', { class: 'grid' }, svg);
    const step = range > 12 ? 6 : 3;
    for (let db = -range + step; db < range; db += step) {
      node('line', { x1: P.l, x2: P.w - P.r, y1: Y(db), y2: Y(db), class: db ? '' : 'zero' }, grid);
      node('text', { x: P.l - 6, y: Y(db) + 4, 'text-anchor': 'end' }, grid).textContent = db > 0 ? `+${db}` : db;
    }
    for (const f of MINOR_F) node('line', { y1: P.t, y2: P.h - P.b, x1: X(f), x2: X(f), class: 'minor' }, grid);
    for (const f of GRID_F) {
      node('line', { y1: P.t, y2: P.h - P.b, x1: X(f), x2: X(f) }, grid);
      if (P.w > 520 || [20, 100, 1000, 10000].includes(f)) {
        node('text', { x: clamp(X(f), P.l + 8, P.w - P.r - 12), y: P.h - 8, 'text-anchor': 'middle' }, grid).textContent = f >= 1000 ? `${f / 1000}k` : f;
      }
    }
    const stored = m.stored();
    if (stored) node('path', { d: path(response(table48(stored), FREQS)), class: 'stored' }, svg);
    st.bands.forEach((b, i) => {
      if (b.on === false) return;
      const r = bandResponse(b, FREQS);
      if (i === sel) node('path', { d: area(r, 0), class: 'band-fill', style: `--c:var(--b${i})` }, svg);
      node('path', { d: path(r), class: `band${i === sel ? ' sel' : ''}`, style: `--c:var(--b${i})` }, svg);
    });
    if (solo && st.bands[sel]) node('path', { d: area(response(table48(m.soloTables()), FREQS), -range), class: 'solo' }, svg);
    if (total) node('path', { d: path(total), class: 'total' }, svg);

    const dotY = (b) => Y(isPass(b.type) ? (total ? total[Math.round((Math.log10(clamp(b.f, 20, 20000) / 20) / 3) * 300)] : 0) : +b.gain || 0);
    const sb = st.bands[sel];
    if (sb) {
      const x = X(sb.f), dy = dotY(sb), y = dy > P.h - P.b - 44 ? dy - 32 : dy + 32;
      const g = node('g', { class: `solo-handle${solo ? ' on' : ''}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, svg);
      node('title', {}, g).textContent = 'Hold to hear only this band. Drag sideways to sweep it.';
      node('circle', { r: 16, class: 'hit' }, g);
      node('circle', { r: 12, class: 'disc' }, g);
      node('path', { d: 'M-6 3v-2a6 6 0 0 1 12 0v2', class: 'arc' }, g);
      node('rect', { x: -7.5, y: 1.5, width: 3.5, height: 5, rx: 1 }, g);
      node('rect', { x: 4, y: 1.5, width: 3.5, height: 5, rx: 1 }, g);
    }
    st.bands.forEach((b, i) => {
      const g = node('g', {
        class: `dot${i === sel ? ' sel' : ''}${b.on === false ? ' off' : ''}`, 'data-i': i, style: `--c:var(--b${i})`,
        transform: `translate(${X(b.f).toFixed(1)} ${dotY(b).toFixed(1)})`,
      }, svg);
      node('circle', { r: 20, class: 'hit' }, g);
      node('circle', { r: 10, class: 'disc' }, g);
      node('text', { y: 4, 'text-anchor': 'middle' }, g).textContent = i + 1;
    });
    renderPop();
    return total;
  }

  function renderPop() {
    const b = bands()[sel];
    el.classList.toggle('has-pop', !!b);
    pop.inert = !b;
    if (!b) return;
    pop.style.setProperty('--c', `var(--b${sel})`);
    pop.querySelector('.pop-title').textContent = `Band ${sel + 1} · ${LABEL[b.type]}`;
    for (const bt of pop.querySelectorAll('.types button')) bt.setAttribute('aria-pressed', bt.dataset.t === b.type);
    const set = (name, v) => { const i = pop.querySelector(`[name=${name}]`); if (document.activeElement !== i) i.value = v; };
    set('f', round(b.f, 1));
    set('gain', isPass(b.type) ? '' : round(b.gain, 1));
    set('q', round(b.q, 2));
    pop.querySelector('[name=gain]').disabled = isPass(b.type);
    pop.querySelector('.bypass').textContent = b.on === false ? 'Enable' : 'Bypass';
    pop.style.marginLeft = `${clamp(X(b.f) - pop.offsetWidth / 2, 0, P.w - pop.offsetWidth)}px`;
  }

  function select(i) {
    sel = i;
    render();
  }

  function edit(fn, now = true) {
    m.checkpoint();
    fn();
    m.changed(now);
  }

  function remove(i) {
    edit(() => bands().splice(i, 1));
    sel = -1;
    render();
  }

  function add(b) {
    if (bands().length >= MAX_BANDS) { m.notify(`The buds support at most ${MAX_BANDS} bands.`); return; }
    edit(() => bands().push(b));
    select(bands().length - 1);
  }

  function setSolo(on) {
    solo = on;
    m.solo(on);
    render();
  }

  svg.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest('.solo-handle'), dot = ev.target.closest('.dot');
    if (!handle && !dot) { if (sel >= 0) select(-1); return; }
    if (dot) sel = +dot.dataset.i;
    const b = bands()[sel], p = point(ev);
    m.checkpoint();
    drag = { x: p.x, y: p.y, f: b.f, gain: +b.gain || 0, id: ev.pointerId, moved: false, solo: !!handle };
    try { svg.setPointerCapture(ev.pointerId); } catch {}
    ev.preventDefault();
    if (handle) setSolo(true);
    else render();
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const p = point(ev), k = ev.shiftKey ? 0.1 : 1, b = bands()[sel];
    b.f = round(clamp(drag.f * 1000 ** (((p.x - drag.x) * k) / pw()), 20, 20000), 1);
    if (!drag.solo && !isPass(b.type)) b.gain = round(clamp(drag.gain - ((p.y - drag.y) * k * 2 * range) / ph(), -24, 24), 1);
    drag.moved = true;
    m.changed(false);
  });

  const endDrag = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.moved) m.discardCheckpoint();
    const wasSolo = drag.solo;
    drag = null;
    if (wasSolo) setSolo(false);
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener('wheel', (ev) => {
    const dot = ev.target.closest('.dot');
    if (dot) sel = +dot.dataset.i;
    const b = bands()[sel];
    if (!b) return;
    ev.preventDefault();
    const k = Math.exp(-ev.deltaY * (ev.shiftKey ? 0.0003 : 0.0015));
    if (solo && b.type !== 'peak') { m.soloWidth(k); render(); return; }
    b.q = round(clamp(b.q * k, 0.1, 20), 3);
    m.changed(false);
  }, { passive: false });

  svg.addEventListener('dblclick', (ev) => {
    if (ev.target.closest('.solo-handle')) return;
    const dot = ev.target.closest('.dot');
    if (dot) { const b = bands()[+dot.dataset.i]; edit(() => { b.on = b.on === false; }); return; }
    const p = point(ev);
    add({ on: true, type: 'peak', f: Math.round(clamp(F(p.x), 20, 20000)), gain: round(clamp(DB(p.y), -24, 24), 1), q: 1 });
  });

  svg.addEventListener('contextmenu', (ev) => {
    const dot = ev.target.closest('.dot');
    if (!dot) return;
    ev.preventDefault();
    remove(+dot.dataset.i);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.closest('input, textarea, select') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const b = bands()[sel];
    if (!b) return;
    const k = ev.shiftKey ? 0.1 : 1;
    const moves = {
      ArrowLeft: () => { b.f = round(clamp(b.f / 2 ** (k / 12), 20, 20000), 1); },
      ArrowRight: () => { b.f = round(clamp(b.f * 2 ** (k / 12), 20, 20000), 1); },
      ArrowUp: () => { if (!isPass(b.type)) b.gain = round(clamp(b.gain + 0.5 * k, -24, 24), 1); },
      ArrowDown: () => { if (!isPass(b.type)) b.gain = round(clamp(b.gain - 0.5 * k, -24, 24), 1); },
    };
    if (moves[ev.key]) { ev.preventDefault(); edit(moves[ev.key], false); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); remove(sel); }
    else if (ev.key === 'Escape') select(-1);
  });

  const types = pop.querySelector('.types');
  types.innerHTML = TYPES.map((t) => `<button type="button" data-t="${t}" title="${LABEL[t]}" aria-label="${LABEL[t]}"><svg viewBox="0 0 26 14" aria-hidden="true"><path d="${ICON[t]}"/></svg></button>`).join('');
  types.addEventListener('click', (ev) => {
    const bt = ev.target.closest('button'), b = bands()[sel];
    if (!bt || !b) return;
    edit(() => {
      b.type = bt.dataset.t;
      if (isPass(b.type)) { b.gain = 0; if (b.q > 2) b.q = 0.707; }
    });
  });
  for (const name of ['f', 'gain', 'q']) {
    const input = pop.querySelector(`[name=${name}]`);
    input.addEventListener('focus', () => m.checkpoint());
    input.addEventListener('input', () => {
      const b = bands()[sel], v = parseFloat(input.value);
      if (!b || !Number.isFinite(v)) return;
      b[name] = name === 'f' ? clamp(v, 20, 20000) : name === 'q' ? clamp(v, 0.1, 20) : clamp(v, -24, 24);
      m.changed(false);
    });
  }
  pop.querySelector('.bypass').addEventListener('click', () => { const b = bands()[sel]; if (b) edit(() => { b.on = b.on === false; }); });
  pop.querySelector('.delete').addEventListener('click', () => remove(sel));
  pop.querySelector('.close').addEventListener('click', () => select(-1));

  new ResizeObserver(() => { resize(); render(); }).observe(svg);
  resize();

  return {
    render,
    select,
    add,
    get selected() { return bands()[sel] || null; },
    get solo() { return solo; },
    get peak() { return last ? Math.max(...last) : null; },
    get range() { return range; },
    set range(v) { range = v; render(); },
    deselect() { sel = -1; },
  };
}
