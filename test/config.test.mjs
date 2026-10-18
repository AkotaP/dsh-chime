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
      ['attention', 'completionMinSeconds', 'enabled', 'kinds', 'maxDepth', 'notify'],
      'DEFAULT_CONFIG gained a field — extend configsEqual and this test, or the field will be silently unupdatable',
    );

    for (const field of fields) {
      // 对象型字段（attention / kinds / notify）由各自的专项用例覆盖，这里只跑标量。
      if (field === 'kinds' || field === 'notify' || field === 'attention') continue;
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

test('attention：两路档位都能写进去，且互不干扰（configsEqual 覆盖了 attention）', () => {
  withStorage(() => {
    const store = createConfigStore();
    const before = store.getSnapshot().attention;

    store.update({ attention: { ...before, sound: 'away' } });
    assert.equal(store.getSnapshot().attention.sound, 'away');
    assert.equal(store.getSnapshot().attention.notify, before.notify, '改一路不该动另一路');

    store.update({ attention: { ...store.getSnapshot().attention, notify: 'never' } });
    assert.equal(store.getSnapshot().attention.notify, 'never');

    // 非法取值回落默认，而不是把整份配置写坏。
    store.update({ attention: { sound: 'bogus', notify: 'nope' } });
    assert.equal(store.getSnapshot().attention.sound, DEFAULT_CONFIG.attention.sound);
    assert.equal(store.getSnapshot().attention.notify, DEFAULT_CONFIG.attention.notify);
  });
});

test('老配置的 backgroundSessions 折算进 attention.sound，且不再写出', () => {
  const KEY = 'dsh.chime.config.v1';

  withStorage((backing) => {
    backing.set(KEY, JSON.stringify({ enabled: true, backgroundSessions: true }));
    const on = createConfigStore();
    assert.equal(on.getSnapshot().attention.sound, 'always', 'true 应折算成 always');
    assert.equal(
      Object.prototype.hasOwnProperty.call(on.getSnapshot(), 'backgroundSessions'),
      false,
      '旧字段不该再出现在快照里',
    );
  });

  withStorage((backing) => {
    backing.set(KEY, JSON.stringify({ enabled: true, backgroundSessions: false }));
    const off = createConfigStore();
    assert.equal(off.getSnapshot().attention.sound, 'current-only', 'false 应折算成 current-only');
    assert.equal(off.getSnapshot().attention.notify, DEFAULT_CONFIG.attention.notify);
  });
});

test('notify 的总开关与逐类开关都真的能写进去（configsEqual 覆盖了 notify）', () => {
  withStorage(() => {
    const store = createConfigStore();

    store.update({ notify: { ...store.getSnapshot().notify, enabled: true } });
    assert.equal(
      store.getSnapshot().notify.enabled,
      true,
      'update({ notify.enabled }) 被 commit 丢掉了——configsEqual 没比较 notify',
    );

    const kinds = { ...store.getSnapshot().notify.kinds, completed: false };
    store.update({ notify: { ...store.getSnapshot().notify, kinds } });
    assert.equal(
      store.getSnapshot().notify.kinds.completed,
      false,
      'update({ notify.kinds }) 被 commit 丢掉了——configsEqual 没比较 notify.kinds',
    );

    // 归一化容错：notify 整体损坏时回落默认形状，而不是把整份配置变成 undefined。
    store.update({ notify: 'garbage' });
    assert.equal(store.getSnapshot().notify.enabled, DEFAULT_CONFIG.notify.enabled);
    assert.deepEqual(store.getSnapshot().notify.kinds, DEFAULT_CONFIG.notify.kinds);
  });
});

test('notify.raiseWindow 默认关闭、能写进去，且非法值回落默认（configsEqual 覆盖了它）', () => {
  withStorage(() => {
    const store = createConfigStore();
    assert.equal(store.getSnapshot().notify.raiseWindow, false, '实验性开关必须默认关闭');

    store.update({ notify: { ...store.getSnapshot().notify, raiseWindow: true } });
    assert.equal(
      store.getSnapshot().notify.raiseWindow,
      true,
      'update({ notify.raiseWindow }) 被 commit 丢掉了——configsEqual 没比较 notify.raiseWindow',
    );

    // 归一化容错：非布尔值回落默认，而不是把整份配置写坏。
    store.update({ notify: { ...store.getSnapshot().notify, raiseWindow: 'yes' } });
    assert.equal(store.getSnapshot().notify.raiseWindow, DEFAULT_CONFIG.notify.raiseWindow);
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

test('settings.jsx 的镜像归一化与 DEFAULT_CONFIG.notify 保持同字段（漏同步会让开关弹回）', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/client/settings.jsx', import.meta.url), 'utf8');
  for (const key of Object.keys(DEFAULT_CONFIG.notify)) {
    assert.ok(
      source.includes(key),
      `settings.jsx 里没有 ${key}：它的镜像归一化会把该字段过滤掉，界面开关会「点了马上弹回」`,
    );
  }
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
