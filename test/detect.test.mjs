/**
 * `src/client/detect.js` 的单元测试（CONTRACT §3 / §4.4）。
 *
 * 全部用例都把假数据直接喂给 `evaluate(statuses, list, activeJobs)`；
 * 时间通过可注入的假时钟控制，因此 1200ms 防抖到期是确定性的，不依赖真实等待。
 *
 * 运行：`node --test test/detect.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { COMPLETION_DEBOUNCE_MS, MAX_SESSION_DEPTH, createDetector } from '../src/client/detect.js';

/**
 * 假时钟：`setTimeout` 只在 `advance()` 时按时间顺序触发，`fireTimers: false`
 * 时完全不触发（用于「防抖已到期但尚未结算」这种单 tick 场景）。
 *
 * @param {{ fireTimers?: boolean }} [options] 选项。
 * @returns {{ now: () => number, setTimeout: (fn: Function, ms: number) => number, clearTimeout: (id: number) => void, set: (ms: number) => void, advance: (ms: number) => Promise<void>, pending: () => number }} 假时钟。
 */
function createClock({ fireTimers = true } = {}) {
  let current = 0;
  let seq = 0;
  /** @type {Map<number, { fn: () => unknown, at: number }>} */
  const timers = new Map();

  const earliestDue = (target) => {
    let best = null;
    for (const [id, timer] of timers) {
      if (timer.at > target) continue;
      if (best === null || timer.at < best.timer.at) best = { id, timer };
    }
    return best;
  };

  return {
    now: () => current,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, at: current + Math.max(0, Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    /** 只是把时间往前拨，不触发定时器。 */
    set(ms) {
      current += ms;
    },
    /** 把时间往前拨，并按顺序触发到点的定时器（等待异步回调）。 */
    async advance(ms) {
      const target = current + ms;
      if (fireTimers) {
        for (;;) {
          const due = earliestDue(target);
          if (due === null) break;
          timers.delete(due.id);
          current = due.timer.at;
          await due.timer.fn();
        }
      }
      current = target;
    },
    pending: () => timers.size,
  };
}

/**
 * 建一个判定器 + 假时钟 + 事件收集器。
 *
 * @param {{ config?: object, deps?: object, fireTimers?: boolean }} [options] 选项。
 * @returns {{ detector: any, events: any[], clock: any, kinds: () => string[] }} 测试夹具。
 */
function createHarness({ config = {}, deps = {}, fireTimers = true } = {}) {
  const events = [];
  const clock = createClock({ fireTimers });
  const detector = createDetector({
    onChime: (event) => events.push(event),
    getConfig: () => ({ backgroundSessions: false, enabled: true, ...config }),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onError: () => {},
    ...deps,
  });
  return { detector, events, clock, kinds: () => events.map((event) => event.kind) };
}

/** @param {Record<string, any>} entries 会话状态条目。 @returns {Map<string, any>} 假 statuses。 */
function statuses(entries) {
  return new Map(Object.entries(entries));
}

/** @param {string} id 会话 id。 @param {any} [extra] 额外字段。 @returns {any} 激活会话行。 */
function mainRow(id, extra = {}) {
  return { id, running: false, retainedBy: { mainView: 1 }, ...extra };
}

/** @param {string} id 会话 id。 @param {any} [extra] 额外字段。 @returns {any} 背景会话行。 */
function bgRow(id, extra = {}) {
  return { id, running: false, retainedBy: { mainView: 0 }, ...extra };
}

/**
 * 构造假 SessionListSnapshot。
 *
 * @param {{ ids?: string[], rows?: Record<string, any>, subagents?: Record<string, string[]>, phase?: string }} [options] 选项。
 * @returns {any} 假会话列表。
 */
function listOf({ ids = [], rows = {}, subagents = {}, phase = 'ready' } = {}) {
  /** @type {Record<string, any>} */
  const projectionsBySession = {};
  for (const [parentId, childIds] of Object.entries(subagents)) {
    projectionsBySession[parentId] = {
      values: { subagentCatalog: childIds.map((id) => ({ id })) },
    };
  }
  return { ids, byId: rows, projectionsBySession, phase };
}

/** @param {any} [extra] 额外字段。 @returns {any} 一条会话状态。 */
function st(extra = {}) {
  return { running: false, pendingInteraction: undefined, completionUnread: false, ...extra };
}

/** 单个激活会话 + 一行列表的常用组合。 */
const soloList = () => listOf({ ids: ['s1'], rows: { s1: mainRow('s1') } });

// ---------------------------------------------------------------------------
// approval / question：上升沿
// ---------------------------------------------------------------------------

test('approval 上升沿只响一次，持续为 approval 不重复响；消失后再次出现重新计一次', () => {
  const h = createHarness();
  const list = soloList();
  const pending = () => statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) });

  const returned = h.detector.evaluate(pending(), list, new Map());
  assert.deepEqual(
    returned,
    [{ kind: 'approval', sessionId: 's1', urgent: true }],
    'evaluate 的返回值应与 onChime 收到的事件一致',
  );
  h.detector.evaluate(pending(), list, new Map());
  h.detector.evaluate(pending(), list, new Map());
  assert.deepEqual(h.kinds(), ['approval'], '持续为 approval 时只应响一次');

  // 用户处理完 → pendingInteraction 消失 → 再次出现应重新响
  h.detector.evaluate(statuses({ s1: st() }), list, new Map());
  h.detector.evaluate(pending(), list, new Map());
  assert.deepEqual(h.kinds(), ['approval', 'approval']);
  assert.deepEqual(h.events[0], { kind: 'approval', sessionId: 's1', urgent: true });
});

