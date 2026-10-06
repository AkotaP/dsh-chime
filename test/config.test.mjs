/**
 * Regression guards for the configuration store.
 *
 * The bug this file exists to prevent: `configsEqual` decides whether a write
 * changes anything, so any top-level field missing from that comparison can
 * never be updated — the settings form would silently snap back to the default
 * value on blur. The first test below enumerates `DEFAULT_CONFIG` so a future
 * field cannot be added without the comparison (and this list) being extended.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfigStore, DEFAULT_CONFIG, normalizeConfig } from '../src/client/config.js';

/**
 * Run `body` with a minimal `localStorage` double, so the store exercises its
 * persistence path instead of falling back to memory.
 *
 * @param {() => void} body test body.
 */
function withStorage(body) {
  const backing = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => {
      backing.set(key, String(value));
    },
    removeItem: (key) => {
      backing.delete(key);
    },
  };
  try {
    body(backing);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test('every top-level default field can actually be updated', () => {
  withStorage(() => {
    const fields = Object.keys(DEFAULT_CONFIG).sort();
    assert.deepEqual(
      fields,
      ['backgroundSessions', 'completionMinSeconds', 'enabled', 'kinds', 'maxDepth'],
      'DEFAULT_CONFIG gained a field — extend configsEqual and this test, or the field will be silently unupdatable',
    );

    for (const field of fields) {
      if (field === 'kinds') continue;
      const store = createConfigStore();
      const before = store.getSnapshot()[field];
      const next = typeof before === 'boolean' ? !before : before + 1;
      store.update({ [field]: next });
      assert.equal(
        store.getSnapshot()[field],
        next,
        `update({ ${field}: ... }) did not change the snapshot`,
      );
    }
  });
});

test('setKind still updates one per-kind field', () => {
  withStorage(() => {
    const store = createConfigStore();
    store.setKind('completed', { src: 'x.mp3', source: 'file', volume: 0.5 });
    const entry = store.getSnapshot().kinds.completed;
    assert.deepEqual(
      { src: entry.src, source: entry.source, volume: entry.volume },
      { src: 'x.mp3', source: 'file', volume: 0.5 },
    );
  });
});

test('updated values survive a reload', () => {
  withStorage(() => {
    const first = createConfigStore();
    first.update({ maxDepth: 7, completionMinSeconds: 25 });
    const second = createConfigStore();
    assert.equal(second.getSnapshot().maxDepth, 7);
    assert.equal(second.getSnapshot().completionMinSeconds, 25);
  });
});

test('an unchanged write is still a no-op', () => {
  withStorage(() => {
    const store = createConfigStore();
    const before = store.getSnapshot();
    store.update({ maxDepth: before.maxDepth });
    assert.equal(store.getSnapshot(), before, 'writing the same value should keep the same snapshot');
  });
});

test('normalization clamps bounds and falls back on junk', () => {
  assert.equal(normalizeConfig({ maxDepth: 99 }).maxDepth, 16);
  assert.equal(normalizeConfig({ maxDepth: -3 }).maxDepth, 0);
  assert.equal(normalizeConfig({ maxDepth: 4.7 }).maxDepth, 4);
  assert.equal(normalizeConfig({ maxDepth: '7' }).maxDepth, DEFAULT_CONFIG.maxDepth);
  assert.equal(normalizeConfig({}).maxDepth, DEFAULT_CONFIG.maxDepth);

  assert.equal(normalizeConfig({ completionMinSeconds: 9999 }).completionMinSeconds, 3600);
  assert.equal(normalizeConfig({ completionMinSeconds: -5 }).completionMinSeconds, 0);
  assert.equal(normalizeConfig({}).completionMinSeconds, 10);
  assert.equal(normalizeConfig({ completionMinSeconds: 'abc' }).completionMinSeconds, 10);
});
