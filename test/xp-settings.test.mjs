/** Offline hook/element contract tests. React stays supplied by the DSH host, never installed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { version } from 'esbuild';
import { isLocalPath } from '../src/client/assets.js';
import { NS, zh, en } from '../src/xp/locale.js';

// Some Windows checkouts retain the pnpm binary but lack its optional-dependency link.
// Reuse that existing executable without installing or changing repository files.
if (process.platform === 'win32' && !process.env.ESBUILD_BINARY_PATH) {
  const binary = fileURLToPath(new URL('../node_modules/.pnpm/@esbuild+win32-' + process.arch + '@' + version + '/node_modules/@esbuild/win32-' + process.arch + '/esbuild.exe', import.meta.url));
  if (existsSync(binary)) process.env.ESBUILD_BINARY_PATH = binary;
}
const source = readFileSync(new URL('../src/xp/settings.jsx', import.meta.url), 'utf8');
// Keep generated fixtures in the ignored workspace area, not a shared Windows temp tree.
const temporaryRoot = fileURLToPath(new URL('../.probe/', import.meta.url));
mkdirSync(temporaryRoot, { recursive: true });
const temporary = mkdtempSync(join(temporaryRoot, 'dsh-xp-ui-test-'));
let code;
try {
  const output = join(temporary, 'settings.cjs');
  const binary = createRequire(import.meta.url).resolve('esbuild/bin/esbuild');
  // Inherit stdio: captured child pipes are deliberately unavailable in the DSH sandbox.
  const compiled = spawnSync(process.execPath, [binary, fileURLToPath(new URL('../src/xp/settings.jsx', import.meta.url)), '--format=cjs', '--jsx-factory=React.createElement', '--outfile=' + output, '--log-level=error'], { stdio: 'inherit' });
  if (compiled.error) throw compiled.error;
  assert.equal(compiled.status, 0, 'JSX compilation must succeed');
  code = readFileSync(output, 'utf8');
} finally { rmSync(temporary, { recursive: true, force: true }); }
const defaults = () => ({ enabled: false, sound: { src: '', source: 'url', volume: 0.1 }, durationMinSeconds: 1, durationMaxSeconds: 3, orbsPerSecond: 6, playInBackground: false });

function store(initial = {}) {
  let value = { ...defaults(), ...initial };
  const listeners = new Set();
  const writes = [];
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(partial) { writes.push(structuredClone(partial)); value = { ...value, ...structuredClone(partial) }; listeners.forEach(listener => listener()); return true; },
    reset() { value = defaults(); listeners.forEach(listener => listener()); return true; },
    writes,
    listeners,
  };
}

function nodes(tree) {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return typeof tree === 'object' ? [tree, ...nodes(tree.props.children)] : [];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  return typeof tree === 'object' ? text(tree.props.children) : String(tree);
}
const english = (key, params) => en[key];
const clone = value => JSON.parse(JSON.stringify(value));

function mount(props = {}, component = 'XpSettings') {
  const cells = [];
  const effects = [];
  const intervals = new Map();
  let cursor = 0;
  let dirty = false;
  let tree;
  let now = 100;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [cells[index], next => { const value = typeof next === 'function' ? next(cells[index]) : next; if (!Object.is(value, cells[index])) { cells[index] = value; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in cells)) cells[index] = { current: initial }; return cells[index]; },
    useId() { const index = cursor++; if (!(index in cells)) cells[index] = ':fixture-' + index + ':'; return cells[index]; },
    useEffect(effect, deps) {
      const index = cursor++;
      const old = cells[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        cells[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { cells[index].cleanup?.(); cells[index].cleanup = effect(); });
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, AbortController,
    Date: { now: () => now },
    setInterval(fn, ms) { const id = intervals.size + 1; intervals.set(id, { fn, ms }); return id; },
    clearInterval: id => intervals.delete(id),
    require(name) {
      if (name === 'react') return React;
      if (name === './locale.js') return { zh };
      if (name === '../client/assets.js') return { isLocalPath };
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  const current = { configStore: store(), t: english, ...props };
  function render() {
    let count = 0;
    do {
      dirty = false;
      cursor = 0;
      tree = module.exports[component](current);
      while (effects.length) effects.shift()();
      assert.ok(++count < 15, 'render should settle');
    } while (dirty);
    return tree;
  }
  render();
  return {
    props: current,
    render,
    all: () => nodes(render()),
    text: () => text(render()),
    input(suffix) { const input = nodes(render()).find(node => node.type === 'input' && node.props.id.endsWith(suffix)); assert.ok(input, suffix); return input; },
    button(label) { const button = nodes(render()).find(node => node.type === 'button' && text(node) === (en[label] || label)); assert.ok(button, label); return button; },
    async event(node, event, value) {
      await node.props[event]({ target: { value, checked: value }, currentTarget: { blur: () => node.props.onBlur?.() } });
      for (let i = 0; i < 6; i++) await Promise.resolve();
      render();
    },
    async edit(suffix, value, commit = true) {
      this.input(suffix).props.onChange({ target: { value } }); render();
      if (commit) await this.event(this.input(suffix), 'onBlur');
    },
    async click(label) { await this.event(this.button(label), 'onClick'); },
    poll(elapsed = 200) { now += elapsed; [...intervals.values()].forEach(interval => interval.fn()); render(); },
    intervals,
    unmount() { cells.forEach(cell => cell?.cleanup?.()); },
  };
}

function configured() { return store({ sound: { src: 'https://example.com/xp.ogg', source: 'url', volume: 0.1 } }); }

test('XP dictionaries have identical nonempty keys and placeholders', () => {
  assert.equal(NS, 'dshChimeXp');
  for (const match of source.matchAll(/tt\('([A-Za-z]+)'/g)) assert.ok(Object.hasOwn(zh, match[1]), match[1]);
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const key of Object.keys(zh)) {
    assert.ok(zh[key].trim() && en[key].trim(), key);
    assert.deepEqual(zh[key].match(/\{\w+\}/g), en[key].match(/\{\w+\}/g), key);
  }
  assert.ok(en.sourcePlaceholder.includes('E:\\Sounds\\orb.ogg'));
});

test('defaults, accessible labels, localized copy and XP-only CSS', () => {
  const ui = mount();
  assert.equal(ui.input('enabled').props.checked, false);
  assert.equal(ui.input('background').props.checked, false);
  assert.equal(ui.input('volume').props.value, 0.1);
  assert.equal(ui.input('durationMinSeconds').props.value, '1');
  assert.equal(ui.input('durationMaxSeconds').props.value, '3');
  assert.equal(ui.input('orbsPerSecond').props.value, '6');
  assert.equal(ui.button('previewSound').props.disabled, true);
  assert.equal(ui.button('previewRhythm').props.disabled, true);
  for (const input of ui.all().filter(node => node.type === 'input')) {
    assert.ok(ui.all().some(node => node.type === 'label' && node.props.htmlFor === input.props.id), input.props.id);
  }
  const css = text(ui.all().find(node => node.type === 'style'));
  for (const selector of css.matchAll(/(?:^|\})([^{}]+)\{/g)) {
    assert.ok(selector[1].split(',').every(part => part.trim().startsWith('.xp-')), selector[1]);
  }
  assert.doesNotMatch(ui.text(), /系统通知|Notification|permission request/i);
  assert.match(ui.text(), /0.55–1.25/);
  assert.match(ui.text(), /historical tool events/);
  assert.equal(ui.props.configStore.writes.length, 0, 'mount never writes defaults');
  ui.unmount();
  assert.equal(ui.intervals.size, 0);
  assert.equal(ui.props.configStore.listeners.size, 0);
});

test('numeric drafts survive intermediate input and unrelated store notifications', async () => {
  const ui = mount();
  await ui.edit('orbsPerSecond', '', false);
  assert.equal(ui.input('orbsPerSecond').props.value, '');
  await ui.edit('orbsPerSecond', '0.', false);
  ui.props.configStore.set({ enabled: true });
  assert.equal(ui.input('orbsPerSecond').props.value, '0.');
  assert.equal(ui.props.configStore.getSnapshot().orbsPerSecond, 6);
  await ui.edit('orbsPerSecond', '0.15');
  assert.equal(ui.props.configStore.getSnapshot().orbsPerSecond, 0.15);
  await ui.edit('durationMinSeconds', '');
  assert.equal(ui.input('durationMinSeconds').props.value, '');
  assert.ok(ui.text().includes(en.numberInvalid));
  assert.equal(ui.props.configStore.getSnapshot().durationMinSeconds, 1);
  await ui.click('reset');
  assert.equal(ui.input('durationMinSeconds').props.value, '1', 'reset restores even an unchanged persisted value');
  ui.unmount();
});

test('duration bounds update atomically, preserve order and clamp rates', async () => {
  const ui = mount();
  await ui.edit('durationMinSeconds', '100');
  assert.deepEqual(ui.props.configStore.writes.at(-1), { durationMinSeconds: 30, durationMaxSeconds: 30 });
  await ui.edit('durationMaxSeconds', '0.05');
  assert.deepEqual(ui.props.configStore.writes.at(-1), { durationMinSeconds: 0.1, durationMaxSeconds: 0.1 });
  await ui.edit('orbsPerSecond', '20');
  assert.equal(ui.props.configStore.getSnapshot().orbsPerSecond, 10);
  await ui.edit('orbsPerSecond', '-2');
  assert.equal(ui.props.configStore.getSnapshot().orbsPerSecond, 0.1);
  ui.unmount();
});

test('URL/absolute sources reuse asset detection and retain independent volume', async () => {
  const ui = mount();
  await ui.event(ui.input('volume'), 'onChange', '0.24');
  for (const path of ['E:\\Sounds\\orb.ogg', '\\\\server\\share\\orb.wav', '/home/me/orb.ogg']) {
    await ui.edit('source', path);
    assert.deepEqual(ui.props.configStore.getSnapshot().sound, { src: path, source: 'file', volume: 0.24 });
  }
  await ui.edit('source', 'https://example.com/orb.ogg');
  assert.equal(ui.props.configStore.getSnapshot().sound.source, 'url');
  const before = ui.props.configStore.writes.length;
  await ui.edit('source', '../orb.ogg');
  assert.equal(ui.props.configStore.writes.length, before);
  assert.ok(ui.text().includes(en.sourceInvalid));
  await ui.click('clear');
  assert.deepEqual(ui.props.configStore.getSnapshot().sound, { src: '', source: 'url', volume: 0.24 });
  assert.equal(ui.button('previewSound').props.disabled, true);
  assert.ok(ui.props.configStore.writes.every(partial => Object.keys(partial).every(key => ['sound'].includes(key))));
  ui.unmount();
});

test('one-sound preview unlocks and uses exactly the existing two-argument audio API', async () => {
  const calls = [];
  const configStore = configured();
  const ui = mount({ configStore, audio: { unlock: async () => calls.push('unlock'), preview: async (...args) => { calls.push(clone(args)); return true; } } });
  await ui.click('previewSound');
  assert.deepEqual(calls, ['unlock', ['xp', configStore.getSnapshot().sound]]);
  assert.equal(configStore.getSnapshot().enabled, false, 'preview works with automatic playback disabled');
  ui.unmount();
});

test('preview errors and persistence failures remain readable', async () => {
  const configStore = configured();
  const ui = mount({ configStore, audio: { preview: () => { throw new Error('HTTP 404: audio missing'); } } });
  await ui.click('previewSound');
  assert.ok(ui.text().includes('HTTP 404: audio missing'));
  assert.ok(ui.all().some(node => node.props.role === 'alert'));
  ui.props.audio.preview = () => false;
  await ui.click('previewSound');
  assert.ok(ui.text().includes(en.previewFailed));
  configStore.set = () => { throw new Error('storage denied'); };
  await ui.event(ui.input('enabled'), 'onChange', true);
  assert.ok(ui.text().includes('storage denied'));
  configStore.set = () => false;
  await ui.event(ui.input('enabled'), 'onChange', true);
  assert.ok(ui.text().includes(en.writeFailed));
  ui.unmount();
});

test('10-second rhythm polls state and only stops UI-owned playback on unmount', async () => {
  let playing = false;
  let stops = 0;
  const calls = [];
  const controller = { preview: async seconds => { calls.push(seconds); playing = true; return true; }, stop() { stops++; playing = false; }, isPlaying: () => playing };
  Object.defineProperty(controller, 'onStateChange', { get() { throw new Error('not a UI subscription'); } });
  const ui = mount({ configStore: configured(), audio: { unlock: async () => calls.push('unlock') }, controller });
  await ui.click('previewRhythm');
  assert.deepEqual(calls, ['unlock', 10]);
  ui.poll();
  assert.ok(ui.text().includes(en.playing));
  assert.equal(ui.button('stopPreview').props.disabled, false);
  ui.unmount();
  assert.equal(stops, 1);
  assert.equal(ui.intervals.size, 0);
  playing = true; // Automatic playback on another mount is not owned by that settings page.
  const automatic = mount({ controller });
  automatic.poll();
  automatic.unmount();
  assert.equal(stops, 1);
});

test('ended or expired previews relinquish ownership before automatic playback', async () => {
  let playing = false;
  let stops = 0;
  const controller = { preview() { playing = true; return true; }, stop() { stops++; }, isPlaying: () => playing };
  const ui = mount({ configStore: configured(), controller });
  await ui.click('previewRhythm');
  playing = false;
  ui.poll();
  playing = true;
  ui.unmount();
  assert.equal(stops, 0);
  const expired = mount({ configStore: configured(), controller });
  await expired.click('previewRhythm');
  expired.poll(10100);
  assert.equal(expired.button('stopPreview').props.disabled, true);
  expired.unmount();
  assert.equal(stops, 0);
});

test('explicit stop and unmount during unlock never stop unrelated playback', async () => {
  let resolveUnlock;
  let starts = 0;
  let stops = 0;
  const controller = { preview() { starts++; return true; }, stop() { stops++; }, isPlaying: () => true };
  const ui = mount({ configStore: configured(), controller });
  await ui.click('previewRhythm');
  await ui.click('stopPreview');
  ui.unmount();
  assert.equal(stops, 1);
  const late = mount({ configStore: configured(), controller, audio: { unlock: () => new Promise(resolve => { resolveUnlock = resolve; }) } });
  const request = late.button('previewRhythm').props.onClick();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  late.unmount();
  resolveUnlock();
  await request;
  assert.equal(starts, 1, 'unmount cancels preview before audio unlock completes');
  assert.equal(stops, 1);
});

test('automatic takeover is guarded atomically even before the next UI poll', async () => {
  let isPreview = false;
  let stops = 0;
  let guardedStops = 0;
  const controller = {
    preview() { isPreview = true; return true; },
    stop() { stops++; },
    stopPreview() { guardedStops++; if (isPreview) { stops++; isPreview = false; } },
    isPreview: () => isPreview,
    isPlaying: () => true,
  };
  const ui = mount({ configStore: configured(), controller });
  await ui.click('previewRhythm');
  isPreview = false; // An automatic tool result takes over between two polling ticks.
  ui.unmount();
  assert.equal(guardedStops, 1);
  assert.equal(stops, 0);
  const observed = mount({ configStore: configured(), controller });
  await observed.click('previewRhythm');
  isPreview = false;
  observed.poll();
  assert.equal(observed.button('stopPreview').props.disabled, true);
  observed.unmount();
  assert.equal(guardedStops, 1);
});

test('delayed rhythm audio failure becomes a visible error without stale old errors', async () => {
  let playing = true;
  let failure = new Error('old unrelated failure');
  const controller = { preview: () => true, stop() {}, isPlaying: () => playing };
  const ui = mount({ configStore: configured(), controller, audio: { lastFailure: kind => { assert.equal(kind, 'xp'); return failure; } } });
  await ui.click('previewRhythm');
  ui.poll();
  assert.ok(!ui.text().includes('old unrelated failure'));
  failure = new Error('decode failed during rhythm preview');
  playing = false;
  ui.poll();
  assert.ok(ui.text().includes('decode failed during rhythm preview'));
  assert.ok(ui.all().some(node => node.props.role === 'alert'));
  ui.unmount();
});

test('stale cancelled preview promises cannot overwrite a newer preview or show cancellation errors', async () => {
  const resolvers = [];
  let stops = 0;
  const controller = { preview: () => new Promise(resolve => resolvers.push(resolve)), stop() { stops++; }, isPlaying: () => true };
  const ui = mount({ configStore: configured(), controller });
  const old = ui.button('previewRhythm').props.onClick();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await ui.click('stopPreview');
  const next = ui.button('previewRhythm').props.onClick();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  resolvers[0](false);
  await old;
  assert.ok(!ui.text().includes(en.previewFailed));
  assert.equal(ui.button('stopPreview').props.disabled, false);
  resolvers[1](true);
  await next;
  ui.unmount();
  assert.equal(stops, 2);
});

test('directory picker, navigation, truncation and file choice retain original asset interfaces', async () => {
  const calls = [];
  const files = [{ name: 'orb.ogg', path: 'E:/Sounds/sub/orb.ogg', size: 0 }];
  const fileBrowser = {
    async pickDirectory(signal) { assert.equal(signal.aborted, false); return 'E:/Sounds'; },
    async listAudioFiles(path, signal) {
      calls.push(path);
      assert.equal(signal.aborted, false);
      return { files: path.endsWith('/sub') ? files : [], directories: path.endsWith('/sub') ? [] : [{ name: 'sub', path: 'E:/Sounds/sub' }], enumerable: true, truncated: true };
    },
  };
  const ui = mount({ fileBrowser });
  await ui.click('chooseDirectory');
  assert.ok(ui.text().includes(en.truncated));
  await ui.click('Open directory: sub');
  assert.equal(ui.input('directory').props.value, 'E:/Sounds/sub');
  await ui.click('Select audio: orb.ogg');
  assert.deepEqual(ui.props.configStore.getSnapshot().sound, { src: files[0].path, source: 'file', volume: 0.1 });
  await ui.click('parentDirectory');
  assert.deepEqual(calls, ['E:/Sounds', 'E:/Sounds/sub', 'E:/Sounds']);
  ui.unmount();
});

test('directory cancellation/errors are distinct, and unmount aborts an outstanding list', async () => {
  let signal;
  let resolveList;
  let lists = 0;
  const fileBrowser = { pickDirectory: async () => null, listAudioFiles: () => { lists++; throw new Error('directory access denied'); } };
  const ui = mount({ fileBrowser });
  await ui.click('chooseDirectory');
  assert.equal(lists, 0);
  await ui.edit('directory', 'E:/Sounds', false);
  await ui.click('loadDirectory');
  assert.ok(ui.text().includes('directory access denied'));
  ui.props.fileBrowser.listAudioFiles = (path, value) => { signal = value; return new Promise(resolve => { resolveList = resolve; }); };
  const request = ui.button('loadDirectory').props.onClick();
  assert.equal(signal.aborted, false);
  ui.unmount();
  assert.equal(signal.aborted, true);
  resolveList({ files: [], directories: [] });
  await request;
});

test('summary subscribes independently and resets never write original chime keys', async () => {
  const configStore = configured();
  const ui = mount({ configStore }, 'XpSummary');
  assert.ok(ui.text().includes(en.summaryDisabled));
  assert.ok(ui.text().includes('10%'));
  configStore.set({ enabled: true, orbsPerSecond: 9 });
  assert.ok(ui.text().includes(en.summaryEnabled));
  assert.ok(ui.text().includes('9 sounds/s'));
  ui.unmount();
  assert.equal(configStore.listeners.size, 0);
  const form = mount({ configStore, t: key => key });
  assert.ok(form.text().includes(zh.enabled), 'missing translator keys fall back to dictionary, not raw keys');
  await form.click(zh.reset);
  assert.deepEqual(configStore.getSnapshot(), defaults());
  form.unmount();
});
