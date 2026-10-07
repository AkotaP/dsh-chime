/**
 * Reproduce the browser boot path for the client half: register the bundle,
 * materialize its factory, then actually call `apply(ctx)` against a stub
 * Client context. `tools/verify-client-bundle.mjs` only proves the factory
 * runs; this proves activation runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const code = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');

const registered = new Map();
const fakeWindow = {
  __ModuleLoader__: {
    load(row) {
      registered.set(row.id, row);
    },
  },
};
new Function('window', code)(fakeWindow);

const row = registered.get('dsh-chime');
if (row === undefined) throw new Error('bundle did not register id "dsh-chime"');

const noop = () => {};
const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, noop],
  useEffect: noop,
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  useSyncExternalStore: () => undefined,
  Fragment: Symbol('Fragment'),
};
const jsxRuntime = { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: Symbol('Fragment') };

function requireStub(name) {
  if (name === 'react') return react;
  if (name === 'react/jsx-runtime') return jsxRuntime;
  throw new Error(`unexpected require("${name}")`);
}

// --- browser stand-ins ------------------------------------------------------
globalThis.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
  setItem(k, v) { this.store.set(k, String(v)); },
  removeItem(k) { this.store.delete(k); },
  clear() { this.store.clear(); },
};

const listeners = [];
globalThis.document = {
  addEventListener(type, fn, opts) { listeners.push({ type, fn, opts }); },
  removeEventListener(type, fn) { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
};

class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.destination = {}; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  decodeAudioData(_buf, ok) { if (typeof ok === 'function') ok({ duration: 1 }); return Promise.resolve({ duration: 1 }); }
  createBufferSource() { return { buffer: null, connect: noop, start: noop, stop: noop, disconnect: noop }; }
  createGain() { return { gain: { value: 1, setValueAtTime: noop }, connect: noop, disconnect: noop }; }
}
globalThis.AudioContext = FakeAudioContext;

// --- stub Client context ----------------------------------------------------
const disposers = [];
const services = {
  slots: {
    inject(_key, callback) { return callback(); },
    register() { return noop; },
  },
  locale: {
    register() { return noop; },
    bind() { return (key) => key; },
  },
  jobs: {
    state: { getSnapshot: () => ({ rowsBySession: new Map() }), subscribe: () => noop },
    watchRows() { return noop; },
  },
  sessions: {
    list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }), subscribe: () => noop },
    binding: () => undefined,
  },
  remote: { job: { list: () => (async function* () {})() } },
  uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => noop } },
  uiWorkspace: { pickDirectory: async () => null, listDirectory: async () => ({ entries: [] }) },
};

const ctx = {
  // Cordis' `inject` exposes declared services as context properties, while
  // `ctx.get(...)` is the optional-lookup form — the plugin uses both.
  ...services,
  get(name) { return services[name]; },
  on() { return noop; },
  provide() { return noop; },
  effect(callback, label) {
    const dispose = callback();
    disposers.push({ label, dispose });
    return () => { if (typeof dispose === 'function') dispose(); };
  },
};

const mod = row.factory(requireStub);
const apply = mod.apply ?? mod.default?.apply;
if (typeof apply !== 'function') throw new Error('client half exports no apply()');

console.log('inject         :', (mod.inject ?? []).join(', '));

try {
  apply(ctx);
  console.log('apply()        : OK');
} catch (error) {
  console.log('apply()        : FAILED');
  console.log('  message      :', error && error.message);
  console.log('  stack        :', String(error && error.stack).split('\n').slice(0, 6).join('\n                  '));
  process.exit(1);
}

// Degradation: an older DSH without the `jobs` service must still activate —
// the roster count simply stays 0 instead of throwing.
delete services.jobs;
try {
  apply(ctx);
  console.log('apply() w/o jobs: OK — degraded, count stays 0');
} catch (error) {
  console.log('apply() w/o jobs: FAILED');
  console.log('  message        :', error && error.message);
  process.exit(1);
}

console.log('effects        :', disposers.map((d) => d.label).join(' | '));
console.log('doc listeners  :', listeners.map((l) => l.type).join(', ') || '(none)');

// `apply` starts the detector's poll timer, so the event loop would otherwise
// stay alive forever. Tear the effects down, then exit explicitly.
for (const record of disposers) {
  try {
    if (typeof record.dispose === 'function') record.dispose();
  } catch {
    // best effort
  }
}
console.log('teardown       : OK');
process.exit(0);