test('question：question 与 plan-review 归为同一类，从无到有各算一次上升沿', () => {
  const h = createHarness();
  const list = soloList();

  // plan-review 单独出现 → 走 question 音
  h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'plan-review' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['question']);

  h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'plan-review' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['question'], '持续 plan-review 不重复响');

  // question 与 plan-review 归为同一类（§3.3），彼此切换不算新事件
  h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'question' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['question'], '同类切换不重复响');

  // 消失后再次出现 → 新的上升沿
  h.detector.evaluate(statuses({ s1: st() }), list, new Map());
  h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'question' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['question', 'question']);
});

// ---------------------------------------------------------------------------
// 优先级
// ---------------------------------------------------------------------------

test('优先级：approval 与「防抖到期的 completed」同一 tick 成立时只响 approval', () => {
  const h = createHarness({ fireTimers: false });
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map()); // 武装完成
  h.clock.set(COMPLETION_DEBOUNCE_MS + 100); // 防抖已到期

  h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['approval'], 'completed 必须让位给 approval');

  // completed 已被更高优先级事件吞掉，不会在后续 tick 补响
  h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['approval']);
  assert.equal(h.events.length, 1, '同一会话同一时刻只响一个');
});

test('优先级：question > completed（plan-review 到点时只响 question）', () => {
  const h = createHarness({ fireTimers: false });
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());
  h.clock.set(COMPLETION_DEBOUNCE_MS + 100);

  h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'plan-review' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['question']);
});

test('优先级：interrupted > completed（错误落定时不响 completed）', () => {
  const h = createHarness({ fireTimers: false });
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());
  h.clock.set(COMPLETION_DEBOUNCE_MS + 100);

  h.detector.evaluate(statuses({ s1: st({ lastAgentError: 'fatal' }) }), list, new Map());
  assert.deepEqual(h.kinds(), ['interrupted']);
});

// ---------------------------------------------------------------------------
// interrupted：必须排除自动重试
// ---------------------------------------------------------------------------

test('自动重试：lastAgentError 短暂出现又消失（running 期间）不得触发 interrupted', () => {
  const h = createHarness();
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(
    statuses({ s1: st({ running: true, lastAgentError: 'transient failure' }) }),
    list,
    new Map(),
  );
  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());

  assert.deepEqual(
    h.events.filter((event) => event.kind === 'interrupted'),
    [],
    '重试期间不得触发 interrupted',
  );
  assert.deepEqual(h.kinds(), []);
});

test('自动重试成功后正常结束：不响 interrupted，只响 completed', async () => {
  const h = createHarness();
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  // 重试期中瞬时错误
  h.detector.evaluate(
    statuses({ s1: st({ running: true, lastAgentError: 'transient failure' }) }),
    list,
    new Map(),
  );
  // 重试成功：running 继续，错误被清空
  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  // 真正结束
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());
  await h.clock.advance(COMPLETION_DEBOUNCE_MS + 1);

  assert.deepEqual(h.kinds(), ['completed'], '重试成功路径不得出现 interrupted');
});

