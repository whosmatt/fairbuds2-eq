// RACE over BLE GATT (Airoha). One Session per chosen device.
import { frame, buildTables, u16, rd16 } from './codec.js';
import { MAX_BANDS } from './dsp.js';

export const SERVICE = '5052494d-2dab-0341-6972-6f6861424c45';
const TX = '43484152-2dab-3241-6972-6f6861424c45';
const RX = '43484152-2dab-3141-6972-6f6861424c45';

// Larger frames are dropped silently.
const MAX_FRAME = 1251;
const PARTNER = [0x05, 0x06];
export const EQ_KEY = 0xe42c;
export const PRESET_KEYS = [[0xe410, 'Default'], [0xe411, 'Balance'], [0xe412, 'Bass boost'], [0xe413, 'Treble boost'], [0xe414, 'Voice']];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPartner = (d) => d.length === 2 && d[0] === PARTNER[0] && d[1] === PARTNER[1];
const hex = (v) => `0x${v.toString(16)}`;

export class Session {
  constructor(log = () => {}) {
    this.log = log;
    this.onNotify = null;
    this.buf = [];
    this.waiters = [];
    this.chunk = 509;
  }

  async pick() {
    this.dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }, { name: 'Fairbuds 2' }],
      optionalServices: [SERVICE],
    });
    this.log(`selected ${this.dev.name || '(unnamed)'}`);
  }

  async open(retries = 3) {
    for (let i = 0; ; i++) {
      try {
        return await this.#open();
      } catch (e) {
        const transient = i === 0 || /disconnected|connection attempt failed|connection error|unknown reason|timed out/i.test(e.message);
        if (!transient || /not paired/i.test(e.message) || i >= retries) throw e;
        this.log(`${e.message}, retrying`);
        this.close();
        await sleep(1500);
      }
    }
  }

  async #open() {
    this.buf = [];
    this.waiters = [];
    const gatt = await this.dev.gatt.connect();
    const svc = await gatt.getPrimaryService(SERVICE);
    this.tx = await svc.getCharacteristic(TX);
    const rx = await svc.getCharacteristic(RX);
    if (rx !== this.rx) {
      rx.addEventListener('characteristicvaluechanged', (e) => this.#receive(new Uint8Array(e.target.value.buffer)));
      this.rx = rx;
    }
    // Notifications need an encrypted link; this is where pairing happens.
    await Promise.race([
      rx.startNotifications(),
      sleep(35000).then(() => { throw new Error('pairing was not confirmed in time'); }),
    ]);
    this.log('connected');
  }

  close() {
    try { this.dev?.gatt.disconnect(); } catch {}
  }

  #receive(data) {
    this.buf.push(...data);
    while (this.buf.length >= 4 && this.buf[0] === 5 && this.buf.length >= 4 + rd16(this.buf, 2)) {
      const f = new Uint8Array(this.buf.splice(0, 4 + rd16(this.buf, 2)));
      const i = this.waiters.findIndex((w) => w.match(f));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(f);
      else this.onNotify?.(f[1], rd16(f, 4), f.slice(6));
    }
    if (this.buf.length && this.buf[0] !== 5) {
      this.log('resyncing receive buffer');
      this.buf = [];
    }
  }

  // Register before writing so a fast reply is not missed.
  #expect(match, timeout, what) {
    const w = { match };
    const p = new Promise((resolve, reject) => {
      w.resolve = resolve;
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) { this.waiters.splice(i, 1); reject(new Error(`no reply to ${what}`)); }
      }, timeout);
    });
    this.waiters.push(w);
    p.catch(() => {});
    return p;
  }

  #queue = Promise.resolve();

  // Web Bluetooth rejects overlapping GATT writes
  #write(f) {
    const run = this.#queue.then(() => this.#send(f));
    this.#queue = run.catch(() => {});
    return run;
  }

  async #send(f) {
    if (f.length > MAX_FRAME) throw new Error(`frame of ${f.length} bytes is too large`);
    for (let o = 0; o < f.length; ) {
      try {
        await this.tx.writeValueWithResponse(f.slice(o, o + this.chunk));
        o += this.chunk;
      } catch (e) {
        if (o > 0 || this.chunk <= 20) throw e;
        this.chunk = this.chunk > 244 ? 244 : this.chunk > 182 ? 182 : 20;
        this.log(`write failed (${e.message}), chunk size ${this.chunk}`);
      }
    }
  }

  async cmd(id, payload = [], timeout = 4000) {
    const reply = this.#expect((r) => r[1] === 0x5b && rd16(r, 4) === id, timeout, hex(id));
    await this.#write(frame(id, payload));
    return (await reply).slice(6);
  }

  async partnerReachable() {
    return isPartner(await this.cmd(0x0d00));
  }

  // Forward a command to the other bud through 0x0D01.
  async relay(id, payload = [], timeout = 5000) {
    if (!(await this.partnerReachable())) throw new Error('the other bud is not reachable');
    const ack = this.#expect((r) => r[1] === 0x5b && rd16(r, 4) === 0x0d01, timeout, 'relay');
    const reply = this.#expect((r) => r[1] === 0x5d && rd16(r, 4) === 0x0d01 && r[8] === 5 && r[9] === 0x5b && rd16(r, 12) === id, timeout, `relayed ${hex(id)}`);
    await this.#write(frame(0x0d01, [...PARTNER, ...frame(id, payload)]));
    const a = await ack;
    if (a[6] !== 0) throw new Error(`relay rejected (${a[6]})`);
    return (await reply).slice(14);
  }

  async nvRead(key, partner = false) {
    const p = [...u16(key), ...u16(1000)];
    const r = partner ? await this.relay(0x0a00, p) : await this.cmd(0x0a00, p);
    return r.slice(2, 2 + rd16(r, 0));
  }

  async nvWrite(key, data, partner = false) {
    const send = (id, p) => (partner ? this.relay(id, p) : this.cmd(id, p));
    const reclaim = await send(0x0a03, u16(data.length));
    if (reclaim[0] !== 1) throw new Error(`NVKEY ${hex(key)} reclaim failed (${reclaim[0]})`);
    const write = await send(0x0a01, [...u16(key), ...data]);
    if (write[0] !== 0) throw new Error(`NVKEY ${hex(key)} write failed (${write[0]})`);
  }

  async live(tables) {
    if (tables.length !== 4 || tables.some((t) => t.bq.length > MAX_BANDS)) throw new Error('invalid EQ tables');
    await this.cmd(0x0e03, [0, ...buildTables(tables)]);
  }

  // Same order as the app: partner first, then this bud, then notify both.
  async save(tables) {
    const blob = buildTables(tables);
    if (!(await this.partnerReachable())) throw new Error('both buds must be connected to save');
    await this.live(tables);
    await this.nvWrite(EQ_KEY, blob, true);
    await this.nvWrite(EQ_KEY, blob);
    await this.relay(0x09fd, [0, ...u16(EQ_KEY)]);
    await this.cmd(0x09fd, [0, ...u16(EQ_KEY)]);
    for (const partner of [false, true]) {
      const r = await this.nvRead(EQ_KEY, partner);
      if (r.length !== blob.length || r.some((v, i) => v !== blob[i])) throw new Error(`verification failed on the ${partner ? 'other' : 'connected'} bud`);
    }
  }
}
