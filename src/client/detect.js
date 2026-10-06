/**
 * dsh-chime 事件判定器 —— 四类音效事件的判定与防误报。
 *
 * 规格来源：`CONTRACT.md` §3（判定规则）与 §4.4（模块接口）。
 * 参考实现：`.probe/workspace-client.js:441-467,1386-1435`（DSH 侧边栏状态机）、
 * `.probe/ui-session-client.js:314-358`（running / completionUnread）、
 * `.probe/agent-loop.js:790-798`（running 只是 agent loop 的 phase，不等于任务结束）。
 *
 * 核心设计：
 * - `evaluate(statuses, list, activeJobs)` 是**数据驱动的单步求值**：只读入参、
 *   内部 per-session 状态和注入的依赖函数，不读任何全局状态，可直接喂假数据单测。
 *   `start()` 只负责把真实快照喂给同一个 `evaluate`。
 * - 只做**上升沿**触发；同一会话同一 tick 只产出优先级最高的一个事件（§3.1）。
 * - `interrupted` 只认 `lastAgentError`：错误出现后，必须等到该会话确实不在跑
 *   （`running === false`）时才响；重试期间的瞬时错误（running 仍为 true，
 *   或重试成功后错误被清空）一律不响（§3.4，需求 4）。
 * - `completed` 走「曾活跃 → 全空闲 → 防抖到期」三段式复合判定（§3.5）。
 * - `completed` 另有一道**最短任务时长门槛**：距该会话最后一条用户消息不足
 *   `config.completionMinSeconds` 秒就不响，避免小任务频繁响铃。门槛只决定
 *   「这一次响不响」，不参与内部状态推进；拿不到时间戳或配置没给该字段时**照响**
 *   （主人指定的回落方向：宁可多响，绝不静默）。
 *
 * @module dsh-chime/detect
 */

/** 完成事件防抖窗口（毫秒），CONTRACT §3.5。 */
export const COMPLETION_DEBOUNCE_MS = 1200;

/** `start()` 的默认轮询间隔（毫秒）。 */
export const DEFAULT_POLL_MS = 400;

/** 视为「活跃后台 job」的状态（job 计数由调用方计算，此处仅用于容错入参）。 */
const ACTIVE_JOB_STATUSES = new Set(['running', 'stopping']);

/**
 * 空会话列表；`phase: 'pending'` 表示基线未就绪，避免此时清理会话状态。
 * @type {Readonly<{ ids: string[], byId: Record<string, unknown>, projectionsBySession: Record<string, unknown>, phase: string }>}
 */
const EMPTY_LIST = Object.freeze({
  ids: Object.freeze([]),
  byId: Object.freeze({}),
  projectionsBySession: Object.freeze({}),
  phase: 'pending',
});

/**
 * 判定用事件。
 * @typedef {object} ChimeEvent
 * @property {'approval' | 'question' | 'interrupted' | 'completed'} kind 事件种类。
 * @property {string} sessionId 触发事件的会话 id。
 * @property {boolean} [urgent] 是否需要用户立刻注意（当前仅 `approval` 为 true）。
 */

/**
 * 每个会话的判定状态。
 * @typedef {object} SessionState
 * @property {'approval' | 'question' | undefined} pendingKind 上一次求值时的归一化 pending 类型。
 * @property {boolean} errorFired 当前错误「事件期」内是否已经响过 interrupted。
 * @property {boolean} seenActive 是否观察到过活跃（running / 子代理 / job）。
 * @property {number | null} armAt 完成防抖计时起点；`null` 表示未武装。
 * @property {unknown} timer 防抖定时器句柄。
 */

/** 默认错误上报（只写控制台，绝不打断判定）。 */
function defaultOnError(error, where) {
  try {
    globalThis.console?.warn?.(`[dsh-chime] ${where}`, error);
  } catch {
    // 控制台不可用时忽略。
  }
}

/** @returns {SessionState} 全新的会话判定状态。 */
function createSessionState() {
  return {
    pendingKind: undefined,
    errorFired: false,
    seenActive: false,
    armAt: null,
    timer: null,
  };
}

