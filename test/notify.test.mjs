/**
 * `src/client/notify.js` 的单元测试（CONTRACT §4.7）。
 *
 * 通知模块刻意把构造器做成可注入依赖，所以这里不需要浏览器：所有分支都用
 * 假的 `Notification` 覆盖。重点守两条纪律：
 *  1. **独立通道** —— 通知只认 `config.notify`，与音效总开关、音源配置无关；
 *  2. **绝不抛错** —— 权限拒绝、构造失败、构造器缺失都只返回 `false`。
 *
 * 运行：`node test/notify.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createNotifier } from '../src/client/notify.js';

/**
 * 造一个假的 `Notification`：静态 `permission` 可控，实例全部留档。
 *
 * @param {{ permission?: string, throwOnConstruct?: boolean }} [options] 选项。
 * @returns {{ FakeNotification: any, instances: any[] }} 构造器与实例列表。
 */
function createFakeNotification({ permission = 'granted', throwOnConstruct = false } = {}) {
  const instances = [];
  class FakeNotification {
    static permission = permission;

    static async requestPermission() {
      return FakeNotification.permission;
    }

    constructor(title, init) {
      if (throwOnConstruct) throw new Error('constructor exploded');
      this.title = title;
      this.init = init ?? {};
      this.closed = false;
      instances.push(this);
    }

    close() {
      this.closed = true;
    }
  }
  return { FakeNotification, instances };
}

/**
 * 造一份「通知总开关打开」的配置依赖。
 *
 * @param {object} [overrides] `notify` 的覆盖项（`kinds` 会被整体替换）。
 * @returns {() => object} `getConfig`。
 */
function configWith(overrides = {}) {
  return () => ({
    notify: {
      enabled: true,
      kinds: { approval: true, question: true, interrupted: true, completed: true },
      ...overrides,
    },
  });
}

/** 静默错误上报，避免测试刷控制台。 */
const silent = () => {};

test('总开关关闭（默认）时不弹——通知与音效各自独立', () => {
  const { FakeNotification, instances } = createFakeNotification();
  const notifier = createNotifier({
    getConfig: () => ({ notify: { enabled: false, kinds: { approval: true } } }),
    NotificationCtor: FakeNotification,
    onError: silent,
  });

  assert.equal(notifier.notify({ kind: 'approval', sessionId: 's1' }), false);
  assert.equal(instances.length, 0);
});

test('总开关关着但音效也关着：两者互不牵连（通知只认自己的开关）', () => {
  const { FakeNotification, instances } = createFakeNotification();
  const notifier = createNotifier({
    // 音效那一份配置完全缺席，只给 notify —— 通知照样要弹。
    getConfig: configWith(),
    NotificationCtor: FakeNotification,
    onError: silent,
  });

  assert.equal(notifier.notify({ kind: 'question', sessionId: 's1' }), true);
  assert.equal(instances.length, 1);
});

test('弹出时 silent=true、tag 带 kind 与会话 id', () => {
  const { FakeNotification, instances } = createFakeNotification();
  const notifier = createNotifier({
    getConfig: configWith(),
    NotificationCtor: FakeNotification,
    buildMessage: () => ({ title: '标题', body: '正文' }),
    onError: silent,
  });

  assert.equal(notifier.notify({ kind: 'approval', sessionId: 's-42' }), true);
  const [shown] = instances;
  assert.equal(shown.title, '标题');
  assert.equal(shown.init.body, '正文');
  assert.equal(shown.init.silent, true, '通知必须静音：声音归音效通道管，否则会「双响」');
  assert.equal(shown.init.tag, 'dsh-chime:approval:s-42');
});

test('逐类开关关闭时不弹，其他类不受影响', () => {
  const { FakeNotification, instances } = createFakeNotification();
  const notifier = createNotifier({
    getConfig: configWith({ kinds: { approval: true, question: false, interrupted: true, completed: false } }),
    NotificationCtor: FakeNotification,
    onError: silent,
  });

  assert.equal(notifier.notify({ kind: 'question', sessionId: 's1' }), false);
  assert.equal(notifier.notify({ kind: 'completed', sessionId: 's1' }), false);
  assert.equal(notifier.notify({ kind: 'approval', sessionId: 's1' }), true);
  assert.equal(notifier.notify({ kind: 'interrupted', sessionId: 's1' }), true);
  assert.equal(instances.length, 2);
});

test('权限不是 granted 时不弹，且绝不抛错', () => {
  for (const permission of ['default', 'denied']) {
    const { FakeNotification, instances } = createFakeNotification({ permission });
    const notifier = createNotifier({
      getConfig: configWith(),
      NotificationCtor: FakeNotification,
      onError: silent,
    });
    assert.equal(notifier.permission(), permission);
    assert.equal(notifier.notify({ kind: 'approval', sessionId: 's1' }), false);
    assert.equal(instances.length, 0);
  }
});