test('真中断：running 落 false 且 lastAgentError 仍在 → interrupted，且只响一次', () => {
  const h = createHarness();
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(
    statuses({ s1: st({ running: false, lastAgentError: 'fatal error' }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['interrupted']);

  h.detector.evaluate(
    statuses({ s1: st({ running: false, lastAgentError: 'fatal error' }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['interrupted'], '同一次错误不重复响');

  // 错误清空后再次出现 → 新的事件期，重新响
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());
  h.detector.evaluate(
    statuses({ s1: st({ running: false, lastAgentError: 'fatal again' }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['interrupted', 'interrupted']);
});

test('错误先出现、running 稍后才落 false：落定后仍响 interrupted（§3.4「之后仍成立」）', () => {
  const h = createHarness();
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(
    statuses({ s1: st({ running: true, lastAgentError: 'fatal error' }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), [], 'running 期间不响');

  h.detector.evaluate(
    statuses({ s1: st({ running: false, lastAgentError: 'fatal error' }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['interrupted']);
});

test('interrupted 不依赖被自动重试的错误源：只认 lastAgentError', () => {
  const h = createHarness();
  const list = soloList();

  // `promptError` 等其它字段不应被当成中断信号
  h.detector.evaluate(statuses({ s1: st({ running: false, promptError: 'nope' }) }), list, new Map());
  assert.deepEqual(h.kinds(), []);
});

// ---------------------------------------------------------------------------
// completed：复合判定 + 防抖
// ---------------------------------------------------------------------------

test('后台 job 在跑时 running=false 不得触发 completed', async () => {
  const h = createHarness({ fireTimers: false });
  const list = soloList();
  const jobs = new Map([['s1', 2]]);

  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, jobs);
  h.clock.set(COMPLETION_DEBOUNCE_MS + 5000);
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, jobs);
  assert.equal(h.events.filter((event) => event.kind === 'completed').length, 0);

  // job 结束后才算完成
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());
  h.clock.set(COMPLETION_DEBOUNCE_MS + 1);
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());
  assert.deepEqual(h.kinds(), ['completed']);
});

test('子代理在跑时不得触发 completed', async () => {
  const h = createHarness({ fireTimers: false });
  const list = listOf({
    ids: ['s1', 'c1'],
    rows: { s1: mainRow('s1'), c1: bgRow('c1') },
    subagents: { s1: ['c1'] },
  });
  const statusesWithChild = statuses({ s1: st({ running: true }), c1: st({ running: true }) });

  h.detector.evaluate(statusesWithChild, list, new Map());
  // 父会话落回 idle，但子代理还在跑
  const parentIdle = statuses({ s1: st({ running: false }), c1: st({ running: true }) });
  h.detector.evaluate(parentIdle, list, new Map());
  h.clock.set(COMPLETION_DEBOUNCE_MS + 5000);
  h.detector.evaluate(parentIdle, list, new Map());
  assert.equal(h.events.filter((event) => event.kind === 'completed').length, 0);

  // 子代理结束（子代理的 running 也可以只体现在 list.byId 上，见 workspace-client.js:449-451）
  const childDone = statuses({ s1: st({ running: false }), c1: st({ running: false }) });
  h.detector.evaluate(childDone, list, new Map());
  h.clock.set(COMPLETION_DEBOUNCE_MS + 1);
  h.detector.evaluate(childDone, list, new Map());
  assert.deepEqual(h.kinds(), ['completed']);
});

test('初始就空闲的会话不响 completed（必须先观察到活跃）', async () => {
  const h = createHarness();
  const list = soloList();
  const idle = statuses({ s1: st({ running: false }) });

  h.detector.evaluate(idle, list, new Map());
  await h.clock.advance(COMPLETION_DEBOUNCE_MS * 5);
  assert.deepEqual(h.kinds(), []);
});

test('完成判定：全空闲后 1200ms 防抖到期 → completed；窗口内又变 running → 取消', async () => {
  const h = createHarness();
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());

  await h.clock.advance(COMPLETION_DEBOUNCE_MS - 1);
  assert.deepEqual(h.kinds(), [], '防抖窗口未到时不得响');

  await h.clock.advance(1);
  assert.deepEqual(h.kinds(), ['completed'], '防抖到期后响 completed');
});

test('完成防抖窗口内 running 回到 true → 取消本次完成（之后重新空闲再走满窗口）', async () => {
  const h = createHarness();
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());

  await h.clock.advance(600);
  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  await h.clock.advance(COMPLETION_DEBOUNCE_MS * 3);
  assert.deepEqual(h.kinds(), [], '窗口内重新 running 必须取消本次完成');

  // 再次空闲 → 重新计时
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());
  await h.clock.advance(COMPLETION_DEBOUNCE_MS - 1);
  assert.deepEqual(h.kinds(), []);
  await h.clock.advance(1);
  assert.deepEqual(h.kinds(), ['completed']);
});

test('完成防抖窗口内出现新 job → 取消本次完成', async () => {
  const h = createHarness();
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map());

  await h.clock.advance(600);
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), list, new Map([['s1', 1]]));
  await h.clock.advance(COMPLETION_DEBOUNCE_MS * 3);
  assert.deepEqual(h.kinds(), [], '窗口内出现新 job 必须取消本次完成');
});

test('等待审批/回答期间不响 completed（空闲但仍在等用户）', async () => {
  const h = createHarness();
  const list = soloList();

  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    list,
    new Map(),
  );
  await h.clock.advance(COMPLETION_DEBOUNCE_MS * 5);
  assert.deepEqual(h.kinds(), ['approval'], '只响 approval，不响 completed');
});

// ---------------------------------------------------------------------------
// 多会话 / 配置
// ---------------------------------------------------------------------------

test('backgroundSessions=false：非激活会话一律不响', () => {
  const h = createHarness({ config: { backgroundSessions: false } });
  const list = listOf({ ids: ['bg'], rows: { bg: bgRow('bg') } });

  h.detector.evaluate(
    statuses({ bg: st({ pendingInteraction: { kind: 'approval' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), []);
});

test('backgroundSessions=true：非激活会话照常响', () => {
  const h = createHarness({ config: { backgroundSessions: true } });
  const list = listOf({ ids: ['bg'], rows: { bg: bgRow('bg') } });

  h.detector.evaluate(
    statuses({ bg: st({ pendingInteraction: { kind: 'question' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds(), ['question']);
});

test('backgroundSessions=false：非激活会话落定也不响 completed', async () => {
  const h = createHarness({ config: { backgroundSessions: false } });
  const list = listOf({ ids: ['bg'], rows: { bg: bgRow('bg') } });

  h.detector.evaluate(statuses({ bg: st({ running: true }) }), list, new Map());
  h.detector.evaluate(statuses({ bg: st({ running: false }) }), list, new Map());
  await h.clock.advance(COMPLETION_DEBOUNCE_MS + 1);
  assert.deepEqual(h.kinds(), []);
});

test('enabled=false 时全局静音，但状态照常推进（重新开启不会补响旧事件）', () => {
  const h = createHarness({ config: { enabled: false } });
  const list = soloList();
  const pending = () => statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) });

  h.detector.evaluate(pending(), list, new Map());
  assert.deepEqual(h.kinds(), []);
});

test('多会话各自独立判定，同一 tick 互不影响', () => {
  const h = createHarness({ config: { backgroundSessions: true } });
  const list = listOf({
    ids: ['a', 'b'],
    rows: { a: mainRow('a'), b: bgRow('b') },
  });
  h.detector.evaluate(
    statuses({
      a: st({ pendingInteraction: { kind: 'approval' } }),
      b: st({ lastAgentError: 'fatal' }),
    }),
    list,
    new Map(),
  );
  assert.deepEqual(h.kinds().sort(), ['approval', 'interrupted']);
});

test('会话从列表消失（phase=ready）时清理状态，不会把旧状态带到新会话', () => {
  const h = createHarness();
  const list = listOf({ ids: ['s1'], rows: { s1: mainRow('s1') } });
  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());

  const emptyList = listOf({ ids: [], rows: {} });
  h.detector.evaluate(new Map(), emptyList, new Map());

  // 同一个 id 重新出现并已空闲：因为状态被清理过，未观察到活跃 → 不响 completed
  const again = listOf({ ids: ['s1'], rows: { s1: mainRow('s1') } });
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), again, new Map());
  h.clock.set(COMPLETION_DEBOUNCE_MS * 3);
  h.detector.evaluate(statuses({ s1: st({ running: false }) }), again, new Map());
  assert.deepEqual(h.kinds(), []);
});

// ---------------------------------------------------------------------------
// evaluate 的输入容错 / start() 接线
// ---------------------------------------------------------------------------

test('evaluate 容忍缺失的 statuses / 普通对象数据源 / job 数组', () => {
  const h = createHarness({ config: { backgroundSessions: true } });
  const list = listOf({ ids: ['s1'], rows: { s1: mainRow('s1') } });

  // statuses 传普通对象；activeJobs 传 job 视图数组（按 status 计数）
  h.detector.evaluate({ s1: st({ running: false }) }, list, {
    s1: [{ status: 'running' }, { status: 'stopping' }, { status: 'completed' }],
  });
  assert.deepEqual(h.kinds(), [], 'job 数组里有活跃 job，不得当成空闲完成');

  // 完全缺失的数据源不应抛错
  assert.doesNotThrow(() => h.detector.evaluate(undefined, undefined, undefined));
});

test('start() 轮询真实快照并判定；dispose() 清理定时器与状态', async () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const clock = createClock();
  /** @type {Map<string, any>} */
  const live = new Map([['s1', st({ running: true })]]);
  const list = soloList();
  const events = [];
  let jobCount = 0;

  const detector = createDetector({
    getStatuses: () => live,
    getSessionList: () => list,
    countActiveJobs: async () => jobCount,
    getConfig: () => ({ backgroundSessions: false, enabled: true }),
    onChime: (event) => events.push(event),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    pollMs: 100,
    onError: () => {},
  });

  const stop = detector.start();
  assert.equal(typeof stop, 'function');
  await flush(); // 初始 tick 结算：观察到 running

  // 空闲 + 后台 job 在跑 → 不得响 completed
  live.set('s1', st({ running: false }));
  jobCount = 1;
  await clock.advance(200);
  await flush();
  await clock.advance(2000);
  await flush();
  assert.deepEqual(events, [], '后台 job 未结束时不得响 completed');

  // job 结束 → 全部空闲 → 防抖 → completed
  jobCount = 0;
  await clock.advance(200);
  await flush();
  await clock.advance(COMPLETION_DEBOUNCE_MS + 200);
  await flush();
  assert.deepEqual(events.map((event) => event.kind), ['completed']);

  stop();
  assert.equal(clock.pending(), 0, 'dispose 后不得留下任何定时器');

  // dispose 之后不再求值
  live.set('s1', st({ running: true }));
  await clock.advance(1000);
  await flush();
  assert.deepEqual(events.map((event) => event.kind), ['completed']);
});

test('evaluate 在 dispose 之后是空操作', () => {
  const h = createHarness();
  const list = soloList();
  h.detector.dispose();
  const result = h.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(result, []);
  assert.deepEqual(h.kinds(), []);
});

test('依赖抛错不影响判定（getConfig / onChime 异常被吞掉）', () => {
  const h = createHarness({
    deps: {
      getConfig: () => {
        throw new Error('config boom');
      },
      onChime: () => {
        throw new Error('chime boom');
      },
    },
  });
  const list = soloList();
  assert.doesNotThrow(() => {
    h.detector.evaluate(
      statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
      list,
      new Map(),
    );
  });
  assert.deepEqual(h.kinds(), []);
});

// ---------------------------------------------------------------------------
// completed：最短任务时长门槛（config.completionMinSeconds）
// ---------------------------------------------------------------------------
//
// 计时起点是**用户消息时间戳**（由可选依赖 `getLastUserMessageTime` 提供），
// 不是 `running` 上升沿；差值用可注入的假时钟算，因此完全确定性。

/**
 * 走完一次「观察到活跃 → 空闲武装防抖 → 防抖到期后单 tick 求值」（指定会话）。
 *
 * 用 `clock.set()`（只拨时间、不触发定时器）而不是 `advance()`，
 * 让结算只发生在这一次显式 `evaluate` 上。
 *
 * @param {any} h 测试夹具。
 * @param {string} id 会话 id。
 * @param {any} list 会话列表。
 * @param {number} [elapsedMs] 从武装起到结算经过的毫秒数。
 * @returns {any[]} 最后一次 evaluate 返回的事件。
 */
function armSession(h, id, list, elapsedMs = COMPLETION_DEBOUNCE_MS + 1) {
  h.detector.evaluate(statuses({ [id]: st({ running: true }) }), list, new Map());
  h.detector.evaluate(statuses({ [id]: st({ running: false }) }), list, new Map());
  h.clock.set(elapsedMs);
  return h.detector.evaluate(statuses({ [id]: st({ running: false }) }), list, new Map());
}

/**
 * 走完一次「观察到活跃 → 空闲武装防抖 → 防抖到期后单 tick 求值」（`s1` 版本）。
 *
 * @param {any} h 测试夹具。
 * @param {number} elapsedMs 从武装起到结算经过的毫秒数。
 * @param {any} [list] 会话列表。
 * @returns {any[]} 最后一次 evaluate 返回的事件。
 */
function armAndEvaluate(h, elapsedMs, list = soloList()) {
  return armSession(h, 's1', list, elapsedMs);
}

/**
 * 建一个带门槛依赖的夹具：假时钟从 0 起，`getLastUserMessageTime` 由测试控制。
 *
 * @param {any} userAt 用户消息时间戳（相对假时钟）。
 * @param {any} min `config.completionMinSeconds` 的值。
 * @returns {any} 测试夹具。
 */
function minHarness(userAt, min) {
  return createHarness({
    config: { completionMinSeconds: min },
    deps: { getLastUserMessageTime: () => userAt },
  });
}

test('最短时长门槛：距上次用户输入不足 min 秒 → 不响 completed（含差 1ms 的边界）', () => {
  // 只跑了 3 秒（min = 10 秒）
  const short = minHarness(0, 10);
  const returned = armAndEvaluate(short, 3000);
  assert.deepEqual(short.kinds(), [], '只跑了 3 秒不得响 completed');
  assert.deepEqual(returned, [], 'evaluate 的返回值同样不得包含 completed');

  // 贴着边界：差 1ms 到线
  const almost = minHarness(0, 10);
  armAndEvaluate(almost, 10_000 - 1);
  assert.deepEqual(almost.kinds(), [], '差 1ms 到线仍不得响 completed');
});

test('最短时长门槛：刚好到线 / 长任务 → 照响 completed', () => {
  // 距用户输入正好 10 秒（>= min * 1000）
  const exact = minHarness(0, 10);
  armAndEvaluate(exact, 10_000);
  assert.deepEqual(exact.kinds(), ['completed'], '刚好到线必须响');

  // 长任务：60 秒
  const long = minHarness(0, 10);
  armAndEvaluate(long, 60_000);
  assert.deepEqual(long.kinds(), ['completed'], '长任务必须响');
});

test('最短时长门槛：min <= 0 / 配置没给该字段 → 门槛关闭，照响', () => {
  /** @type {Array<[string, any]>} */
  const cases = [
    ['min = 0', 0],
    ['min 为负数', -5],
    ['min 为 NaN', Number.NaN],
    ['配置缺该字段', undefined],
  ];

  for (const [name, min] of cases) {
    const h = minHarness(0, min); // 用户消息就在当前时刻，门槛若生效必被拦
    armAndEvaluate(h, COMPLETION_DEBOUNCE_MS + 1);
    assert.deepEqual(h.kinds(), ['completed'], `${name} 时门槛应关闭，照响`);
  }
});

test('最短时长门槛：拿不到用户消息时间戳 → 照响（缺失 / null / undefined / 非有限数 / 抛错）', () => {
  /** @type {Array<[string, object]>} */
  const cases = [
    ['依赖缺失', {}],
    ['返回 null', { getLastUserMessageTime: () => null }],
    ['返回 undefined', { getLastUserMessageTime: () => undefined }],
    ['返回 NaN', { getLastUserMessageTime: () => Number.NaN }],
    ['返回 Infinity', { getLastUserMessageTime: () => Number.POSITIVE_INFINITY }],
    ['返回字符串', { getLastUserMessageTime: () => 'not-a-number' }],
    [
      '依赖抛错',
      {
        getLastUserMessageTime: () => {
          throw new Error('no message index');
        },
      },
    ],
  ];

  for (const [name, deps] of cases) {
    const h = createHarness({ config: { completionMinSeconds: 10 }, deps });
    assert.doesNotThrow(() => {
      armAndEvaluate(h, COMPLETION_DEBOUNCE_MS + 1);
    }, `${name} 时不得把异常抛出判定器`);
    assert.deepEqual(h.kinds(), ['completed'], `${name} 时必须照响，绝不静默`);
  }
});

test('最短时长门槛只拦「响」：短任务被拦后状态照常推进，不补响也不吞下一次完成', () => {
  const list = soloList();
  const idle = statuses({ s1: st({ running: false }) });
  let userAt = 0; // 用户消息时间戳（与假时钟同源）
  const h = createHarness({
    config: { completionMinSeconds: 10 },
    deps: { getLastUserMessageTime: () => userAt },
  });

  armAndEvaluate(h, 3000); // 距用户输入 3 秒 < 10 秒 → 本次不响
  assert.deepEqual(h.kinds(), []);

  // 越过门槛窗口后也不得补响（seenActive / armAt 已经在上一 tick 推进掉了）
  h.clock.set(60_000);
  h.detector.evaluate(idle, list, new Map());
  h.detector.evaluate(idle, list, new Map());
  assert.deepEqual(h.kinds(), [], '短任务过后不得补响 completed');

  // 下一次真实完成：用户消息已是 60 秒前 → 门槛放开，照常响
  userAt = h.clock.now() - 60_000;
  armAndEvaluate(h, COMPLETION_DEBOUNCE_MS + 1);
  assert.deepEqual(h.kinds(), ['completed'], '下一次正常完成不得被吞');
});

test('最短时长门槛只加在 completed 上：approval / question / interrupted 始终立即响', () => {
  const list = soloList();
  // 用户消息就在当前时刻（差 0ms）——若门槛误加到 attention 事件上，这三类都会哑掉。
  const cases = [
    ['approval', st({ pendingInteraction: { kind: 'approval' } }), 'approval'],
    ['question', st({ pendingInteraction: { kind: 'plan-review' } }), 'question'],
    ['interrupted', st({ lastAgentError: 'fatal' }), 'interrupted'],
  ];

  for (const [name, next, expected] of cases) {
    const h = minHarness(0, 10);
    h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
    h.detector.evaluate(statuses({ s1: next }), list, new Map());
    assert.deepEqual(h.kinds(), [expected], `${name} 必须立即响，不受最短时长门槛影响`);
  }
});

// ---------------------------------------------------------------------------
// 全局深度门槛（config.maxDepth）
// ---------------------------------------------------------------------------
//
// 深度取自 `byId[id].parentSessionId` 父链：主对话 = 0，直接子代理 = 1，依此类推。
// 只在即将发声时按需计算并缓存；该门槛对四类事件都生效；算不出深度时照响。

/**
 * 带父链的行（深度测试用；仍按「激活会话」处理，避免 backgroundSessions 干扰）。
 *
 * @param {string} id 会话 id。
 * @param {string | null} parentId 父会话 id。
 * @param {boolean} [subagent] 是否标记 `origin: 'subagent'`。
 * @returns {any} 假会话行。
 */
function depthRow(id, parentId, subagent = false) {
  return mainRow(id, { parentSessionId: parentId, ...(subagent ? { origin: 'subagent' } : {}) });
}

/**
 * 造一条 `target → p1 → p2 …` 的父链，使 `target` 的深度恰好等于 `depth`。
 *
 * @param {number} depth 目标深度。
 * @returns {Record<string, any>} `byId` 行集合。
 */
function chainRows(depth) {
  /** @type {Record<string, any>} */
  const rows = {};
  if (depth === 0) {
    rows.target = depthRow('target', null);
    return rows;
  }
  rows.target = depthRow('target', 'p1', true);
  for (let level = 1; level <= depth; level += 1) {
    rows[`p${level}`] = depthRow(`p${level}`, level === depth ? null : `p${level + 1}`, true);
  }
  return rows;
}

/** @param {Record<string, any>} rows 行集合。 @returns {any} 假会话列表。 */
function depthList(rows) {
  return listOf({ ids: Object.keys(rows), rows });
}

/** @returns {any} `target` 会话的一条 approval 状态。 */
function targetApproval() {
  return statuses({ target: st({ pendingInteraction: { kind: 'approval' } }) });
}

/**
 * 建一个「父链读取可计数」的假列表：`s1 → p1 → p2`（`s1` 深度 2）。
 *
 * `p1` / `p2` 用**不可枚举**的 getter 暴露，这样它们不会进入 `collectSessionIds`
 * 的全量遍历（那会每 tick 读一次 `byId[id]`），计数器只会记到深度遍历的读取。
 *
 * @returns {{ list: any, reads: { p1: number, p2: number } }} 列表与各父行的读取次数。
 */
function countingChainList() {
  /** @type {{ p1: number, p2: number }} */
  const reads = { p1: 0, p2: 0 };
  const p2Row = depthRow('p2', null);
  const p1Row = depthRow('p1', 'p2', true);
  /** @type {Record<string, any>} */
  const byId = { s1: depthRow('s1', 'p1', true) };
  Object.defineProperty(byId, 'p1', {
    enumerable: false,
    get() {
      reads.p1 += 1;
      return p1Row;
    },
  });
  Object.defineProperty(byId, 'p2', {
    enumerable: false,
    get() {
      reads.p2 += 1;
      return p2Row;
    },
  });
  return { list: { ids: ['s1'], byId, projectionsBySession: {}, phase: 'ready' }, reads };
}

test('深度门槛：depth 0/1/2 与 maxDepth 0/1 的组合', () => {
  /** @type {Array<{ depth: number, maxDepth: number, rings: boolean }>} */
  const cases = [
    { depth: 0, maxDepth: 0, rings: true },
    { depth: 1, maxDepth: 0, rings: false },
    { depth: 1, maxDepth: 1, rings: true },
    { depth: 2, maxDepth: 1, rings: false },
  ];

  for (const { depth, maxDepth, rings } of cases) {
    const h = createHarness({ config: { maxDepth } });
    h.detector.evaluate(targetApproval(), depthList(chainRows(depth)), new Map());
    assert.deepEqual(
      h.kinds(),
      rings ? ['approval'] : [],
      `depth=${depth} maxDepth=${maxDepth} 应${rings ? '发声' : '静音'}`,
    );
  }
});

test('深度门槛对四类事件都生效（全局策略，不只是 completed）', () => {
  const list = depthList(chainRows(1)); // target 深度 1

  const approval = createHarness({ config: { maxDepth: 0 } });
  approval.detector.evaluate(targetApproval(), list, new Map());
  assert.deepEqual(approval.kinds(), [], 'approval 受深度门槛约束');

  const question = createHarness({ config: { maxDepth: 0 } });
  question.detector.evaluate(
    statuses({ target: st({ pendingInteraction: { kind: 'plan-review' } }) }),
    list,
    new Map(),
  );
  assert.deepEqual(question.kinds(), [], 'question 受深度门槛约束');

  const interrupted = createHarness({ config: { maxDepth: 0 } });
  interrupted.detector.evaluate(statuses({ target: st({ running: true }) }), list, new Map());
  interrupted.detector.evaluate(
    statuses({ target: st({ running: false, lastAgentError: 'fatal' }) }),
    list,
    new Map(),
  );
  assert.deepEqual(interrupted.kinds(), [], 'interrupted 受深度门槛约束');

  const blocked = createHarness({ config: { maxDepth: 0 } });
  armSession(blocked, 'target', list);
  assert.deepEqual(blocked.kinds(), [], 'completed 同样受深度门槛约束');

  const allowed = createHarness({ config: { maxDepth: 1 } });
  armSession(allowed, 'target', list);
  assert.deepEqual(allowed.kinds(), ['completed'], 'maxDepth=1 时深度 1 的会话照响');
});

test('深度门槛：算不出深度 → 照响；明确的 subagent 父链断 → 按深度 1', () => {
  // list 缺失（getSessionList 拿不到快照）
  const noList = createHarness({ config: { maxDepth: 0 } });
  noList.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    undefined,
    new Map(),
  );
  assert.deepEqual(noList.kinds(), ['approval'], 'list 缺失 → 算不出深度 → 照响');

  // byId 里没有该会话
  const noRow = createHarness({ config: { maxDepth: 0 } });
  noRow.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    listOf({ ids: ['s1'], rows: {} }),
    new Map(),
  );
  assert.deepEqual(noRow.kinds(), ['approval'], 'byId 缺该项 → 照响');

  // 普通会话但父不在 byId（断链，无法证明它是子代理）
  const broken = createHarness({ config: { maxDepth: 0 } });
  broken.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    listOf({ ids: ['s1'], rows: { s1: depthRow('s1', 'missing-parent') } }),
    new Map(),
  );
  assert.deepEqual(broken.kinds(), ['approval'], '非 subagent 的断链 → 算不出 → 照响');

  // parentSessionId 为 null 但明确是 subagent → 至少按深度 1
  const subList = listOf({ ids: ['s1'], rows: { s1: depthRow('s1', null, true) } });
  const sub = createHarness({ config: { maxDepth: 0 } });
  sub.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    subList,
    new Map(),
  );
  assert.deepEqual(sub.kinds(), [], 'subagent 没有父链 → 按 1 → maxDepth=0 拦住');

  const subOk = createHarness({ config: { maxDepth: 1 } });
  subOk.detector.evaluate(
    statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) }),
    subList,
    new Map(),
  );
  assert.deepEqual(subOk.kinds(), ['approval'], '按深度 1 → maxDepth=1 放行');
});