/**
 * 从 `Map` 或普通对象里取一个键（两种形态都能当数据源）。
 * @param {unknown} source Map / 普通对象 / null。
 * @param {string} id 键。
 * @returns {any} 对应值，缺失时为 undefined。
 */
function readFrom(source, id) {
  if (source === null || source === undefined) return undefined;
  if (typeof source.get === 'function') return source.get(id);
  return source[id];
}

/**
 * 把 `Map` / 普通对象的键收进集合。
 * @param {unknown} source Map / 普通对象 / null。
 * @param {Set<string>} out 目标集合（原地修改）。
 * @returns {Set<string>} 同一个集合。
 */
function addKeys(source, out) {
  if (source === null || source === undefined) return out;
  if (typeof source.keys === 'function' && typeof source.get === 'function') {
    for (const key of source.keys()) out.add(key);
    return out;
  }
  for (const key of Object.keys(source)) out.add(key);
  return out;
}

/**
 * 收集本 tick 需要判定的全部会话 id（statuses ∪ list.ids ∪ list.byId）。
 * @param {unknown} statuses 会话状态集合。
 * @param {any} list 会话列表快照。
 * @returns {Set<string>} 会话 id 集合。
 */
function collectSessionIds(statuses, list) {
  const ids = new Set();
  addKeys(statuses, ids);
  if (Array.isArray(list?.ids)) for (const id of list.ids) ids.add(id);
  addKeys(list?.byId, ids);
  return ids;
}

/**
 * 归一化 `pendingInteraction.kind`（CONTRACT §3.2/§3.3）。
 * `plan-review` 归入 `question`，未知值一律忽略。
 * @param {unknown} kind 原始 kind。
 * @returns {'approval' | 'question' | undefined} 归一化后的类型。
 */
function normalizePendingKind(kind) {
  switch (kind) {
    case 'approval':
      return 'approval';
    case 'question':
    case 'plan-review':
      return 'question';
    default:
      return undefined;
  }
}

/**
 * 在跑子代理数，算法照搬 `.probe/workspace-client.js:449-451`。
 * @param {any} list 会话列表快照。
 * @param {string} parentId 父会话 id。
 * @param {unknown} statuses 会话状态集合。
 * @returns {number} 正在运行的子代理数量。
 */
function runningChildCount(list, parentId, statuses) {
  const catalog = list?.projectionsBySession?.[parentId]?.values?.subagentCatalog;
  if (!Array.isArray(catalog)) return 0;
  let count = 0;
  for (const child of catalog) {
    const childId = child?.id;
    if (childId === undefined) continue;
    const running = readFrom(statuses, childId)?.running ?? list?.byId?.[childId]?.running;
    if (running === true) count += 1;
  }
  return count;
}

/**
 * 读取某会话的活跃 job 数。
 *
 * 规范入参是 `Map<sessionId, number>`（或同形普通对象）；同时容忍
 * 「job 视图数组」写法（按 `status ∈ {running, stopping}` 计数），
 * 这样 `countActiveJobs` 无论返回计数还是原始 roster 都不会误判。
 *
 * @param {unknown} activeJobs 活跃 job 计数集合。
 * @param {string} id 会话 id。
 * @returns {number} 活跃 job 数（非负数）。
 */
function readActiveJobs(activeJobs, id) {
  const raw = readFrom(activeJobs, id);
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  if (!Array.isArray(raw)) return 0;
  let count = 0;
  for (const item of raw) {
    if (typeof item === 'number') {
      if (item > 0) count += 1;
    } else if (ACTIVE_JOB_STATUSES.has(item?.status)) {
      count += 1;
    }
  }
  return count;
}

