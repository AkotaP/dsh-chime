/**
 * dsh-chime 配置存储。
 *
 * 单一事实来源：`CONTRACT.md` §4.1。
 *
 * 设计要点：
 * - 配置持久化在 `localStorage`（key `dsh.chime.config.v1`），但 `localStorage`
 *   在隐私模式 / 被策略禁用 / Node 环境里都可能不可用，此时自动降级为纯内存模式。
 * - 快照是不可变语义：每次变更都产出新对象；若内容没有真正变化，则保留原引用并且
 *   不通知监听者（`subscribe` 只在快照引用变化时触发）。
 * - `normalizeConfig` 是唯一的容错入口：任何缺失字段、错误类型、越界音量都会回落到
 *   默认值，损坏的 JSON 只影响自己那一层，不会让整块配置失效。
 *
 * @module dsh-chime/config
 */

/** `localStorage` 中保存整份配置的 key。 */
export const STORAGE_KEY = 'dsh.chime.config.v1';

/** 音效种类（顺序即 UI 顺序）。 @type {ReadonlyArray<ChimeKind>} */
export const CHIME_KINDS = Object.freeze(['approval', 'question', 'interrupted', 'completed']);

/** 单个音效配置；`src` 为空字符串表示未配置（不响）。 @type {Readonly<ChimeConfig>} */
export const DEFAULT_CHIME = Object.freeze({ src: '', volume: 0.8, source: 'url' });

/**
 * 默认整份配置。
 * @type {Readonly<{ backgroundSessions: boolean, completionMinSeconds: number, enabled: boolean, maxDepth: number, kinds: Readonly<Record<ChimeKind, ChimeConfig>> }>}
 */
export const DEFAULT_CONFIG = deepFreeze({
  backgroundSessions: false, // 背景会话是否也响
  completionMinSeconds: 10, // 完成音的最短任务时长（秒）；0 = 不设门槛
  enabled: true, // 总开关
  maxDepth: 0, // 最深发声的会话层级；0 = 只有主对话
  kinds: {
    approval: { src: '', volume: 0.8, source: 'url' },
    question: { src: '', volume: 0.8, source: 'url' },
    interrupted: { src: '', volume: 0.8, source: 'url' },
    completed: { src: '', volume: 0.8, source: 'url' },
  },
});

/**
 * 音效种类。
 * @typedef {'approval' | 'question' | 'interrupted' | 'completed'} ChimeKind
 */

/**
 * 音效来源：`url` 直接交给 `Audio`；`file` 走本地文件读取 → Blob URL。
 * @typedef {'url' | 'file' | 'local'} ChimeSource
 */

/**
 * 单个音效配置。
 * @typedef {{ src: string, volume: number, source: ChimeSource }} ChimeConfig
 */

/**
 * 整份配置快照（`ObservableSnapshot` 风格）。
 * @typedef {{ backgroundSessions: boolean, completionMinSeconds: number, enabled: boolean, maxDepth: number, kinds: Record<ChimeKind, ChimeConfig> }} ChimeConfigSnapshot
 */

/**
 * 容错读入配置：字段缺失、类型错误、音量越界一律回落默认值；未知 kind 直接丢弃。
 *
 * @param {unknown} raw 任意来源（JSON.parse 结果、旧版本数据、null……）。
 * @returns {ChimeConfigSnapshot} 一份全新的、保证合法的配置对象（永远不是传入对象本身）。
 */
export function normalizeConfig(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const rawKinds = isPlainObject(source.kinds) ? source.kinds : {};

  /** @type {Record<string, ChimeConfig>} */
  const kinds = {};
  for (const kind of CHIME_KINDS) {
    kinds[kind] = normalizeChime(rawKinds[kind]);
  }

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_CONFIG.enabled,
    backgroundSessions:
      typeof source.backgroundSessions === 'boolean'
        ? source.backgroundSessions
        : DEFAULT_CONFIG.backgroundSessions,
    completionMinSeconds: normalizeMinSeconds(source.completionMinSeconds),
    maxDepth: normalizeMaxDepth(source.maxDepth),
    kinds: /** @type {Record<ChimeKind, ChimeConfig>} */ (kinds),
  };
}