test('深度门槛：环形父链不挂死，结果稳定', () => {
  // A → B → A，两者都没标记 subagent → 算不出深度 → 照响
  const cyclic = listOf({
    ids: ['a', 'b'],
    rows: { a: depthRow('a', 'b'), b: depthRow('b', 'a') },
  });
  const h = createHarness({ config: { maxDepth: 0 } });
  const pendingA = () => statuses({ a: st({ pendingInteraction: { kind: 'approval' } }) });

  h.detector.evaluate(pendingA(), cyclic, new Map());
  assert.deepEqual(h.kinds(), ['approval'], '环 → 算不出深度 → 照响');
  h.detector.evaluate(pendingA(), cyclic, new Map());
  h.detector.evaluate(pendingA(), cyclic, new Map());
  assert.deepEqual(h.kinds(), ['approval'], '环上重复判定结果稳定（不重复响）');

  // 同一环上但明确是 subagent → 按深度 1 → maxDepth=0 拦住
  const cyclicSub = listOf({
    ids: ['a', 'b'],
    rows: { a: depthRow('a', 'b', true), b: depthRow('b', 'a') },
  });
  const blocked = createHarness({ config: { maxDepth: 0 } });
  blocked.detector.evaluate(pendingA(), cyclicSub, new Map());
  assert.deepEqual(blocked.kinds(), [], 'subagent 的父链成环 → 按 1 → 被拦住');
});