/**
 * 创建事件判定器（CONTRACT §4.4）。
 *
 * 除契约声明的 5 个依赖外，还接受若干**可选**依赖，用于时间与数据源注入：
 *
 * | 依赖 | 作用 |
 * |---|---|
 * | `now`, `setTimeout`, `clearTimeout` | 注入时钟/定时器（默认取全局），单测用假时钟即可让 1200ms 防抖确定性地到期 |
 * | `debounceMs`, `pollMs` | 覆盖防抖窗口与轮询间隔 |
 * | `getAgentError` / `getSessionSnapshot` | 可选：读出 `SessionSnapshot.lastAgentError`。DSH 的 `SessionStatus`（§2.2）本身不带该字段，若不提供则本判定器只会从 `statuses` 条目或 `list.byId[id]` 上读同名字段 |
 * | `getLastUserMessageTime` | 可选：读出该会话最后一条用户消息的时间戳，用于 `completed` 的最短任务时长门槛；拿不到（缺失 / 返回 null、undefined、非有限数 / 抛错）时一律照响 |
 * | `onError` | 错误上报（默认 `console.warn`），判定永不因依赖抛错而中断 |
 *
 * @param {object} [deps] 依赖。
 * @param {() => Map<string, any>} [deps.getStatuses] 取 `uiSession.sessionStatus` 快照。
 * @param {() => any} [deps.getSessionList] 取 `sessions.list` 快照。
 * @param {(sessionId: string) => Promise<number>} [deps.countActiveJobs] 取某会话活跃 job 数。
 * @param {(event: ChimeEvent) => void} [deps.onChime] 命中事件时回调。
 * @param {() => any} [deps.getConfig] 取配置快照（读 `enabled` / `backgroundSessions` / `completionMinSeconds`）。
 * @param {(sessionId: string) => (string | null | undefined)} [deps.getAgentError] 可选：直接读最终错误。
 * @param {(sessionId: string) => any} [deps.getSessionSnapshot] 可选：读 `SessionSnapshot`。
 * @param {(sessionId: string) => (number | null | undefined)} [deps.getLastUserMessageTime] 可选：读该会话最后一条用户消息的时间戳（毫秒，与 `now` 同源）。
 * @param {() => number} [deps.now] 可选：当前时间戳。
 * @param {(fn: () => void, ms: number) => unknown} [deps.setTimeout] 可选：定时器。
 * @param {(handle: unknown) => void} [deps.clearTimeout] 可选：取消定时器。
 * @param {number} [deps.debounceMs] 可选：完成防抖窗口。
 * @param {number} [deps.pollMs] 可选：`start()` 轮询间隔。
 * @param {(error: unknown, where: string) => void} [deps.onError] 可选：错误上报。
 * @returns {{ start: () => () => void, evaluate: (statuses: unknown, list: any, activeJobs: unknown) => ChimeEvent[], dispose: () => void }} 判定器。
 */