/**
 * 创建配置 store。
 *
 * 返回对象形状见 `CONTRACT.md` §4.1：
 * `{ getSnapshot, subscribe, update, setKind, reset }`。
 *
 * 说明（契约未定义、由实现决定的细节）：
 * - 每个 store 实例是独立的内存状态，只在创建时读一次 `localStorage`；不做跨标签页同步。
 * - `update(patch)` 只浅合并顶层字段；`patch.kinds` 一旦出现就整体替换（随后走容错归一）。
 * - `update` / `setKind` / `reset` 返回当前快照，方便调用方链式使用。
 * - 监听者抛错不会影响其他监听者，也不会影响 store 状态。
 *
 * @returns {{
 *   getSnapshot: () => ChimeConfigSnapshot,
 *   subscribe: (fn: (config: ChimeConfigSnapshot) => void) => () => void,
 *   update: (patch?: object) => ChimeConfigSnapshot,
 *   setKind: (kind: ChimeKind, patch?: object) => ChimeConfigSnapshot,
 *   reset: () => ChimeConfigSnapshot,
 * }} 配置 store。
 */
export function createConfigStore() {
  /** @type {Set<(config: ChimeConfigSnapshot) => void>} */
  const listeners = new Set();
  /** @type {ChimeConfigSnapshot} */
  let snapshot = normalizeConfig(readPersisted());

  /**
   * 提交候选快照：内容无变化则保留原引用且不通知。
   * @param {ChimeConfigSnapshot} candidate 候选快照。
   * @returns {ChimeConfigSnapshot} 生效后的快照。
   */
  function commit(candidate) {
    if (candidate === snapshot || configsEqual(candidate, snapshot)) return snapshot;
    snapshot = candidate;
    writePersisted(snapshot);
    for (const listener of Array.from(listeners)) {
      try {
        listener(snapshot);
      } catch {
        // 监听者自身的问题不该影响 store 与其他监听者。
      }
    }
    return snapshot;
  }

  return {
    /** @returns {ChimeConfigSnapshot} 当前快照（视为只读）。 */
    getSnapshot() {
      return snapshot;
    },

    /**
     * 订阅变更。
     * @param {(config: ChimeConfigSnapshot) => void} fn 监听函数。
     * @returns {() => void} 取消订阅（幂等）。
     */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    /**
     * 浅合并顶层字段。
     * @param {object} [patch] 例如 `{ enabled: false }`。
     * @returns {ChimeConfigSnapshot} 生效后的快照。
     */
    update(patch) {
      const safe = isPlainObject(patch) ? patch : {};
      /** @type {object} */
      const merged = { ...snapshot, ...safe };
      if (!('kinds' in safe)) merged.kinds = snapshot.kinds;
      return commit(normalizeConfig(merged));
    },

    /**
     * 只合并某一个音效的字段（src / volume / source）。
     * @param {ChimeKind} kind 音效种类；非法时不做任何事。
     * @param {object} [patch] 例如 `{ src, source, volume }`。
     * @returns {ChimeConfigSnapshot} 生效后的快照。
     */
    setKind(kind, patch) {
      if (!CHIME_KINDS.includes(kind)) return snapshot;
      const safe = isPlainObject(patch) ? patch : {};
      const kinds = {
        ...snapshot.kinds,
        [kind]: { ...snapshot.kinds[kind], ...safe },
      };
      return commit(normalizeConfig({ ...snapshot, kinds }));
    },

    /** @returns {ChimeConfigSnapshot} 恢复默认配置（并写回存储）。 */
    reset() {
      return commit(normalizeConfig(null));
    },
  };
}

/**
 * 归一化单个音效配置。
 * @param {unknown} raw 原始值。
 * @returns {ChimeConfig} 合法配置。
 */
function normalizeChime(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    src: typeof source.src === 'string' ? source.src : DEFAULT_CHIME.src,
    volume: normalizeVolume(source.volume),
    source: normalizeSource(source.source),
  };
}