test('深度门槛：超长父链在 MAX_SESSION_DEPTH 层封顶（防异常数据长循环）', () => {
  // 40 层父链：t → p1 → … → p40（p40 无父），远超封顶值。
  /** @type {Record<string, any>} */
  const rows = { t: depthRow('t', 'p1', true) };
  for (let level = 1; level <= 40; level += 1) {
    rows[`p${level}`] = depthRow(`p${level}`, level === 40 ? null : `p${level + 1}`, true);
  }
  const list = depthList(rows);
  const pending = () => statuses({ t: st({ pendingInteraction: { kind: 'approval' } }) });

  const capped = createHarness({ config: { maxDepth: MAX_SESSION_DEPTH - 1 } });
  capped.detector.evaluate(pending(), list, new Map());
  assert.deepEqual(capped.kinds(), [], `深度封顶在 ${MAX_SESSION_DEPTH} → 更低的上限必须拦住`);

  const allowed = createHarness({ config: { maxDepth: MAX_SESSION_DEPTH } });
  allowed.detector.evaluate(pending(), list, new Map());
  assert.deepEqual(allowed.kinds(), ['approval'], '封顶值本身仍然照响');
});

test('深度门槛：maxDepth 非法（NaN / 负数 / 字符串 / null / 缺失）→ 门槛失效、照响', () => {
  /** @type {Array<[string, any]>} */
  const cases = [
    ['NaN', Number.NaN],
    ['负数', -1],
    ['字符串 "0"', '0'],
    ['字符串 "abc"', 'abc'],
    ['null', null],
    ['缺失', undefined],
  ];

  for (const [name, maxDepth] of cases) {
    const h = createHarness({ config: { maxDepth } });
    // 深度 3 的会话：只要门槛被误当成生效，就一定不会响。
    h.detector.evaluate(targetApproval(), depthList(chainRows(3)), new Map());
    assert.deepEqual(h.kinds(), ['approval'], `${name} 应视为非法 → 门槛关闭、照响`);
  }
});