export function createDetector(deps) {
  const {
    getStatuses = () => new Map(),
    getSessionList = () => EMPTY_LIST,
    countActiveJobs = async () => 0,
    onChime = () => {},
    getConfig = () => ({}),
    getAgentError = null,
    getSessionSnapshot = null,
    getLastUserMessageTime = null,
    now = () => Date.now(),
    setTimeout: schedule = (fn, ms) => setTimeout(fn, ms),
    clearTimeout: cancel = (handle) => clearTimeout(handle),
    debounceMs: rawDebounceMs = COMPLETION_DEBOUNCE_MS,
    pollMs: rawPollMs = DEFAULT_POLL_MS,
    onError = defaultOnError,
  } = deps ?? {};

  const debounceMs =
    typeof rawDebounceMs === 'number' && Number.isFinite(rawDebounceMs) && rawDebounceMs >= 0
      ? rawDebounceMs
      : COMPLETION_DEBOUNCE_MS;
  const pollMs =
    typeof rawPollMs === 'number' && Number.isFinite(rawPollMs) && rawPollMs > 0
      ? rawPollMs
      : DEFAULT_POLL_MS;

  /** @type {Map<string, SessionState>} 每个会话的上一次判定状态。 */
  const states = new Map();
  /** @type {Map<string, number>} 最近一次成功读到的活跃 job 数。 */
  const jobCounts = new Map();
  /** 最近一次喂给 `evaluate` 的数据（供防抖定时器在纯求值模式下复用）。 */
  let lastData = { statuses: new Map(), list: EMPTY_LIST, activeJobs: new Map() };
  let disposed = false;
  let started = false;
  let ticking = false;
  /** @type {unknown} */
  let pollHandle = null;

  /** @param {unknown} error 错误。 @param {string} where 位置。 */
  function report(error, where) {
    try {
      onError(error, where);
    } catch {
      // 上报本身出错也要吞掉。
    }
  }

  /** @param {string} id 会话 id。 @returns {SessionState} 该会话状态（按需创建）。 */
  function stateOf(id) {
    let state = states.get(id);
    if (state === undefined) {
      state = createSessionState();
      states.set(id, state);
    }
    return state;
  }

  /** 取消某个会话的完成防抖（幂等）。 @param {SessionState} state 会话状态。 */
  function cancelArm(state) {
    if (state.timer !== null) {
      try {
        cancel(state.timer);
      } catch (error) {
        report(error, 'clearTimeout');
      }
      state.timer = null;
    }
    state.armAt = null;
  }

  /**
   * 武装一次「完成」候选：先记时，等防抖窗口结束后再确认。
   * 窗口内任何活跃迹象（running 回来 / 新 job / 新子代理）都会取消它。
   *
   * @param {string} id 会话 id。
   * @param {SessionState} state 会话状态。
   * @param {number} nowMs 当前时间。
   */
  function armCompletion(id, state, nowMs) {
    state.armAt = nowMs;
    const onDeadline = () => {
      state.timer = null;
      if (disposed) return;
      // 定时器到点时再求值一次：确认窗口内没有重新活跃（§3.5）。
      if (started) {
        void tick();
      } else {
        evaluate(lastData.statuses, lastData.list, lastData.activeJobs);
      }
      // 时钟精度导致「到点但还差一点」时补一次定时，避免完成事件被吞掉。
      if (!disposed && state.armAt !== null && state.timer === null) {
        const remaining = debounceMs - (now() - state.armAt);
        if (remaining > 0) {
          state.timer = schedule(onDeadline, remaining);
        }
      }
    };
    try {
      state.timer = schedule(onDeadline, debounceMs);
    } catch (error) {
      report(error, 'setTimeout');
      state.timer = null;
    }
  }

  /**
   * 读某个会话的最终错误来源（`lastAgentError`）。
   *
   * 优先用入参数据里已有的字段，其次才是可选依赖；任何一层抛错都当作「无错误」，
   * 以免判定器被数据源拖垮。
   *
   * @param {string} id 会话 id。
   * @param {any} status 会话状态条目。
   * @param {any} row 会话列表行。
   * @returns {unknown} 原始错误值（falsy 表示无错误）。
   */
  function agentErrorFor(id, status, row) {
    const direct = status?.lastAgentError ?? row?.lastAgentError;
    if (direct !== undefined && direct !== null && direct !== false) return direct;
    if (typeof getAgentError === 'function') {
      try {
        const value = getAgentError(id);
        if (value !== undefined && value !== null && value !== false) return value;
      } catch (error) {
        report(error, 'getAgentError');
      }
    }
    if (typeof getSessionSnapshot === 'function') {
      try {
        const value = getSessionSnapshot(id)?.lastAgentError;
        if (value !== undefined && value !== null && value !== false) return value;
      } catch (error) {
        report(error, 'getSessionSnapshot');
      }
    }
    return null;
  }

  /**
   * 读某个会话最后一条用户消息的时间戳。
   *
   * 拿不到时一律返回 `undefined`（= 照响）：依赖缺失、返回 null / undefined /
   * 非有限数、或依赖本身抛错，都视同「没有时间戳」，绝不让门槛把声音静默掉。
   *
   * @param {string} id 会话 id。
   * @returns {number | undefined} 时间戳（毫秒，与 `now()` 同源）；拿不到时为 undefined。
   */
  function lastUserMessageTimeFor(id) {
    if (typeof getLastUserMessageTime !== 'function') return undefined;
    try {
      const value = getLastUserMessageTime(id);
      return typeof value === 'number' ? value : undefined;
    } catch (error) {
      report(error, 'getLastUserMessageTime');
      return undefined;
    }
  }

  /**
   * 「最短任务时长」门槛：本次 `completed` 是否应当被拦下。
   *
   * 计时起点是**用户消息时间戳**（不是 `running` 上升沿）——中途等审批/回答不会
   * 产生新的 `user/message`，因此长任务不会因为一次审批被误判成刚开的新任务。
   *
   * @param {string} id 会话 id。
   * @param {number} nowMs 本 tick 的时间（来自可注入时钟）。
   * @param {any} config 本 tick 的配置快照。
   * @returns {boolean} true = 任务太短，本次不响 completed。
   */
  function completionTooShort(id, nowMs, config) {
    const min = Number(config?.completionMinSeconds);
    // 门槛关闭 / 配置没给该字段（NaN）→ 照响。
    if (!Number.isFinite(min) || min <= 0) return false;
    const startedAt = lastUserMessageTimeFor(id);
    // 拿不到用户消息时间戳 → 照响（主人指定的回落方向）。
    if (!Number.isFinite(startedAt)) return false;
    return nowMs - startedAt < min * 1000;
  }

  /**
   * 单步求值（CONTRACT §4.4）：本 tick 每个会话最多产出一个事件。
   *
   * @param {unknown} statuses `Map<SessionId, SessionStatus>`（也容忍普通对象）。
   * @param {any} list `SessionListSnapshot`。
   * @param {unknown} activeJobs `Map<SessionId, number>`（也容忍普通对象 / job 数组）。
   * @returns {ChimeEvent[]} 本 tick 实际触发的事件（同时已回调 `onChime`）。
   */
  function evaluate(statuses, list, activeJobs) {
    if (disposed) return [];
    const sessionList = list ?? EMPTY_LIST;
    lastData = { statuses, list: sessionList, activeJobs };

    let config = {};
    try {
      config = getConfig() ?? {};
    } catch (error) {
      report(error, 'getConfig');
      config = {};
    }
    const enabled = config.enabled !== false;
    const backgroundSessions = config.backgroundSessions === true;
    const nowMs = now();
    /** @type {ChimeEvent[]} */
    const emitted = [];
    const ids = collectSessionIds(statuses, sessionList);

    for (const id of ids) {
      const state = stateOf(id);
      const status = readFrom(statuses, id);
      const row = sessionList.byId?.[id];

      const running = (status?.running ?? row?.running) === true;
      const pendingKind = normalizePendingKind(status?.pendingInteraction?.kind);
      const errorActive = Boolean(agentErrorFor(id, status, row));
      const childCount = runningChildCount(sessionList, id, statuses);
      const jobCount = readActiveJobs(activeJobs, id);
      const activeWork = running || childCount > 0 || jobCount > 0;
      // 列表里查不到该会话时（例如启动期 `list.phase === 'pending'`）无法证明它是
      // 背景会话，按「激活」处理，避免漏掉主会话的第一次审批。
      const isActiveSession = row === undefined || (row.retainedBy?.mainView ?? 0) > 0;
      const audible = enabled && (backgroundSessions || isActiveSession);

      // 1) 记录活跃事实：completed 必须建立在「曾经活跃」之上，防止初始状态误触发（§3.5）。
      if (activeWork) state.seenActive = true;

      // 2) 错误「事件期」：错误消失即复位；同一事件期内只响一次（§3.4）。
      if (!errorActive) state.errorFired = false;

      // 3) 上升沿判定（§3.2 / §3.3 / §3.4）。
      const approvalRising = pendingKind === 'approval' && state.pendingKind !== 'approval';
      const questionRising = pendingKind === 'question' && state.pendingKind !== 'question';
      // 真中断 = 处于错误事件期内 **且此刻已不在跑**，且本次错误还没响过。
      // - 重试期间的瞬时错误：running 仍为 true → 不响；重试成功后 lastAgentError
      //   被清空 → 事件期直接结束，依然不响（需求 4）。
      // - 最终错误：lastAgentError 保留，会话落回 idle 后仍成立 → 响（§3.4）。
      const interruptedRising = errorActive && !running && !state.errorFired;

      // 4) completed：等待交互、活跃工作、高优先级事件都会取消/推迟本次完成（§3.1 / §3.5）。
      let completed = false;
      const blocked = activeWork || pendingKind !== undefined;
      if (approvalRising || questionRising || interruptedRising) {
        // 同一 tick 已有更高优先级事件：吞掉待发的 completed（§3.1）。
        cancelArm(state);
      } else if (blocked) {
        cancelArm(state);
      } else if (state.seenActive && state.armAt === null) {
        armCompletion(id, state, nowMs);
      } else if (state.seenActive && state.armAt !== null && nowMs - state.armAt >= debounceMs) {
        completed = true;
        state.seenActive = false;
        cancelArm(state);
      }

      // 5) 推进状态（必须在判定之后，否则上升沿会被自己吃掉）。
      state.pendingKind = pendingKind;
      if (interruptedRising) state.errorFired = true;

      // 6) 同一会话同一 tick 只取优先级最高的一个：approval > question > interrupted > completed。
      const kind = approvalRising
        ? 'approval'
        : questionRising
          ? 'question'
          : interruptedRising
            ? 'interrupted'
            : completed
              ? 'completed'
              : null;
      if (kind === null) continue;

      // 非激活会话 / 总开关关闭时不出声；状态照常推进，避免解禁后补响旧事件。
      if (!audible) continue;

      // completed 的最短任务时长门槛：只决定「这一次响不响」。
      // 上面的状态推进（seenActive 复位、取消防抖）已经完成，所以短任务既不补响，
      // 也不会吞掉下一次正常完成；approval / question / interrupted 不走这道门槛。
      if (kind === 'completed' && completionTooShort(id, nowMs, config)) continue;

      /** @type {ChimeEvent} */
      const event = { kind, sessionId: id, urgent: kind === 'approval' };
      emitted.push(event);
      try {
        onChime(event);
      } catch (error) {
        report(error, 'onChime');
      }
    }

    // 7) 清理已经消失的会话（仅在列表基线就绪时；参考 ui-session-client.js:332-336）。
    if (sessionList.phase === 'ready') {
      for (const [id, state] of states) {
        if (ids.has(id)) continue;
        cancelArm(state);
        states.delete(id);
      }
    }

    return emitted;
  }

  /**
   * 刷新所有会话的活跃 job 计数。
   *
   * 读取失败时**保留旧值**，绝不回落 0 —— 否则一次网络抖动就会被当成「全部空闲」
   * 而误报 completed。
   *
   * @param {Set<string>} ids 会话 id 集合。
   * @returns {Promise<Map<string, number>>} 计数快照。
   */
  async function refreshJobCounts(ids) {
    for (const id of ids) {
      try {
        const value = await countActiveJobs(id);
        if (typeof value === 'number' && Number.isFinite(value)) {
          jobCounts.set(id, Math.max(0, value));
        } else if (Array.isArray(value)) {
          jobCounts.set(id, readActiveJobs(new Map([[id, value]]), id));
        }
      } catch (error) {
        report(error, 'countActiveJobs');
      }
    }
    return new Map(jobCounts);
  }

  /** 下一次轮询。 */
  function scheduleNextPoll() {
    if (disposed || !started) return;
    pollHandle = schedule(() => tick(), pollMs);
  }

  /** 拉取真实快照并求值一次。 */
  async function tick() {
    if (disposed || ticking) return;
    ticking = true;
    try {
      const list = getSessionList() ?? EMPTY_LIST;
      const ids = collectSessionIds(getStatuses(), list);
      if (list.phase === 'ready') {
        for (const id of [...jobCounts.keys()]) if (!ids.has(id)) jobCounts.delete(id);
      }
      const activeJobs = await refreshJobCounts(ids);
      if (disposed) return;
      evaluate(getStatuses(), list, activeJobs);
    } catch (error) {
      report(error, 'tick');
    } finally {
      ticking = false;
      scheduleNextPoll();
    }
  }

  /**
   * 开始监听：轮询真实快照 → `evaluate`。返回的停止函数与 `dispose()` 等价且幂等。
   * @returns {() => void} 停止监听并释放资源。
   */
  function start() {
    if (started) return dispose;
    disposed = false;
    started = true;
    void tick();
    return dispose;
  }

  /** 停止监听并清理全部定时器与状态（幂等）。 */
  function dispose() {
    if (!disposed) {
      disposed = true;
      started = false;
      if (pollHandle !== null) {
        try {
          cancel(pollHandle);
        } catch (error) {
          report(error, 'clearTimeout');
        }
        pollHandle = null;
      }
      for (const state of states.values()) cancelArm(state);
      states.clear();
      jobCounts.clear();
    }
  }

  return { start, evaluate, dispose };
}
