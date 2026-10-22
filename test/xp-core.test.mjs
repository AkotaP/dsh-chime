import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, DEFAULT_CONFIG, normalizeConfig, createConfigStore } from '../src/xp/config.js';
import { samplePitch, createBurstController } from '../src/xp/burst.js';
import { normalizeConfig as normalizeNotifications } from '../src/client/config.js';

const near = (actual, expected, epsilon = 1e-10) => assert.ok(
  Math.abs(actual - expected) <= epsilon, 'expected ' + actual + ' approximately ' + expected,
);

function seeded(seed = 0x12345678) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

class Clock {
  at = 0;
  nextId = 0;
  pending = new Map();
  callbacks = [];
  maxPending = 0;
  now = () => this.at;
  setTimeout = (fn, delay) => {
    assert.ok(Number.isFinite(delay) && delay >= 0);
    const id = ++this.nextId;
    this.pending.set(id, { fn, at: this.at + delay });
    this.callbacks.push(fn);
    this.maxPending = Math.max(this.maxPending, this.pending.size);
    return id;
  };
  clearTimeout = (id) => this.pending.delete(id);
  first() {
    return [...this.pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  }
  advance(to) {
    assert.ok(to >= this.at);
    let steps = 0;
    for (let next; (next = this.first()) && next[1].at <= to;) {
      assert.ok(++steps < 10000, 'scheduler must not spin');
      this.at = Math.max(this.at, next[1].at);
      this.pending.delete(next[0]);
      next[1].fn();
    }
    this.at = to;
  }
  late(to) {
    this.at = to;
    const next = this.first();
    assert.ok(next && next[1].at <= to);
    this.pending.delete(next[0]);
    next[1].fn();
  }
}

function harness(patch = {}, deps = {}) {
  const clock = new Clock();
  let config = normalizeConfig({ ...DEFAULT_CONFIG, enabled: true, ...patch,
    sound: { ...DEFAULT_CONFIG.sound, src: 'xp.ogg', ...patch.sound },
  });
  let allowed = true;
  const orbs = [];
  const states = [];
  const { onOrb, onStateChange, ...rest } = deps;
  const controller = createBurstController({
    getConfig: () => config,
    canPlay: () => allowed,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    random: () => 0.5,
    onOrb(value) { orbs.push({ ...value, at: clock.at }); return onOrb?.(value); },
    onStateChange(value) { states.push(value); return onStateChange?.(value); },
    ...rest,
  });
  return {
    clock, orbs, states, controller,
    get config() { return config; },
    set config(value) { config = value; },
    set allowed(value) { allowed = value; },
  };
}

function storageFixture(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  const listeners = new Set();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) { writes.push([key, value]); data.set(key, value); },
  };
  const eventTarget = {
    addEventListener(type, listener) { assert.equal(type, 'storage'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'storage'); listeners.delete(listener); },
  };
  const dispatch = (event) => { for (const listener of [...listeners]) listener(event); };
  return { data, writes, listeners, storage, eventTarget, dispatch };
}