test('requestPermission() 反映真实三态；不支持时返回 unsupported', async () => {
  const { FakeNotification } = createFakeNotification({ permission: 'default' });
  const notifier = createNotifier({
    getConfig: configWith(),
    NotificationCtor: FakeNotification,
    onError: silent,
  });

  assert.equal(notifier.permission(), 'default');
  FakeNotification.permission = 'granted';
  assert.equal(await notifier.requestPermission(), 'granted');
  assert.equal(notifier.permission(), 'granted');

  // 用户在系统里手动拒绝 → 下一次请求返回 denied，界面据此提示去系统设置
  FakeNotification.permission = 'denied';
  assert.equal(await notifier.requestPermission(), 'denied');
  assert.equal(notifier.permission(), 'denied');

  const unsupported = createNotifier({ getConfig: configWith(), NotificationCtor: null, onError: silent });
  assert.equal(unsupported.supported(), false);
  assert.equal(unsupported.permission(), 'unsupported');
  assert.equal(await unsupported.requestPermission(), 'unsupported');
});

test('环境不支持通知：supported()=false，notify() 恒 false', () => {
  const notifier = createNotifier({
    getConfig: configWith(),
    NotificationCtor: null,
    onError: silent,
  });

  assert.equal(notifier.supported(), false);
  assert.equal(notifier.notify({ kind: 'approval', sessionId: 's1' }), false);
});

test('构造通知抛错、buildMessage 抛错：都被吞掉，不影响返回值', () => {
  const broken = createFakeNotification({ throwOnConstruct: true });
  const notifier = createNotifier({
    getConfig: configWith(),
    NotificationCtor: broken.FakeNotification,
    onError: silent,
  });
  assert.doesNotThrow(() => notifier.notify({ kind: 'approval', sessionId: 's1' }));
  assert.equal(notifier.notify({ kind: 'approval', sessionId: 's1' }), false);

  const { FakeNotification, instances } = createFakeNotification();
  const withBadMessage = createNotifier({
    getConfig: configWith(),
    NotificationCtor: FakeNotification,
    buildMessage: () => {
      throw new Error('i18n boom');
    },
    onError: silent,
  });
  assert.equal(withBadMessage.notify({ kind: 'approval', sessionId: 's1' }), true);
  assert.equal(instances[0].title, 'DeepSeek Harness', '文案生成失败要回落通用标题');
});

test('getConfig 抛错时静默返回 false', () => {
  const { FakeNotification } = createFakeNotification();
  const notifier = createNotifier({
    getConfig: () => {
      throw new Error('config boom');
    },
    NotificationCtor: FakeNotification,
    onError: silent,
  });

  assert.doesNotThrow(() => notifier.notify({ kind: 'approval', sessionId: 's1' }));
  assert.equal(notifier.notify({ kind: 'approval', sessionId: 's1' }), false);
});

test('未知 kind 不弹（防止上游新增事件时静默刷屏）', () => {
  const { FakeNotification, instances } = createFakeNotification();
  const notifier = createNotifier({
    getConfig: configWith({ kinds: { approval: true, question: true, interrupted: true, completed: true, bogus: true } }),
    NotificationCtor: FakeNotification,
    onError: silent,
  });

  assert.equal(notifier.notify({ kind: 'bogus', sessionId: 's1' }), false);
  assert.equal(notifier.notify({}), false);
  assert.equal(instances.length, 0);
});

test('点击通知触发 onClick、回调拿到事件本身，并关闭自己；dispose() 关掉全部并让后续调用失效', () => {
  const { FakeNotification, instances } = createFakeNotification();
  /** @type {Array<{ kind: string, sessionId?: string }>} */
  const clicks = [];
  const notifier = createNotifier({
    getConfig: configWith(),
    NotificationCtor: FakeNotification,
    onClick: (event) => {
      clicks.push(event);
    },
    onError: silent,
  });

  notifier.notify({ kind: 'approval', sessionId: 'a' });
  notifier.notify({ kind: 'question', sessionId: 'b' });
  assert.equal(instances.length, 2);

  instances[0].onclick();
  assert.deepEqual(
    clicks,
    [{ kind: 'approval', sessionId: 'a' }],
    '点击回调必须收到事件：index.js 靠其中的 sessionId 决定跳到哪条对话',
  );
  assert.equal(instances[0].closed, true, '点过的通知要关掉，避免留在通知中心');

  notifier.dispose();
  assert.equal(instances.every((item) => item.closed), true);
  assert.equal(notifier.notify({ kind: 'approval', sessionId: 'a' }), false);
  assert.equal(instances.length, 2, 'dispose 之后不得再弹');
});

// ---------------------------------------------------------------------------
// explain()：把「为什么没弹」说清楚（设置页的「测试通知」按钮用它）
// ---------------------------------------------------------------------------