test('深度缓存：只在即将发声时计算，且同一会话只读一次父链', () => {
  const { list, reads } = countingChainList();
  const h = createHarness({ config: { maxDepth: 5 } });
  const approval = () => statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) });

  // 未命中发声点的 tick：根本不碰父链
  h.detector.evaluate(statuses({ s1: st({ running: true }) }), list, new Map());
  assert.deepEqual(reads, { p1: 0, p2: 0 }, '不发声时不得计算深度');

  // 第一次发声：父链各读一次
  h.detector.evaluate(approval(), list, new Map());
  assert.deepEqual(h.kinds(), ['approval']);
  assert.deepEqual(reads, { p1: 1, p2: 1 }, '首次发声时父链各读一次');

  // 第二次发声（新的上升沿）：必须命中缓存，不得再读父链
  h.detector.evaluate(statuses({ s1: st() }), list, new Map());
  h.detector.evaluate(approval(), list, new Map());
  assert.deepEqual(h.kinds(), ['approval', 'approval']);
  assert.deepEqual(reads, { p1: 1, p2: 1 }, '重复判定必须命中深度缓存');
});

test('深度缓存随会话消失清理：重新出现时重新计算父链', () => {
  const { list, reads } = countingChainList();
  const h = createHarness({ config: { maxDepth: 5 } });
  const approval = () => statuses({ s1: st({ pendingInteraction: { kind: 'approval' } }) });

  h.detector.evaluate(approval(), list, new Map());
  assert.deepEqual(h.kinds(), ['approval']);
  assert.deepEqual(reads, { p1: 1, p2: 1 });

  // 会话从列表消失（phase=ready）→ 深度缓存被清理
  h.detector.evaluate(new Map(), listOf({ ids: [], rows: {} }), new Map());

  // 同一 id 重新出现并再次发声 → 父链必须重新读取
  h.detector.evaluate(approval(), list, new Map());
  assert.deepEqual(h.kinds(), ['approval', 'approval']);
  assert.deepEqual(reads, { p1: 2, p2: 2 }, '缓存清理后必须重新计算父链');
});