test('XP defaults are independent, deeply frozen and normalize to new objects', () => {
  assert.equal(STORAGE_KEY, 'dsh.chime.xp.config.v1');
  assert.deepEqual(DEFAULT_CONFIG, {
    enabled: false, sound: { src: '', source: 'url', volume: 0.1 },
    durationMinSeconds: 1, durationMaxSeconds: 3, orbsPerSecond: 6, playInBackground: false,
  });
  assert.ok(Object.isFrozen(DEFAULT_CONFIG) && Object.isFrozen(DEFAULT_CONFIG.sound));
  for (const raw of [undefined, null, [], '', false, 12, new Date()]) {
    const result = normalizeConfig(raw);
    assert.deepEqual(result, DEFAULT_CONFIG);
    assert.notEqual(result, DEFAULT_CONFIG);
    assert.notEqual(result.sound, DEFAULT_CONFIG.sound);
  }
  const raw = { enabled: true, notify: { enabled: true }, kinds: { completed: { src: 'notice' } },
    sound: { src: '  xp  ', source: 'file', volume: 0.2 }, attention: { sound: 'never' } };
  const before = structuredClone(raw);
  const noticeBefore = normalizeNotifications(raw);
  const result = normalizeConfig(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(normalizeNotifications(raw), noticeBefore);
  assert.equal(result.sound.src, 'xp');
  assert.equal(result.sound.source, 'file');
  assert.equal('notify' in result, false);
  assert.equal('kinds' in result, false);
});

test('normalization clamps ranges, sorts duration endpoints and rejects invalid types', () => {
  const low = normalizeConfig({ durationMinSeconds: -9, durationMaxSeconds: 100,
    orbsPerSecond: -1, sound: { src: '   ', source: 'bad', volume: -1 } });
  assert.equal(low.durationMinSeconds, 0.1);
  assert.equal(low.durationMaxSeconds, 30);
  assert.equal(low.orbsPerSecond, 0.1);
  assert.deepEqual(low.sound, { src: '', source: 'url', volume: 0 });
  const high = normalizeConfig({ durationMinSeconds: 29, durationMaxSeconds: 2,
    orbsPerSecond: 999, sound: { source: 'local', volume: 5 }, playInBackground: true });
  assert.equal(high.durationMinSeconds, 2);
  assert.equal(high.durationMaxSeconds, 29);
  assert.equal(high.orbsPerSecond, 10);
  assert.equal(high.sound.volume, 1);
  assert.equal(high.sound.source, 'local');
  assert.equal(high.playInBackground, true);
  for (const bad of [NaN, Infinity, -Infinity, '4', null, {}, []]) {
    const result = normalizeConfig({ enabled: bad, sound: { src: typeof bad === 'string' ? null : bad, volume: bad },
      durationMinSeconds: bad, durationMaxSeconds: bad, orbsPerSecond: bad, playInBackground: bad });
    assert.deepEqual(result, DEFAULT_CONFIG);
  }
});

test('store merges partial sound, persists its own key, deduplicates and releases', () => {
  const fixture = storageFixture({ 'dsh.chime.config.v1': '{"enabled":true}' });
  const store = createConfigStore(fixture);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  store.subscribe(() => { throw Error('isolated listener'); });
  const initial = store.getSnapshot();
  assert.equal(store.set({ enabled: false }), initial);
  assert.equal(notifications, 0);
  const first = store.set({ enabled: true, sound: { src: 'xp', source: 'file' } });
  const second = store.set({ sound: { volume: 0.4 }, notify: { enabled: true } });
  assert.deepEqual(second.sound, { src: 'xp', source: 'file', volume: 0.4 });
  assert.equal(first.sound.volume, 0.1);
  assert.ok(Object.isFrozen(second) && Object.isFrozen(second.sound));
  assert.throws(() => { second.sound.src = 'mutated'; }, TypeError);
  assert.equal(store.set({ sound: { volume: 0.4 } }), second);
  assert.equal(store.set(null), second);
  assert.equal(notifications, 2);
  assert.ok(fixture.writes.every(([key]) => key === STORAGE_KEY));
  assert.equal(fixture.data.get('dsh.chime.config.v1'), '{"enabled":true}');
  assert.deepEqual(JSON.parse(fixture.data.get(STORAGE_KEY)), second);
  assert.deepEqual(store.reset(), DEFAULT_CONFIG);
  assert.equal(notifications, 3);
  unsubscribe(); unsubscribe();
  store.set({ enabled: true });
  assert.equal(notifications, 3);
  store.dispose(); store.dispose();
  assert.equal(fixture.listeners.size, 0);
  const disposed = store.getSnapshot();
  assert.equal(store.reset(), disposed);
  assert.equal(store.set({ enabled: false }), disposed);
  store.subscribe(() => assert.fail('disposed store must not notify'));
});

test('storage events synchronize XP only, handle clear/corruption, and never echo writes', () => {
  const fixture = storageFixture({ [STORAGE_KEY]: '{"enabled":true,"sound":{"src":"saved"}}' });
  const store = createConfigStore(fixture);
  assert.equal(store.getSnapshot().sound.src, 'saved');
  let changes = 0;
  store.subscribe(() => changes++);
  const initial = store.getSnapshot();
  fixture.dispatch({ key: 'dsh.chime.config.v1', newValue: '{}' });
  fixture.dispatch({ key: STORAGE_KEY, storageArea: {}, newValue: '{}' });
  assert.equal(store.getSnapshot(), initial);
  const event = { key: STORAGE_KEY, storageArea: fixture.storage,
    newValue: '{"enabled":true,"sound":{"src":"remote","volume":0.3}}' };
  fixture.dispatch(event);
  assert.equal(store.getSnapshot().sound.src, 'remote');
  assert.equal(changes, 1);
  fixture.dispatch(event);
  assert.equal(changes, 1);
  fixture.dispatch({ key: STORAGE_KEY, newValue: '{broken' });
  assert.deepEqual(store.getSnapshot(), DEFAULT_CONFIG);
  fixture.dispatch(event);
  fixture.dispatch({ key: STORAGE_KEY, newValue: null });
  assert.deepEqual(store.getSnapshot(), DEFAULT_CONFIG);
  fixture.dispatch(event);
  fixture.dispatch({ key: null });
  assert.deepEqual(store.getSnapshot(), DEFAULT_CONFIG);
  assert.equal(fixture.writes.length, 0);
  store.dispose();
  fixture.dispatch(event);
  assert.deepEqual(store.getSnapshot(), DEFAULT_CONFIG);
});

test('store survives unavailable storage, corrupt persisted JSON and async listeners', async () => {
  const store = createConfigStore({ storage: {
    getItem() { throw Error('storage denied'); }, setItem() { throw Error('quota'); },
  }, eventTarget: { addEventListener() { throw Error('unavailable'); } } });
  store.subscribe(async () => { throw Error('rejected listener'); });
  assert.equal(store.set({ enabled: true }).enabled, true);
  assert.deepEqual(store.reset(), DEFAULT_CONFIG);
  store.dispose();
  const corrupt = createConfigStore(storageFixture({ [STORAGE_KEY]: '{' }));
  assert.deepEqual(corrupt.getSnapshot(), DEFAULT_CONFIG);
  corrupt.dispose();
  await Promise.resolve();
});

test('pitch uses exactly two random samples and the specified MC formula', () => {
  const values = [1, 0, 0, 1, 0.5, 0.5];
  near(samplePitch(() => values.shift()), 1.25);
  near(samplePitch(() => values.shift()), 0.55);
  near(samplePitch(() => values.shift()), 0.9);
  assert.equal(values.length, 0);
  assert.equal(samplePitch(() => 0.5), 0.9);
});

test('seeded Monte Carlo pitch distribution has MC support, mean, variance and triangular density', () => {
  const random = seeded();
  const count = 120000;
  let sum = 0; let squares = 0; let center = 0; let tails = 0;
  for (let i = 0; i < count; i++) {
    const pitch = samplePitch(random);
    assert.ok(pitch >= 0.55 && pitch <= 1.25);
    sum += pitch;
    squares += (pitch - 0.9) ** 2;
    if (Math.abs(pitch - 0.9) < 0.1) center++;
    if (Math.abs(pitch - 0.9) > 0.25) tails++;
  }
  near(sum / count, 0.9, 0.002);
  near(squares / count, 0.35 ** 2 / 6, 0.0003);
  near(center / count, 1 - (1 - 0.1 / 0.35) ** 2, 0.005);
  near(tails / count, (1 - 0.25 / 0.35) ** 2, 0.003);
});

test('trigger samples uniform duration at endpoints/interior and emits first orb immediately', () => {
  for (const sample of [0, 0.25, 0.5, 0.999999, 1]) {
    let calls = 0;
    const h = harness({}, { random: () => calls++ === 0 ? sample : 0.5 });
    assert.equal(h.controller.trigger(), true);
    assert.deepEqual(h.orbs, [{ at: 0, pitch: 0.9 }]);
    const end = 1000 + sample * 2000;
    h.clock.advance(end - 0.001);
    assert.equal(h.controller.isPlaying(), true);
    h.clock.advance(end);
    assert.equal(h.controller.isPlaying(), false);
    assert.deepEqual(h.states, [true, false]);
    assert.equal(h.clock.pending.size, 0);
    assert.equal(h.clock.maxPending, 1);
  }
});

test('duration bounds 0.1 and 30 seconds use a half-open interval', () => {
  for (const seconds of [0.1, 30]) {
    const h = harness({ durationMinSeconds: seconds, durationMaxSeconds: seconds, orbsPerSecond: 10 });
    h.controller.trigger();
    h.clock.advance(seconds * 1000);
    assert.equal(h.orbs.length, seconds * 10);
    assert.equal(h.orbs[0].at, 0);
    assert.ok(h.orbs.at(-1).at < seconds * 1000);
    assert.equal(h.controller.isPlaying(), false);
  }
});

test('frequency follows configured spacing including fractional, low and clamped rates', () => {
  for (const [rate, expectedPeriod, seconds] of [[10, 100, 1], [999, 100, 1], [4, 250, 1],
    [6, 1000 / 6, 1], [0.1, 10000, 30], [0, 10000, 30]]) {
    const h = harness({ durationMinSeconds: seconds, durationMaxSeconds: seconds, orbsPerSecond: rate });
    h.controller.trigger();
    h.clock.advance(seconds * 1000);
    for (let i = 1; i < h.orbs.length; i++) near(h.orbs[i].at - h.orbs[i - 1].at, expectedPeriod);
    assert.ok(h.orbs.length >= seconds * 1000 / expectedPeriod);
    assert.equal(h.clock.pending.size, 0);
    assert.equal(h.clock.maxPending, 1);
  }
});

test('reentry merges deadlines using max(end, now+sample), without immediate extra orbs', () => {
  let durationSample = 1;
  const h = harness({ orbsPerSecond: 4 }, { random: () => durationSample });
  h.controller.trigger(); // end=3000
  const timer = h.clock.first()[0];
  durationSample = 0;
  h.clock.advance(100);
  for (let i = 0; i < 100; i++) h.controller.trigger(); // candidate=1100, still 3000
  assert.equal(h.orbs.length, 1);
  assert.equal(h.clock.first()[0], timer);
  h.clock.advance(2900);
  assert.equal(h.controller.isPlaying(), true);
  h.controller.trigger(); // end=max(3000,3900)
  h.clock.advance(3000);
  assert.equal(h.controller.isPlaying(), true);
  h.clock.advance(3900);
  assert.equal(h.controller.isPlaying(), false);
  assert.deepEqual(h.states, [true, false]);
  assert.equal(h.clock.maxPending, 1);
  for (let i = 1; i < h.orbs.length; i++) near(h.orbs[i].at - h.orbs[i - 1].at, 250);
});

test('disabled, whitespace source and denied background gate cannot start or bank experience', () => {
  for (const patch of [{ enabled: false }, { sound: { src: '  ' } }]) {
    const h = harness(patch);
    for (let i = 0; i < 100; i++) assert.equal(h.controller.trigger(), false);
    assert.equal(h.orbs.length, 0);
    assert.equal(h.clock.pending.size, 0);
    h.config = { ...h.config, enabled: true, sound: { ...h.config.sound, src: 'xp' } };
    h.clock.advance(10000);
    assert.equal(h.orbs.length, 0);
    assert.equal(h.controller.trigger(), true);
    assert.equal(h.orbs.length, 1);
  }
  const h = harness();
  h.allowed = false;
  assert.equal(h.controller.trigger(), false);
  assert.equal(h.controller.preview(), false);
  h.allowed = true;
  h.clock.advance(10000);
  assert.equal(h.orbs.length, 0);
});

test('live disabled/source/gate changes stop at next observation and never resume automatically', () => {
  for (const change of ['disabled', 'source', 'gate']) {
    const h = harness({ orbsPerSecond: 10 });
    h.controller.trigger();
    h.clock.advance(50);
    if (change === 'disabled') h.config = { ...h.config, enabled: false };
    if (change === 'source') h.config = { ...h.config, sound: { ...h.config.sound, src: '' } };
    if (change === 'gate') h.allowed = false;
    h.clock.advance(100);
    assert.equal(h.controller.isPlaying(), false);
    assert.equal(h.orbs.length, 1);
    assert.equal(h.clock.pending.size, 0);
    h.config = { ...h.config, enabled: true, sound: { ...h.config.sound, src: 'xp' } };
    h.allowed = true;
    h.clock.advance(10000);
    assert.equal(h.orbs.length, 1);
  }
});

test('observable getter subscriptions stop immediately and dispose releases subscriptions', () => {
  const fixture = storageFixture();
  const store = createConfigStore(fixture);
  store.set({ enabled: true, sound: { src: 'xp' } });
  const getConfig = Object.assign(() => store.getSnapshot(), { subscribe: store.subscribe });
  const gateListeners = new Set();
  let allowed = true;
  const canPlay = Object.assign(() => allowed, {
    subscribe(fn) { gateListeners.add(fn); return () => gateListeners.delete(fn); },
  });
  const h = harness({}, { getConfig, canPlay });
  h.controller.trigger();
  store.set({ enabled: false });
  assert.equal(h.clock.pending.size, 0);
  assert.deepEqual(h.states, [true, false]);
  assert.equal(h.controller.preview(), true);
  store.set({ sound: { src: '' } });
  assert.equal(h.clock.pending.size, 0);
  store.set({ enabled: true, sound: { src: 'xp' } });
  h.controller.trigger();
  allowed = false;
  for (const notify of gateListeners) notify();
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.controller.isPlaying(), false);
  h.controller.dispose();
  assert.equal(gateListeners.size, 0);
  store.dispose();
});