test('explain() 逐条报告卡在哪一步，且**不真的弹**', () => {
  const { FakeNotification, instances } = createFakeNotification();

  const ready = createNotifier({ getConfig: configWith(), NotificationCtor: FakeNotification, onError: silent });
  assert.deepEqual(ready.explain({ kind: 'approval', sessionId: 's1' }), { ok: true, reason: 'ready' });
  assert.equal(instances.length, 0, 'explain 只预检，绝不能真的弹通知');

  const masterOff = createNotifier({
    getConfig: () => ({ notify: { enabled: false, kinds: {} } }),
    NotificationCtor: FakeNotification,
    onError: silent,
  });
  assert.deepEqual(masterOff.explain({ kind: 'approval' }), { ok: false, reason: 'disabled' });

  const kindOff = createNotifier({
    getConfig: configWith({ kinds: { approval: false, question: true, interrupted: true, completed: true } }),
    NotificationCtor: FakeNotification,
    onError: silent,
  });
  assert.deepEqual(kindOff.explain({ kind: 'approval' }), { ok: false, reason: 'kind-off' });

  const unsupported = createNotifier({ getConfig: configWith(), NotificationCtor: null, onError: silent });
  assert.deepEqual(unsupported.explain({ kind: 'approval' }), { ok: false, reason: 'unsupported' });

  const denied = createNotifier({
    getConfig: configWith(),
    NotificationCtor: createFakeNotification({ permission: 'denied' }).FakeNotification,
    onError: silent,
  });
  assert.deepEqual(denied.explain({ kind: 'approval' }), { ok: false, reason: 'permission-denied' });

  const unknownKind = createNotifier({ getConfig: configWith(), NotificationCtor: FakeNotification, onError: silent });
  assert.deepEqual(unknownKind.explain({ kind: 'bogus' }), { ok: false, reason: 'unknown-kind' });

  const brokenConfig = createNotifier({
    getConfig: () => {
      throw new Error('config boom');
    },
    NotificationCtor: FakeNotification,
    onError: silent,
  });
  assert.deepEqual(brokenConfig.explain({ kind: 'approval' }), { ok: false, reason: 'config-error' });
});

test('notify() 与 explain() 结论永远一致', () => {
  const { FakeNotification } = createFakeNotification();
  const notifier = createNotifier({
    getConfig: configWith({ kinds: { approval: true, question: false, interrupted: true, completed: true } }),
    NotificationCtor: FakeNotification,
    onError: silent,
  });

  assert.equal(notifier.explain({ kind: 'question' }).ok, false);
  assert.equal(notifier.notify({ kind: 'question' }), false, 'explain 说不行，notify 也必须不行');

  assert.equal(notifier.explain({ kind: 'approval' }).ok, true);
  assert.equal(notifier.notify({ kind: 'approval' }), true, 'explain 说行，notify 必须真的发出去');
});

// ---------------------------------------------------------------------------
// tag 长度：Windows toast 的 Tag 上限是 64 字符，超长会被整条静默丢弃
// ---------------------------------------------------------------------------

test('tag 长度受控：超长会话 id 截尾，绝不越过 64 字符上限', () => {
  const { FakeNotification, instances } = createFakeNotification();
  const notifier = createNotifier({
    getConfig: configWith(),
    NotificationCtor: FakeNotification,
    onError: silent,
  });

  // DSH 真实形态：`session-<uuid>` 共 44 字符，拼上前缀正好压到 64 —— 线上就是栽在这里：
  // 通知构造成功、却既不显示也不报错。
  const longId = 'session-9589878d-da71-4b0d-b855-b8ae73d23ce8';
  assert.equal(notifier.notify({ kind: 'completed', sessionId: longId }), true);
  const longTag = instances[0].init.tag;
  assert.ok(longTag.length <= 64, `tag 必须 ≤ 64 字符，实际 ${longTag.length}`);
  assert.ok(longTag.startsWith('dsh-chime:completed:'), '前缀与 kind 必须保留，去重语义才不变');
  assert.ok(longTag.endsWith(longId.slice(-12)), '应保留 id 尾部，避免不同会话被当成同一条');

  // 短 id 原样拼接，不做无谓截断。
  notifier.notify({ kind: 'approval', sessionId: 's1' });
  assert.equal(instances[1].init.tag, 'dsh-chime:approval:s1');

  // 同一会话的同类事件共享同一个 tag（通知中心里互相替换，不堆成一串）。
  notifier.notify({ kind: 'completed', sessionId: longId });
  assert.equal(instances[2].init.tag, longTag);

  // 极端长度也不失控。
  notifier.notify({ kind: 'interrupted', sessionId: 'x'.repeat(400) });
  assert.ok(instances[3].init.tag.length <= 64);
});
