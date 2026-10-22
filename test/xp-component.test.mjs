/** Built-artifact activation tests: XP needs no running notification component. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { apply as applyXpHost } from '../components/xp/lib/index.js';
import { apply as applyNotificationHost } from '../lib/index.js';
import { toPlayableUrl, createFileBrowser } from '../src/client/assets.js';

const code = readFileSync(new URL('../components/xp/lib/client.js', import.meta.url), 'utf8');
const noop = () => {};
function observable(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) { value = next; for (const fn of [...listeners]) fn(); }, size: () => listeners.size };
}
function events() {
  const listeners = new Map();
  return { addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type) { for (const fn of [...listeners.get(type) ?? []]) fn(); },
    size: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) };
}
function fixture(config = {}) {
  const storage = new Map([['dsh.chime.xp.config.v1', JSON.stringify(config)], ['dsh.chime.config.v1', '{"enabled":false}']]);
  let focused = true, currentTime = 0, revision = 1, seq = 5;
  let registered, allocated = 0;
  const sources = [], timers = new Map(), slots = [], disposers = [];
  const doc = Object.assign(events(), { hasFocus: () => focused, visibilityState: 'visible' });
  const win = Object.assign(events(), { __ModuleLoader__: { load: row => { registered = row; } } });
  const source = observable({ entries: [{ event: { seq: 5, type: 'tool/result' } }], revision, change: { kind: 'replace' } });
  const current = observable({ key: 'a' });
  const list = observable({ ids: ['a'], byId: { a: { retainedBy: { mainView: 1 } } } });
  const statuses = observable(new Map([['a', { running: true }]]));
  class Context {
    constructor() { allocated++; this.state = 'running'; this.destination = {}; this.currentTime = 0; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    decodeAudioData(_data, ok) { const buffer = { duration: 0.4 }; ok?.(buffer); return Promise.resolve(buffer); }
    createBufferSource() { const voice = { playbackRate: { value: 1 }, connect: noop, disconnect: noop,
      start() { this.started = true; }, stop() { this.stopped = true; } }; sources.push(voice); return voice; }
    createGain() { return { gain: { value: 1, setValueAtTime(v) { this.value = v; } }, connect: noop, disconnect: noop }; }
  }
  const react = { createElement: (type, props) => ({ type, props }) };
  vm.runInNewContext(code, { window: win, document: doc, AudioContext: Context, AbortController, URL, console,
    performance: { now: () => currentTime },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    setTimeout(fn, ms) { const id = Symbol(); timers.set(id, { fn, at: currentTime + ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  assert.equal(registered.id, 'dsh-chime-xp');
  const module = registered.factory(name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: noop, jsxs: noop };
    throw new Error('unexpected external ' + name);
  });
  const services = {
    sessions: { list, binding: () => ({ eventSource: source }) },
    uiSession: { adapter: { current }, sessionStatus: statuses }, uiWorkspace: {},
    locale: { register: () => noop },
    slots: { inject(_name, fn) { const dispose = fn(); if (dispose) disposers.push(dispose); },
      register(options, render) { slots.push({ options, render }); return noop; } },
  };
  module.apply({ get: key => services[key], slots: services.slots,
    effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose); return dispose; } });
  return { sources, slots, storage, timers, source, statuses, allocated: () => allocated,
    tool() { const e = { event: { seq: ++seq, type: 'tool/result' } };
      const snapshot = source.getSnapshot(); source.set({ entries: [...snapshot.entries, e], revision: ++revision, change: { kind: 'append', entries: [e] } }); },
    blur() { focused = false; win.emit('blur'); },
    focus() { focused = true; },
    tick(ms) { currentTime += ms; for (const [id, timer] of [...timers]) if (timer.at <= currentTime) { timers.delete(id); timer.fn(); } },
    dispose() { for (const fn of disposers.reverse()) fn(); },
    subscriptions: () => source.size() + current.size() + list.size() + statuses.size() + doc.size() + win.size() };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('XP client mounts only its row settings, default source is silent and lifecycle fully releases', () => {
  const h = fixture();
  assert.equal(h.slots.length, 1);
  assert.equal(h.slots[0].options.name, 'plugins.row.config');
  assert.equal(h.slots[0].options.key, 'dsh-chime#chime-xp');
  h.tool(); assert.equal(h.sources.length, 0); assert.equal(h.allocated(), 0);
  assert.equal(h.storage.get('dsh.chime.config.v1'), '{"enabled":false}');
  h.dispose(); assert.equal(h.subscriptions(), 0); assert.equal(h.timers.size, 0);
});

test('XP plays independently, merges tool triggers, applies pitch and stops on blur without catch-up', async () => {
  const h = fixture({ enabled: true, sound: { src: '/sounds/orb.ogg', source: 'file', volume: 0.1 },
    durationMinSeconds: 1, durationMaxSeconds: 1, orbsPerSecond: 10 });
  try {
    await flush(); h.tool(); await flush();
    assert.equal(h.sources.filter(v => v.started).length, 1);
    assert.ok(h.sources[0].playbackRate.value >= 0.55 && h.sources[0].playbackRate.value <= 1.25);
    h.tool(); await flush(); assert.equal(h.sources.length, 1);
    h.tick(100); await flush(); assert.equal(h.sources.length, 2);
    assert.equal(h.sources[0].stopped, undefined, 'tails overlap instead of cutting each other');
    h.blur(); assert.ok(h.sources.every(v => v.stopped));
    h.tick(500); h.focus(); await flush(); assert.equal(h.sources.length, 2);
    h.tool(); await flush(); assert.equal(h.sources.length, 3);
  } finally { h.dispose(); }
  assert.equal(h.subscriptions(), 0); assert.equal(h.timers.size, 0);
});

test('manual rhythm preview stays adjustable while automatic playback is off', async () => {
  const h = fixture({ enabled: false, sound: { src: '/sounds/orb.ogg', source: 'file', volume: 0.1 } });
  try {
    const { props } = h.slots[0].render({ view: 'page' });
    await flush();
    props.controller.preview(10); await flush();
    assert.equal(h.sources.length, 1);
    // Supply plain objects from the bundle's VM realm, as its real React UI does.
    const before = props.configStore.getSnapshot();
    const sound = Object.assign(Object.create(Object.getPrototypeOf(before.sound)), { volume: 0.2 });
    props.configStore.set(Object.assign(Object.create(Object.getPrototypeOf(before)), { sound }));
    assert.equal(props.configStore.getSnapshot().sound.volume, 0.2);
    assert.equal(props.controller.isPlaying(), true);
    assert.equal(h.sources[0].stopped, undefined);
    props.controller.stopPreview();
    assert.ok(h.sources[0].stopped);
    assert.equal(h.timers.size, 0);
  } finally { h.dispose(); }
});

test('pending interaction and completion cancel XP voices and timers', async () => {
  const h = fixture({ enabled: true, sound: { src: 'https://example.test/orb.ogg' } });
  try {
    await flush(); h.tool(); await flush();
    h.statuses.set(new Map([['a', { running: true, pendingInteraction: { kind: 'question' } }]]));
    assert.equal(h.timers.size, 0); assert.ok(h.sources.every(v => v.stopped));
    h.statuses.set(new Map([['a', { running: true }]]));
    h.tick(200); h.tool(); await flush();
    h.statuses.set(new Map([['a', { running: false }]]));
    assert.equal(h.timers.size, 0); assert.ok(h.sources.every(v => v.stopped));
  } finally { h.dispose(); }
});

test('notification and XP host rows own disjoint routes; disabling either leaves the other intact', () => {
  const routes = new Map();
  function ctx() {
    const releases = [];
    const web = { register(route) { assert.ok(!routes.has(route.path)); routes.set(route.path, route); return () => routes.delete(route.path); } };
    return { get: () => web, webServer: web, effect(fn) { const dispose = fn(); releases.push(dispose); },
      dispose() { releases.reverse().forEach(fn => fn?.()); } };
  }
  const original = ctx(), xp = ctx();
  applyNotificationHost(original); applyXpHost(xp);
  assert.equal(routes.size, 5);
  original.dispose(); assert.deepEqual([...routes.keys()].sort(), ['/dsh-chime-xp/asset', '/dsh-chime-xp/list']);
  xp.dispose(); assert.equal(routes.size, 0);
});

test('shared asset helpers preserve old defaults and isolate XP routes', async t => {
  assert.equal(toPlayableUrl('/sounds/orb.ogg', 'file', 'xp'), '/dsh-chime/asset?path=%2Fsounds%2Forb.ogg');
  assert.equal(toPlayableUrl('/sounds/orb.ogg', 'file', 'xp', '/dsh-chime-xp'), '/dsh-chime-xp/asset?path=%2Fsounds%2Forb.ogg');
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url); return { ok: true, json: async () => ({ entries: [] }) }; });
  await createFileBrowser({}, { routePrefix: '/dsh-chime-xp' }).listAudioFiles('/sounds');
  assert.deepEqual(urls, ['/dsh-chime-xp/list?path=%2Fsounds']);
});

test('package includes the independent manifest and built artifacts, optional row is disabled', () => {
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const xp = JSON.parse(readFileSync(new URL('../components/xp/package.json', import.meta.url)));
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.ok(root.files.includes('components/xp'));
  assert.equal(xp.name, 'dsh-chime-xp');
  assert.ok(patch.includes("id: chime-xp\n      name: 'dsh-chime-xp'\n      disabled: true"));
  assert.ok(readFileSync(new URL('../components/xp/lib/index.js', import.meta.url), 'utf8').includes('/dsh-chime-xp/asset'));
  assert.ok(!code.includes('require("dsh-chime")'), 'XP must not depend on notification client activation');
});