test('preview defaults to ten seconds, bypasses enabled but not source or gates', () => {
  const h = harness({ enabled: false, orbsPerSecond: 10 });
  assert.equal(h.controller.preview(), true);
  h.clock.advance(9000);
  assert.equal(h.controller.trigger(), false, 'disabled triggers cannot extend preview');
  h.clock.advance(9999);
  assert.equal(h.controller.isPlaying(), true);
  h.clock.advance(10000);
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.orbs.length, 100);
  assert.equal(h.config.enabled, false);
  h.config = { ...h.config, sound: { ...h.config.sound, src: '' } };
  assert.equal(h.controller.preview(), false);
  assert.equal(h.clock.pending.size, 0);
});

test('preview duration is bounded and repeated preview/stop/restart cannot bypass rate limit', () => {
  for (const [seconds, expected] of [[0, 100], [0.2, 200], [100, 30000], [NaN, 10000]]) {
    const h = harness({ enabled: false, orbsPerSecond: 10 });
    h.controller.preview(seconds);
    h.clock.advance(expected - 1);
    assert.equal(h.controller.isPlaying(), true);
    h.clock.advance(expected);
    assert.equal(h.controller.isPlaying(), false);
  }
  const h = harness({ enabled: false, orbsPerSecond: 10 });
  h.controller.preview(1);
  for (let i = 0; i < 50; i++) { h.controller.stop(); h.controller.preview(1); }
  assert.equal(h.orbs.length, 1);
  h.clock.advance(99);
  assert.equal(h.orbs.length, 1);
  h.clock.advance(100);
  assert.equal(h.orbs.length, 2);
  assert.equal(h.clock.maxPending, 1);
  h.controller.dispose();
});

