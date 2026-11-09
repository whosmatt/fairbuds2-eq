import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/race.js';
import { frame, rd16 } from '../src/codec.js';
import { design } from '../src/dsp.js';

// Rejects overlapping writes like Chromium does, and answers every complete frame.
function fakeBuds() {
  const received = [];
  let busy = false, buf = [], listener = null;
  const rx = {
    addEventListener: (_, fn) => { listener = fn; },
    startNotifications: async () => {},
  };
  const reply = (id) => {
    const f = frame(id, id === 0x0a00 ? [0, 0] : [0], 0x5b);
    setTimeout(() => listener({ target: { value: { buffer: f.buffer } } }), 1);
  };
  const tx = {
    async writeValueWithResponse(chunk) {
      if (busy) throw new Error('GATT operation already in progress.');
      busy = true;
      await new Promise((r) => setTimeout(r, 2));
      busy = false;
      buf.push(...chunk);
      while (buf.length >= 4 && buf.length >= 4 + rd16(buf, 2)) {
        const f = buf.splice(0, 4 + rd16(buf, 2));
        received.push(f);
        reply(rd16(f, 4));
      }
    },
  };
  const svc = { getCharacteristic: async (u) => (u.includes('3241') ? tx : rx) };
  return { received, dev: { gatt: { connect: async () => ({ getPrimaryService: async () => svc }), disconnect() {} } } };
}

test('concurrent commands never overlap or interleave on the wire', async () => {
  const buds = fakeBuds();
  const s = new Session();
  s.dev = buds.dev;
  await s.open();
  const tables = design([{ on: true, type: 'peak', f: 1000, gain: 3, q: 1 }]);
  await Promise.all([s.live(tables), s.nvRead(0xe410), s.nvRead(0xe411), s.live(tables), s.nvRead(0xe412)]);
  assert.deepEqual(buds.received.map((f) => rd16(f, 4)), [0x0e03, 0x0a00, 0x0a00, 0x0e03, 0x0a00]);
  assert.ok(buds.received.every((f) => f[0] === 5 && f[1] === 0x5a));
});