/** 播放引擎认识的音源类型。 */
const CHIME_SOURCES = Object.freeze(['url', 'file', 'local']);

/**
 * 归一化音源类型；缺失或未知值一律回落到 `url`。
 * @param {unknown} value 原始值。
 * @returns {ChimeSource} 合法音源类型。
 */
function normalizeSource(value) {
  return typeof value === 'string' && CHIME_SOURCES.includes(value) ? value : 'url';
}

/**
 * 音量钳制到 0..1；非有限数字回落到默认音量。
 * @param {unknown} value 原始音量。
 * @returns {number} 0..1 之间的音量。
 */
function normalizeVolume(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CHIME.volume;
  return Math.min(1, Math.max(0, value));
}

/** 「最短任务时长」的上限（秒）。 */
const MIN_SECONDS_MAX = 3600;

/**
 * 归一化「最短任务时长」：取整并钳到 0..3600；缺失或非法回落默认值。
 *
 * `0` 是合法值，表示关闭门槛（总是响）。
 *
 * @param {unknown} value 原始值。
 * @returns {number} 0..3600 之间的整秒数。
 */
function normalizeMinSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONFIG.completionMinSeconds;
  }
  return Math.min(MIN_SECONDS_MAX, Math.max(0, Math.floor(value)));
}

/** 「最深响应的对话层级」的上限。 */
const MAX_DEPTH_MAX = 16;

/**
 * 归一化「最深响应的对话层级」：取整并钳到 0..16；缺失或非法回落默认值。
 *
 * `0` 是合法值，表示只有主对话发声。
 *
 * @param {unknown} value 原始值。
 * @returns {number} 0..16 之间的整数层级。
 */
function normalizeMaxDepth(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONFIG.maxDepth;
  }
  return Math.min(MAX_DEPTH_MAX, Math.max(0, Math.floor(value)));
}

/**
 * 深比较两份配置（字段全等）。
 * @param {ChimeConfigSnapshot} a 配置 A。
 * @param {ChimeConfigSnapshot} b 配置 B。
 * @returns {boolean} 是否完全一致。
 */
function configsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  // Every top-level field must be compared here: `commit` uses this function
  // to decide whether a write changes anything, so a field missing from this
  // list can never be updated at all.
  if (
    a.enabled !== b.enabled ||
    a.backgroundSessions !== b.backgroundSessions ||
    a.completionMinSeconds !== b.completionMinSeconds ||
    a.maxDepth !== b.maxDepth
  ) {
    return false;
  }
  for (const kind of CHIME_KINDS) {
    const left = a.kinds[kind];
    const right = b.kinds[kind];
    if (!left || !right) return false;
    if (left.src !== right.src || left.volume !== right.volume || left.source !== right.source) {
      return false;
    }
  }
  return true;
}

/**
 * 从 `localStorage` 读出原始配置；不可用或数据损坏时返回 `null`。
 * @returns {unknown} 原始 JSON 值或 null。
 */
function readPersisted() {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return null;
    const text = storage.getItem(STORAGE_KEY);
    if (typeof text !== 'string' || text.length === 0) return null;
    return JSON.parse(text);
  } catch {
    // 访问 localStorage 本身可能抛 SecurityError；JSON 损坏也会走到这里。
    return null;
  }
}

/**
 * 把配置写入 `localStorage`；失败（隐私模式 / 配额 / 不可用）时静默降级为内存模式。
 * @param {ChimeConfigSnapshot} config 待写入的配置。
 * @returns {void}
 */
function writePersisted(config) {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.setItem !== 'function') return;
    storage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 写不进去不影响内存里的配置生效。
  }
}

/**
 * 判断是否为普通对象（排除 null / 数组）。
 * @param {unknown} value 待判断值。
 * @returns {boolean} 是否普通对象。
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 递归冻结对象（用于导出的默认值常量，防止被下游意外改写）。
 * @template T
 * @param {T} value 待冻结对象。
 * @returns {T} 同一个对象。
 */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