test('late timer emits once, resets spacing from actual time, and drops all expired orbs', () => {
  const h = harness({ orbsPerSecond: 10 });
  h.controller.trigger();
  h.clock.late(850);
  assert.deepEqual(h.orbs.map((orb) => orb.at), [0, 850]);
  h.clock.advance(949);
  assert.equal(h.orbs.length, 2);
  h.clock.advance(950);
  assert.equal(h.orbs.length, 3);
  h.clock.late(10000);
  assert.equal(h.orbs.length, 3);
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.clock.pending.size, 0);
});

test('stop/dispose are idempotent, cancel timers and invalidate already captured callbacks', () => {
  const h = harness();
  h.controller.trigger();
  const stale = h.clock.callbacks[0];
  h.controller.stop(); h.controller.stop();
  assert.equal(h.clock.pending.size, 0);
  stale();
  assert.equal(h.orbs.length, 1);
  h.clock.advance(1000);
  h.controller.trigger();
  stale();
  assert.equal(h.orbs.length, 2);
  assert.equal(h.clock.pending.size, 1);
  const latest = h.clock.callbacks.at(-1);
  h.controller.dispose(); h.controller.dispose();
  latest();
  h.clock.advance(10000);
  assert.equal(h.controller.trigger(), false);
  assert.equal(h.controller.preview(), false);
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.orbs.length, 2);
  assert.deepEqual(h.states, [true, false, true, false]);
});

test('async onOrb is never overlapped or accumulated, even across stop/restart', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const h = harness({ orbsPerSecond: 10 }, { onOrb: () => pending });
  h.controller.trigger();
  h.clock.advance(500);
  assert.equal(h.orbs.length, 1);
  h.controller.stop();
  h.controller.trigger();
  h.clock.advance(800);
  assert.equal(h.orbs.length, 1);
  resolve();
  await Promise.resolve();
  assert.equal(h.orbs.length, 1, 'settling a promise must not flush missed orbs');
  h.clock.advance(900);
  assert.equal(h.orbs.length, 2);
  h.controller.dispose();
  await Promise.resolve();
});

test('sync throws and async rejections from callbacks never escape or become unhandled', async () => {
  for (const callback of [() => { throw Error('sync'); }, async () => { throw Error('async'); }]) {
    const h = harness({ orbsPerSecond: 10 }, { onOrb: callback, onStateChange: callback });
    assert.doesNotThrow(() => h.controller.trigger());
    await Promise.resolve();
    assert.doesNotThrow(() => h.clock.advance(100));
    await Promise.resolve();
    h.controller.stop();
    h.controller.dispose();
    await Promise.resolve();
  }
  for (const deps of [
    { getConfig: () => { throw Error('config'); } },
    { canPlay: () => { throw Error('gate'); } },
    { getConfig: async () => { throw Error('async config'); } },
    { canPlay: async () => { throw Error('async gate'); } },
    { random: () => { throw Error('random'); } },
    { now: () => NaN },
    { setTimeout: () => { throw Error('timer'); } },
  ]) {
    const h = harness({}, deps);
    assert.equal(h.controller.trigger(), false);
    assert.equal(h.controller.isPlaying(), false);
    h.controller.dispose();
    await Promise.resolve();
  }
});

test('callbacks can synchronously stop/dispose without scheduling another timeout', () => {
  let controller;
  const first = harness({}, { onOrb: () => controller.stop() });
  controller = first.controller;
  assert.equal(controller.trigger(), false);
  assert.equal(first.clock.pending.size, 0);
  const second = harness({}, { onStateChange: (playing) => { if (playing) controller.dispose(); } });
  controller = second.controller;
  assert.equal(controller.trigger(), false);
  assert.equal(second.orbs.length, 0);
  assert.equal(second.clock.pending.size, 0);
});

test('preview ownership is atomic: a tool result takes over and UI teardown cannot stop it', () => {
  const h = harness();
  assert.equal(h.controller.preview(10), true);
  assert.equal(h.controller.isPreview(), true);
  h.controller.trigger();
  assert.equal(h.controller.isPreview(), false);
  h.controller.stopPreview();
  assert.equal(h.controller.isPlaying(), true);
  h.controller.stop();
  h.clock.advance(200);
  h.controller.preview(10);
  h.controller.stopPreview();
  assert.equal(h.controller.isPlaying(), false);
  assert.equal(h.clock.pending.size, 0);
  h.controller.dispose();
});